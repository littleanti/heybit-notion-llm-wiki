'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, syncOnce, listFiles } = require('./helpers/sync-harness');
const { loadWorkspace, createMockNotion, pageUrl } = require('./helpers/mock-notion');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');

const ID = {
  refundLegal: '55555555-0001-4005-8000-000000000001',
  refundCs: '55555555-0001-4004-8000-000000000001',
  vipSensitive: '55555555-0001-4004-8000-000000000004',
  excludedMemo: '55555555-0001-4006-8000-000000000003',
  trashed: '55555555-0001-4006-8000-000000000004',
  registryRow: '55555555-0001-4001-8000-000000000004',
  legacyRegistered: '66666666-0001-4001-8000-000000000001',
  legacyUnregistered: '66666666-0001-4004-8000-000000000001',
  rootChild: '77777777-0001-4000-8000-000000000001',
  wikiIndexPage: '99999999-9999-4999-8999-000000000002',
  truncatedMeeting: '55555555-0002-4003-8000-000000000002',
};

function readRaw(rootDir, rel) {
  return fm.split(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
}
function findRawById(rootDir, id) {
  const files = listFiles(path.join(rootDir, 'raw')).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const { data } = readRaw(rootDir, `raw/${f}`);
    if (data && data.notion_id === id) return { rel: `raw/${f}`, data, body: readRaw(rootDir, `raw/${f}`).body };
  }
  return null;
}
function markdownCalls(client) {
  return client.stats().byPath['GET /v1/pages/{id}/markdown'] || 0;
}

test('T4 sync: 멘션 태그 — 실 Notion 의 자기닫는 형태와 문서 예시의 쌍 형태를 모두 상대 경로로 보강한다 (TRD N17)', () => {
  const { appendMentionLinks } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/sync');
  const planned = new Map([
    ['aaaaaaaa-0000-4000-8000-000000000111', { relPath: 'raw/routinefit/legal/구독-환불-규정-abc123.md', title: '구독 환불 규정' }],
  ]);
  const fromRel = 'raw/routinefit/cs/환불-처리-응대-가이드-xyz789.md';
  const selfClosing = appendMentionLinks({ body: '근거는 <mention-page url="https://app.notion.com/p/aaaaaaaa000040008000000000000111"/> 다.', fromRel, planned });
  assert.equal(selfClosing, '근거는 <mention-page url="https://app.notion.com/p/aaaaaaaa000040008000000000000111"/> ([구독 환불 규정](../legal/구독-환불-규정-abc123.md)) 다.');
  const paired = appendMentionLinks({ body: '<mention-page url="https://www.notion.so/w/aaaaaaaa000040008000000000000111">환불 규정</mention-page>', fromRel, planned });
  assert.match(paired, /<\/mention-page> \(\[환불 규정\]\(\.\.\/legal\/구독-환불-규정-abc123\.md\)\)$/);
  const unknown = '<mention-page url="https://app.notion.com/p/ffffffff000040008000000000000999"/>';
  assert.equal(appendMentionLinks({ body: unknown, fromRel, planned }), unknown, '미러에 없는 대상은 그대로');
  const selfRef = '<mention-page url="https://app.notion.com/p/aaaaaaaa000040008000000000000111"/>';
  assert.equal(appendMentionLinks({ body: selfRef, fromRel: 'raw/routinefit/legal/구독-환불-규정-abc123.md', planned }), selfRef, '자기 자신은 그대로');
  assert.equal(appendMentionLinks({ body: '<td>텍스트</td>', fromRel, planned }), '<td>텍스트</td>', '표 셀은 건드리지 않는다');
});

test('T4 sync: mock 워크스페이스 → raw/ 가 커밋된 골든과 바이트 단위로 일치한다', async () => {
  const { rootDir } = await syncOnce();
  const golden = listFiles(path.join(REPO_ROOT, 'raw'));
  const actual = listFiles(path.join(rootDir, 'raw'));
  assert.ok(golden.length >= 12, `골든 raw 파일 수 ${golden.length} — test/helpers/generate-golden.js 를 먼저 실행했는가`);
  assert.deepEqual(actual, golden);
  for (const f of golden) {
    const a = fs.readFileSync(path.join(rootDir, 'raw', f), 'utf8');
    const g = fs.readFileSync(path.join(REPO_ROOT, 'raw', f), 'utf8');
    assert.equal(a, g, `내용 불일치: raw/${f}`);
  }
});

test('T5 sync: 2회차는 본문 조회 0건, 1건만 바뀌면 그것만 다시 받는다', async () => {
  const first = await syncOnce();
  assert.ok(first.report.added.length > 10);
  const second = await syncOnce({ rootDir: first.rootDir, workspace: first.workspace });
  assert.equal(markdownCalls(second.client), 0);
  assert.equal(second.report.added.length + second.report.changed.length + second.report.deleted.length, 0);
  assert.equal(second.report.unchanged.length, first.report.added.length);

  const page = first.workspace.pages.get(ID.refundCs);
  page.last_edited_time = '2026-09-08T00:00:00.000Z';
  page._markdown += '\n추가된 문장.';
  const third = await syncOnce({ rootDir: first.rootDir, workspace: first.workspace });
  assert.equal(markdownCalls(third.client), 1);
  assert.equal(third.report.changed.length, 1);
  assert.equal(third.report.unchanged.length, first.report.added.length - 1);
  const raw = findRawById(first.rootDir, ID.refundCs);
  assert.ok(raw.body.includes('추가된 문장.'));
  assert.equal(raw.data.last_edited_time, '2026-09-08T00:00:00.000Z');
});

test('T6 sync: 민감·위키제외·휴지통 페이지는 미러에 없고, 나중에 민감으로 바뀐 파일은 삭제된다', async () => {
  const r = await syncOnce();
  assert.equal(findRawById(r.rootDir, ID.vipSensitive), null);
  assert.equal(findRawById(r.rootDir, ID.excludedMemo), null);
  assert.equal(findRawById(r.rootDir, ID.trashed), null);
  assert.ok(r.report.excluded.some((x) => x.id === ID.vipSensitive && x.reason === '민감'));
  assert.ok(r.report.excluded.some((x) => x.id === ID.excludedMemo && x.reason === '위키제외'));

  const before = findRawById(r.rootDir, ID.refundCs);
  assert.ok(before);
  const page = r.workspace.pages.get(ID.refundCs);
  page.properties['비밀등급'].select = { id: 'x', name: '민감', color: 'default' };
  page.last_edited_time = '2026-09-08T00:00:00.000Z';
  const legal = r.workspace.pages.get(ID.refundLegal);
  legal.in_trash = true; legal.is_archived = true;
  const r2 = await syncOnce({ rootDir: r.rootDir, workspace: r.workspace });
  assert.equal(fs.existsSync(path.join(r.rootDir, before.rel)), false);
  assert.equal(findRawById(r.rootDir, ID.refundLegal), null);
  assert.ok(r2.report.deleted.some((d) => d.path === before.rel && d.reason.includes('제외')));
  assert.ok(r2.report.deleted.some((d) => d.reason === '휴지통'));
});

test('T7 sync: 레거시 등록 항목은 원본 본문 + 등록 항목 meta 로 하나의 파일이 되고, 원본 단독 파일은 없다', async () => {
  const r = await syncOnce();
  const reg = findRawById(r.rootDir, ID.registryRow);
  assert.ok(reg, '등록 항목 파일');
  assert.equal(reg.data.meta_source, 'registry');
  assert.equal(reg.data.source_url, pageUrl(ID.legacyRegistered));
  assert.equal(reg.data.registry_url, pageUrl(ID.registryRow));
  assert.equal(reg.data.doc_type, '정책·규정');
  assert.equal(reg.data.review_by, '2026-06-30');
  assert.ok(reg.body.length > 100, '원본 본문이 들어와야 한다');
  assert.equal(reg.data.created_time, r.workspace.pages.get(ID.legacyRegistered).created_time);
  assert.equal(findRawById(r.rootDir, ID.legacyRegistered), null, '원본 단독 항목은 제거');
  assert.equal(listFiles(path.join(r.rootDir, 'raw')).filter((f) => f.startsWith('routinefit/') && f.includes('-666666.md')).length, 1, '루틴핏의 미등록 레거시 1건만 66666666 접미어로 남는다');

  const un = findRawById(r.rootDir, ID.legacyUnregistered);
  assert.equal(un.data.meta_source, 'inferred');
  assert.equal(un.data.category, 'cs');
  assert.equal(un.data.doc_type, null);
  assert.ok(r.report.metaMissing.some((m) => m.path === un.rel));

  const rc = findRawById(r.rootDir, ID.rootChild);
  assert.equal(rc.data.category, 'misc');
  assert.equal(rc.data.meta_source, 'inferred');
});

test('T7 sync: 멘션은 미러 내 상대 링크가 덧붙고, related 는 제목·URL 로 해석되며, truncated 는 기록된다', async () => {
  const r = await syncOnce();
  const cs = findRawById(r.rootDir, ID.refundCs);
  assert.match(cs.body, /<mention-page url="[^"]+">[^<]*<\/mention-page> \(\[[^\]]+\]\(\.\.\/legal\/[^)]+-555555\.md\)\)/);
  assert.equal(cs.data.owner[0], '김하늘');
  assert.equal(JSON.stringify(cs.data).includes('example.com'), false, '이메일이 남지 않는다');
  const legal = findRawById(r.rootDir, ID.refundLegal);
  assert.ok(legal.data.related.length >= 1);
  assert.ok(legal.data.related.every((x) => x.title && x.url.startsWith('https://www.notion.so/')));
  const meeting = findRawById(r.rootDir, ID.truncatedMeeting);
  assert.equal(meeting.data.notion_truncated, true);
  assert.equal(meeting.data.notion_unknown_blocks, 1);
  assert.match(meeting.body, /<!-- notion: truncated=true unknown_block_ids=abcdefab/);
  assert.ok(r.report.truncated.some((t) => t.path === meeting.rel));
});

test('T8 sync: 위키 루트 하위 페이지는 수집되지 않고, 위키 루트가 서비스 하위면 거부한다', async () => {
  const r = await syncOnce();
  assert.equal(findRawById(r.rootDir, ID.wikiIndexPage), null);
  assert.equal(r.report.outOfScope, 1, '위키 루트 아래 "색인" 페이지 1건이 범위 밖으로 집계된다');
  assert.equal(r.report.containers, 12, '카테고리 페이지 12건은 컨테이너로 집계된다');

  const ws = loadWorkspace();
  const wikiRoot = ws.pages.get('99999999-9999-4999-8999-000000000001');
  wikiRoot.parent = { type: 'page_id', page_id: '11111111-1111-4111-8111-000000000001' };
  await assert.rejects(() => syncOnce({ workspace: ws, mock: createMockNotion(ws) }), /자기 출력을 다시 수집/);
});

test('T8 sync: 원본 조회 실패는 그 항목만 실패로 남기고 나머지는 계속한다', async () => {
  const ws = loadWorkspace();
  ws.pages.delete(ID.legacyRegistered);
  const r = await syncOnce({ workspace: ws, mock: createMockNotion(ws) });
  assert.ok(r.report.failed.some((f) => f.id === ID.registryRow));
  assert.ok(r.report.added.length > 10);
  assert.equal(findRawById(r.rootDir, ID.registryRow), null);
});
