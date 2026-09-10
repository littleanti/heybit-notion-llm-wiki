#!/usr/bin/env node
'use strict';
// 초안 → Notion (docs/TRD.md 6.10). 기본 dry-run: 읽기만 하고 무엇을 쓸지 보여 준다.
// 쓰기는 --apply 에서만. 성공하면 그 페이지만 raw/ 미러에 즉시 기록한다 (DESIGN 10.8).

const fs = require('node:fs');
const path = require('node:path');
const { config, meta: metaLib, mdNotion, notionClient, registerLegacy, slug, frontmatter: fm, sync } = require('./lib/shared');
const draftLib = require('./lib/draft');
const propsLib = require('./lib/props');
const diffLib = require('./lib/diff');
const target = require('./lib/target');

const FILE_TAG_RE = /!\[|<(?:file|pdf|video|audio)\s/;

function titleOf(page) {
  const t = Object.values((page && page.properties) || {}).find((p) => p && p.type === 'title');
  return metaLib.plainText(t ? t.title : []).trim();
}

async function dataSourceSchema(client, dsId) {
  const ds = await client.request('GET', `/v1/data_sources/${dsId}`);
  return ds.properties || {};
}

// 게시한 페이지 하나를 raw 미러와 동기화 상태에 기록한다 (DESIGN 10.8).
// service·category 는 **설정의 객체**({slug, name})다 — toRawFrontmatter 가 .slug 와 .name 을 함께 쓴다.
// 문자열 slug 를 넘기면 frontmatter 의 service·category 가 null 이 되어 lint 가 meta-invalid 를 낸다 (2026-09-10 실측 결함).
async function writeRawMirror({ cfg, client, rootDir, service, category, metaId, bodyId, nowIso }) {
  if (!service || !category || typeof service !== 'object' || typeof category !== 'object') {
    throw new Error('writeRawMirror: service·category 는 설정의 객체여야 한다 (slug 문자열이 아니다)');
  }
  const metaPage = await client.request('GET', `/v1/pages/${metaId}`);
  const bodyPage = bodyId === metaId ? metaPage : await client.request('GET', `/v1/pages/${bodyId}`);
  const md = await client.request('GET', `/v1/pages/${bodyId}/markdown`);
  const m = metaLib.extractMeta(metaPage, cfg);
  const title = m.title || titleOf(metaPage) || '(제목 없음)';
  const isRegistry = bodyId !== metaId;

  const related = [];
  for (const rid of m.related || []) {
    try {
      const rp = await client.request('GET', `/v1/pages/${rid}`);
      related.push({ title: titleOf(rp) || null, url: rp.url });
    } catch {
      related.push({ title: null, url: `https://www.notion.so/${String(rid).replace(/-/g, '')}` });
    }
  }

  const rowLastEdited = metaPage.last_edited_time;
  const frontmatter = metaLib.toRawFrontmatter({
    pageId: metaId, title, meta: m, service, category, related,
    sourceUrl: bodyPage.url, registryUrl: isRegistry ? metaPage.url : null,
    metaSource: isRegistry ? 'registry' : 'properties',
    createdTime: bodyPage.created_time,
    lastEditedTime: isRegistry && bodyPage.last_edited_time > rowLastEdited ? bodyPage.last_edited_time : rowLastEdited,
    syncedAt: nowIso, truncated: md.truncated, unknownBlocks: (md.unknown_block_ids || []).length,
  });

  let body = String(md.markdown || '');
  if (FILE_TAG_RE.test(body)) body = `<!-- notion: 파일·이미지 URL 은 1시간 후 만료된다. 필요하면 Notion 에서 다시 연다 -->\n${body}`;
  if (md.truncated || (md.unknown_block_ids || []).length) {
    body += `\n<!-- notion: truncated=${Boolean(md.truncated)} unknown_block_ids=${(md.unknown_block_ids || []).join(',') || '없음'} -->`;
  }
  const rel = `${cfg.paths.raw}/${service.slug}/${category.slug}/${slug.rawFileName(title, metaId)}`;
  const abs = path.join(rootDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fm.join(frontmatter, body.endsWith('\n') ? body : `${body}\n`), 'utf8');

  const rawDir = path.join(rootDir, cfg.paths.raw);
  const state = sync.loadState(rawDir);
  const prev = state.pages[metaId];
  let movedFrom = null;
  if (prev && prev.path !== rel) {
    const old = path.join(rootDir, prev.path);
    if (fs.existsSync(old)) fs.unlinkSync(old);
    movedFrom = prev.path;
  }
  state.pages[metaId] = {
    path: rel, title,
    lastEdited: rowLastEdited,
    sourceId: isRegistry ? bodyId : null,
    sourceLastEdited: isRegistry ? bodyPage.last_edited_time : null,
  };
  fs.writeFileSync(path.join(rawDir, sync.STATE_FILE), sync.sortedJson(state), 'utf8');
  return { path: rel, movedFrom, syncedAt: nowIso, stateSyncedAt: state.syncedAt || null };
}

function emptyReport(file, apply) {
  return {
    file, apply, kind: null, aborted: null, errors: [], warnings: [],
    targetName: null, action: null,
    properties: { written: [], changed: [], skipped: [] },
    body: { bytes: 0, sections: 0, changed: null, diff: null, counts: null, unresolved: [] },
    created: null, updated: { properties: false, body: false }, raw: null,
  };
}

async function runSubmit({ cfg, client, rootDir, file, apply = false, today, nowIso, log = () => {} }) {
  const absFile = path.isAbsolute(file) ? file : path.join(rootDir, file);
  if (!fs.existsSync(absFile)) throw new Error(`초안 파일이 없다: ${file}`);
  const rel = draftLib.relDraftPath(cfg, rootDir, absFile);
  const report = emptyReport(rel, apply);

  const draft = draftLib.readDraft(absFile);
  const { errors, warnings } = draftLib.validate({ cfg, draft, today });
  report.kind = draft.data.kind || null;
  report.errors = errors;
  report.warnings = warnings;
  if (errors.length) {
    report.aborted = `중단: 초안 검증 오류 ${errors.length}건 — 고친 뒤 다시 실행하세요. 아무것도 쓰지 않았습니다.`;
    return report;
  }

  const service = cfg.services.find((s) => s.slug === draft.data.service);
  const category = cfg.categories.find((c) => c.slug === draft.data.category);

  try {
    if (draft.data.kind === 'new') await submitNew({ cfg, client, rootDir, draft, service, category, apply, nowIso, report, log });
    else await submitEdit({ cfg, client, rootDir, draft, service, category, apply, nowIso, report, log });
  } catch (err) {
    if (String(err.message).startsWith('중단:')) { report.aborted = err.message; return report; }
    throw err;
  }
  return report;
}

async function submitNew({ cfg, client, rootDir, draft, service, category, apply, nowIso, report, log }) {
  const ds = await registerLegacy.findCategoryDataSource({ cfg, client, service, category });
  const schema = await dataSourceSchema(client, ds.dsId);
  report.targetName = ds.title || `${service.name} · ${category.name}`;
  report.action = '신규 생성';

  const owners = await propsLib.resolveOwners({ client, names: draft.data.owner || [] });
  const built = propsLib.buildProperties({ cfg, data: draft.data, schema, ownerRefs: owners.refs });
  report.properties.written = built.written.map((w) => ({ ...w, resolved: w.key === 'owner' ? owners.resolved : undefined }));
  report.properties.skipped = built.skipped;

  const { markdown, unresolved } = mdNotion.toEnhancedMarkdown(draft.body, { mentionLinks: true });
  report.body.bytes = Buffer.byteLength(markdown);
  report.body.sections = draft.sections.length;
  report.body.changed = true;
  report.body.unresolved = unresolved;

  if (!apply) return;
  const created = await client.request('POST', '/v1/pages', {
    body: { parent: { type: 'data_source_id', data_source_id: ds.dsId }, properties: built.properties, markdown },
  });
  const id = config.normalizeId(created.id);
  report.created = { id, url: created.url, title: draft.data.title };
  log(`생성: ${draft.data.title} (${id})`);
  report.raw = await writeRawMirror({ cfg, client, rootDir, service, category, metaId: id, bodyId: id, nowIso });
}

async function submitEdit({ cfg, client, rootDir, draft, service, category, apply, nowIso, report, log }) {
  const metaId = config.normalizeId(draft.data.target_meta_id) || config.normalizeId(draft.data.target_body_id);
  const bodyId = config.normalizeId(draft.data.target_body_id);
  const metaPage = await client.request('GET', `/v1/pages/${metaId}`);
  const bodyPage = bodyId === metaId ? metaPage : await client.request('GET', `/v1/pages/${bodyId}`);
  const md = await client.request('GET', `/v1/pages/${bodyId}/markdown`);
  const currentBody = String(md.markdown || '');

  const refuse = target.refuseReason({ cfg, rootDir, metaPage, bodyPage, markdown: currentBody });
  if (refuse) throw new Error(refuse);
  const stale = target.staleReason(draft.data.base_last_edited_time, bodyPage.last_edited_time);
  if (stale) throw new Error(stale);

  const currentMeta = metaLib.extractMeta(metaPage, cfg);
  report.targetName = `${currentMeta.title || titleOf(metaPage)} (${currentMeta.status || '상태 없음'})`;
  report.action = `본문 교체 (대상 상태: ${currentMeta.status || '없음'})`;

  // 속성: 데이터 소스 행이 아니면 속성을 쓸 수 없다 (일반 페이지는 제목뿐이다)
  const dsId = metaPage.parent && metaPage.parent.type === 'data_source_id' ? config.normalizeId(metaPage.parent.data_source_id) : null;
  const schema = dsId ? await dataSourceSchema(client, dsId) : null;
  if (!schema) report.warnings.push({ code: 'draft-target-missing', message: '대상이 데이터베이스 항목이 아니어서 속성은 바꿀 수 없다 — 본문만 교체한다 (레거시 등록을 먼저 하면 속성도 관리된다)' });

  let propDiff = { changed: [], properties: {} };
  if (schema) {
    propDiff = propsLib.diffProperties({ cfg, data: draft.data, schema, page: metaPage, ownerRefs: [] });
    if (propDiff.changed.some((c) => c.key === 'owner')) {
      const owners = await propsLib.resolveOwners({ client, names: draft.data.owner || [] });
      propDiff = propsLib.diffProperties({ cfg, data: draft.data, schema, page: metaPage, ownerRefs: owners.refs });
    }
  }
  report.properties.changed = propDiff.changed;

  const newBody = draftLib.normalizeBody(draft.body);
  const cur = draftLib.normalizeBody(currentBody);
  const bodyChanged = draftLib.bodyHash(newBody) !== draftLib.bodyHash(cur);
  const rows = diffLib.lineDiff(cur, newBody);
  report.body.bytes = Buffer.byteLength(newBody);
  report.body.sections = draft.sections.length;
  report.body.changed = bodyChanged;
  report.body.counts = diffLib.counts(rows);
  report.body.diff = bodyChanged ? diffLib.formatDiff(rows, { context: 2 }) : null;

  if (!bodyChanged && !propDiff.changed.length) {
    report.warnings.push({ code: 'draft-unchanged', message: '속성·본문 모두 바뀌지 않았다 — 게시할 것이 없다' });
    return;
  }
  if (!apply) return;

  if (propDiff.changed.length) {
    await client.request('PATCH', `/v1/pages/${metaId}`, { body: { properties: propDiff.properties } });
    report.updated.properties = true;
    log(`속성 수정: ${propDiff.changed.map((c) => c.name).join(', ')}`);
  }
  if (bodyChanged) {
    await client.request('PATCH', `/v1/pages/${bodyId}/markdown`, {
      body: { type: 'replace_content', replace_content: { new_str: newBody, allow_deleting_content: false } },
    });
    report.updated.body = true;
    log(`본문 교체: ${bodyId}`);
  }
  report.raw = await writeRawMirror({ cfg, client, rootDir, service, category, metaId, bodyId, nowIso });
}

function summaryLine(report) {
  if (report.aborted) return report.aborted;
  if (report.apply) {
    const created = report.created ? 1 : 0;
    return `submit: 생성 ${created} · 속성 수정 ${report.updated.properties ? 1 : 0} · 본문 교체 ${report.updated.body ? 1 : 0} · raw 기록 ${report.raw ? 1 : 0} · 오류 0`;
  }
  const isNew = report.kind === 'new';
  const willEdit = !isNew && (report.body.changed || report.properties.changed.length) ? 1 : 0;
  return `dry-run: 신규 ${isNew ? 1 : 0} · 수정 ${willEdit} · 오류 ${report.errors.length} · 경고 ${report.warnings.length}. 실제로 쓰려면 --apply`;
}

function printReport(report) {
  console.log(`draft-submit: ${report.file}`);
  if (report.targetName) console.log(`대상    ${report.targetName}`);
  if (report.action) console.log(`동작    ${report.action}`);
  const pad = (s) => String(s).padEnd(8, ' ');
  if (report.properties.written.length) {
    report.properties.written.forEach((w, i) => {
      const value = w.key === 'owner' && w.resolved && w.resolved.length
        ? w.resolved.map((r) => `${r.name} → ${r.id}`).join(', ')
        : Array.isArray(w.value) ? w.value.join(', ') : String(w.value === null || w.value === undefined ? '' : w.value);
      console.log(`${i === 0 ? pad('속성') : pad('')}${String(w.name).padEnd(10, ' ')}${value}`);
    });
  }
  if (report.properties.changed.length) {
    report.properties.changed.forEach((c, i) => {
      const show = (v) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined || v === '' ? '(없음)' : String(v));
      console.log(`${i === 0 ? pad('속성 변경') : pad('')}${String(c.name).padEnd(10, ' ')}${show(c.from)} → ${show(c.to)}`);
    });
  }
  if (report.properties.skipped.length) console.log(`${pad('건너뜀')}데이터베이스에 없는 속성: ${report.properties.skipped.join(', ')}`);
  const cnt = report.body.counts;
  console.log(`${pad('본문')}${report.body.bytes.toLocaleString('en-US')} bytes · 섹션 ${report.body.sections}${cnt ? ` · +${cnt.added} -${cnt.removed}` : ''}${report.body.changed === false ? ' · 변경 없음' : ''}`);
  if (report.body.diff) {
    console.log('본문 diff');
    console.log(report.body.diff.split('\n').map((l) => `  ${l}`).join('\n'));
  }
  for (const u of report.body.unresolved || []) console.log(`${pad('링크')}해석 불가: ${u} — Notion URL 이나 @ 멘션으로 바꾼다`);
  for (const e of report.errors) console.log(`${pad('오류')}E ${e.code}: ${e.message}`);
  for (const w of report.warnings) console.log(`${pad('경고')}W ${w.code}: ${w.message}`);
  if (report.created) console.log(`${pad('생성됨')}${report.created.url}`);
  if (report.raw) console.log(`${pad('raw')}${report.raw.path}${report.raw.movedFrom ? ` (이전 ${report.raw.movedFrom} 삭제)` : ''}`);
  console.log(summaryLine(report));
}

const FLAGS_WITH_VALUE = new Set(['--root', '--now', '--today']);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS_WITH_VALUE.has(a)) { flags[a] = argv[++i]; continue; }
    if (a.startsWith('--')) { flags[a] = true; continue; }
    positional.push(a);
  }
  return { flags, positional };
}

async function main(argv) {
  const { flags, positional } = parseArgs(argv);
  const rootDir = flags['--root'] ? path.resolve(flags['--root']) : process.cwd();
  const file = positional[0];
  if (!file) {
    console.error('사용법: draft-submit.js <초안 파일> [--apply] [--json]');
    console.error('  --apply 가 없으면 읽기만 한다 (대상 확인 · 속성 매핑 · 본문 diff).');
    process.exit(1);
  }
  const cfg = config.loadConfig(rootDir);
  const nowIso = flags['--now'] || new Date().toISOString();
  const today = flags['--today'] || nowIso.slice(0, 10);
  const token = config.requireToken(config.loadEnv(rootDir), flags['--apply'] ? 'draft-submit --apply' : 'draft-submit');
  const client = notionClient.createClient({ token, version: cfg.notionVersion, rps: cfg.sync.rps, log: (m) => console.error(m) });
  const report = await runSubmit({ cfg, client, rootDir, file, apply: Boolean(flags['--apply']), today, nowIso, log: (m) => console.error(m) });
  if (flags['--json']) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (report.errors.length) process.exitCode = 2;
  else if (report.aborted) process.exitCode = 3;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { runSubmit, writeRawMirror, summaryLine, printReport, parseArgs };
