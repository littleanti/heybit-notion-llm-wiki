#!/usr/bin/env node
'use strict';
// wiki → Notion 게시 (docs/TRD.md 6.2). 기본 dry-run. --apply 일 때만 쓴다.
// 위키 루트 아래 자기가 만든 페이지만 만지고, 원본(raw) 페이지는 대상이 될 수 없다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig, loadEnv, requireToken, normalizeId } = require('./lib/config');
const { createClient } = require('./lib/notion-client');
const { listRawPages, listWikiPages, displayTitle, wikiOrder, compareTuples, WIKI_SPECIAL } = require('./lib/pages');
const { toEnhancedMarkdown, callout } = require('./lib/md-notion');
const fm = require('./lib/frontmatter');

const STATE_FILE = '.publish-state.json';
const STATE_VERSION = 1;

function loadState(wikiDir, rootPageId) {
  const file = path.join(wikiDir, STATE_FILE);
  if (!fs.existsSync(file)) return { version: STATE_VERSION, rootPageId, pages: {} };
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (s.version !== STATE_VERSION) throw new Error(`게시 상태 파일 버전이 다릅니다 (${s.version} ≠ ${STATE_VERSION})`);
  if (s.rootPageId && normalizeId(s.rootPageId) !== rootPageId) {
    throw new Error(`중단: 게시 상태 파일의 위키 루트(${s.rootPageId})와 설정(${rootPageId})이 다릅니다. 다른 워크스페이스의 상태 파일입니다.`);
  }
  s.pages = s.pages || {};
  return s;
}

function saveState(wikiDir, state) {
  const sorted = { version: state.version, rootPageId: state.rootPageId, pages: Object.fromEntries(Object.keys(state.pages).sort().map((k) => [k, state.pages[k]])) };
  fs.writeFileSync(path.join(wikiDir, STATE_FILE), JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function readSyncedAt(cfg, rootDir) {
  const f = path.join(rootDir, cfg.paths.raw, '.sync-state.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).syncedAt || null; } catch { return null; }
}

function markerText({ updated, syncedAt }) {
  const sync = syncedAt ? syncedAt.replace('T', ' ').slice(0, 16) : '기록 없음';
  return `🤖 이 페이지는 LLM wiki 가 자동 생성·갱신합니다 (마지막 갱신 ${updated}, 원본 동기화 ${sync}). 직접 수정하면 다음 게시 때 덮어써집니다. 틀린 내용은 원본 페이지를 고치거나, 이 페이지에 페이지 코멘트로 남겨 주세요.`;
}

// 게시 계획: 파일 → Notion 페이지 대응 (docs/TRD.md 6.2 표)
function buildPlan({ cfg, rootDir, nowIso }) {
  const wikiDir = cfg.paths.wiki;
  const items = [];
  const problems = [];
  const specials = [
    { rel: `${wikiDir}/index.md`, title: cfg.wiki.indexTitle || '색인' },
    { rel: `${wikiDir}/log.md`, title: cfg.wiki.logTitle || '변경 이력' },
  ];
  for (const s of specials) {
    if (!fs.existsSync(path.join(rootDir, s.rel))) continue;
    items.push({ key: s.rel, kind: 'leaf', parentKey: null, title: s.title, relPath: s.rel, updated: nowIso.slice(0, 10) });
  }
  const pages = listWikiPages(cfg, rootDir);
  const containers = new Map();
  for (const p of pages.sort((a, b) => compareTuples(wikiOrder(cfg, a), wikiOrder(cfg, b)))) {
    if (p.error || !p.data) { problems.push({ path: p.relPath, error: p.error || 'frontmatter 없음' }); continue; }
    const svcSlug = p.data.service || 'all';
    const svc = cfg.services.find((s) => s.slug === svcSlug);
    const containerKey = `container:${svcSlug}`;
    if (!containers.has(containerKey)) {
      containers.set(containerKey, { key: containerKey, kind: 'container', parentKey: null, title: svc ? svc.name : svcSlug === 'all' ? '공통' : svcSlug });
    }
    items.push({ key: p.relPath, kind: 'leaf', parentKey: containerKey, title: displayTitle(cfg, p.data), relPath: p.relPath, updated: String(p.data.updated || nowIso.slice(0, 10)) });
  }
  // 컨테이너는 잎보다 먼저
  const ordered = [...items.filter((i) => i.parentKey === null && i.kind === 'leaf'), ...containers.values(), ...items.filter((i) => i.parentKey !== null)];
  return { items: ordered, problems };
}

function makeLinkResolver({ cfg, rootDir, state, fromRel, pendingUrl }) {
  const rawByPath = new Map(listRawPages(cfg, rootDir).filter((p) => p.data).map((p) => [p.relPath, p.data]));
  return (href) => {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), href));
    if (rawByPath.has(target)) return rawByPath.get(target).source_url || null;
    if (state.pages[target] && state.pages[target].url) return state.pages[target].url;
    if (fs.existsSync(path.join(rootDir, target)) && target.startsWith(cfg.paths.wiki + '/')) return pendingUrl(target);
    return null;
  };
}

function renderLeaf({ cfg, rootDir, state, item, syncedAt, pendingUrl }) {
  const text = fs.readFileSync(path.join(rootDir, item.relPath), 'utf8');
  const { body } = fm.split(text);
  const resolveLink = makeLinkResolver({ cfg, rootDir, state, fromRel: item.relPath, pendingUrl });
  const { markdown, unresolved } = toEnhancedMarkdown(body, { resolveLink });
  const full = `${callout(markerText({ updated: item.updated, syncedAt }))}\n${markdown}`;
  return { markdown: full, unresolved, hash: sha256(full) };
}

async function runPublish({ cfg, client = null, rootDir = cfg.rootDir, apply = false, nowIso = new Date().toISOString(), log = () => {} }) {
  const wikiDir = path.join(rootDir, cfg.paths.wiki);
  fs.mkdirSync(wikiDir, { recursive: true });
  const state = loadState(wikiDir, cfg.wiki.rootPageId);
  const syncedAt = readSyncedAt(cfg, rootDir);
  const { items, problems } = buildPlan({ cfg, rootDir, nowIso });
  const report = { created: [], replaced: [], unchanged: [], orphans: [], unresolved: [], problems, aborted: null, apply };

  const pendingUrl = (rel) => (state.pages[rel] && state.pages[rel].url) || `notion://pending/${rel}`;
  const plan = items.map((item) => {
    const entry = state.pages[item.key];
    const rendered = item.kind === 'leaf' ? renderLeaf({ cfg, rootDir, state, item, syncedAt, pendingUrl }) : null;
    let action;
    if (!entry) action = 'create';
    else if (item.kind === 'container') action = 'keep';
    else action = entry.hash === rendered.hash ? 'unchanged' : 'replace';
    return { ...item, action, markdown: rendered ? rendered.markdown : null, hash: rendered ? rendered.hash : null, unresolved: rendered ? rendered.unresolved : [] };
  });
  for (const key of Object.keys(state.pages)) {
    if (!items.some((i) => i.key === key)) report.orphans.push({ key, ...state.pages[key] });
  }

  if (!apply) {
    for (const p of plan) {
      if (p.action === 'create') report.created.push({ key: p.key, title: p.title, parent: p.parentKey || 'root', bytes: p.markdown ? Buffer.byteLength(p.markdown) : 0 });
      else if (p.action === 'replace') report.replaced.push({ key: p.key, title: p.title });
      else report.unchanged.push({ key: p.key, title: p.title });
      for (const u of p.unresolved) report.unresolved.push({ key: p.key, href: u });
    }
    return { plan, report, state };
  }

  if (!client) throw new Error('publish --apply 에는 client 가 필요하다');

  // ---- 안전 검사: 상태의 모든 페이지가 위키 루트 아래 우리 컨테이너/루트의 자식인지 ----
  const ourIds = new Set([cfg.wiki.rootPageId, ...Object.values(state.pages).map((p) => normalizeId(p.id))]);
  for (const [key, entry] of Object.entries(state.pages)) {
    const page = await client.request('GET', `/v1/pages/${entry.id}`);
    const parentId = page.parent && page.parent.page_id ? normalizeId(page.parent.page_id) : null;
    if (!parentId || !ourIds.has(parentId) || page.in_trash) {
      report.aborted = `중단: 게시 상태의 페이지 ${entry.id} (${key}) 의 부모가 위키 루트 아래가 아닙니다. 상태 파일이 손상됐거나 페이지가 이동됐습니다. 아무것도 쓰지 않았습니다.`;
      return { plan, report, state };
    }
  }

  // ---- 1단계: 생성 ----
  const idOf = (key) => (key === null ? cfg.wiki.rootPageId : state.pages[key] && state.pages[key].id);
  for (const p of plan) {
    if (p.action !== 'create') continue;
    const parentId = idOf(p.parentKey);
    if (!parentId) throw new Error(`부모 페이지가 아직 없다: ${p.parentKey}`);
    const body = {
      parent: { page_id: parentId },
      properties: { title: { title: [{ type: 'text', text: { content: p.title } }] } },
      markdown: p.kind === 'container' ? `아래 페이지는 LLM wiki 가 자동 생성·갱신합니다. 이 컨테이너 페이지의 본문은 게시기가 다시 쓰지 않습니다.` : '생성 중…',
    };
    const created = await client.request('POST', '/v1/pages', { body });
    state.pages[p.key] = { id: normalizeId(created.id), url: created.url, title: p.title, kind: p.kind, hash: null };
    saveState(wikiDir, state); // 중간 실패 시 중복 생성을 막기 위해 즉시 저장
    report.created.push({ key: p.key, title: p.title, id: state.pages[p.key].id });
    log(`생성: ${p.title} (${p.key})`);
  }

  // ---- 2단계: 본문 교체 (링크는 이제 전부 실제 URL 로 해석 가능) ----
  for (const p of plan) {
    if (p.kind !== 'leaf') continue;
    const entry = state.pages[p.key];
    const rendered = renderLeaf({ cfg, rootDir, state, item: p, syncedAt, pendingUrl });
    for (const u of rendered.unresolved) report.unresolved.push({ key: p.key, href: u });
    if (entry.hash === rendered.hash) { report.unchanged.push({ key: p.key, title: p.title }); continue; }
    await client.request('PATCH', `/v1/pages/${entry.id}/markdown`, {
      body: { type: 'replace_content', replace_content: { new_str: rendered.markdown, allow_deleting_content: false } },
    });
    entry.hash = rendered.hash;
    entry.updatedAt = nowIso;
    saveState(wikiDir, state);
    if (!report.created.some((c) => c.key === p.key)) report.replaced.push({ key: p.key, title: p.title });
    log(`교체: ${p.title} (${p.key})`);
  }
  return { plan, report, state };
}

function summaryLine(report) {
  if (report.aborted) return report.aborted;
  const head = report.apply ? 'publish' : 'dry-run';
  const tail = report.apply ? '' : '. 실제로 쓰려면 --apply';
  return `${head}: 생성 ${report.created.length} · 교체 ${report.replaced.length} · 변경 없음 ${report.unchanged.length} · 고아 게시 페이지 ${report.orphans.length}${report.unresolved.length ? ` · 해석 불가 링크 ${report.unresolved.length}` : ''}${tail}`;
}

async function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
  const apply = argv.includes('--apply');
  const cfg = loadConfig(rootDir);
  let client = null;
  if (apply) {
    const env = loadEnv(rootDir);
    const token = requireToken(env, 'publish --apply');
    client = createClient({ token, version: cfg.notionVersion, rps: cfg.sync.rps, log: (m) => console.error(m) });
  }
  const { plan, report } = await runPublish({ cfg, client, rootDir, apply, log: (m) => console.error(m) });
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ plan: plan.map(({ markdown, ...p }) => ({ ...p, bytes: markdown ? Buffer.byteLength(markdown) : 0 })), report }, null, 2));
  } else {
    for (const c of report.created) console.log(`생성  ${c.title}  ← ${c.key}`);
    for (const r of report.replaced) console.log(`교체  ${r.title}  ← ${r.key}`);
    for (const o of report.orphans) console.log(`고아  ${o.title}  (${o.key}) — 파일이 사라졌지만 Notion 페이지는 남겨 둔다. 필요하면 Notion 에서 직접 정리`);
    for (const u of report.unresolved) console.log(`링크  ${u.key}: ${u.href} — 해석 불가(텍스트만 남김)`);
    for (const p of report.problems) console.log(`문제  ${p.path}: ${p.error}`);
    console.log(summaryLine(report));
  }
  if (report.aborted) process.exitCode = 3;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { runPublish, buildPlan, renderLeaf, markerText, summaryLine, loadState, STATE_FILE, WIKI_SPECIAL };
