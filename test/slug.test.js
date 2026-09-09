'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTitle, shortId, rawFileName, MAX_TITLE_CHARS } = require('../.claude/skills/notion-llm-wiki/scripts/lib/slug');

const ID = '3f9a1c2b-0000-4000-8000-000000000001';

test('T2 slug: 금지 문자를 - 로 바꾸고 축약한다', () => {
  assert.equal(sanitizeTitle('환불 처리 / 응대: 가이드?'), '환불-처리-응대-가이드');
  assert.equal(sanitizeTitle('  a  <b> | c*d  '), 'a-b-c-d');
  assert.equal(sanitizeTitle('[초안] 2026 Q3 (v2)'), '초안-2026-Q3-v2');
});

test('T2 slug: 빈 제목은 untitled, 길이는 상한에서 잘린다', () => {
  assert.equal(sanitizeTitle(''), 'untitled');
  assert.equal(sanitizeTitle('///'), 'untitled');
  const long = '가'.repeat(100);
  assert.equal(Array.from(sanitizeTitle(long)).length, MAX_TITLE_CHARS);
});

test('T2 slug: NFC 정규화 — 분해형(NFD) 한글도 같은 파일명이 된다', () => {
  const nfd = '환불'.normalize('NFD');
  assert.notEqual(nfd, '환불');
  assert.equal(sanitizeTitle(nfd), '환불');
});

test('T2 slug: id 접미어 6자 + .md, 잘못된 id 는 거부', () => {
  assert.equal(shortId(ID), '3f9a1c');
  assert.equal(shortId('3F9A1C2B00004000800000000000000A'), '3f9a1c');
  assert.equal(rawFileName('환불 정책', ID), '환불-정책-3f9a1c.md');
  assert.throws(() => shortId('not-an-id'), /Notion id 형식/);
});
