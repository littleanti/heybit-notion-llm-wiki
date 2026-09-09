'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, NotionError } = require('../.claude/skills/notion-llm-wiki/scripts/lib/notion-client');

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function harness(responses) {
  const calls = [];
  const sleeps = [];
  let clock = 0;
  const client = createClient({
    token: 'ntn_test_token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('예상보다 많은 요청');
      if (next instanceof Error) throw next;
      return next;
    },
    sleepImpl: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
  });
  return { client, calls, sleeps, tick: (ms) => { clock += ms; } };
}

test('T15 client: 429 는 Retry-After(초) 만큼 기다린 뒤 재시도한다', async () => {
  const h = harness([
    response(429, { code: 'rate_limited', message: 'slow down' }, { 'retry-after': '2' }),
    response(200, { object: 'page', id: 'p1' }),
  ]);
  const res = await h.client.request('GET', '/v1/pages/p1');
  assert.equal(res.id, 'p1');
  assert.equal(h.calls.length, 2);
  assert.ok(h.sleeps.includes(2000), `sleeps=${h.sleeps}`);
  assert.equal(h.client.stats().retries, 1);
  assert.equal(h.client.stats().requests, 2);
});

test('T15 client: 요청 간격이 rps 를 지킨다 (토큰 버킷)', async () => {
  const h = harness([response(200, {}), response(200, {}), response(200, {})]);
  await h.client.request('GET', '/v1/a');
  await h.client.request('GET', '/v1/b');
  await h.client.request('GET', '/v1/c');
  // 3 rps → 334ms 간격. 첫 요청은 대기 없음, 이후 두 번은 대기
  assert.equal(h.sleeps.length, 2);
  assert.ok(h.sleeps.every((ms) => ms >= 300 && ms <= 340), `sleeps=${h.sleeps}`);
});

test('T15 client: 페이지네이션은 next_cursor 를 따라 results 를 이어 붙인다', async () => {
  const h = harness([
    response(200, { results: [1, 2], has_more: true, next_cursor: 'c2' }),
    response(200, { results: [3], has_more: false, next_cursor: null, request_status: { type: 'complete' } }),
  ]);
  const out = await h.client.paginate('POST', '/v1/search', { filter: { property: 'object', value: 'page' } });
  assert.deepEqual(out.results, [1, 2, 3]);
  assert.equal(out.pages, 2);
  const second = JSON.parse(h.calls[1].init.body);
  assert.equal(second.start_cursor, 'c2');
  assert.equal(second.page_size, 100);
  assert.equal(second.filter.value, 'page');
});

test('T15 client: 4xx 는 재시도하지 않고 NotionError 를 던진다 — 메시지에 토큰이 없다', async () => {
  const h = harness([response(404, { code: 'object_not_found', message: 'Could not find page' })]);
  await assert.rejects(
    () => h.client.request('GET', '/v1/pages/missing'),
    (err) => {
      assert.ok(err instanceof NotionError);
      assert.equal(err.status, 404);
      assert.equal(err.code, 'object_not_found');
      assert.equal(String(err.message).includes('ntn_test_token'), false);
      return true;
    },
  );
  assert.equal(h.calls.length, 1);
});

test('T15 client: 헤더에 Authorization·Notion-Version 이 붙고 통계는 id 를 {id} 로 묶는다', async () => {
  const h = harness([response(200, {}), response(200, {})]);
  await h.client.request('GET', '/v1/pages/11111111-1111-4111-8111-000000000001');
  await h.client.request('GET', '/v1/pages/11111111-1111-4111-8111-000000000002');
  assert.equal(h.calls[0].init.headers.Authorization, 'Bearer ntn_test_token');
  assert.equal(h.calls[0].init.headers['Notion-Version'], '2026-03-11');
  assert.deepEqual(h.client.stats().byPath, { 'GET /v1/pages/{id}': 2 });
});

test('T15 client: 재시도 상한을 넘으면 마지막 에러를 던진다', async () => {
  const h = harness(Array.from({ length: 7 }, () => response(529, { code: 'overloaded', message: 'x' })));
  await assert.rejects(() => h.client.request('GET', '/v1/x'), (e) => e.status === 529);
  assert.equal(h.calls.length, 7);
});
