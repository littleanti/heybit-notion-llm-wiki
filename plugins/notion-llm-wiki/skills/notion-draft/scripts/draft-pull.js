#!/usr/bin/env node
'use strict';
// 기존 Notion 페이지 → 수정용 초안 파일 (docs/TRD.md 6.9). 읽기만 한다.
// 받은 본문은 Notion 이 준 enhanced markdown 그대로 둔다 — 제출 때 정규화기를 다시 돌리지 않는다.

const fs = require('node:fs');
const path = require('node:path');
const { config, meta: metaLib, notionClient } = require('./lib/shared');
const draftLib = require('./lib/draft');
const target = require('./lib/target');

// 초안의 base_hash 는 draft.js 의 기준(끝 빈 줄 무시)으로 계산한다 — 검증이 같은 값을 다시 계산한다.
const sha256 = draftLib.bodyHash;

function titleOf(page) {
  const t = Object.values((page && page.properties) || {}).find((p) => p && p.type === 'title');
  return metaLib.plainText(t ? t.title : []).trim();
}

async function runPull({ cfg, client, rootDir, arg, serviceSlug = null, categorySlug = null, nowIso, force = false }) {
  const t = target.resolveTarget({ cfg, rootDir, arg, serviceSlug, categorySlug });
  const metaPage = await client.request('GET', `/v1/pages/${t.metaId}`);
  const bodyPage = t.bodyId === t.metaId ? metaPage : await client.request('GET', `/v1/pages/${t.bodyId}`);
  const md = await client.request('GET', `/v1/pages/${t.bodyId}/markdown`);
  const body = String(md.markdown || '');

  const reason = target.refuseReason({ cfg, rootDir, metaPage, bodyPage, markdown: body });
  if (reason) return { aborted: reason, target: t };

  const m = metaLib.extractMeta(metaPage, cfg);
  const title = m.title || titleOf(metaPage) || t.title || '(제목 없음)';
  const service = (cfg.services.find((s) => s.slug === t.service) || {}).slug;
  const category = (cfg.categories.find((c) => c.slug === t.category) || {}).slug;
  if (!service || !category) {
    return { aborted: `중단: 서비스·카테고리를 알 수 없습니다 (service=${t.service}, category=${t.category}). --service·--category 를 주세요.`, target: t };
  }

  const file = draftLib.draftPath(cfg, rootDir, { service, category, title, targetId: t.bodyId });
  if (fs.existsSync(file) && !force) {
    return {
      aborted: `중단: 이미 있는 초안입니다: ${draftLib.relDraftPath(cfg, rootDir, file)}\n그 파일을 이어서 고치거나, 현재 Notion 내용으로 다시 받으려면 --force 를 붙이세요 (그 파일의 수정 내용은 사라집니다).`,
      target: t, file,
    };
  }

  const data = {
    kind: 'edit',
    service, category, title,
    doc_type: m.docType ?? null,
    status: m.status ?? null,
    author_type: m.authorType ?? null,
    owner: m.owner || [],
    summary: m.summary ?? null,
    keywords: m.keywords || [],
    tags: m.tags || [],
    review_by: m.reviewBy ?? null,
    verified_at: m.verifiedAt ?? null,
    sensitivity: m.sensitivity ?? null,
    exclude: Boolean(m.exclude),
    related: (m.related || []).map((id) => ({ title: null, url: `https://www.notion.so/${String(id).replace(/-/g, '')}` })),
    drafted_at: nowIso,
    target_meta_id: t.metaId,
    target_body_id: t.bodyId,
    source_url: bodyPage.url || t.sourceUrl || null,
    registry_url: t.metaId === t.bodyId ? null : metaPage.url || t.registryUrl || null,
    base_last_edited_time: bodyPage.last_edited_time,
    base_hash: sha256(body),
  };
  draftLib.writeDraft(file, data, body);
  return {
    file, rel: draftLib.relDraftPath(cfg, rootDir, file), target: t, data,
    truncated: Boolean(md.truncated), unknownBlocks: (md.unknown_block_ids || []).length,
    bytes: Buffer.byteLength(body), aborted: null,
  };
}

const FLAGS_WITH_VALUE = new Set(['--root', '--service', '--category', '--now']);

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
  const get = (flag) => (typeof flags[flag] === 'string' ? flags[flag] : null);
  const rootDir = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const arg = positional[0];
  if (!arg) {
    console.error('사용법: draft-pull.js <raw 경로 | Notion URL | page id> [--service <slug> --category <slug>] [--force]');
    process.exit(1);
  }
  const cfg = config.loadConfig(rootDir);
  const token = config.requireToken(config.loadEnv(rootDir), 'draft-pull');
  const client = notionClient.createClient({ token, version: cfg.notionVersion, rps: cfg.sync.rps, log: (m) => console.error(m) });
  const r = await runPull({
    cfg, client, rootDir, arg, serviceSlug: get('--service'), categorySlug: get('--category'),
    nowIso: get('--now') || new Date().toISOString(), force: Boolean(flags['--force']),
  });
  if (flags['--json']) { console.log(JSON.stringify(r, null, 2)); if (r.aborted) process.exitCode = 3; return; }
  if (r.aborted) { console.error(r.aborted); process.exitCode = 3; return; }
  console.log(`초안 생성: ${r.rel}  (${r.bytes} bytes)`);
  console.log(`대상: ${r.data.title} · ${r.data.status || '(상태 없음)'} · 최종수정 ${r.data.base_last_edited_time}`);
  if (r.data.registry_url) console.log(`등록 항목과 원본이 다르다: 속성은 ${r.data.target_meta_id}, 본문은 ${r.data.target_body_id}`);
  if (r.truncated || r.unknownBlocks) console.log(`주의: 원본 본문이 절단됐거나(truncated=${r.truncated}) 알 수 없는 블록 ${r.unknownBlocks}개가 있다 — 그대로 제출하면 그 부분이 사라진다. Notion 에서 직접 고치는 것을 고려한다.`);
  console.log('본문은 Notion 형식(enhanced markdown)이다. 표 <table>·탭 들여쓰기·이스케이프를 유지하며 고친다.');
  console.log('다음: 고친 뒤 draft-submit.js 로 dry-run 해서 diff 를 확인한다.');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { runPull, sha256, parseArgs };
