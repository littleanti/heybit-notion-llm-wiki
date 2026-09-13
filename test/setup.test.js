'use strict';
// T24 — 온보딩 setup (docs/PLAN.md P12): URL→id 추출 · 템플릿 채우기 · 기존 파일 비파괴 ·
// 토큰을 인자로 받지 않고 파일로만 받아 기록 후 지우기 · **출력 어디에도 토큰 값이 없는지** (PRD DR1)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const setup = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/setup');

const TOKEN = 'ntn_TESTtoken0123456789abcdefghijklmnopqrstuv';
const SVC_A = 'routinefit|루틴핏|https://www.notion.so/team/aaaaaaaabbbbccccddddeeeeeeee0001?v=abc#frag';
const SVC_B = 'moneynote|머니노트|https://www.notion.so/aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0002';
const WIKI = 'https://app.notion.com/p/99999999999949998999000000000001';

function tmpWs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omc-setup-'));
}
// 로그를 모아 두고 토큰이 새는지 본다.
function capture() {
  const lines = [];
  return { log: (m) => lines.push(String(m)), text: () => lines.join('\n') };
}

test('T24 setup: Notion URL·id 어느 형태로 줘도 같은 id 가 된다 (쿼리·프래그먼트·대시 유무)', () => {
  const want = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001';
  for (const input of [
    'https://www.notion.so/team/페이지-제목-aaaaaaaabbbbccccddddeeeeeeee0001',
    'https://www.notion.so/team/aaaaaaaabbbbccccddddeeeeeeee0001?v=xyz&pvs=4',
    'https://app.notion.com/p/aaaaaaaabbbbccccddddeeeeeeee0001#block',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001',
    'aaaaaaaabbbbccccddddeeeeeeee0001',
  ]) {
    assert.equal(setup.resolvePageId(input, '서비스'), want, `입력: ${input}`);
  }
  assert.throws(() => setup.resolvePageId('https://notion.so/no-id-here', '위키 루트'), /Notion 페이지 id 를 읽을 수 없다/);
});

test('T24 setup: --service 형식 검증 — 3칸이 아니거나 slug 규칙 위반이면 거부한다', () => {
  assert.deepEqual(setup.parseServiceArg(SVC_A), {
    name: '루틴핏',
    slug: 'routinefit',
    rootPageId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001',
  });
  assert.throws(() => setup.parseServiceArg('routinefit|루틴핏'), /--service 형식이 아니다/);
  assert.throws(() => setup.parseServiceArg('루틴핏|루틴핏|aaaaaaaabbbbccccddddeeeeeeee0001'), /slug 는 영소문자/);
  assert.throws(() => setup.parseServiceArg('a||aaaaaaaabbbbccccddddeeeeeeee0001'), /--service 형식이 아니다/);
});

test('T24 setup: 템플릿이 플러그인에 실려 있고, 채운 설정이 검증을 통과한다', () => {
  for (const f of ['notion-wiki.config.json', 'env.example']) {
    assert.ok(fs.existsSync(path.join(setup.TEMPLATES_DIR, f)), `templates/${f} 가 없으면 설치본에서 setup 이 동작하지 않는다`);
  }
  const ws = tmpWs();
  const log = capture();
  setup.initConfig({ rootDir: ws, services: [setup.parseServiceArg(SVC_A), setup.parseServiceArg(SVC_B)], wikiRoot: WIKI, log: log.log });
  const cfg = JSON.parse(fs.readFileSync(path.join(ws, 'notion-wiki.config.json'), 'utf8'));
  assert.deepEqual(cfg.services.map((s) => s.slug), ['routinefit', 'moneynote']);
  assert.equal(cfg.wiki.rootPageId, '99999999-9999-4999-8999-000000000001');
  assert.ok(cfg.categories.some((c) => c.fallback), 'fallback 카테고리는 템플릿에서 온다');
  assert.equal(cfg.properties.title, '제목');
});

test('T24 setup: 위키 루트가 서비스 루트와 같으면 거부한다 (자기 출력을 다시 수집하는 것을 막는다)', () => {
  const ws = tmpWs();
  assert.throws(
    () => setup.initConfig({ rootDir: ws, services: [setup.parseServiceArg(SVC_A)], wikiRoot: 'aaaaaaaabbbbccccddddeeeeeeee0001', log: () => {} }),
    /wiki\.rootPageId 가 서비스/,
  );
  assert.equal(fs.existsSync(path.join(ws, 'notion-wiki.config.json')), false, '검증에 실패하면 파일을 남기지 않는다');
});

test('T24 setup: 이미 있는 파일을 덮어쓰지 않는다', () => {
  const ws = tmpWs();
  const svc = [setup.parseServiceArg(SVC_A)];
  setup.initConfig({ rootDir: ws, services: svc, wikiRoot: WIKI, log: () => {} });
  assert.throws(() => setup.initConfig({ rootDir: ws, services: svc, wikiRoot: WIKI, log: () => {} }), /이미 있다/);

  setup.initEnv({ rootDir: ws, log: () => {} });
  fs.writeFileSync(path.join(ws, '.env'), 'NOTION_TOKEN=keepme\n# 사람이 손으로 적은 줄\n', 'utf8');
  setup.initEnv({ rootDir: ws, log: () => {} });
  assert.match(fs.readFileSync(path.join(ws, '.env'), 'utf8'), /keepme[\s\S]*사람이 손으로 적은 줄/, '.env 가 있으면 손대지 않는다');
});

test('T24 setup: upsertEnvToken 은 토큰 줄만 갈고 주석·다른 변수를 보존한다', () => {
  const before = '# 주석\nNOTION_TOKEN=\nOTHER=x\n';
  const after = setup.upsertEnvToken(before, TOKEN);
  assert.equal(after, `# 주석\nNOTION_TOKEN=${TOKEN}\nOTHER=x\n`);
  assert.equal(setup.upsertEnvToken('export NOTION_TOKEN=old\n', TOKEN), `export NOTION_TOKEN=${TOKEN}\n`, 'source .env 를 쓰는 운영자를 위해 export 를 보존한다');
  assert.equal(setup.upsertEnvToken('OTHER=x\n', TOKEN), `OTHER=x\nNOTION_TOKEN=${TOKEN}\n`, '없으면 덧붙인다');
  assert.equal(setup.upsertEnvToken('OTHER=x\r\n', TOKEN), `OTHER=x\r\nNOTION_TOKEN=${TOKEN}\r\n`, 'CRLF 파일의 개행을 유지하고 끝 개행도 보존한다');
});

test('T24 setup: --set-token 은 토큰 파일을 지우고, 출력에 토큰 값을 남기지 않는다 (DR1)', () => {
  const ws = tmpWs();
  setup.initEnv({ rootDir: ws, log: () => {} });
  const tokenFile = path.join(ws, 'token.tmp');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`, 'utf8');

  const log = capture();
  setup.setToken({ rootDir: ws, tokenFile, log: log.log });

  assert.equal(fs.existsSync(tokenFile), false, '토큰 파일을 지워야 한다 — 남으면 비밀이 두 곳에 있다');
  assert.equal(log.text().includes(TOKEN), false, '출력에 토큰 값이 절대 나오면 안 된다');
  assert.match(log.text(), new RegExp(`${TOKEN.length}자`), '길이는 알려 준다');
  assert.equal(fs.readFileSync(path.join(ws, '.env'), 'utf8').includes(`NOTION_TOKEN=${TOKEN}`), true);
});

test('T24 setup: 빈 토큰·공백 섞인 토큰은 거부하되 파일은 그래도 지운다', () => {
  const ws = tmpWs();
  for (const [content, re] of [['\n', /첫 줄이 비어 있다/], ['ntn_ab cd\n', /공백이 들어 있다/]]) {
    const tokenFile = path.join(ws, 'token.tmp');
    fs.writeFileSync(tokenFile, content, 'utf8');
    assert.throws(() => setup.setToken({ rootDir: ws, tokenFile, log: () => {} }), re);
    assert.equal(fs.existsSync(tokenFile), false, '거부해도 토큰 파일을 남기지 않는다');
  }
});

test('T24 setup: status 와 리포트는 토큰 값이 아니라 길이만 내보낸다', () => {
  const ws = tmpWs();
  const empty = setup.status(ws);
  assert.equal(empty.config.exists, false);
  assert.equal(empty.env.exists, false);

  setup.initConfig({ rootDir: ws, services: [setup.parseServiceArg(SVC_A)], wikiRoot: WIKI, log: () => {} });
  setup.initEnv({ rootDir: ws, log: () => {} });
  const half = setup.status(ws);
  assert.equal(half.config.valid, true);
  assert.equal(half.env.exists, true);
  assert.equal(half.env.tokenSet, false, '빈 NOTION_TOKEN 은 채워진 것으로 보지 않는다');

  const tokenFile = path.join(ws, 'token.tmp');
  fs.writeFileSync(tokenFile, TOKEN, 'utf8');
  setup.setToken({ rootDir: ws, tokenFile, log: () => {} });

  const done = setup.status(ws);
  assert.equal(done.env.tokenSet, true);
  assert.equal(done.env.tokenLength, TOKEN.length);
  assert.equal(JSON.stringify(done).includes(TOKEN), false, '--json 출력에도 토큰 값이 실리면 안 된다');

  const log = capture();
  assert.equal(setup.reportStatus(done, log.log), true, '설정 정상 + 토큰 있음이면 준비된 것이다');
  assert.equal(log.text().includes(TOKEN), false, 'reportStatus 에도 토큰 값이 나오면 안 된다');
});

test('T24 setup: parseArgs — 토큰을 인자로 받는 경로가 없다', () => {
  const a = setup.parseArgs(['--status', '--root', '.', '--json']);
  assert.deepEqual(a.actions, ['status']);
  assert.equal(a.json, true);
  assert.throws(() => setup.parseArgs(['--token', TOKEN]), /모르는 인자/, '토큰을 인자로 주는 경로가 있으면 안 된다 (프로세스 목록 노출)');
  assert.throws(() => setup.parseArgs(['--nope']), /모르는 인자/);
  assert.deepEqual(setup.parseArgs(['--set-token', '--token-file', 'x']).tokenFile, 'x');
});

// ── 2026-09-13 보안 검토가 잡은 결함의 회귀 테스트 ─────────────────────────

test('T24 setup: --token-file 은 화이트리스트 밖의 파일을 지우지 않는다 (H1)', () => {
  const ws = tmpWs();
  // 오타 한 번(`--token-file .env`)이 복구 불가능한 삭제가 되면 안 된다.
  const victim = path.join(ws, '.env');
  fs.writeFileSync(victim, 'NOTION_TOKEN=소중한값\n', 'utf8');
  assert.throws(() => setup.setToken({ rootDir: ws, tokenFile: victim, log: () => {} }), /\.tmp 또는 \.token/);
  assert.equal(fs.existsSync(victim), true, '.env 를 지우면 안 된다 — gitignore 라 복구 방법이 없다');
  assert.match(fs.readFileSync(victim, 'utf8'), /소중한값/, '내용도 그대로여야 한다');

  const doc = path.join(ws, 'important.md');
  fs.writeFileSync(doc, '중요 문서\n', 'utf8');
  assert.throws(() => setup.setToken({ rootDir: ws, tokenFile: doc, log: () => {} }), /\.tmp 또는 \.token/);
  assert.equal(fs.existsSync(doc), true);

  // shredTokenFile 자체도 같은 경계를 지킨다 — 삭제가 일어나는 유일한 곳이기 때문이다.
  assert.equal(setup.shredTokenFile(doc), false);
  assert.equal(fs.existsSync(doc), true);
});

test('T24 setup: 토큰 파일이 너무 크면 읽지도 지우지도 않는다 (H1)', () => {
  const ws = tmpWs();
  const big = path.join(ws, 'big.tmp');
  fs.writeFileSync(big, 'x'.repeat(setup.TOKEN_FILE_MAX_BYTES + 1), 'utf8');
  assert.throws(() => setup.setToken({ rootDir: ws, tokenFile: big, log: () => {} }), /너무 크다/);
  assert.equal(fs.existsSync(big), true, '토큰 파일이 아닌 것 같으면 지우지 않는다');
});

test('T24 setup: 인자 파싱이 실패해도 토큰 파일이 남지 않는다 (M1)', () => {
  const ws = tmpWs();
  const tokenFile = path.join(ws, 'tok.tmp');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`, 'utf8');
  // parseArgs 가 setToken 에 닿기 전에 throw 하는 경로 — 예전에는 평문 토큰이 그대로 남았다.
  assert.equal(setup.shredTokenFileFromArgv(['--set-token', '--token-file', tokenFile, '--jsonn']), true);
  assert.equal(fs.existsSync(tokenFile), false, '파싱 실패 경로에서도 토큰 파일을 지워야 한다');
});

test('T24 setup: 에러 메시지가 토큰처럼 보이는 값을 되풀이하지 않는다 (M4, DR1)', () => {
  // 흔한 오타: `--set-token <값>` (--token-file 을 빠뜨림).
  // 예전에는 이 값이 `모르는 인자: ntn_…` 으로 그대로 stdout 에 찍혀 세션 기록에 남았다.
  assert.throws(() => setup.parseArgs(['--set-token', TOKEN]), (err) => {
    assert.equal(err.message.includes(TOKEN), false, '에러 메시지에 토큰 값이 있으면 안 된다');
    assert.match(err.message, /비밀일 수 있어 표시하지 않는다/);
    assert.match(err.message, /--token-file/, '올바른 사용법을 함께 알려 준다');
    return true;
  });
  assert.throws(() => setup.resolvePageId(TOKEN, '위키 루트'), (err) => {
    assert.equal(err.message.includes(TOKEN), false);
    return true;
  });
  assert.equal(setup.safe('routinefit'), 'routinefit', '평범한 값은 그대로 보여 준다 — 진단이 가능해야 한다');
  assert.equal(setup.safe(TOKEN).includes(TOKEN), false);
});

test('T24 setup: .env 가 커밋되는지 확인한 사실만 말한다 (M3)', () => {
  // git 저장소가 아니면 안전하다고 단언하지 않는다.
  const plain = tmpWs();
  const l1 = capture();
  assert.equal(setup.ensureEnvIgnored(plain, l1.log), 'not-a-repo');
  assert.match(l1.text(), /git 저장소가 아니다/);

  // git 저장소면 .gitignore 에 실제로 넣는다.
  const repo = tmpWs();
  fs.mkdirSync(path.join(repo, '.git'));
  const l2 = capture();
  assert.equal(setup.ensureEnvIgnored(repo, l2.log), 'added');
  assert.match(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), /^\.env$/m);

  // 이미 있으면 중복으로 넣지 않는다.
  const l3 = capture();
  assert.equal(setup.ensureEnvIgnored(repo, l3.log), 'already');
  const body = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
  assert.equal(body.match(/^\.env$/gm).length, 1);
});

test('T24 setup: 작업 위치가 수상하면 파일을 만들기 전에 경고한다', () => {
  // 깨끗한 빈 폴더는 위험 표시가 없다 — 잔소리하지 않는다.
  const clean = tmpWs();
  assert.deepEqual(setup.describeRootRisks(clean), []);

  // 코드 프로젝트 안에 위키 파일을 흩뿌리는 것이 가장 흔한 실수다.
  const proj = tmpWs();
  fs.writeFileSync(path.join(proj, 'package.json'), '{}', 'utf8');
  const risks = setup.describeRootRisks(proj);
  assert.equal(risks.length, 1);
  assert.match(risks[0], /다른 프로젝트로 보인다 \(package\.json 있음\)/);

  // 플러그인 폴더 안은 갱신되면 사라진다.
  assert.match(
    setup.describeRootRisks(setup.TEMPLATES_DIR).join('\n'),
    /플러그인이 설치된 폴더 안이다/,
    'templates/ 는 플러그인 루트 아래이므로 경고 대상이다',
  );

  // 경고 블록은 절대 경로와 만들어질 것들을 반드시 담는다 — 사람이 이것만 보고 판단한다.
  const log = capture();
  setup.warnAboutRoot({ rootDir: proj, log: log.log, explicitRoot: true });
  assert.ok(log.text().includes(path.resolve(proj)), '절대 경로를 보여 준다');
  assert.match(log.text(), /\.env · notion-wiki\.config\.json · raw\/ · wiki\/ · drafts\//);
  assert.match(log.text(), /다른 프로젝트로 보인다/);
  assert.match(log.text(), /--root 는 sync·ingest·lint·publish 에도 매번/, '--root 가 끈적하다는 것을 알린다');

  // --root 를 안 줬으면 대안을 알려 준다.
  const log2 = capture();
  setup.warnAboutRoot({ rootDir: clean, log: log2.log, explicitRoot: false });
  assert.match(log2.text(), /claude 를 다시 열거나/);
});

test('T24 setup: 홈 디렉터리는 경고 대상이다', () => {
  assert.match(setup.describeRootRisks(os.homedir()).join('\n'), /홈 디렉터리다/);
});
