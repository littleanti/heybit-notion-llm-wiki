'use strict';
// T21 신규 게시 · T22 기존 페이지 수정 (docs/TRD.md 9절, PRD A19~A22)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, syncOnce, makeClient } = require('./helpers/sync-harness');
const { loadWorkspace, createMockNotion } = require('./helpers/mock-notion');
const { loadConfig } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');
const { runSync } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/sync');
const draftLib = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/lib/draft');
const { runNew } = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/draft-new');
const { runPull } = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/draft-pull');
const { runSubmit, summaryLine } = require('../plugins/notion-llm-wiki/skills/notion-draft/scripts/draft-submit');

const TODAY = '2026-09-10';
const NOW = '2026-09-10T02:00:00.000Z';

// mock 워크스페이스에 대해 한 번 동기화한 작업 공간을 만든다 (raw 미러가 있는 실제 상태)
async function workspaceWithMirror() {
  const r = await syncOnce({});
  return { rootDir: r.rootDir, cfg: r.cfg, mock: r.mock, client: r.client, workspace: r.workspace };
}

function faqDraft(rootDir, cfg, overrides = {}) {
  const r = runNew({
    cfg, rootDir, service: 'routinefit', category: 'cs', docType: 'FAQ·응대',
    title: '알림 미수신 1차 응대', owner: ['박서준'],
    summary: '푸시 알림이 오지 않는다는 문의의 1차 응대와 확인 순서를 정한다',
    keywords: ['알림', '푸시', '미수신'], tags: ['CS', '알림'], today: TODAY, nowIso: NOW, ...overrides,
  });
  const body = [
    '## 요약', '푸시 알림이 오지 않는다는 문의의 1차 응대와 확인 순서를 정한다.', '',
    '## 상황', '"알림이 안 와요", "푸시가 안 떠요" 라는 문의.', '',
    '## 응대', '1. 기기 알림 권한을 확인한다.', '2. 앱 내 알림 설정을 확인한다.', '',
    '## 근거 정책', '없음 — 정책 필요', '',
    '## 미확정 · 열린 질문', '없음', '',
    '## 변경 이력', `- ${TODAY} (박서준) 최초 작성`, '',
  ].join('\n');
  draftLib.writeDraft(r.file, draftLib.readDraft(r.file).data, body);
  return r.file;
}

test('T21 신규: dry-run 은 Notion 에 쓰지 않고 대상·속성·본문을 보여 준다 (A19)', async () => {
  const { rootDir, cfg, mock, client } = await workspaceWithMirror();
  const file = faqDraft(rootDir, cfg);
  const before = mock.writes.length;
  const report = await runSubmit({ cfg, client, rootDir, file, apply: false, today: TODAY, nowIso: NOW });
  assert.equal(report.aborted, null, report.aborted || '');
  assert.deepEqual(report.errors, []);
  assert.equal(mock.writes.length, before, 'dry-run 은 쓰기 0건이어야 한다');
  assert.equal(report.action, '신규 생성');
  assert.match(report.targetName, /루틴핏 · CS/);
  const byKey = Object.fromEntries(report.properties.written.map((w) => [w.key, w]));
  assert.equal(byKey.title.name, '제목');
  assert.equal(byKey.status.value, '초안');
  assert.equal(byKey.owner.resolved[0].name, '박서준');
  assert.match(byKey.owner.resolved[0].id, /^aaaaaaaa-/);
  assert.ok(report.body.bytes > 100);
  assert.equal(report.body.sections, 6);
  assert.equal(summaryLine(report), 'dry-run: 신규 1 · 수정 0 · 오류 0 · 경고 0. 실제로 쓰려면 --apply');
});

test('T21 신규: --apply 가 DB 항목을 만들고 속성이 매핑대로 들어간다 (A20)', async () => {
  const { rootDir, cfg, mock, client } = await workspaceWithMirror();
  const file = faqDraft(rootDir, cfg);
  const report = await runSubmit({ cfg, client, rootDir, file, apply: true, today: TODAY, nowIso: NOW });
  assert.equal(report.aborted, null, report.aborted || '');
  assert.ok(report.created && report.created.id, '생성 결과가 없다');
  const created = mock.writes.filter((w) => w.op === 'create_row');
  assert.equal(created.length, 1);
  assert.equal(created[0].dataSource, '44444444-0001-4000-8000-000000000004', '루틴핏 · CS 의 data source');
  assert.equal(created[0].title, '알림 미수신 1차 응대');
  assert.deepEqual(created[0].props['담당자'], ['박서준'], '이름 → id → 다시 이름으로 왕복');
  assert.equal(created[0].props['문서유형'], 'FAQ·응대');
  assert.equal(created[0].props['상태'], '초안');
  assert.deepEqual(created[0].props['키워드'], ['알림', '푸시', '미수신']);
  assert.equal(created[0].props['위키제외'], false);
  const page = await client.request('GET', `/v1/pages/${report.created.id}`);
  assert.equal(page.parent.type, 'data_source_id');
  const md = await client.request('GET', `/v1/pages/${report.created.id}/markdown`);
  assert.match(md.markdown, /^## 요약/, 'h1 제목을 본문에 넣지 않는다 (N4)');
  assert.equal(md.markdown.includes('<!--'), false, '안내 주석은 게시되지 않는다');
  assert.equal(summaryLine(report), 'submit: 생성 1 · 속성 수정 0 · 본문 교체 0 · raw 기록 1 · 오류 0');
});

test('T21 신규: 게시 직후 raw 에 기록되고 이어지는 sync 가 다시 받지 않는다 (A21)', async () => {
  const { rootDir, cfg, mock, client, workspace } = await workspaceWithMirror();
  const file = faqDraft(rootDir, cfg);
  const report = await runSubmit({ cfg, client, rootDir, file, apply: true, today: TODAY, nowIso: NOW });
  const rawPath = report.raw.path;
  assert.match(rawPath, /^raw\/routinefit\/cs\/알림-미수신-1차-응대-888888\.md$/);
  const text = fs.readFileSync(path.join(rootDir, rawPath), 'utf8');
  const { data, body } = fm.split(text);
  assert.equal(data.notion_id, report.created.id);
  // 범위 필드 — slug 문자열을 넘기면 null 이 되어 lint 가 meta-invalid 를 낸다 (2026-09-10 실측 결함)
  assert.equal(data.service, 'routinefit');
  assert.equal(data.service_name, '루틴핏');
  assert.equal(data.category, 'cs');
  assert.equal(data.category_name, 'CS');
  assert.equal(data.doc_type, 'FAQ·응대');
  assert.equal(data.status, '초안');
  assert.deepEqual(data.owner, ['박서준']);
  assert.equal(data.meta_source, 'properties');
  assert.equal(data.synced_at, NOW, '파일의 synced_at 은 이 시각이다');
  assert.match(body, /## 응대/);

  const state = JSON.parse(fs.readFileSync(path.join(rootDir, cfg.paths.raw, '.sync-state.json'), 'utf8'));
  assert.equal(state.pages[report.created.id].path, rawPath);
  assert.equal(state.syncedAt, '2026-09-09T01:00:00.000Z', '전체 동기화 시각은 바뀌지 않는다 (DESIGN 10.8)');

  // 이어서 sync: 이 페이지의 markdown 을 다시 받지 않는다
  const mock2 = createMockNotion(workspace);
  const client2 = makeClient(mock2);
  await runSync({ cfg: loadConfig(rootDir), client: client2, rootDir, nowIso: () => '2026-09-10T03:00:00.000Z', clock: () => 0 });
  const mdCalls = mock2.calls.filter((c) => c.method === 'GET' && c.path === `/v1/pages/${report.created.id}/markdown`);
  assert.equal(mdCalls.length, 0, '이미 미러에 있으므로 본문을 다시 받지 않는다');
  assert.ok(fs.existsSync(path.join(rootDir, rawPath)), 'sync 가 파일을 지우지 않는다');
});

test('T22 수정: pull → 고침 → dry-run diff → apply 가 본문과 속성을 바꾼다', async () => {
  const { rootDir, cfg, mock, client } = await workspaceWithMirror();
  const rawRel = 'raw/routinefit/cs/환불-처리-응대-가이드-555555.md';
  assert.ok(fs.existsSync(path.join(rootDir, rawRel)), `${rawRel} 이 미러에 있어야 한다`);
  const pulled = await runPull({ cfg, client, rootDir, arg: rawRel, nowIso: NOW });
  assert.equal(pulled.aborted, null, pulled.aborted || '');
  assert.equal(pulled.data.kind, 'edit');
  assert.equal(pulled.data.target_meta_id, pulled.data.target_body_id, '등록 항목이 아니면 둘이 같다');
  assert.ok(pulled.data.base_last_edited_time && pulled.data.base_hash);

  // 사람+Claude 가 본문을 고치고 이력을 남긴다. 상태도 올린다.
  const d = draftLib.readDraft(pulled.file);
  const newBody = `${d.body.trimEnd()}\n- ${TODAY} (김하늘) 환불 기한 안내 문구 보강\n`;
  draftLib.writeDraft(pulled.file, { ...d.data, status: '검토중' }, newBody);

  const before = mock.writes.length;
  const dry = await runSubmit({ cfg, client, rootDir, file: pulled.file, apply: false, today: TODAY, nowIso: NOW });
  assert.equal(dry.aborted, null, dry.aborted || '');
  assert.equal(mock.writes.length, before, 'dry-run 쓰기 0건');
  assert.equal(dry.body.changed, true);
  assert.match(dry.body.diff, /\+ - 2026-09-10 \(김하늘\)/);
  assert.deepEqual(dry.properties.changed.map((c) => c.key), ['status']);
  assert.equal(dry.properties.changed[0].from, '확정');
  assert.equal(dry.properties.changed[0].to, '검토중');
  assert.match(dry.action, /^본문 교체 \(대상 상태: 확정\)/);
  assert.equal(summaryLine(dry), 'dry-run: 신규 0 · 수정 1 · 오류 0 · 경고 0. 실제로 쓰려면 --apply');

  const applied = await runSubmit({ cfg, client, rootDir, file: pulled.file, apply: true, today: TODAY, nowIso: NOW });
  assert.equal(applied.aborted, null, applied.aborted || '');
  assert.deepEqual(applied.updated, { properties: true, body: true });
  const patched = mock.writes.filter((w) => w.op === 'update_page');
  assert.equal(patched.length, 1);
  assert.deepEqual(Object.keys(patched[0].body.properties), ['상태'], '바뀐 속성만 보낸다');
  const replaced = mock.writes.filter((w) => w.op === 'replace_content');
  assert.equal(replaced.length, 1);
  assert.equal(applied.raw.path, rawRel, '같은 파일에 다시 기록한다');
  const after = fm.split(fs.readFileSync(path.join(rootDir, rawRel), 'utf8'));
  assert.equal(after.data.status, '검토중');
  assert.equal(after.data.service, 'routinefit');
  assert.equal(after.data.category_name, 'CS');
  assert.match(after.body, /환불 기한 안내 문구 보강/);
});

test('T22 수정: 바뀐 것이 없으면 경고만 내고 쓰지 않는다 (draft-unchanged)', async () => {
  const { rootDir, cfg, mock, client } = await workspaceWithMirror();
  const pulled = await runPull({ cfg, client, rootDir, arg: 'raw/routinefit/cs/환불-처리-응대-가이드-555555.md', nowIso: NOW });
  const before = mock.writes.length;
  const r = await runSubmit({ cfg, client, rootDir, file: pulled.file, apply: true, today: TODAY, nowIso: NOW });
  assert.ok(r.warnings.some((w) => w.code === 'draft-unchanged'), JSON.stringify(r.warnings));
  assert.equal(mock.writes.length, before);
  assert.equal(r.raw, null);
});

test('T22 수정 거부: 초안 이후 원본이 바뀌면 중단한다 (A22)', async () => {
  const { rootDir, cfg, mock, client } = await workspaceWithMirror();
  const pulled = await runPull({ cfg, client, rootDir, arg: 'raw/routinefit/cs/환불-처리-응대-가이드-555555.md', nowIso: NOW });
  const d = draftLib.readDraft(pulled.file);
  draftLib.writeDraft(pulled.file, d.data, `${d.body.trimEnd()}\n- ${TODAY} (김하늘) 문구 보강\n`);
  // 다른 사람이 Notion 에서 같은 페이지를 고쳤다
  await client.request('PATCH', `/v1/pages/${d.data.target_body_id}/markdown`, {
    body: { type: 'replace_content', replace_content: { new_str: '다른 사람이 고친 본문', allow_deleting_content: false } },
  });
  const before = mock.writes.length;
  const r = await runSubmit({ cfg, client, rootDir, file: pulled.file, apply: true, today: TODAY, nowIso: NOW });
  assert.match(r.aborted, /^중단: 원본이 초안을 만든 뒤에 수정됐습니다/);
  assert.match(r.aborted, /draft-pull 로 다시 받아 고치세요/);
  assert.equal(mock.writes.length, before, '거부 시 쓰기 0건');
});

test('T22 수정 거부: 민감 · 폐기 · 하위 페이지 포함 (A22)', async () => {
  const { rootDir, cfg, mock, client, workspace } = await workspaceWithMirror();
  const rawRel = 'raw/routinefit/cs/환불-처리-응대-가이드-555555.md';
  const pulled = await runPull({ cfg, client, rootDir, arg: rawRel, nowIso: NOW });
  const d0 = draftLib.readDraft(pulled.file);
  draftLib.writeDraft(pulled.file, d0.data, `${d0.body.trimEnd()}
- ${TODAY} (김하늘) 문구 보강
`);
  const d = draftLib.readDraft(pulled.file);
  const targetId = d.data.target_body_id;
  const page = workspace.pages.get(targetId);
  const mutate = (fn) => { const snapshot = JSON.parse(JSON.stringify(page.properties)); fn(); return () => { page.properties = snapshot; }; };

  // 민감
  let restore = mutate(() => { page.properties['비밀등급'] = { id: 'x', type: 'select', select: { id: 'opt', name: '민감', color: 'default' } }; });
  let before = mock.writes.length;
  let r = await runSubmit({ cfg, client, rootDir, file: pulled.file, apply: true, today: TODAY, nowIso: NOW });
  assert.match(r.aborted, /비밀등급이 "민감"/);
  assert.equal(mock.writes.length, before);
  restore();

  // 폐기
  restore = mutate(() => { page.properties['상태'] = { id: 'y', type: 'select', select: { id: 'opt', name: '폐기', color: 'default' } }; });
  before = mock.writes.length;
  r = await runSubmit({ cfg, client, rootDir, file: pulled.file, apply: true, today: TODAY, nowIso: NOW });
  assert.match(r.aborted, /상태가 "폐기"/);
  assert.equal(mock.writes.length, before);
  restore();

  // 하위 페이지·DB 포함 (본문에 <page url=…> 이 있다)
  const savedMd = page._markdown;
  page._markdown = `${savedMd}\n<page url="https://www.notion.so/heybit/77777777000140008000000000000001">하위 페이지</page>`;
  before = mock.writes.length;
  r = await runSubmit({ cfg, client, rootDir, file: pulled.file, apply: true, today: TODAY, nowIso: NOW });
  assert.match(r.aborted, /하위 페이지·데이터베이스를 갖고 있어/);
  assert.equal(mock.writes.length, before);
  // pull 도 같은 이유로 먼저 막는다
  const p2 = await runPull({ cfg, client, rootDir, arg: rawRel, nowIso: NOW, force: true });
  assert.match(p2.aborted, /하위 페이지·데이터베이스/);
  page._markdown = savedMd;
});

test('T22 수정: 위키 페이지는 대상이 될 수 없다', async () => {
  const { rootDir, cfg, client } = await workspaceWithMirror();
  const wikiDir = path.join(rootDir, cfg.paths.wiki);
  fs.mkdirSync(wikiDir, { recursive: true });
  const wikiPageId = '88888888-0000-4000-8000-000000000099';
  fs.writeFileSync(path.join(wikiDir, '.publish-state.json'), JSON.stringify({
    version: 1, rootPageId: cfg.wiki.rootPageId, pages: { 'wiki/routinefit/overview.md': { id: wikiPageId, url: 'https://www.notion.so/x', title: '개요', kind: 'leaf', hash: 'h' } },
  }, null, 2));
  const r = await runPull({ cfg, client, rootDir, arg: wikiPageId, serviceSlug: 'routinefit', categorySlug: 'cs', nowIso: NOW })
    .catch((err) => ({ aborted: err.message }));
  assert.match(r.aborted, /위키 루트 아래입니다|Could not find page/);
});

test('T22 수정: 등록 항목은 속성과 본문의 대상이 다르다', async () => {
  const { rootDir, cfg, client } = await workspaceWithMirror();
  const found = [];
  for (const svc of fs.readdirSync(path.join(rootDir, 'raw'))) {
    const svcDir = path.join(rootDir, 'raw', svc);
    if (!fs.statSync(svcDir).isDirectory()) continue;
    for (const cat of fs.readdirSync(svcDir)) {
      for (const f of fs.readdirSync(path.join(svcDir, cat))) {
        const { data } = fm.split(fs.readFileSync(path.join(svcDir, cat, f), 'utf8'));
        if (data && data.registry_url) found.push(`raw/${svc}/${cat}/${f}`);
      }
    }
  }
  assert.ok(found.length >= 1, '등록 항목 raw 파일이 샘플에 있어야 한다');
  const pulled = await runPull({ cfg, client, rootDir, arg: found[0], nowIso: NOW });
  assert.equal(pulled.aborted, null, pulled.aborted || '');
  assert.notEqual(pulled.data.target_meta_id, pulled.data.target_body_id, '등록 항목과 원본이 다르다');
  assert.equal(pulled.data.registry_url !== null, true);
  assert.match(pulled.rel, /-666666\.md$/, '파일명은 본문 페이지 id 를 쓴다');
});
