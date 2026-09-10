'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REPO_ROOT, makeClient } = require('./helpers/sync-harness');
const { loadWorkspace, createMockNotion, pageUrl } = require('./helpers/mock-notion');
const { loadConfig } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const { runRegisterLegacy } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/register-legacy');

const cfg = loadConfig(REPO_ROOT);
const UNREGISTERED_CS = '66666666-0001-4004-8000-000000000001';

test('T17 register-legacy: dry-run 은 미등록 레거시만 계획하고 쓰지 않는다', async () => {
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const r = await runRegisterLegacy({ cfg, client: makeClient(mock), serviceSlug: 'routinefit', categorySlug: 'cs' });
  assert.equal(r.legacy, 1);
  assert.equal(r.alreadyRegistered, 0);
  assert.deepEqual(r.planned.map((p) => p.id), [UNREGISTERED_CS]);
  assert.equal(mock.writes.length, 0);
});

test('T17 register-legacy: 이미 등록된 레거시는 건너뛴다 (상품기획: 등록 항목 1 존재)', async () => {
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const r = await runRegisterLegacy({ cfg, client: makeClient(mock), serviceSlug: 'routinefit', categorySlug: 'product-planning' });
  assert.equal(r.legacy, 1);
  assert.equal(r.alreadyRegistered, 1);
  assert.equal(r.planned.length, 0);
});

test('T17 register-legacy: --apply 는 제목+원본(+상태 초안) 만 채운 행을 만들고, 재실행 시 0건', async () => {
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const client = makeClient(mock);
  const originalBefore = JSON.stringify(ws.pages.get(UNREGISTERED_CS));
  const r = await runRegisterLegacy({ cfg, client, serviceSlug: 'routinefit', categorySlug: 'cs', apply: true });
  assert.equal(r.created.length, 1);
  const w = mock.writes.find((x) => x.op === 'create_row');
  assert.equal(w.title, '2025 CS 응대 원칙');
  assert.equal(w.props['원본'], pageUrl(UNREGISTERED_CS));
  assert.equal(w.props['상태'], '초안');
  assert.equal(w.props['요약'], undefined, '요약은 사람이 채운다');
  assert.equal(mock.writes.length, 1, '쓰기는 행 생성 1건뿐');
  assert.equal(JSON.stringify(ws.pages.get(UNREGISTERED_CS)), originalBefore, '원본 페이지는 건드리지 않는다');

  const again = await runRegisterLegacy({ cfg, client, serviceSlug: 'routinefit', categorySlug: 'cs', apply: true });
  assert.equal(again.alreadyRegistered, 1);
  assert.equal(again.created.length, 0);
});

test('T17 register-legacy: 카테고리 페이지가 없으면 명확한 에러', async () => {
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  await assert.rejects(() => runRegisterLegacy({ cfg, client: makeClient(mock), serviceSlug: 'routinefit', categorySlug: 'misc' }), /카테고리 페이지 "기타" 을 찾을 수 없다/);
});
