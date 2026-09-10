'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');

const sample = {
  notion_id: '3f9a1c2b-0000-4000-8000-000000000001',
  title: '구독 환불 규정: 결제 후 14일',
  summary: '루틴핏 구독 환불의 기한(결제 후 7일)·조건·예외를 정한다 #정책',
  owner: ['김하늘', '박서준'],
  keywords: ['환불', '취소', 'refund', '청약철회'],
  tags: [],
  review_by: '2027-03-01',
  verified_at: null,
  exclude: false,
  count: 12,
  ratio: 0.5,
  related: [{ title: '환불 처리 응대 가이드', url: 'https://www.notion.so/abc' }, { title: 'a, b', url: null }],
  nested: { a: 'x', b: 2 },
  weird: '"quoted" and \\backslash',
  yesno: 'yes',
  numeric_string: '007',
  colon_end: 'ends:',
  dash_start: '- not a list',
  multiline: 'line1\nline2',
};

test('T1 frontmatter: stringify → parse 라운드트립이 값을 보존한다', () => {
  const text = fm.stringify(sample);
  const back = fm.parse(text);
  assert.deepEqual(back, sample);
});

test('T1 frontmatter: 따옴표가 필요한 값만 따옴표를 쓴다', () => {
  const text = fm.stringify({ a: '환불 정책', b: '결제 후: 14일', c: 'null', d: '2026-09-09', e: '' });
  assert.match(text, /^a: 환불 정책$/m);
  assert.match(text, /^b: "결제 후: 14일"$/m);
  assert.match(text, /^c: "null"$/m);
  assert.match(text, /^d: 2026-09-09$/m);
  assert.match(text, /^e: ""$/m);
});

test('T1 frontmatter: split/join 이 본문을 그대로 두고 CRLF 를 정규화한다', () => {
  const md = '---\r\ntitle: 제목\r\nowner: [김하늘]\r\n---\r\n\r\n## 요약\r\n본문\r\n';
  const { data, body } = fm.split(md);
  assert.deepEqual(data, { title: '제목', owner: ['김하늘'] });
  assert.equal(body, '## 요약\n본문\n');
  assert.equal(fm.join(data, body), '---\ntitle: 제목\nowner: [김하늘]\n---\n\n## 요약\n본문\n');
});

test('T1 frontmatter: frontmatter 가 없으면 data 는 null', () => {
  assert.deepEqual(fm.split('# 제목\n본문'), { data: null, body: '# 제목\n본문' });
});

test('T1 frontmatter: 부분집합 밖의 YAML 은 명시적으로 거부한다', () => {
  assert.throws(() => fm.parse('a:\n  - x\n  b: y\n'), /배열과 객체를 섞었다/);
  assert.throws(() => fm.parse('  indented: 1\n'), /들여쓰기/);
  assert.throws(() => fm.parse('a: "unterminated\n'), /따옴표/);
  assert.throws(() => fm.stringify({ a: [[1, 2]] }), /스칼라만 또는 평면 객체만/);
});
