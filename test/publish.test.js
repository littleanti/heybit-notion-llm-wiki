'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REPO_ROOT, FIXED_NOW, makeClient } = require('./helpers/sync-harness');
const { loadWorkspace, createMockNotion } = require('./helpers/mock-notion');
const { loadConfig } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const { runPublish, STATE_FILE } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/publish');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');

const GOLDEN = path.join(REPO_ROOT, 'test', 'golden', 'publish-plan.json');

// 샘플 저장소(raw + wiki + index/log) 사본. wiki 가 아직 없으면 최소 위키를 만든다.
function sandbox({ withWiki = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwiki-pub-'));
  fs.copyFileSync(path.join(REPO_ROOT, 'notion-wiki.config.json'), path.join(dir, 'notion-wiki.config.json'));
  fs.cpSync(path.join(REPO_ROOT, 'raw'), path.join(dir, 'raw'), { recursive: true });
  if (withWiki && fs.existsSync(path.join(REPO_ROOT, 'wiki'))) fs.cpSync(path.join(REPO_ROOT, 'wiki'), path.join(dir, 'wiki'), { recursive: true });
  fs.rmSync(path.join(dir, 'wiki', STATE_FILE), { force: true });
  const cfg = loadConfig(dir);
  return { dir, cfg };
}

function planSummary(plan) {
  return plan.map(({ key, kind, parentKey, title, action, hash, unresolved, markdown }) => ({ key, kind, parentKey, title, action, hash, unresolved, bytes: markdown ? Buffer.byteLength(markdown) : 0 }));
}

test('T12 publish: dry-run 계획이 골든과 일치하고 Notion 을 호출하지 않는다', async () => {
  const { dir, cfg } = sandbox();
  const { plan, report } = await runPublish({ cfg, rootDir: dir, apply: false, nowIso: FIXED_NOW });
  assert.ok(plan.length >= 3, `계획 항목 ${plan.length}`);
  assert.ok(plan.some((p) => p.kind === 'container'));
  assert.ok(plan.every((p) => p.action === 'create'), '상태가 없으니 전부 생성');
  assert.equal(report.apply, false);
  assert.equal(fs.existsSync(path.join(dir, 'wiki', STATE_FILE)), false, 'dry-run 은 상태를 쓰지 않는다');
  for (const p of plan.filter((x) => x.kind === 'leaf')) {
    assert.match(p.markdown, /^<callout icon="🤖" color="gray_bg">\n\t🤖 이 페이지는 LLM wiki 가 자동 생성·갱신합니다 \(마지막 갱신 \d{4}-\d{2}-\d{2}, 원본 동기화 2026-09-09 01:00\)/);
    assert.equal(p.markdown.includes('\n---\ntitle:'), false, 'frontmatter 가 제거돼야 한다');
  }
  assert.ok(fs.existsSync(GOLDEN), 'test/golden/publish-plan.json 이 없다 — node test/helpers/generate-golden.js 실행');
  assert.deepEqual(planSummary(plan), JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});

test('T13 publish: --apply 2회 → 1회차만 생성, 2회차는 생성·교체 0, 페이지 수 불변, 링크가 실제 URL 로 해석됨', async () => {
  const { dir, cfg } = sandbox();
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const client = makeClient(mock);
  const before = ws.pages.size;
  const first = await runPublish({ cfg, client, rootDir: dir, apply: true, nowIso: FIXED_NOW });
  assert.equal(first.report.aborted, null);
  const leaves = first.plan.filter((p) => p.kind === 'leaf').length;
  const containers = first.plan.filter((p) => p.kind === 'container').length;
  assert.equal(mock.writes.filter((w) => w.op === 'create_page').length, leaves + containers);
  assert.equal(mock.writes.filter((w) => w.op === 'replace_content').length, leaves);
  assert.equal(ws.pages.size, before + leaves + containers);
  // 위키 루트 아래에만 만들어졌는가
  const wikiRoot = cfg.wiki.rootPageId;
  const created = mock.writes.filter((w) => w.op === 'create_page');
  for (const c of created) {
    const parent = ws.pages.get(c.parent);
    assert.ok(c.parent === wikiRoot || (parent && parent.parent.page_id === wikiRoot), `부모가 위키 루트 아래가 아님: ${c.title}`);
  }
  // 교체된 본문의 raw 링크는 원본 Notion URL, wiki 링크는 게시된 URL 이어야 한다 (pending 없음)
  for (const p of ws.pages.values()) {
    if (!p.id.startsWith('88888888')) continue;
    assert.equal(p._markdown.includes('notion://pending/'), false, `미해석 링크 잔존: ${p.properties.title.title[0].plain_text}`);
  }
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'wiki', STATE_FILE), 'utf8'));
  assert.equal(Object.keys(state.pages).length, leaves + containers);

  const writesBefore = mock.writes.length;
  const second = await runPublish({ cfg, client, rootDir: dir, apply: true, nowIso: FIXED_NOW });
  assert.equal(second.report.created.length, 0);
  assert.equal(second.report.replaced.length, 0);
  assert.equal(second.report.unchanged.length, leaves);
  assert.equal(mock.writes.length, writesBefore, '2회차에 쓰기 0건');
  assert.equal(ws.pages.size, before + leaves + containers);

  // 파일 하나를 바꾸면 그것만 교체된다
  const leaf = first.plan.find((p) => p.kind === 'leaf' && p.parentKey);
  const file = path.join(dir, leaf.relPath);
  const { data, body } = fm.split(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, fm.join(data, body + '\n추가 문장.\n'));
  const third = await runPublish({ cfg, client, rootDir: dir, apply: true, nowIso: FIXED_NOW });
  assert.equal(third.report.replaced.length, 1);
  assert.equal(third.report.replaced[0].key, leaf.key);
  assert.equal(mock.writes.length, writesBefore + 1);
});

test('T14 publish: 상태 파일에 루트 밖 페이지 id 가 있으면 아무것도 쓰지 않고 중단한다', async () => {
  const { dir, cfg } = sandbox();
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const client = makeClient(mock);
  await runPublish({ cfg, client, rootDir: dir, apply: true, nowIso: FIXED_NOW });
  const stateFile = path.join(dir, 'wiki', STATE_FILE);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const victim = '55555555-0001-4005-8000-000000000001'; // 원본(법무 환불 규정) 페이지 — 절대 대상이 되면 안 된다
  const anyLeaf = Object.keys(state.pages).find((k) => state.pages[k].kind === 'leaf');
  state.pages[anyLeaf].id = victim;
  state.pages[anyLeaf].hash = 'stale';
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const writesBefore = mock.writes.length;
  const original = ws.pages.get(victim)._markdown;
  const res = await runPublish({ cfg, client, rootDir: dir, apply: true, nowIso: FIXED_NOW });
  assert.match(res.report.aborted, /중단: 게시 상태의 페이지 .* 의 부모가 위키 루트 아래가 아닙니다/);
  assert.equal(mock.writes.length, writesBefore, '쓰기 0건');
  assert.equal(ws.pages.get(victim)._markdown, original, '원본 본문이 그대로');
});

test('T14 publish: 다른 워크스페이스의 상태 파일(루트 불일치)은 거부한다', async () => {
  const { dir, cfg } = sandbox();
  fs.writeFileSync(path.join(dir, 'wiki', STATE_FILE), JSON.stringify({ version: 1, rootPageId: '99999999-9999-4999-8999-0000000000ff', pages: {} }));
  await assert.rejects(() => runPublish({ cfg, rootDir: dir, apply: false, nowIso: FIXED_NOW }), /위키 루트.*설정.*다릅니다/);
});

test('T13 publish: 컨테이너 본문은 다시 쓰지 않는다 (하위 페이지를 지우게 되는 replace 를 피한다)', async () => {
  const { dir, cfg } = sandbox();
  const ws = loadWorkspace();
  const mock = createMockNotion(ws);
  const client = makeClient(mock);
  await runPublish({ cfg, client, rootDir: dir, apply: true, nowIso: FIXED_NOW });
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'wiki', STATE_FILE), 'utf8'));
  const containerIds = Object.values(state.pages).filter((p) => p.kind === 'container').map((p) => p.id);
  assert.ok(containerIds.length >= 1);
  const replaced = mock.writes.filter((w) => w.op === 'replace_content').map((w) => w.id);
  for (const id of containerIds) assert.equal(replaced.includes(id), false, `컨테이너 ${id} 본문이 교체됨`);
});
