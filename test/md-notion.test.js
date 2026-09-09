'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { toEnhancedMarkdown, escapeText, callout } = require('../.claude/skills/notion-llm-wiki/scripts/lib/md-notion');
const fm = require('../.claude/skills/notion-llm-wiki/scripts/lib/frontmatter');

const GOLDEN_DIR = path.join(__dirname, 'golden');

test('T11 md-notion: 파이프 표 → <table>, 셀 안 인라인 서식 유지', () => {
  const md = '| 항목 | 값 |\n|---|---|\n| 기한 | **14일** |\n| 비고 | `code` \\| 파이프 |\n';
  const { markdown } = toEnhancedMarkdown(md);
  assert.equal(markdown, [
    '<table header-row="true">',
    '\t<tr>', '\t\t<td>항목</td>', '\t\t<td>값</td>', '\t</tr>',
    '\t<tr>', '\t\t<td>기한</td>', '\t\t<td>**14일**</td>', '\t</tr>',
    '\t<tr>', '\t\t<td>비고</td>', '\t\t<td>`code` \\| 파이프</td>', '\t</tr>',
    '</table>',
  ].join('\n'));
});

test('T11 md-notion: 목록 중첩은 탭, 체크박스·번호 목록 유지, 빈 줄 제거, 문단 소프트랩 합침', () => {
  const md = '- 상위\n  - 하위 2칸\n    - 하위 4칸\n1. 첫째\n2) 둘째\n- [ ] 할 일\n- [x] 끝난 일\n\n문단 첫 줄\n문단 둘째 줄\n\n다음 문단\n';
  const { markdown } = toEnhancedMarkdown(md);
  assert.equal(markdown, '- 상위\n\t- 하위 2칸\n\t\t- 하위 4칸\n1. 첫째\n2. 둘째\n- [ ] 할 일\n- [x] 끝난 일\n문단 첫 줄 문단 둘째 줄\n다음 문단');
});

test('T11 md-notion: 연속 인용은 한 블록 + <br>, h5/h6 → h4, 구분선, HTML 주석 제거', () => {
  const md = '##### 다섯\n###### 여섯\n> 첫 줄\n> 둘째 줄\n\n***\n<!-- 주석 -->\n본문\n';
  const { markdown } = toEnhancedMarkdown(md);
  assert.equal(markdown, '#### 다섯\n#### 여섯\n> 첫 줄<br>둘째 줄\n---\n본문');
});

test('T11 md-notion: 텍스트의 특수문자는 이스케이프하되 코드·링크 URL·태그·취소선은 건드리지 않는다', () => {
  assert.equal(escapeText('a < b > {c} $5 ^2 x|y [초안] ~물결 ~~취소~~'), 'a \\< b \\> \\{c\\} \\$5 \\^2 x\\|y \\[초안\\] \\~물결 ~~취소~~');
  const md = '값은 `a < b` 이고 [링크 <x>](https://example.com/a?b={1}) 이다.\n<callout icon="💡" color="gray_bg">\n\t그대로 <b> {c}\n</callout>\n<mention-page url="https://www.notion.so/x">멘션</mention-page> 뒤 텍스트 <x>\n';
  const { markdown } = toEnhancedMarkdown(md);
  assert.equal(markdown, '값은 `a < b` 이고 [링크 \\<x\\>](https://example.com/a?b={1}) 이다.\n<callout icon="💡" color="gray_bg">\n\t그대로 <b> {c}\n</callout>\n<mention-page url="https://www.notion.so/x">멘션</mention-page> 뒤 텍스트 <x>');
});

test('T11 md-notion: 코드 블록은 그대로, 상대 링크는 콜백으로 해석되고 실패하면 텍스트만 남긴다', () => {
  const md = '```js\nconst a = 1 < 2; // {x}\n```\n[원본](../../raw/x/y/z.md) 와 [없음](./none.md) 와 [외부](https://e.com)\n';
  const resolveLink = (href) => (href.endsWith('z.md') ? 'https://www.notion.so/heybit/abc' : null);
  const { markdown, unresolved } = toEnhancedMarkdown(md, { resolveLink });
  assert.equal(markdown, '```js\nconst a = 1 < 2; // {x}\n```\n[원본](https://www.notion.so/heybit/abc) 와 없음 와 [외부](https://e.com)');
  assert.deepEqual(unresolved, ['./none.md']);
});

test('T11 md-notion: 골든 — 위키 페이지 샘플 전체 변환', () => {
  const src = path.join(GOLDEN_DIR, 'md-notion.input.md');
  const expected = path.join(GOLDEN_DIR, 'md-notion.expected.md');
  assert.ok(fs.existsSync(src) && fs.existsSync(expected), '골든 파일이 없다');
  const { body } = fm.split(fs.readFileSync(src, 'utf8')); // publish 와 같은 순서: frontmatter 제거 → 정규화
  const { markdown } = toEnhancedMarkdown(body, { resolveLink: (h) => `https://www.notion.so/heybit/${Buffer.from(h).toString('hex').slice(0, 32).padEnd(32, '0')}` });
  assert.equal(markdown + '\n', fs.readFileSync(expected, 'utf8'));
});

test('T11 md-notion: callout 헬퍼', () => {
  assert.equal(callout('안내'), '<callout icon="🤖" color="gray_bg">\n\t안내\n</callout>');
});
