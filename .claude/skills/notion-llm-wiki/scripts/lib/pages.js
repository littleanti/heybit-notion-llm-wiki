'use strict';
// raw / wiki 페이지 목록과 게시 제목 규칙 (docs/DESIGN.md 8절). build-index · lint · publish 가 공유한다.
const fs = require('node:fs');
const path = require('node:path');
const fm = require('./frontmatter');

const WIKI_TYPES = ['overview', 'digest', 'topic', 'conflicts'];
const WIKI_SPECIAL = new Set(['index.md', 'log.md']);

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.name.endsWith('.md')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function loadPage(rootDir, relPath) {
  const text = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  try {
    const { data, body } = fm.split(text);
    return { relPath, data, body, text, error: null };
  } catch (err) {
    return { relPath, data: null, body: text, text, error: err.message };
  }
}

// raw/<service>/<category>/<file>.md
function listRawPages(cfg, rootDir) {
  const base = path.join(rootDir, cfg.paths.raw);
  return walk(base).map((rel) => loadPage(rootDir, `${cfg.paths.raw}/${rel}`));
}

// wiki/**.md — index/log 와 '_' 로 시작하는 파일 제외
function listWikiPages(cfg, rootDir) {
  const base = path.join(rootDir, cfg.paths.wiki);
  return walk(base)
    .filter((rel) => !WIKI_SPECIAL.has(rel) && !path.posix.basename(rel).startsWith('_'))
    .map((rel) => loadPage(rootDir, `${cfg.paths.wiki}/${rel}`));
}

function categoryOf(cfg, slug) {
  return cfg.categories.find((c) => c.slug === slug) || null;
}

function serviceOf(cfg, slug) {
  return cfg.services.find((s) => s.slug === slug) || null;
}

// Notion 게시 제목 (docs/DESIGN.md 8절)
function displayTitle(cfg, data) {
  if (!data) return '(제목 없음)';
  switch (data.type) {
    case 'overview': return '개요';
    case 'digest': { const c = categoryOf(cfg, data.category); return `${c ? c.name : data.category} 다이제스트`; }
    case 'topic': return `토픽: ${data.title}`;
    case 'conflicts': return '충돌 · 미확정';
    default: return data.title || '(제목 없음)';
  }
}

// 위키 페이지 정렬: 개요 → 다이제스트(카테고리 순) → 토픽(제목 순) → 충돌
function wikiOrder(cfg, page) {
  const d = page.data || {};
  const typeRank = { overview: 0, digest: 1, topic: 2, conflicts: 3 }[d.type] ?? 9;
  const catRank = d.type === 'digest' ? cfg.categories.findIndex((c) => c.slug === d.category) : 0;
  return [typeRank, catRank < 0 ? 99 : catRank, d.title || ''];
}

function compareTuples(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

module.exports = { walk, loadPage, listRawPages, listWikiPages, displayTitle, wikiOrder, compareTuples, categoryOf, serviceOf, WIKI_TYPES, WIKI_SPECIAL };
