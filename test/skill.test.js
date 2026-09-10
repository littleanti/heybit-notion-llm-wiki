'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');

const SKILL_DIR = path.resolve(__dirname, '..', 'plugins', 'notion-llm-wiki', 'skills', 'notion-llm-wiki');
const SKILL = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const { data, body } = fm.split(SKILL);
const SUBCOMMANDS = ['sync', 'ingest', 'query', 'lint', 'publish'];

test('T16 skill: frontmatter — name · description(5개 동작 언급) · argument-hint · allowed-tools', () => {
  assert.equal(data.name, 'notion-llm-wiki');
  assert.equal(path.basename(SKILL_DIR), data.name, '디렉터리 이름과 name 이 같아야 /notion-llm-wiki 로 호출된다');
  for (const s of SUBCOMMANDS) assert.ok(data.description.includes(`(${s})`), `description 에 (${s}) 없음`);
  assert.ok(((data.description || '') + (data.when_to_use || '')).length <= 1536, 'description+when_to_use 1,536자 이내');
  assert.match(data['argument-hint'], /sync\|ingest\|query\|lint\|publish/);
  assert.ok(String(data['allowed-tools']).includes('Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)'), '번들 스크립트 규칙은 ${CLAUDE_SKILL_DIR} 로 (본문과 같은 변수 — 권한 프롬프트 없이 실행)');
  assert.equal(String(data['allowed-tools']).includes('Bash(*)'), false, '전체 Bash 를 열지 않는다');
});

test('T16 skill: 서브커맨드 5개가 각자 섹션을 갖고, LLM 절차는 references 파일을 가리킨다', () => {
  for (const s of SUBCOMMANDS) assert.match(body, new RegExp(`^## \`${s}`, 'm'), `## ${s} 섹션 없음`);
  const refs = ['wiki-schema.md', 'ingest-procedure.md', 'query-procedure.md', 'lint-semantic.md', 'notion-authoring.md'];
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', r)), `references/${r} 없음`);
    assert.ok(SKILL.includes(`references/${r}`), `SKILL.md 가 references/${r} 를 언급하지 않는다`);
  }
  const scripts = ['sync.js', 'build-index.js', 'lint.js', 'publish.js', 'register-legacy.js'];
  for (const s of scripts) assert.ok(fs.existsSync(path.join(SKILL_DIR, 'scripts', s)), `scripts/${s} 없음`);
});

test('T16 skill: SKILL.md 는 500줄 이내이고 절대 규칙(raw 읽기 전용·출처·토큰)을 담는다', () => {
  assert.ok(SKILL.split('\n').length <= 500);
  assert.match(body, /raw\/.*읽기만/);
  assert.match(body, /출처/);
  assert.match(body, /토큰을 출력하지 않는다/);
});

test('T16 skill: references 의 상한·규칙이 설정·문서와 일치한다', () => {
  const schema = fs.readFileSync(path.join(SKILL_DIR, 'references', 'wiki-schema.md'), 'utf8');
  assert.match(schema, /최대 15/);
  assert.match(schema, /200줄/);
  assert.match(schema, /200KB/);
  for (const t of ['overview', 'digest', 'topic', 'conflicts']) assert.ok(schema.includes(`\`${t}\``), `wiki-schema 에 ${t} 없음`);
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'notion-wiki.config.json'), 'utf8'));
  for (const v of cfg.values.docType) assert.ok(schema.includes(v), `wiki-schema 의 doc_type 목록에 ${v} 없음`);
});
