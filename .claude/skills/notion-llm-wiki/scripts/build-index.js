#!/usr/bin/env node
'use strict';
// raw + wiki frontmatter → wiki/index.md (docs/TRD.md 6.4, docs/DESIGN.md 5.1). 본문은 읽지 않는다. 결정적이다.

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { listRawPages, listWikiPages, displayTitle, wikiOrder, compareTuples } = require('./lib/pages');
const { REQUIRED_META } = require('./lib/meta');

function dateOnly(iso) {
  return iso ? String(iso).slice(0, 10) : '—';
}

function metaMissing(d) {
  return REQUIRED_META.some((k) => d[k] === null || d[k] === undefined || (Array.isArray(d[k]) && d[k].length === 0));
}

function rawLine(d, href, today) {
  const kw = d.keywords && d.keywords.length ? ` · 키워드: ${d.keywords.join(', ')}` : '';
  if (metaMissing(d) && d.meta_source === 'inferred') {
    return `- ⚠ [${d.title}](${href}) · meta 없음 · ${dateOnly(d.last_edited_time)}${d.summary ? ` — ${d.summary}` : ''}${kw}`;
  }
  const status = d.status === '확정' ? '확정' : d.status ? `(${d.status})` : '(상태 없음)';
  const stale = d.review_by && d.review_by < today ? ' ⏰' : '';
  const owner = d.owner && d.owner.length ? d.owner.join('·') : '담당 없음';
  const summary = d.summary ? d.summary : '(요약 없음)';
  return `- [${d.title}](${href}) · ${d.doc_type || '유형 없음'} · ${status}${stale} · ${owner} · ${dateOnly(d.last_edited_time)} — ${summary}${kw}`;
}

function wikiLine(cfg, p, href) {
  const d = p.data;
  const kw = d.keywords && d.keywords.length ? ` · 키워드: ${d.keywords.join(', ')}` : '';
  return `- [${displayTitle(cfg, d)}](${href}) — ${d.summary || '(요약 없음)'}${kw}`;
}

// 색인은 입력(raw/wiki frontmatter + 동기화 상태)만으로 결정된다. 벽시계를 쓰지 않는다 —
// 생성 시각은 git 이 기록하고, 검토기한 경과(⏰)의 기준일은 마지막 동기화 날짜다.
function buildIndexText({ cfg, rootDir, nowIso, syncedAt }) {
  const today = (syncedAt || nowIso).slice(0, 10);
  const raw = listRawPages(cfg, rootDir).filter((p) => p.data && !p.error);
  const wiki = listWikiPages(cfg, rootDir).filter((p) => p.data && !p.error);
  const wikiDir = cfg.paths.wiki;
  const rel = (target) => path.posix.relative(wikiDir, target);

  const out = [];
  out.push('# 색인');
  out.push('');
  out.push(`- 동기화: ${syncedAt || '—'} · raw ${raw.length} · wiki ${wiki.length}`);
  out.push(`- 읽는 법: 위키 → 원본 순서로 찾는다. \`⚠\` 는 meta 없음, \`(초안)\` 은 확정 아님, \`⏰\` 는 검토기한 경과(${today} 기준)`);
  out.push('');
  out.push('## 위키');
  out.push('');
  const groups = [...cfg.services.map((s) => ({ key: s.slug, name: s.name })), { key: 'all', name: '공통' }];
  let anyWiki = false;
  for (const g of groups) {
    const pages = wiki.filter((p) => (p.data.service || 'all') === g.key).sort((a, b) => compareTuples(wikiOrder(cfg, a), wikiOrder(cfg, b)));
    if (!pages.length) continue;
    anyWiki = true;
    out.push(`### ${g.name}`);
    for (const p of pages) out.push(wikiLine(cfg, p, rel(p.relPath)));
    out.push('');
  }
  if (!anyWiki) { out.push('- (아직 합성된 위키 페이지가 없다 — `ingest` 를 실행한다)'); out.push(''); }

  out.push('## 원본 (raw)');
  out.push('');
  for (const s of cfg.services) {
    for (const c of cfg.categories) {
      const pages = raw.filter((p) => p.data.service === s.slug && p.data.category === c.slug).sort((a, b) => (a.data.title < b.data.title ? -1 : a.data.title > b.data.title ? 1 : 0));
      if (!pages.length) continue;
      out.push(`### ${s.name} / ${c.name}`);
      for (const p of pages) out.push(rawLine(p.data, rel(p.relPath), today));
      out.push('');
    }
  }
  const orphans = raw.filter((p) => !cfg.services.some((s) => s.slug === p.data.service) || !cfg.categories.some((c) => c.slug === p.data.category));
  if (orphans.length) {
    out.push('### (설정에 없는 서비스/카테고리)');
    for (const p of orphans) out.push(rawLine(p.data, rel(p.relPath), today));
    out.push('');
  }
  return { text: out.join('\n').replace(/\n+$/, '\n'), counts: { raw: raw.length, wiki: wiki.length } };
}

function readSyncedAt(cfg, rootDir) {
  const f = path.join(rootDir, cfg.paths.raw, '.sync-state.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).syncedAt || null; } catch { return null; }
}

function buildIndex({ cfg, rootDir = cfg.rootDir, nowIso = new Date().toISOString(), write = true }) {
  const syncedAt = readSyncedAt(cfg, rootDir);
  const { text, counts } = buildIndexText({ cfg, rootDir, nowIso, syncedAt });
  const file = path.join(rootDir, cfg.paths.wiki, 'index.md');
  if (write) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
  return { text, counts, file };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
  const cfg = loadConfig(rootDir);
  const { counts, file, text } = buildIndex({ cfg, rootDir });
  console.log(`index: raw ${counts.raw} · wiki ${counts.wiki} · ${text.split('\n').length}줄 → ${path.relative(rootDir, file).split(path.sep).join('/')}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
}

module.exports = { buildIndex, buildIndexText, metaMissing };
