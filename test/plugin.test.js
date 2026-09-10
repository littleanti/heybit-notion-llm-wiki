'use strict';
// T18 — 플러그인 패키징 정합성: plugin.json · marketplace.json · .claude/settings.json · SKILL.md 경로 규약
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');

const REPO = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(REPO, 'plugins', 'notion-llm-wiki');
const SKILL_DIR = path.join(PLUGIN_DIR, 'skills', 'notion-llm-wiki');
const PLUGIN_NAME = 'notion-llm-wiki';
const MARKETPLACE_NAME = 'heybit-notion-llm-wiki';
const GITHUB_REPO = 'littleanti/heybit-notion-llm-wiki';
const KEBAB = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/; // plugins-reference.md 의 name 규칙

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pkg = readJson(path.join(REPO, 'package.json'));
const plugin = readJson(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'));
const marketplace = readJson(path.join(REPO, '.claude-plugin', 'marketplace.json'));
const settings = readJson(path.join(REPO, '.claude', 'settings.json'));

test('T18 plugin.json — 이름 규칙 · 버전은 package.json 과 같다 · 저장소 · 라이선스', () => {
  assert.equal(plugin.name, PLUGIN_NAME);
  assert.match(plugin.name, KEBAB);
  assert.equal(plugin.version, pkg.version, 'plugin.json version 은 package.json version 과 함께 올린다 (ADR-009)');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, 'semver');
  assert.equal(plugin.license, 'MIT');
  assert.ok(String(plugin.repository).includes(GITHUB_REPO));
  assert.ok(plugin.description && plugin.description.length > 0);
  assert.equal(plugin.author && plugin.author.email, undefined, '공개 매니페스트에 이메일을 싣지 않는다');
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'SKILL.md')), '기본 위치 skills/<name>/SKILL.md 에 스킬이 있어야 plugin.json 의 skills 필드를 생략할 수 있다');
});

test('T18 플러그인 디렉터리는 설치되는 것만 담는다 (샘플 데이터·락파일 없음)', () => {
  for (const d of ['raw', 'wiki', 'test', 'docs', 'node_modules']) {
    assert.equal(fs.existsSync(path.join(PLUGIN_DIR, d)), false, `plugins/notion-llm-wiki/${d} 는 설치 캐시에 실려 가므로 두지 않는다`);
  }
  for (const f of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', '.env']) {
    assert.equal(fs.existsSync(path.join(PLUGIN_DIR, f)), false, `${f} 가 있으면 설치 시 node_modules 를 받거나 비밀이 실린다`);
  }
  assert.equal(fs.existsSync(path.join(REPO, '.claude', 'skills', 'notion-llm-wiki')), false, '옛 프로젝트 스킬 사본이 남아 있으면 같은 스킬이 두 번 로드된다');
});

test('T18 marketplace.json — 필수 필드 · 상대 경로 source 가 플러그인 루트를 가리킨다', () => {
  assert.equal(marketplace.name, MARKETPLACE_NAME);
  assert.match(marketplace.name, KEBAB);
  assert.ok(marketplace.owner && marketplace.owner.name, 'owner.name 필수');
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1);
  const entry = marketplace.plugins[0];
  assert.equal(entry.name, PLUGIN_NAME);
  assert.match(entry.source, /^\.\//, '같은 저장소의 플러그인은 ./ 로 시작하는 상대 경로');
  assert.equal(entry.source.includes('..'), false, '마켓플레이스 루트 밖(../)은 금지');
  const resolved = path.resolve(REPO, entry.source);
  assert.equal(resolved, PLUGIN_DIR, 'source 는 마켓플레이스 루트(.claude-plugin 을 담은 디렉터리) 기준으로 해석된다');
  assert.ok(fs.existsSync(path.join(resolved, '.claude-plugin', 'plugin.json')));
  assert.equal(entry.version, undefined, '버전은 plugin.json 한 곳에만 둔다 (두 곳이면 어긋난다)');
});

test('T18 .claude/settings.json — 이 저장소를 여는 사람에게 같은 마켓플레이스·플러그인을 권장한다', () => {
  const mk = settings.extraKnownMarketplaces && settings.extraKnownMarketplaces[MARKETPLACE_NAME];
  assert.ok(mk, `extraKnownMarketplaces.${MARKETPLACE_NAME} 없음`);
  assert.equal(mk.source.source, 'github');
  assert.equal(mk.source.repo, GITHUB_REPO);
  assert.equal(settings.enabledPlugins[`${PLUGIN_NAME}@${MARKETPLACE_NAME}`], true);
});

test('T18 SKILL.md — 스크립트는 ${CLAUDE_SKILL_DIR} 로만 부르고, 본문과 allowed-tools 가 같은 변수를 쓴다', () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const { data, body } = fm.split(skill);
  assert.ok(String(data['allowed-tools']).includes('Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)'), 'allowed-tools 에 ${CLAUDE_SKILL_DIR} 규칙');
  const calls = [...body.matchAll(/node\s+("?)([^\s"]+\/scripts\/[a-z-]+\.js)\1/g)].map((m) => m[2]);
  assert.ok(calls.length >= 5, `본문에 스크립트 호출이 ${calls.length}개`);
  for (const c of calls) assert.ok(c.startsWith('${CLAUDE_SKILL_DIR}/scripts/'), `치환 변수 없는 경로: ${c}`);
  assert.equal(skill.includes('.claude/skills/notion-llm-wiki/'), false, 'SKILL.md 에 옛 프로젝트 상대 스크립트 경로가 남아 있다');
  for (const script of calls.map((c) => c.replace('${CLAUDE_SKILL_DIR}/', ''))) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, script)), `SKILL.md 가 부르는 ${script} 가 없다`);
  }
  const refsDir = path.join(SKILL_DIR, 'references');
  for (const f of fs.readdirSync(refsDir)) {
    const t = fs.readFileSync(path.join(refsDir, f), 'utf8');
    assert.equal(/\.claude\/skills\/|plugins\/notion-llm-wiki\//.test(t), false, `references/${f} 는 경로를 직접 쓰지 않는다 (치환이 적용되지 않는 파일)`);
  }
});
