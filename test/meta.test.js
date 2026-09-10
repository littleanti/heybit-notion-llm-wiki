'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const meta = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/meta');

const cfg = loadConfig(path.resolve(__dirname, '..'));

function rt(s) { return [{ type: 'text', plain_text: s, text: { content: s } }]; }

const page = {
  id: '3f9a1c2b-0000-4000-8000-000000000001',
  properties: {
    '제목': { type: 'title', title: rt('구독 환불 규정') },
    '문서유형': { type: 'select', select: { id: 'x', name: '정책·규정', color: 'blue' } },
    '상태': { type: 'status', status: { id: 'y', name: '확정', color: 'green' } },
    '작성주체': { type: 'select', select: null },
    '담당자': { type: 'people', people: [{ object: 'user', id: 'u1', name: '김하늘', person: { email: 'secret@example.com' } }] },
    '요약': { type: 'rich_text', rich_text: rt('환불 기한·조건·예외를 정한다') },
    '키워드': { type: 'multi_select', multi_select: [{ name: '환불' }, { name: 'refund' }] },
    '태그': { type: 'multi_select', multi_select: [] },
    '검토기한': { type: 'date', date: { start: '2027-03-01', end: null } },
    '최종확인일': { type: 'date', date: null },
    '비밀등급': { type: 'select', select: { name: '내부' } },
    '위키제외': { type: 'checkbox', checkbox: false },
    '원본': { type: 'url', url: 'https://www.notion.so/heybit/Refund-2025-aaaaaaaabbbbccccddddeeeeeeeeeeee' },
    '관련 페이지': { type: 'relation', relation: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }], has_more: false },
  },
};

test('T3 meta: 속성 타입 10종을 내부 키로 읽는다 (people 은 이름만)', () => {
  const m = meta.extractMeta(page, cfg);
  assert.equal(m.title, '구독 환불 규정');
  assert.equal(m.docType, '정책·규정');
  assert.equal(m.status, '확정');
  assert.equal(m.authorType, null);
  assert.deepEqual(m.owner, ['김하늘']);
  assert.equal(JSON.stringify(m).includes('secret@example.com'), false);
  assert.equal(m.summary, '환불 기한·조건·예외를 정한다');
  assert.deepEqual(m.keywords, ['환불', 'refund']);
  assert.deepEqual(m.tags, []);
  assert.equal(m.reviewBy, '2027-03-01');
  assert.equal(m.verifiedAt, null);
  assert.equal(m.sensitivity, '내부');
  assert.equal(m.exclude, false);
  assert.equal(m.source, 'https://www.notion.so/heybit/Refund-2025-aaaaaaaabbbbccccddddeeeeeeeeeeee');
  assert.deepEqual(m.related, ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
  assert.equal(m.service, null);
  assert.equal(m.category, null);
});

test('T3 meta: 속성이 전혀 없는 페이지(레거시)는 전부 null / [] / false', () => {
  const m = meta.extractMeta({ id: 'x', properties: { title: { type: 'title', title: rt('옛 페이지') } } }, cfg);
  assert.equal(m.title, '옛 페이지');
  assert.equal(m.docType, null);
  assert.deepEqual(m.owner, []);
  assert.equal(m.exclude, false);
});

test('T3 meta: 제외 판정 — 민감 · 위키제외 · excludeWhenUnset', () => {
  assert.deepEqual(meta.isExcluded({ sensitivity: '민감', exclude: false }, cfg), { excluded: true, reason: '민감' });
  assert.deepEqual(meta.isExcluded({ sensitivity: '내부', exclude: true }, cfg), { excluded: true, reason: '위키제외' });
  assert.deepEqual(meta.isExcluded({ sensitivity: null, exclude: false }, cfg), { excluded: false, reason: null });
  const strict = { ...cfg, sync: { ...cfg.sync, excludeWhenUnset: true } };
  assert.equal(meta.isExcluded({ sensitivity: null, exclude: false }, strict).excluded, true);
});

test('T3 meta: URL 에서 page id 를 뽑는다', () => {
  assert.equal(meta.pageIdFromUrl('https://www.notion.so/heybit/Refund-aaaaaaaabbbbccccddddeeeeeeeeeeee'), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(meta.pageIdFromUrl('https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee?v=123'), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(meta.pageIdFromUrl('https://www.notion.so/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(meta.pageIdFromUrl('https://example.com/no-id'), null);
  assert.equal(meta.pageIdFromUrl(null), null);
});

test('T3 meta: raw frontmatter 의 키 순서가 고정이다', () => {
  const fmObj = meta.toRawFrontmatter({
    pageId: page.id, title: '구독 환불 규정', meta: meta.extractMeta(page, cfg),
    service: cfg.services[0], category: cfg.categories[4],
    sourceUrl: 'https://www.notion.so/x', registryUrl: null, metaSource: 'properties',
    createdTime: '2026-06-12T09:30:00.000Z', lastEditedTime: '2026-09-01T02:11:45.000Z', syncedAt: '2026-09-09T01:00:00.000Z',
    truncated: false, unknownBlocks: 0, related: [],
  });
  assert.deepEqual(Object.keys(fmObj), [
    'notion_id', 'title', 'service', 'service_name', 'category', 'category_name', 'doc_type', 'status', 'author_type',
    'owner', 'summary', 'keywords', 'tags', 'review_by', 'verified_at', 'sensitivity', 'related', 'source_url',
    'registry_url', 'meta_source', 'created_time', 'last_edited_time', 'synced_at', 'notion_truncated', 'notion_unknown_blocks',
  ]);
  assert.equal(fmObj.category, 'legal');
  assert.equal(fmObj.verified_at, null);
});
