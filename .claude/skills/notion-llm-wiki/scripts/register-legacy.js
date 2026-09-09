#!/usr/bin/env node
'use strict';
// 레거시 페이지 등록 (docs/DESIGN.md 1.3): 카테고리 페이지 하위 일반 페이지마다 카테고리 DB 에 `제목 + 원본` 항목을 만든다.
// dry-run 기본. --apply 일 때만 쓴다. 원본 페이지는 건드리지 않는다.

const path = require('node:path');
const { loadConfig, loadEnv, requireToken, normalizeId, categoryByName } = require('./lib/config');
const { createClient } = require('./lib/notion-client');
const { extractMeta, pageIdFromUrl, plainText } = require('./lib/meta');

function titleOf(page) {
  const t = Object.values(page.properties || {}).find((p) => p && p.type === 'title');
  return plainText(t ? t.title : []).trim();
}

async function runRegisterLegacy({ cfg, client, serviceSlug, categorySlug, apply = false, log = () => {} }) {
  const service = cfg.services.find((s) => s.slug === serviceSlug);
  if (!service) throw new Error(`서비스 slug 를 찾을 수 없다: ${serviceSlug}`);
  const category = cfg.categories.find((c) => c.slug === categorySlug);
  if (!category) throw new Error(`카테고리 slug 를 찾을 수 없다: ${categorySlug}`);

  const pages = (await client.paginate('POST', '/v1/search', { filter: { property: 'object', value: 'page' } })).results;
  const categoryPage = pages.find((p) => p.parent && p.parent.type === 'page_id' && normalizeId(p.parent.page_id) === service.rootPageId && categoryByName(cfg, titleOf(p)) === category);
  if (!categoryPage) throw new Error(`"${service.name}" 아래에서 카테고리 페이지 "${category.name}" 을 찾을 수 없다 (연결이 추가돼 있는가?)`);
  const categoryPageId = normalizeId(categoryPage.id);

  const dataSources = (await client.paginate('POST', '/v1/search', { filter: { property: 'object', value: 'data_source' } })).results;
  let target = null;
  for (const ds of dataSources) {
    const dbId = ds.parent && ds.parent.database_id ? normalizeId(ds.parent.database_id) : null;
    if (!dbId) continue;
    const db = await client.request('GET', `/v1/databases/${dbId}`);
    if (db.parent && db.parent.page_id && normalizeId(db.parent.page_id) === categoryPageId) { target = { dsId: normalizeId(ds.id), dbId, title: plainText(ds.title) }; break; }
  }
  if (!target) throw new Error(`카테고리 페이지 "${category.name}" 안에 데이터베이스가 없다. 먼저 DB 를 만든다 (docs/DESIGN.md 1절)`);

  const rows = (await client.paginate('POST', `/v1/data_sources/${target.dsId}/query`, {})).results;
  const registered = new Set(rows.map((r) => extractMeta(r, cfg).source).filter(Boolean).map(pageIdFromUrl));
  const legacy = pages.filter((p) => p.parent && p.parent.type === 'page_id' && normalizeId(p.parent.page_id) === categoryPageId && !p.in_trash);
  const todo = legacy.filter((p) => !registered.has(normalizeId(p.id)));

  const report = { service: service.name, category: category.name, dataSource: target.title, legacy: legacy.length, alreadyRegistered: legacy.length - todo.length, created: [], planned: todo.map((p) => ({ id: normalizeId(p.id), title: titleOf(p), url: p.url })), apply };
  if (!apply) return report;
  for (const p of todo) {
    const props = {};
    props[cfg.properties.title] = { title: [{ type: 'text', text: { content: titleOf(p) || '(제목 없음)' } }] };
    props[cfg.properties.source] = { url: p.url };
    if (cfg.properties.status && (cfg.values.status || []).includes('초안')) props[cfg.properties.status] = { select: { name: '초안' } };
    const created = await client.request('POST', '/v1/pages', { body: { parent: { type: 'data_source_id', data_source_id: target.dsId }, properties: props } });
    report.created.push({ id: normalizeId(created.id), title: titleOf(p), source: p.url });
    log(`등록 항목 생성: ${titleOf(p)}`);
  }
  return report;
}

function summary(r) {
  const head = r.apply ? 'register-legacy' : 'dry-run';
  return `${head}: ${r.service} / ${r.category} (${r.dataSource}) — 레거시 ${r.legacy} · 이미 등록 ${r.alreadyRegistered} · ${r.apply ? `생성 ${r.created.length}` : `생성 예정 ${r.planned.length}`}${r.apply ? '' : '. 실제로 쓰려면 --apply'}`;
}

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const rootDir = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const serviceSlug = get('--service');
  const categorySlug = get('--category');
  if (!serviceSlug || !categorySlug) { console.error('사용법: register-legacy.js --service <slug> --category <slug> [--apply]'); process.exit(1); }
  const cfg = loadConfig(rootDir);
  const token = requireToken(loadEnv(rootDir), 'register-legacy');
  const client = createClient({ token, version: cfg.notionVersion, rps: cfg.sync.rps });
  const r = await runRegisterLegacy({ cfg, client, serviceSlug, categorySlug, apply: argv.includes('--apply'), log: (m) => console.error(m) });
  for (const p of r.planned) console.log(`${r.apply ? '생성' : '예정'}  ${p.title}  ← ${p.url}`);
  console.log(summary(r));
  console.log('만들어진 항목의 문서유형·상태·요약·담당자는 사람이 채운다 (docs/DESIGN.md 1.3).');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { runRegisterLegacy, summary };
