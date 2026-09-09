#!/usr/bin/env node
'use strict';
// 구조 lint (docs/TRD.md 6.5). 보고만 하고 고치지 않는다.
// 경고(warning): L1 meta-missing, L6 stale — 운영 신호. 오류(error): L2·L3·L4·L5·L7·L8 — 저장소 결함.

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { listRawPages, listWikiPages, WIKI_TYPES } = require('./lib/pages');
const { REQUIRED_META } = require('./lib/meta');

const WARNING_CODES = new Set(['meta-missing', 'stale']);
const RAW_REQUIRED_KEYS = ['notion_id', 'title', 'service', 'category', 'source_url', 'meta_source', 'last_edited_time', 'synced_at'];
const WIKI_REQUIRED_KEYS = ['title', 'type', 'summary', 'sources', 'updated'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WIKI_BYTES = 200 * 1024;
const MAX_INDEX_LINES = 2000;

function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function relativeLinks(body) {
  const out = [];
  for (const m of stripCode(body).matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    out.push(href.split('#')[0]);
  }
  return out;
}

function h2Sections(body) {
  const parts = body.split(/^## /m);
  return parts.slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n');
    return { title: (nl >= 0 ? chunk.slice(0, nl) : chunk).trim(), text: nl >= 0 ? chunk.slice(nl + 1) : '' };
  });
}

function lint({ cfg, rootDir = cfg.rootDir, today = new Date().toISOString().slice(0, 10) }) {
  const issues = [];
  const add = (code, relPath, message) => issues.push({ code, path: relPath, message, level: WARNING_CODES.has(code) ? 'warning' : 'error' });
  const exists = (rel) => fs.existsSync(path.join(rootDir, rel));
  const values = cfg.values || {};
  const inList = (key, v) => !values[key] || v === null || v === undefined || values[key].includes(v);

  // ---- raw ----
  const raw = listRawPages(cfg, rootDir);
  const rawByPath = new Map(raw.map((p) => [p.relPath, p]));
  for (const p of raw) {
    if (p.error || !p.data) { add('frontmatter-invalid', p.relPath, p.error || 'frontmatter 가 없다'); continue; }
    const d = p.data;
    const missingKeys = RAW_REQUIRED_KEYS.filter((k) => !(k in d));
    if (missingKeys.length) { add('frontmatter-invalid', p.relPath, `필수 키 없음: ${missingKeys.join(', ')}`); continue; }
    const missing = REQUIRED_META.filter((k) => d[k] === null || d[k] === undefined || (Array.isArray(d[k]) && d[k].length === 0));
    if (missing.length) add('meta-missing', p.relPath, `${missing.join(', ')} 없음${d.meta_source === 'inferred' ? ' — 등록 항목 필요 (DESIGN 1.3)' : ''}`);
    const invalid = [];
    if (!inList('docType', d.doc_type)) invalid.push(`문서유형 "${d.doc_type}"`);
    if (!inList('status', d.status)) invalid.push(`상태 "${d.status}"`);
    if (!inList('authorType', d.author_type)) invalid.push(`작성주체 "${d.author_type}"`);
    if (!inList('sensitivity', d.sensitivity)) invalid.push(`비밀등급 "${d.sensitivity}"`);
    if (d.sensitivity && (cfg.sync.sensitiveValues || []).includes(d.sensitivity)) invalid.push(`비밀등급 "${d.sensitivity}" 인 페이지가 미러에 있다 (있을 수 없는 상태 — sync 를 다시 돌린다)`);
    for (const k of ['review_by', 'verified_at']) if (d[k] !== null && d[k] !== undefined && !DATE_RE.test(String(d[k]))) invalid.push(`${k} 날짜 형식 "${d[k]}"`);
    if (!cfg.services.some((s) => s.slug === d.service)) invalid.push(`서비스 "${d.service}" 가 설정에 없다`);
    if (!cfg.categories.some((c) => c.slug === d.category)) invalid.push(`카테고리 "${d.category}" 가 설정에 없다`);
    if (invalid.length) add('meta-invalid', p.relPath, invalid.join('; '));
    if (d.review_by && DATE_RE.test(String(d.review_by)) && d.review_by < today) add('stale', p.relPath, `검토기한 ${d.review_by} 경과 (담당 ${(d.owner || []).join('·') || '없음'})`);
    for (const href of relativeLinks(p.body)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(p.relPath), href));
      if (!exists(target)) add('link-broken', p.relPath, `링크 대상 없음: ${href}`);
    }
  }

  // ---- wiki ----
  const wiki = listWikiPages(cfg, rootDir);
  const wikiDir = cfg.paths.wiki;
  const indexRel = `${wikiDir}/index.md`;
  const indexText = exists(indexRel) ? fs.readFileSync(path.join(rootDir, indexRel), 'utf8') : null;
  const indexLinks = indexText ? new Set(relativeLinks(indexText).map((h) => path.posix.normalize(path.posix.join(wikiDir, h)))) : null;

  for (const p of wiki) {
    if (p.error || !p.data) { add('frontmatter-invalid', p.relPath, p.error || 'frontmatter 가 없다'); continue; }
    const d = p.data;
    const missingKeys = WIKI_REQUIRED_KEYS.filter((k) => !(k in d) || d[k] === null);
    if (missingKeys.length) { add('frontmatter-invalid', p.relPath, `필수 키 없음: ${missingKeys.join(', ')}`); continue; }
    if (!WIKI_TYPES.includes(d.type)) add('frontmatter-invalid', p.relPath, `type "${d.type}" 는 ${WIKI_TYPES.join('|')} 중 하나여야 한다`);
    if (d.type === 'digest' && !cfg.categories.some((c) => c.slug === d.category)) add('frontmatter-invalid', p.relPath, `digest 의 category "${d.category}" 가 설정에 없다`);
    if (d.service && d.service !== 'all' && !cfg.services.some((s) => s.slug === d.service)) add('frontmatter-invalid', p.relPath, `service "${d.service}" 가 설정에 없다`);
    if (!DATE_RE.test(String(d.updated))) add('frontmatter-invalid', p.relPath, `updated 날짜 형식 "${d.updated}"`);
    if (!Array.isArray(d.sources)) add('frontmatter-invalid', p.relPath, 'sources 는 배열이어야 한다');
    else {
      if (d.sources.length === 0) add('source-missing', p.relPath, 'sources 가 비어 있다');
      let newest = null;
      for (const s of d.sources) {
        const rp = rawByPath.get(s);
        if (!rp) { add('source-missing', p.relPath, `sources 의 raw 없음: ${s}`); continue; }
        const le = rp.data && rp.data.last_edited_time ? String(rp.data.last_edited_time).slice(0, 10) : null;
        if (le && (!newest || le > newest)) newest = le;
      }
      if (newest && DATE_RE.test(String(d.updated)) && newest > d.updated) add('stale', p.relPath, `원본이 ${newest} 에 바뀌었는데 위키는 ${d.updated} 기준이다`);
    }
    for (const sec of h2Sections(p.body)) {
      const hasSource = /\]\((?:[^)\s]*\.md|https?:\/\/(?:www\.)?notion\.so[^)\s]*)\)/.test(stripCode(sec.text));
      if (!hasSource) add('source-missing', p.relPath, `"## ${sec.title}" 섹션에 출처 링크가 없다`);
    }
    for (const href of relativeLinks(p.body)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(p.relPath), href));
      if (!exists(target)) add('link-broken', p.relPath, `링크 대상 없음: ${href}`);
    }
    if (indexLinks && !indexLinks.has(p.relPath)) add('orphan-wiki', p.relPath, 'index.md 에 없다 (build-index 를 다시 돌린다)');
    const bytes = Buffer.byteLength(p.text, 'utf8');
    if (bytes > MAX_WIKI_BYTES) add('too-large', p.relPath, `${Math.round(bytes / 1024)}KB > ${MAX_WIKI_BYTES / 1024}KB`);
  }
  if (indexText) {
    for (const target of indexLinks) {
      if (!exists(target)) add('orphan-wiki', indexRel, `index 가 가리키는 파일 없음: ${target}`);
    }
    const lines = indexText.split('\n').length;
    if (lines > MAX_INDEX_LINES) add('too-large', indexRel, `${lines}줄 > ${MAX_INDEX_LINES}줄 — 서비스별 index 분할 검토 (TRD ADR-002)`);
  }

  issues.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return { issues, errors, warnings, counts: { raw: raw.length, wiki: wiki.length } };
}

function summaryLine(result) {
  const { errors, warnings } = result;
  const tally = (list) => {
    const m = {};
    for (const i of list) m[i.code] = (m[i.code] || 0) + 1;
    return Object.entries(m).map(([k, v]) => `${k} ${v}`).join(', ');
  };
  if (!errors.length && !warnings.length) return 'lint: 결함 없음';
  const parts = [];
  if (errors.length) parts.push(`오류 ${errors.length} (${tally(errors)})`);
  if (warnings.length) parts.push(`경고 ${warnings.length} (${tally(warnings)})`);
  return `lint: ${parts.join(' · ')}`;
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
  const strict = argv.includes('--strict');
  const cfg = loadConfig(rootDir);
  const result = lint({ cfg, rootDir });
  const failing = strict ? result.issues.length > 0 : result.errors.length > 0;
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, summary: summaryLine(result), exitCode: failing ? 1 : 0 }, null, 2));
  } else {
    for (const i of result.issues) console.log(`${i.level === 'error' ? 'E' : 'W'} ${i.code} ${i.path}: ${i.message}`);
    console.log(`${summaryLine(result)} → 종료 코드 ${failing ? 1 : 0}${strict ? ' (--strict)' : ''}`);
  }
  process.exitCode = failing ? 1 : 0;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
}

module.exports = { lint, summaryLine, WARNING_CODES, MAX_WIKI_BYTES, MAX_INDEX_LINES };
