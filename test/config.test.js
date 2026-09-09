'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cfgLib = require('../.claude/skills/notion-llm-wiki/scripts/lib/config');

const root = path.resolve(__dirname, '..');
const base = JSON.parse(fs.readFileSync(path.join(root, 'notion-wiki.config.json'), 'utf8'));

function withConfig(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwiki-cfg-'));
  const cfg = JSON.parse(JSON.stringify(base));
  mutate(cfg);
  fs.writeFileSync(path.join(dir, cfgLib.CONFIG_FILE), JSON.stringify(cfg));
  return dir;
}

test('config: 샘플 설정이 로드되고 id 가 대시 형식으로 정규화된다', () => {
  const cfg = cfgLib.loadConfig(root);
  assert.equal(cfg.services[0].rootPageId, '11111111-1111-4111-8111-000000000001');
  assert.equal(cfg.sync.rps, 3);
  assert.equal(cfgLib.fallbackCategory(cfg).slug, 'misc');
  assert.equal(cfgLib.categoryByName(cfg, 'cs').slug, 'cs');
  assert.equal(cfgLib.categoryByName(cfg, '법무').slug, 'legal');
  assert.equal(cfgLib.categoryByName(cfg, '없는것'), null);
  assert.equal(cfgLib.serviceByRootId(cfg, '11111111111141118111000000000002').slug, 'moneynote');
});

test('config: 위키 루트가 서비스 루트와 같으면 거부한다 (순환)', () => {
  const dir = withConfig((c) => { c.wiki.rootPageId = c.services[0].rootPageId; });
  assert.throws(() => cfgLib.loadConfig(dir), /자기 출력을 다시 수집/);
});

test('config: slug 형식·중복·fallback 개수를 검증한다', () => {
  assert.throws(() => cfgLib.loadConfig(withConfig((c) => { c.services[0].slug = 'Routine Fit'; })), /서비스 slug 형식/);
  assert.throws(() => cfgLib.loadConfig(withConfig((c) => { c.categories[1].slug = c.categories[0].slug; })), /카테고리 slug 중복/);
  assert.throws(() => cfgLib.loadConfig(withConfig((c) => { c.categories.forEach((x) => delete x.fallback); })), /fallback 카테고리는 정확히 1개/);
});

test('config: .env 파싱과 토큰 요구 메시지', () => {
  const env = cfgLib.parseDotEnv('# 주석\nNOTION_TOKEN="ntn_abc" \nexport OTHER=x # 뒤 주석\nBAD LINE\n');
  assert.deepEqual(env, { NOTION_TOKEN: 'ntn_abc', OTHER: 'x' });
  assert.equal(cfgLib.requireToken({ NOTION_TOKEN: ' ntn_abc ' }, 'sync'), 'ntn_abc');
  assert.throws(() => cfgLib.requireToken({}, 'sync'), /NOTION_TOKEN 이 없습니다.*이 명령\(sync\)은 토큰이 필요합니다/);
});
