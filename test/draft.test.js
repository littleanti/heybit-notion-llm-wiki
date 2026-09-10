'use strict';
// T19 초안 검증 · T20 속성 쓰기 매핑 (docs/TRD.md 9절, DESIGN 10.4·10.5)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/sync-harness');
const { loadWorkspace, createMockNotion } = require('./helpers/mock-notion');
const { loadConfig } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const { createClient } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/notion-client');
const draftLib = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/lib/draft');
const templates = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/lib/doc-templates');
const propsLib = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/lib/props');
const diffLib = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/lib/diff');
const { runNew } = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/draft-new');

const cfg = loadConfig(REPO_ROOT);
const TODAY = '2026-09-10';
const NOW = '2026-09-10T02:00:00.000Z';

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndraft-'));
  fs.copyFileSync(path.join(REPO_ROOT, 'notion-wiki.config.json'), path.join(dir, 'notion-wiki.config.json'));
  return dir;
}

function faqBody(overrides = {}) {
  const sections = {
    '요약': '푸시 알림이 오지 않는다는 문의의 1차 응대와 확인 순서를 정한다.',
    '상황': '"알림이 안 와요", "푸시가 안 떠요" 라는 문의.',
    '응대': '1. 기기 알림 권한을 확인한다.\n2. 앱 내 알림 설정을 확인한다.',
    '근거 정책': '없음 — 정책 필요',
    '미확정 · 열린 질문': '없음',
    '변경 이력': `- ${TODAY} (박서준) 최초 작성`,
    ...overrides,
  };
  return Object.entries(sections)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `## ${k}\n${v}\n`)
    .join('\n');
}

function makeDraft(dataOverrides = {}, body = faqBody()) {
  const data = {
    kind: 'new', service: 'routinefit', category: 'cs', title: '알림 미수신 1차 응대',
    doc_type: 'FAQ·응대', status: '초안', author_type: '사람+AI', owner: ['박서준'],
    summary: '푸시 알림이 오지 않는다는 문의의 1차 응대와 확인 순서를 정한다',
    keywords: ['알림', '푸시'], tags: ['CS'], review_by: null, verified_at: null,
    sensitivity: '내부', exclude: false, related: [], drafted_at: NOW, ...dataOverrides,
  };
  const dir = tempRoot();
  const file = path.join(dir, 'drafts', 'routinefit', 'cs', 'draft.md');
  draftLib.writeDraft(file, data, body);
  return draftLib.readDraft(file);
}

const codesOf = (r) => [...r.errors, ...r.warnings].map((i) => i.code);
const check = (dataOverrides, body) => draftLib.validate({ cfg, draft: makeDraft(dataOverrides, body), today: TODAY });

test('T19 검증: 규약을 지킨 신규 초안은 오류·경고 0', () => {
  const r = check();
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  assert.deepEqual(r.warnings, [], JSON.stringify(r.warnings));
});

test('T19 검증: kind 와 frontmatter (draft-frontmatter-invalid)', () => {
  assert.ok(codesOf(check({ kind: 'publish' })).includes('draft-frontmatter-invalid'));
  const noKind = check({ kind: undefined });
  assert.deepEqual(noKind.errors.map((e) => e.code), ['draft-frontmatter-invalid'], 'kind 가 없으면 더 볼 것이 없다');
});

test('T19 검증: 범위·필수 속성·허용값 (draft-scope-unknown · draft-meta-missing · draft-value-invalid)', () => {
  assert.ok(codesOf(check({ service: 'nope' })).includes('draft-scope-unknown'));
  assert.ok(codesOf(check({ category: 'nope' })).includes('draft-scope-unknown'));
  for (const key of ['title', 'doc_type', 'status', 'summary']) {
    assert.ok(codesOf(check({ [key]: '' })).includes('draft-meta-missing'), `${key} 빈 값을 못 잡았다`);
  }
  assert.ok(codesOf(check({ owner: [] })).includes('draft-meta-missing'), '담당자 빈 배열');
  assert.ok(codesOf(check({ doc_type: '노트' })).includes('draft-value-invalid'));
  assert.ok(codesOf(check({ sensitivity: '극비' })).includes('draft-value-invalid'));
  assert.ok(codesOf(check({ author_type: '로봇' })).includes('draft-value-invalid'));
});

test('T19 검증: 요약 길이·날짜 형식·빈 본문 (draft-summary-long · draft-date-invalid · draft-body-empty)', () => {
  assert.ok(codesOf(check({ summary: '가'.repeat(121) })).includes('draft-summary-long'));
  assert.deepEqual(check({ summary: '가'.repeat(120) }).errors, [], '120자는 통과');
  assert.ok(codesOf(check({ review_by: '2027/03/01' })).includes('draft-date-invalid'));
  assert.ok(codesOf(check({ verified_at: '오늘' })).includes('draft-date-invalid'));
  assert.ok(codesOf(check({}, '<!-- 주석만 있다 -->\n')).includes('draft-body-empty'), '주석은 본문이 아니다');
});

test('T19 검증: 섹션 누락·순서·빈 섹션 (draft-section-missing · draft-section-empty)', () => {
  const missing = check({}, faqBody({ '근거 정책': null }));
  assert.ok(missing.errors.some((e) => e.code === 'draft-section-missing' && e.message.includes('근거 정책')));
  const reordered = `## 요약\n요약\n\n## 응대\n응대\n\n## 상황\n상황\n\n## 근거 정책\n없음 — 정책 필요\n\n## 미확정 · 열린 질문\n없음\n\n## 변경 이력\n- ${TODAY} (박서준) 작성\n`;
  assert.ok(check({}, reordered).errors.some((e) => e.code === 'draft-section-missing' && e.message.includes('앞에 있다')), '순서 위반');
  const empty = check({}, faqBody({ '미확정 · 열린 질문': '<!-- 채우기 -->' }));
  assert.ok(empty.warnings.some((w) => w.code === 'draft-section-empty'));
  assert.deepEqual(empty.errors, [], '빈 섹션은 경고일 뿐이다');
  // 골격 그대로면 필수 섹션이 다 있지만 대부분 비어 있다 → 경고 다수, 오류는 없다
  const skeleton = check({}, templates.skeleton('FAQ·응대', { today: TODAY, author: '박서준' }));
  assert.equal(skeleton.errors.length, 0);
  assert.equal(skeleton.warnings.filter((w) => w.code === 'draft-section-empty').length, 5);
});

test('T19 검증: 오늘 날짜 변경 이력 (draft-history-missing)', () => {
  assert.ok(codesOf(check({}, faqBody({ '변경 이력': '- 2026-08-01 (박서준) 최초 작성' }))).includes('draft-history-missing'));
  assert.deepEqual(check({}, faqBody({ '변경 이력': `- 2026-08-01 (박서준) 최초 작성\n- ${TODAY} (김하늘) 확인 순서 보강` })).errors, []);
});

test('T19 검증: 신규는 초안만 (draft-status-not-draft) · 수정은 상태 자유 (A23)', () => {
  assert.ok(codesOf(check({ status: '확정' })).includes('draft-status-not-draft'));
  const editData = { kind: 'edit', status: '확정', target_meta_id: '55555555-0001-4004-8000-000000000001', target_body_id: '55555555-0001-4004-8000-000000000001', base_last_edited_time: '2026-08-30T00:00:00.000Z', base_hash: 'x' };
  assert.equal(codesOf(check(editData)).includes('draft-status-not-draft'), false);
});

test('T19 검증: 수정 초안의 기준 정보 (draft-target-missing) · 섹션 누락은 경고', () => {
  const editData = { kind: 'edit', target_meta_id: null, target_body_id: null, base_last_edited_time: null };
  const r = check(editData);
  assert.equal(r.errors.filter((e) => e.code === 'draft-target-missing').length, 2);
  const r2 = check({ kind: 'edit', target_meta_id: 'a', target_body_id: '55555555-0001-4004-8000-000000000001', base_last_edited_time: 'x' }, faqBody({ '근거 정책': null }));
  assert.ok(r2.warnings.some((w) => w.code === 'draft-section-missing'), '수정에서는 경고');
  assert.deepEqual(r2.errors, [], '수정에서는 오류가 아니다');
});

test('T19 draft-new: 골격이 유형별 섹션을 순서대로 만들고, 같은 파일을 덮어쓰지 않는다', () => {
  const dir = tempRoot();
  const r = runNew({ cfg, rootDir: dir, service: 'moneynote', category: 'legal', docType: '정책·규정', title: '구독 환불 규정 v2', owner: ['김하늘'], today: TODAY, nowIso: NOW });
  assert.equal(r.rel, 'drafts/moneynote/legal/구독-환불-규정-v2.md');
  const draft = draftLib.readDraft(r.file);
  assert.deepEqual(draft.sections.map((s) => s.name), templates.sectionsFor('정책·규정'));
  assert.equal(draft.data.kind, 'new');
  assert.equal(draft.data.status, '초안');
  assert.equal(draft.data.author_type, '사람+AI');
  assert.match(draft.body, new RegExp(`- ${TODAY} \\(김하늘\\) 최초 작성`));
  assert.throws(() => runNew({ cfg, rootDir: dir, service: 'moneynote', category: 'legal', docType: '정책·규정', title: '구독 환불 규정 v2', owner: ['김하늘'], today: TODAY, nowIso: NOW }), /이미 있는 초안/);
  assert.throws(() => runNew({ cfg, rootDir: dir, service: 'moneynote', category: 'legal', docType: '노트', title: 'x', today: TODAY, nowIso: NOW }), /알 수 없는 문서유형/);
});

test('T20 props: 데이터 소스 스키마 타입대로 쓰기 형태를 만든다', async () => {
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const client = createClient({ token: 'ntn_mock', fetchImpl: mock.fetch, sleepImpl: async () => {}, now: () => 0, rps: 1000 });
  const ds = await client.request('GET', '/v1/data_sources/44444444-0001-4000-8000-000000000004');
  const schema = ds.properties;
  const owners = await propsLib.resolveOwners({ client, names: ['박서준'] });
  assert.match(owners.refs[0].id, /^aaaaaaaa-0000-4000-8000-/);
  assert.deepEqual(Object.keys(owners.refs[0]).sort(), ['id', 'object'], '실 API 는 id 로만 받는다');

  const data = makeDraft().data;
  const { properties, written, skipped } = propsLib.buildProperties({ cfg, data, schema, ownerRefs: owners.refs });
  assert.deepEqual(properties['제목'], { title: [{ type: 'text', text: { content: '알림 미수신 1차 응대' } }] });
  assert.deepEqual(properties['문서유형'], { select: { name: 'FAQ·응대' } });
  assert.deepEqual(properties['키워드'], { multi_select: [{ name: '알림' }, { name: '푸시' }] });
  assert.deepEqual(properties['담당자'], { people: owners.refs });
  assert.deepEqual(properties['검토기한'], { date: null });
  assert.deepEqual(properties['위키제외'], { checkbox: false });
  assert.deepEqual(properties['요약'].rich_text[0].text.content, data.summary);
  assert.equal('서비스' in properties, false, '스키마에 없는 속성은 만들지 않는다');
  assert.deepEqual(skipped, [], '설정에 있고 스키마에 없는 값은 값이 있을 때만 보고한다');
  assert.ok(written.length >= 9);
});

test('T20 props: 담당자 미발견·동명이인은 중단한다', async () => {
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const client = createClient({ token: 'ntn_mock', fetchImpl: mock.fetch, sleepImpl: async () => {}, now: () => 0, rps: 1000 });
  await assert.rejects(() => propsLib.resolveOwners({ client, names: ['없는사람'] }), /중단: 담당자 "없는사람" 을 워크스페이스 사용자에서 찾을 수 없습니다/);
  const users = [{ id: 'u1', name: '김하늘', type: 'person' }, { id: 'u2', name: '김하늘', type: 'person' }];
  await assert.rejects(() => propsLib.resolveOwners({ client, names: ['김하늘'], users }), /이름이 같은 사용자가 2명입니다/);
  assert.deepEqual((await propsLib.resolveOwners({ client, names: [] })).refs, []);
});

test('T20 props: 변경분만 뽑는다 (diffProperties)', async () => {
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const client = createClient({ token: 'ntn_mock', fetchImpl: mock.fetch, sleepImpl: async () => {}, now: () => 0, rps: 1000 });
  const rowId = '55555555-0001-4004-8000-000000000001';
  const page = await client.request('GET', `/v1/pages/${rowId}`);
  const ds = await client.request('GET', '/v1/data_sources/44444444-0001-4000-8000-000000000004');
  const current = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/meta').extractMeta(page, cfg);

  const same = propsLib.diffProperties({ cfg, data: { title: current.title, status: current.status, summary: current.summary, keywords: current.keywords }, schema: ds.properties, page });
  assert.deepEqual(same.changed, [], '같은 값이면 변경 없음');
  assert.deepEqual(same.properties, {});

  const changed = propsLib.diffProperties({ cfg, data: { status: '검토중', keywords: [...current.keywords, '추가어'] }, schema: ds.properties, page });
  assert.deepEqual(changed.changed.map((c) => c.key).sort(), ['keywords', 'status']);
  assert.deepEqual(changed.properties['상태'], { select: { name: '검토중' } });
  assert.equal('제목' in changed.properties, false, '바뀌지 않은 속성은 보내지 않는다');
});

test('T20 diff: LCS 가 추가·삭제·문맥을 정확히 낸다', () => {
  const rows = diffLib.lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(diffLib.counts(rows), { added: 2, removed: 1, same: 3 });
  const text = diffLib.formatDiff(rows, { context: 1 });
  assert.match(text, /^ {2}a\n- b\n\+ B\n {2}c/m);
  assert.equal(diffLib.formatDiff(diffLib.lineDiff('x', 'x')), '', '같으면 빈 diff');
  const long = diffLib.formatDiff(diffLib.lineDiff(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'), Array.from({ length: 30 }, (_, i) => (i === 15 ? 'changed' : `line ${i}`)).join('\n')), { context: 2 });
  assert.match(long, /… \d+줄 생략 …/);
});
