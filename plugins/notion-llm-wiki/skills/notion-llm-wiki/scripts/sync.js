#!/usr/bin/env node
'use strict';
// Notion → raw 동기화 (docs/TRD.md 6.1). 읽기 전용 — Notion 에 쓰는 코드 경로가 없다.

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, loadEnv, requireToken, normalizeId, categoryByName, fallbackCategory, serviceByRootId } = require('./lib/config');
const { createClient } = require('./lib/notion-client');
const { extractMeta, isExcluded, pageIdFromUrl, toRawFrontmatter, plainText, REQUIRED_META } = require('./lib/meta');
const { rawFileName } = require('./lib/slug');
const fm = require('./lib/frontmatter');
const { formatSyncReport, summaryLine, emptyReport } = require('./lib/report');

const STATE_FILE = '.sync-state.json';
const REPORT_FILE = '.sync-report.md';
const STATE_VERSION = 1;

function loadState(rawDir) {
  const file = path.join(rawDir, STATE_FILE);
  if (!fs.existsSync(file)) return { version: STATE_VERSION, syncedAt: null, pages: {}, databases: {} };
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (s.version !== STATE_VERSION) throw new Error(`상태 파일 버전이 다릅니다 (${s.version} ≠ ${STATE_VERSION}). raw/${STATE_FILE} 을 지우고 --full 로 다시 받으세요.`);
  s.pages = s.pages || {};
  s.databases = s.databases || {};
  return s;
}

function sortedJson(obj) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
    return v;
  };
  return JSON.stringify(sortKeys(obj), null, 2) + '\n';
}

function titleOf(page) {
  const props = page.properties || {};
  const t = Object.values(props).find((p) => p && p.type === 'title');
  return plainText(t ? t.title : []).trim();
}

function matchCategory(cfg, title) {
  if (!title) return null;
  const direct = categoryByName(cfg, title);
  if (direct) return direct;
  const last = String(title).split(/[·/:|-]/).pop().trim();
  return last && last !== title ? categoryByName(cfg, last) : null;
}

const FILE_TAG_RE = /!\[|<(?:file|pdf|video|audio)\s/;

async function runSync({ cfg, client, rootDir = cfg.rootDir, nowIso = () => new Date().toISOString(), clock = () => Date.now(), full = false, log = () => {} }) {
  const started = clock();
  const rawDir = path.join(rootDir, cfg.paths.raw);
  fs.mkdirSync(rawDir, { recursive: true });
  const state = full ? { version: STATE_VERSION, syncedAt: null, pages: {}, databases: loadState(rawDir).databases } : loadState(rawDir);
  const report = emptyReport();
  report.services = cfg.services.map((s) => s.name);
  const syncedAt = nowIso();
  report.syncedAt = syncedAt;

  // ---- 1. 발견 ----
  const searchPages = await client.paginate('POST', '/v1/search', { filter: { property: 'object', value: 'page' } });
  const searchDs = await client.paginate('POST', '/v1/search', { filter: { property: 'object', value: 'data_source' } });
  const pageById = new Map(searchPages.results.map((p) => [normalizeId(p.id), p]));
  const dsById = new Map(searchDs.results.map((d) => [normalizeId(d.id), d]));
  report.discovered = pageById.size;
  const fetchedPages = new Map();

  async function getPage(id) {
    if (pageById.has(id)) return pageById.get(id);
    if (fetchedPages.has(id)) return fetchedPages.get(id);
    try {
      const p = await client.request('GET', `/v1/pages/${id}`);
      fetchedPages.set(id, p);
      pageById.set(id, p);
      return p;
    } catch (err) {
      fetchedPages.set(id, null);
      log(`페이지 조회 실패 ${id}: ${err.message}`);
      return null;
    }
  }

  async function databaseParent(dbId) {
    if (state.databases[dbId]) return state.databases[dbId];
    const db = await client.request('GET', `/v1/databases/${dbId}`);
    const info = { parentPageId: db.parent && db.parent.page_id ? normalizeId(db.parent.page_id) : null, parentType: db.parent ? db.parent.type : null, title: plainText(db.title) };
    state.databases[dbId] = info;
    return info;
  }

  const serviceRootIds = new Set(cfg.services.map((s) => s.rootPageId));
  const wikiRoot = cfg.wiki.rootPageId;
  const ancestryCache = new Map();

  // parent 체인을 따라 올라가 { root: 서비스 | 'wiki' | null, chain: [{id,title}] } 를 돌려준다
  async function resolveAncestry(parent, startId) {
    const chain = [];
    const visited = new Set([startId]);
    let cur = parent;
    for (let depth = 0; depth < 50 && cur; depth++) {
      if (cur.type === 'workspace') return { root: null, chain };
      let nextParentId = null, nodeTitle = null, nodeId = null;
      if (cur.type === 'page_id') {
        nodeId = normalizeId(cur.page_id);
      } else if (cur.type === 'data_source_id' || cur.type === 'database_id') {
        const dbId = normalizeId(cur.database_id);
        const info = await databaseParent(dbId);
        chain.push({ id: dbId, title: info.title, kind: 'database' });
        nodeId = info.parentPageId;
        if (!nodeId) return { root: null, chain };
      } else {
        return { root: null, chain }; // block_id 등: 추적하지 않는다
      }
      if (nodeId === wikiRoot) return { root: 'wiki', chain };
      if (serviceRootIds.has(nodeId)) return { root: serviceByRootId(cfg, nodeId), chain };
      if (visited.has(nodeId)) return { root: null, chain };
      visited.add(nodeId);
      const node = await getPage(nodeId);
      if (!node) return { root: null, chain };
      nodeTitle = titleOf(node);
      chain.push({ id: nodeId, title: nodeTitle, kind: 'page' });
      if (ancestryCache.has(nodeId)) {
        const cached = ancestryCache.get(nodeId);
        return { root: cached.root, chain: [...chain, ...cached.chain] };
      }
      nextParentId = node.parent;
      cur = nextParentId;
    }
    return { root: null, chain };
  }

  async function ancestryOf(page) {
    const id = normalizeId(page.id);
    if (ancestryCache.has(id)) return ancestryCache.get(id);
    const res = await resolveAncestry(page.parent, id);
    ancestryCache.set(id, res);
    return res;
  }

  // 순환 방지: 위키 루트가 어느 서비스 루트 아래이면 중단
  const wikiRootPage = await getPage(wikiRoot);
  if (wikiRootPage) {
    const a = await ancestryOf(wikiRootPage);
    if (a.root && a.root !== 'wiki') {
      throw new Error(`설정 오류: wiki.rootPageId 가 서비스 "${a.root.name}" 의 하위입니다. 위키가 자기 출력을 다시 수집하게 되므로 거부합니다.`);
    }
  }

  // 범위 안 data source → 행 권위 목록
  const candidates = new Map();
  for (const [dsId, ds] of dsById) {
    const dbId = ds.parent && ds.parent.database_id ? normalizeId(ds.parent.database_id) : null;
    if (!dbId) continue;
    const a = await resolveAncestry({ type: 'database_id', database_id: dbId }, dsId);
    if (!a.root || a.root === 'wiki') continue;
    const rows = await client.paginate('POST', `/v1/data_sources/${dsId}/query`, {});
    for (const row of rows.results) {
      const rid = normalizeId(row.id);
      candidates.set(rid, { page: row, service: a.root, chain: [{ id: dbId, title: plainText(ds.title), kind: 'database' }, ...a.chain] });
      pageById.set(rid, row);
    }
  }
  // search 로 발견된 페이지 중 범위 안
  for (const [id, page] of pageById) {
    if (candidates.has(id)) continue;
    if (fetchedPages.has(id)) continue; // 조상 해석 중 개별 조회한 페이지는 후보가 아니다
    if (serviceRootIds.has(id) || id === wikiRoot) continue;
    const a = await ancestryOf(page);
    if (!a.root || a.root === 'wiki') { report.outOfScope++; continue; }
    // 카테고리 페이지(서비스 루트 직속 + 제목이 카테고리 이름)는 컨테이너다 — 미러하지 않는다
    const isCategoryPage = page.parent && page.parent.type === 'page_id' && serviceRootIds.has(normalizeId(page.parent.page_id)) && matchCategory(cfg, titleOf(page));
    if (isCategoryPage) { report.containers++; continue; }
    candidates.set(id, { page, service: a.root, chain: a.chain });
  }

  // ---- 2. meta ----
  const entries = [];
  const representedSources = new Map(); // 원본 id → 등록 항목 id
  for (const [id, c] of candidates) {
    const meta = extractMeta(c.page, cfg);
    const title = meta.title || titleOf(c.page) || '(제목 없음)';
    const cat = matchCategory(cfg, meta.category) || c.chain.map((n) => matchCategory(cfg, n.title)).find(Boolean) || fallbackCategory(cfg);
    const sourceId = meta.source ? pageIdFromUrl(meta.source) : null;
    const metaSource = sourceId ? 'registry' : c.page.parent && c.page.parent.type === 'data_source_id' ? 'properties' : 'inferred';
    if (sourceId) representedSources.set(sourceId, id);
    entries.push({ id, page: c.page, service: c.service, category: cat, meta, title, sourceId, metaSource, inTrash: Boolean(c.page.in_trash) });
  }

  const planned = new Map(); // id → { relPath, title }
  const active = [];
  for (const e of entries) {
    if (e.inTrash) { continue; }
    if (representedSources.has(e.id)) continue; // 등록 항목이 대표
    const ex = isExcluded(e.meta, cfg);
    if (ex.excluded) { report.excluded.push({ id: e.id, title: e.title, reason: ex.reason }); continue; }
    const relPath = `${cfg.paths.raw}/${e.service.slug}/${e.category.slug}/${rawFileName(e.title, e.id)}`;
    planned.set(e.id, { relPath, title: e.title });
    if (e.sourceId) planned.set(e.sourceId, { relPath, title: e.title });
    active.push({ ...e, relPath });
  }

  function relLink(fromRel, toRel) {
    return path.posix.relative(path.posix.dirname(fromRel), toRel);
  }

  function postProcessBody(body, fromRel) {
    const re = /<(page|mention-page) url="([^"]+)"[^>]*>([^<]*)<\/\1>/g;
    return body.replace(re, (whole, _tag, url, text) => {
      const target = pageIdFromUrl(url);
      const p = target ? planned.get(target) : null;
      if (!p || p.relPath === fromRel) return whole;
      return `${whole} ([${text || p.title}](${relLink(fromRel, p.relPath)}))`;
    });
  }

  // ---- 3~4. 변경 판정 · 쓰기 ----
  const newStatePages = {};
  for (const e of active) {
    const prev = state.pages[e.id];
    let sourcePage = null;
    if (e.sourceId) {
      sourcePage = await getPage(e.sourceId);
      if (!sourcePage) { report.failed.push({ id: e.id, title: e.title, error: `원본 페이지 ${e.sourceId} 를 읽을 수 없다` }); if (prev) newStatePages[e.id] = prev; continue; }
    }
    const lastEdited = e.page.last_edited_time;
    const sourceLastEdited = sourcePage ? sourcePage.last_edited_time : null;
    const bodyId = e.sourceId || e.id;
    const unchanged = prev && prev.path === e.relPath && prev.lastEdited === lastEdited && (prev.sourceLastEdited || null) === sourceLastEdited && fs.existsSync(path.join(rootDir, prev.path));
    if (unchanged) { newStatePages[e.id] = prev; report.unchanged.push({ id: e.id, path: e.relPath }); continue; }

    let md;
    try {
      md = await client.request('GET', `/v1/pages/${bodyId}/markdown`);
    } catch (err) {
      report.failed.push({ id: e.id, title: e.title, error: err.message });
      if (prev) newStatePages[e.id] = prev;
      continue;
    }
    const related = [];
    for (const rid of e.meta.related || []) {
      const rp = pageById.get(rid) || null;
      related.push({ title: rp ? titleOf(rp) || null : null, url: rp ? rp.url : `https://www.notion.so/${rid.replace(/-/g, '')}` });
    }
    const frontmatter = toRawFrontmatter({
      pageId: e.id, title: e.title, meta: e.meta, service: e.service, category: e.category, related,
      sourceUrl: sourcePage ? sourcePage.url : e.page.url, registryUrl: sourcePage ? e.page.url : null, metaSource: e.metaSource,
      createdTime: (sourcePage || e.page).created_time, lastEditedTime: sourcePage && sourcePage.last_edited_time > lastEdited ? sourcePage.last_edited_time : lastEdited,
      syncedAt, truncated: md.truncated, unknownBlocks: (md.unknown_block_ids || []).length,
    });
    let body = postProcessBody(String(md.markdown || ''), e.relPath);
    if (FILE_TAG_RE.test(body)) body = `<!-- notion: 파일·이미지 URL 은 1시간 후 만료된다. 필요하면 Notion 에서 다시 연다 -->\n${body}`;
    if (md.truncated || (md.unknown_block_ids || []).length) {
      body += `\n<!-- notion: truncated=${Boolean(md.truncated)} unknown_block_ids=${(md.unknown_block_ids || []).join(',') || '없음'} -->`;
      report.truncated.push({ path: e.relPath, truncated: Boolean(md.truncated), unknownBlocks: (md.unknown_block_ids || []).length });
    }
    const content = fm.join(frontmatter, body.endsWith('\n') ? body : body + '\n');
    const abs = path.join(rootDir, e.relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    if (prev && prev.path !== e.relPath) {
      const old = path.join(rootDir, prev.path);
      if (fs.existsSync(old)) fs.unlinkSync(old);
      report.moved.push({ from: prev.path, to: e.relPath });
    } else if (prev) report.changed.push({ path: e.relPath, title: e.title });
    else report.added.push({ path: e.relPath, title: e.title });
    if (REQUIRED_META.some((k) => { const v = frontmatter[k]; return v === null || (Array.isArray(v) && v.length === 0); })) report.metaMissing.push({ path: e.relPath, title: e.title });
    newStatePages[e.id] = { path: e.relPath, title: e.title, lastEdited, sourceId: e.sourceId, sourceLastEdited };
  }

  // ---- 5. 삭제 ----
  for (const [id, prev] of Object.entries(state.pages)) {
    if (newStatePages[id]) continue;
    const abs = path.join(rootDir, prev.path);
    const stillActive = active.find((a) => a.id === id);
    let reason;
    if (representedSources.has(id)) reason = '등록 항목이 대표하게 됨';
    else if (report.excluded.find((x) => x.id === id)) reason = '제외(민감/위키제외)';
    else if (entries.find((x) => x.id === id && x.inTrash)) reason = '휴지통';
    else if (report.failed.find((x) => x.id === id)) continue;
    else if (stillActive) reason = '경로 변경';
    else {
      // 검색·쿼리에서 사라진 페이지 — 왜 사라졌는지 한 번 조회해 리포트에 정확히 남긴다 (드문 일이라 호출 비용은 무시할 만하다)
      const gone = await getPage(id);
      if (gone && gone.in_trash) reason = '휴지통';
      else if (gone) reason = '범위 밖으로 이동(부모 변경)';
      else reason = '삭제 또는 공유 해제';
    }
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    report.deleted.push({ path: prev.path, reason });
  }
  // 등록 항목이 대표하는 원본이 이전엔 단독으로 미러됐던 경우도 위에서 처리됨

  // 빈 디렉터리 정리
  for (const svc of cfg.services) {
    const sdir = path.join(rawDir, svc.slug);
    if (!fs.existsSync(sdir)) continue;
    for (const c of fs.readdirSync(sdir)) {
      const cdir = path.join(sdir, c);
      if (fs.statSync(cdir).isDirectory() && fs.readdirSync(cdir).length === 0) fs.rmdirSync(cdir);
    }
    if (fs.readdirSync(sdir).length === 0) fs.rmdirSync(sdir);
  }

  // ---- 6. 상태 · 리포트 ----
  report.calls = client.stats().requests;
  report.durationMs = clock() - started;
  const newState = { version: STATE_VERSION, syncedAt, pages: newStatePages, databases: state.databases };
  fs.writeFileSync(path.join(rawDir, STATE_FILE), sortedJson(newState), 'utf8');
  fs.writeFileSync(path.join(rawDir, REPORT_FILE), formatSyncReport(report) + '\n', 'utf8');
  return { report, state: newState };
}

async function main(argv) {
  const args = new Set(argv);
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
  const cfg = loadConfig(rootDir);
  const env = loadEnv(rootDir);
  const token = requireToken(env, 'sync');
  const client = createClient({ token, version: cfg.notionVersion, rps: cfg.sync.rps, log: (m) => console.error(m) });
  const { report } = await runSync({ cfg, client, rootDir, full: args.has('--full'), log: (m) => console.error(m) });
  console.log(summaryLine(report));
  console.log(`리포트: ${cfg.paths.raw}/${REPORT_FILE}`);
  if (report.failed.length) process.exitCode = 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { runSync, loadState, STATE_FILE, REPORT_FILE, matchCategory, titleOf };
