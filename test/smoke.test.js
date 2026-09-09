'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('package.json 에 dependencies 가 없다 (의존성 0개 원칙)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.private, true);
});

test('Node 22 이상에서 실행 중이다', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= 22, `Node ${process.versions.node}`);
});

test('notion-wiki.config.json 이 파싱되고 기본 구조를 갖는다', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'notion-wiki.config.json'), 'utf8'));
  assert.equal(cfg.notionVersion, '2026-03-11');
  assert.equal(cfg.services.length, 2);
  assert.equal(cfg.categories.filter((c) => c.fallback).length, 1);
  assert.ok(cfg.wiki.rootPageId);
});
