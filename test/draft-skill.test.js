'use strict';
// T23 작성 스킬 구조 — SKILL.md 규약, references, doc-templates ↔ DESIGN 10.4 대조, 스킬 간 결합점 (docs/TRD.md ADR-010)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/sync-harness');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');
const templates = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/lib/doc-templates');

const PLUGIN_DIR = path.join(REPO_ROOT, 'plugins', 'notion-llm-wiki');
const SKILL_DIR = path.join(PLUGIN_DIR, 'skills', 'notion-draft');
const SKILL = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const { data, body } = fm.split(SKILL);
const SUB = ['new', 'edit', 'submit'];
const DESIGN = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'DESIGN.md'), 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('T23 skill: frontmatter — name · description(3개 동작과 반대 방향 스킬 언급) · argument-hint · allowed-tools', () => {
  assert.equal(data.name, 'notion-draft');
  assert.equal(path.basename(SKILL_DIR), data.name, '디렉터리 이름과 name 이 같아야 /notion-draft 로도 불린다');
  for (const s of SUB) assert.ok(data.description.includes(`(${s})`), `description 에 (${s}) 없음`);
  assert.ok(data.description.includes('notion-llm-wiki'), '반대 방향 스킬을 가리켜야 사용자가 헷갈리지 않는다');
  assert.ok(((data.description || '') + (data.when_to_use || '')).length <= 1536, 'description+when_to_use 1,536자 이내');
  assert.match(data['argument-hint'], /new\|edit\|submit/);
  const tools = String(data['allowed-tools']);
  assert.ok(tools.includes('Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)'), '번들 스크립트 규칙');
  assert.ok(tools.includes('AskUserQuestion'), '필수 속성을 물어야 하므로 AskUserQuestion 이 필요하다');
  assert.equal(tools.includes('Bash(*)'), false, '전체 Bash 를 열지 않는다');
});

test('T23 skill: 서브커맨드 3개 섹션 · 절대 규칙 · references 존재', () => {
  for (const s of SUB) assert.match(body, new RegExp(`^## \`${s}`, 'm'), `## ${s} 섹션 없음`);
  for (const r of ['draft-templates.md', 'draft-procedure.md']) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', r)), `references/${r} 없음`);
    assert.ok(SKILL.includes(`references/${r}`), `SKILL.md 가 references/${r} 를 언급하지 않는다`);
  }
  for (const s of ['draft-new.js', 'draft-pull.js', 'draft-submit.js']) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'scripts', s)), `scripts/${s} 없음`);
  }
  assert.ok(SKILL.split('\n').length <= 500, 'SKILL.md 500줄 이내');
  assert.match(body, /추측하지 않는다/, '필수 속성을 추측하지 않는다는 규칙');
  assert.match(body, /상태: 초안/, '신규는 초안으로만');
  assert.match(body, /토큰을 출력하지 않는다/);
  assert.match(body, /중단:/, '"중단:" 메시지를 만났을 때의 규칙');
});

test('T23 skill: 본문의 스크립트 호출은 모두 ${CLAUDE_SKILL_DIR} 로만', () => {
  const calls = [...body.matchAll(/node\s+("?)([^\s"]+\/scripts\/[a-z-]+\.js)\1/g)].map((m) => m[2]);
  assert.ok(calls.length >= 3, `본문 스크립트 호출 ${calls.length}개`);
  for (const c of calls) assert.ok(c.startsWith('${CLAUDE_SKILL_DIR}/scripts/'), `치환 변수 없는 경로: ${c}`);
  assert.equal(SKILL.includes('.claude/skills/'), false);
});

test('T23 doc-templates: DESIGN 10.4 표와 유형·섹션이 정확히 일치한다', () => {
  const section = DESIGN.slice(DESIGN.indexOf('### 10.4'), DESIGN.indexOf('### 10.5'));
  assert.ok(section.length > 200, 'DESIGN 10.4 를 찾지 못했다');
  const rows = [...section.matchAll(/^\| `([^`]+)` \| (.+?) \|$/gm)].map((m) => [m[1], m[2]]);
  assert.equal(rows.length, 9, `DESIGN 10.4 의 유형 행이 9개여야 한다 (현재 ${rows.length})`);
  assert.deepEqual(rows.map((r) => r[0]).sort(), templates.docTypes().slice().sort(), '유형 목록 불일치');
  for (const [docType, cell] of rows) {
    // 표 칸은 " / " 로 섹션을 나눈다. 기획서의 "요약 · 배경 · 문제" 는 두 섹션이 한 칸에 붙어 있다.
    const listed = cell.split(' / ').map((s) => s.trim()).filter(Boolean);
    const expected = templates.sectionsFor(docType);
    const flat = listed.join(' / ');
    const expectedFlat = expected.join(' / ').replace('요약 / 배경 · 문제', '요약 · 배경 · 문제');
    assert.equal(flat, expectedFlat, `${docType} 의 섹션이 DESIGN 과 다르다`);
    assert.equal(expected[0], '요약');
    assert.deepEqual(expected.slice(-2), ['미확정 · 열린 질문', '변경 이력'], `${docType} 의 마지막 두 섹션`);
  }
});

test('T23 doc-templates: 문서유형 목록이 설정의 허용값과 같다', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'notion-wiki.config.json'), 'utf8'));
  assert.deepEqual(templates.docTypes().slice().sort(), cfg.values.docType.slice().sort());
  const refs = fs.readFileSync(path.join(SKILL_DIR, 'references', 'draft-templates.md'), 'utf8');
  for (const t of templates.docTypes()) assert.ok(refs.includes(`\`${t}\``), `draft-templates.md 에 ${t} 없음`);
});

test('T23 ADR-010: 두 스킬의 결합은 lib/shared.js 한 파일뿐이다', () => {
  const files = walk(path.join(SKILL_DIR, 'scripts')).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 8);
  const coupling = files.filter((f) => /notion-llm-wiki\//.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(coupling.map((f) => path.basename(f)), ['shared.js'], '형제 스킬 경로는 shared.js 만 안다');
  const shared = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/lib/shared');
  for (const k of ['config', 'notionClient', 'frontmatter', 'meta', 'slug', 'mdNotion', 'pages', 'sync', 'registerLegacy']) {
    assert.ok(shared[k], `shared.${k} 가 해석되지 않는다`);
  }
  assert.equal(typeof shared.sync.sortedJson, 'function', '상태 직렬화는 sync.js 의 것을 쓴다');
  assert.equal(typeof shared.registerLegacy.findCategoryDataSource, 'function', '카테고리 DB 탐색은 한 구현이다');
});

test('T23 플러그인: 스킬 2개가 같은 플러그인에 있고 마켓플레이스는 그대로다', () => {
  const skills = fs.readdirSync(path.join(PLUGIN_DIR, 'skills')).sort();
  assert.deepEqual(skills, ['notion-draft', 'notion-llm-wiki']);
  const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(plugin.version, pkg.version, '버전은 함께 올린다');
  assert.equal('skills' in plugin, false, '기본 위치를 쓰므로 skills 필드가 필요 없다');
});
