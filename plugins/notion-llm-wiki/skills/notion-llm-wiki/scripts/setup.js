#!/usr/bin/env node
'use strict';
// 온보딩 스캐폴딩 (docs/PLAN.md P12).
// **이 스크립트는 사람과 대화하지 않는다** — 비대화형 Bash 툴 호출에는 stdin 이 없다.
// 묻는 것은 SKILL.md 의 Claude 가 하고(references/setup-procedure.md 가 정본), 여기서는 받은 값을 파일로 만든다.
//
// 토큰 취급 (PRD DR1):
//   - 토큰을 **인자로 받지 않는다** — 프로세스 목록·셸 히스토리에 남는다. `--token-file` 로만 받는다.
//   - 값을 출력하지 않는다. 길이만 내보낸다. 인자로 받은 값을 에러 메시지에 되풀이하지도 않는다 (`safe()`).
//   - 토큰 파일 삭제는 `shredTokenFile()` **한 곳**으로 모은다. 그 함수가 대상을 검증한 뒤에만 지운다.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONFIG_FILE, validate, parseDotEnv, normalizeId } = require('./lib/config');
const { pageIdFromUrl } = require('./lib/meta');
const { SLUG_RE } = require('./lib/slug');

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'templates');
const ENV_FILE = '.env';
const ENV_MODE = 0o600; // 비밀 파일은 소유자만 (Windows 에서는 무의미하지만 POSIX·CI 러너에서 의미가 있다)

// 토큰 파일로 인정하는 것 — **삭제 대상을 여기서 좁힌다.** 확장자를 강제하지 않으면
// `--token-file .env` 같은 오타가 복구 불가능한 삭제가 된다 (2026-09-13 보안 검토 H1).
const TOKEN_FILE_RE = /\.(tmp|token)$/i;
const TOKEN_FILE_MAX_BYTES = 512;

// ── 출력 위생 ────────────────────────────────────────────────────────────────

// 사람이 준 값을 에러 메시지에 되풀이할 때 쓴다. 비밀로 보이면 값을 내보내지 않는다.
// (토큰을 인자로 잘못 준 경우 그 값이 세션 기록·CI 로그에 평문으로 박히는 것을 막는다.)
function safe(value) {
  const s = String(value);
  if (/^(?:ntn_|secret_|ntn)/i.test(s) || s.length > 40) return `<${s.length}자 값 — 비밀일 수 있어 표시하지 않는다>`;
  return s;
}

// 경로는 디렉터리까지만 그대로 보여 주고 파일명만 가린다 (파일명 자리에 토큰이 들어온 경우를 덮는다).
function safePath(p) {
  const resolved = path.resolve(p);
  return path.join(path.dirname(resolved), safe(path.basename(resolved)));
}

// ── 순수 함수 ────────────────────────────────────────────────────────────────

// Notion 페이지 URL 또는 id → 대시 있는 id. 형식이 아니면 던진다.
function resolvePageId(input, what) {
  const id = pageIdFromUrl(input) || normalizeId(input);
  if (!id) {
    throw new Error(`${what} 의 Notion 페이지 id 를 읽을 수 없다: ${safe(input)}\n  → 페이지 URL 을 그대로 주거나, URL 끝 32자리 문자를 준다.`);
  }
  return id;
}

// `--service "<slug>|<이름>|<URL 또는 id>"` 한 건을 판다.
function parseServiceArg(raw) {
  const parts = String(raw).split('|').map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !p)) {
    throw new Error(`--service 형식이 아니다: ${safe(raw)}\n  → "<slug>|<이름>|<URL 또는 id>" 로 준다. 예: "routinefit|루틴핏|https://www.notion.so/…"`);
  }
  const [slug, name, ref] = parts;
  if (!SLUG_RE.test(slug)) throw new Error(`서비스 slug 는 영소문자·숫자·하이픈만 쓴다: ${safe(slug)}`);
  return { name, slug, rootPageId: resolvePageId(ref, `서비스 "${name}"`) };
}

// 템플릿에 서비스·위키 루트를 채운다. 검증까지 통과한 설정 객체를 돌려준다.
function buildConfig({ template, services, wikiRootPageId }) {
  if (!services.length) throw new Error('서비스가 없다 — `--service "<slug>|<이름>|<URL>"` 을 하나 이상 준다.');
  const slugs = services.map((s) => s.slug);
  const dup = slugs.find((s, i) => slugs.indexOf(s) !== i);
  if (dup) throw new Error(`서비스 slug 가 중복이다: ${safe(dup)}`);
  const cfg = JSON.parse(JSON.stringify(template));
  cfg.services = services;
  cfg.wiki.rootPageId = wikiRootPageId;
  validate(cfg); // 위키 루트가 서비스 루트와 같은 경우 등을 여기서 잡는다
  return cfg;
}

// `.env` 본문에서 NOTION_TOKEN 줄만 갈아 끼운다. `export ` 접두사와 다른 줄·주석은 그대로 둔다.
function upsertEnvToken(text, token) {
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text).split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    const m = /^(\s*(?:export\s+)?NOTION_TOKEN\s*=)/.exec(line);
    if (!m) return line;
    replaced = true;
    return `${m[1]}${token}`; // `source .env` 를 쓰는 운영자를 위해 export 를 보존한다
  });
  if (!replaced) {
    if (out.length && out[out.length - 1] === '') out.splice(out.length - 1, 0, `NOTION_TOKEN=${token}`);
    else out.push(`NOTION_TOKEN=${token}`);
  }
  return out.join(nl);
}

// 토큰 값을 절대 내보내지 않는다 — 길이와 접두사 일치 여부만.
function describeToken(token) {
  return { length: token.length, looksLikeNotion: /^ntn_/.test(token) };
}

// ── 토큰 파일 정리 (삭제가 일어나는 유일한 곳) ───────────────────────────────

// 토큰 파일로 **인정되는 것만** 지운다. 아니면 조용히 아무것도 하지 않는다.
// 절대 던지지 않는다 — 정리가 원래 에러를 덮어쓰면 진단이 엉뚱해진다.
function shredTokenFile(p) {
  try {
    if (!p) return false;
    const src = path.resolve(p);
    if (!TOKEN_FILE_RE.test(src)) return false; // 화이트리스트 밖은 건드리지 않는다
    const st = fs.statSync(src, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size > TOKEN_FILE_MAX_BYTES) return false;
    fs.rmSync(src, { force: true });
    return true;
  } catch {
    return false; // 정리 실패는 조용히 넘긴다
  }
}

// 인자 파싱이 실패해도 토큰 파일이 남지 않게 한다 (argv 에서 직접 찾는다).
function shredTokenFileFromArgv(argv) {
  const i = argv.indexOf('--token-file');
  return i >= 0 && argv[i + 1] ? shredTokenFile(argv[i + 1]) : false;
}

// ── 작업 위치 경고 ───────────────────────────────────────────────────────────

// 이 파일들이 있으면 "이미 다른 용도의 프로젝트" 로 본다.
const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle'];
const PLUGIN_ROOT = path.resolve(TEMPLATES_DIR, '..');

// 작업 위치가 수상한 이유를 모은다. 판단은 사람이 한다 — 여기서는 사실만 댄다.
function describeRootRisks(rootDir) {
  const risks = [];
  const resolved = path.resolve(rootDir);
  const within = (parent) => {
    const rel = path.relative(parent, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  if (resolved === path.resolve(os.homedir())) {
    risks.push('홈 디렉터리다 — 위키 파일이 홈에 흩어지면 나중에 찾기 어렵다.');
  }
  if (within(PLUGIN_ROOT) || /[\\/]\.claude[\\/]plugins[\\/]/.test(resolved)) {
    risks.push('플러그인이 설치된 폴더 안이다 — 플러그인이 갱신되면 여기 쓴 것은 사라진다.');
  }
  const marker = PROJECT_MARKERS.find((m) => fs.existsSync(path.join(resolved, m)));
  if (marker) {
    risks.push(`이미 다른 프로젝트로 보인다 (${marker} 있음) — 그 프로젝트 안에 raw/·wiki/·.env 가 생긴다.`);
  }
  return risks;
}

// 파일을 만들기 **전에** 어디에 만들지 알린다. 아직 준비되지 않은 작업 공간에서만 띄운다
// (이미 설정이 정상인 곳에 잔소리하지 않는다).
function warnAboutRoot({ rootDir, log, explicitRoot = false }) {
  const risks = describeRootRisks(rootDir);
  log('');
  log('⚠ 작업 위치를 확인한다 — 아래 폴더에 만들어진다:');
  log(`   ${path.resolve(rootDir)}`);
  log(`   .env · ${CONFIG_FILE} · raw/ · wiki/ · drafts/`);
  for (const r of risks) log(`   ⚠ ${r}`);
  if (explicitRoot) log('   --root 는 sync·ingest·lint·publish 에도 매번 똑같이 붙여야 한다.');
  else log('   다른 곳이어야 하면: 그 폴더에서 claude 를 다시 열거나, 모든 명령에 --root <경로> 를 붙인다.');
  log('');
  return risks;
}

// ── 파일 동작 ────────────────────────────────────────────────────────────────

function readTemplate() {
  const file = path.join(TEMPLATES_DIR, 'notion-wiki.config.json');
  if (!fs.existsSync(file)) throw new Error(`설정 템플릿이 없다: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeSecretFile(file, body) {
  fs.writeFileSync(file, body, { encoding: 'utf8', mode: ENV_MODE });
  try {
    fs.chmodSync(file, ENV_MODE);
  } catch {
    /* Windows 에서는 무의미하다 */
  }
}

// `.env` 가 정말 커밋되지 않는지 **확인한 사실만** 말한다 (추측으로 안심시키지 않는다).
function ensureEnvIgnored(rootDir, log) {
  const gitignore = path.join(rootDir, '.gitignore');
  const body = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  if (/^\s*\.env\s*$/m.test(body)) {
    log('  .gitignore 에 .env 가 있다 — 커밋되지 않는다.');
    return 'already';
  }
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    log('  ⚠ 이 폴더는 git 저장소가 아니다. 나중에 저장소가 되면 .gitignore 에 .env 를 반드시 넣는다.');
    return 'not-a-repo';
  }
  fs.appendFileSync(gitignore, `${!body || body.endsWith('\n') ? '' : '\n'}.env\n`, 'utf8');
  log('  .gitignore 에 .env 를 추가했다 — 이제 커밋되지 않는다.');
  return 'added';
}

function status(rootDir) {
  const configPath = path.join(rootDir, CONFIG_FILE);
  const envPath = path.join(rootDir, ENV_FILE);
  const out = {
    rootDir,
    config: { exists: false, valid: false, error: null, services: [], wikiRootPageId: null },
    env: { exists: false, tokenSet: false, tokenLength: 0 },
    dirs: {},
  };

  if (fs.existsSync(configPath)) {
    out.config.exists = true;
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      validate(cfg);
      out.config.valid = true;
      out.config.services = (cfg.services || []).map((s) => ({ slug: s.slug, name: s.name }));
      out.config.wikiRootPageId = cfg.wiki.rootPageId;
    } catch (err) {
      out.config.error = err.message;
    }
  }
  if (fs.existsSync(envPath)) {
    out.env.exists = true;
    const token = (parseDotEnv(fs.readFileSync(envPath, 'utf8')).NOTION_TOKEN || '').trim();
    out.env.tokenSet = Boolean(token);
    out.env.tokenLength = token.length; // 값이 아니라 길이만
  }
  for (const d of ['raw', 'wiki', 'drafts']) out.dirs[d] = fs.existsSync(path.join(rootDir, d));
  return out;
}

function reportStatus(out, log) {
  log(`작업 디렉터리  ${out.rootDir}`);
  if (!out.config.exists) log(`설정          없다 — ${CONFIG_FILE} 를 만들어야 한다 (--init-config)`);
  else if (!out.config.valid) log(`설정          있으나 검증 실패 — ${out.config.error}`);
  else log(`설정          정상 · 서비스 ${out.config.services.map((s) => `${s.name}(${s.slug})`).join(' · ')} · 위키 루트 ${out.config.wikiRootPageId}`);

  if (!out.env.exists) log(`.env          없다 — 만들어야 한다 (--init-env)`);
  else if (!out.env.tokenSet) log(`.env          있으나 NOTION_TOKEN 이 비어 있다 — ${path.join(out.rootDir, ENV_FILE)} 를 열어 채운다`);
  else log(`.env          NOTION_TOKEN 채워져 있다 (${out.env.tokenLength}자, 값은 읽지 않는다)`);

  log(`디렉터리       ${['raw', 'wiki', 'drafts'].map((d) => `${d}:${out.dirs[d] ? '있음' : '없음'}`).join(' · ')} (스킬이 필요할 때 만든다)`);
  const ready = out.config.valid && out.env.tokenSet;
  log(ready ? '→ 준비됐다. check-notion.js 로 연결을 확인한다.' : '→ 아직 준비되지 않았다. 위의 남은 항목을 채운다.');
  return ready;
}

function initConfig({ rootDir, services, wikiRoot, log }) {
  const file = path.join(rootDir, CONFIG_FILE);
  if (fs.existsSync(file)) {
    throw new Error(`${CONFIG_FILE} 이 이미 있다: ${file}\n  → 덮어쓰지 않는다. 고치려면 그 파일을 직접 편집한다.`);
  }
  const cfg = buildConfig({
    template: readTemplate(),
    services,
    wikiRootPageId: resolvePageId(wikiRoot, '위키 루트'),
  });
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  log(`만들었다: ${file}`);
  for (const s of cfg.services) log(`  서비스    ${s.name} (${s.slug}) → ${s.rootPageId}`);
  log(`  위키 루트  ${cfg.wiki.rootPageId}`);
  log('  카테고리·속성 이름은 템플릿 기본값이다. Notion 의 속성 이름이 다르면 이 파일의 properties 를 고친다.');
  return file;
}

function initEnv({ rootDir, log }) {
  const file = path.join(rootDir, ENV_FILE);
  if (fs.existsSync(file)) {
    log(`이미 있다: ${file} — 손대지 않았다.`);
    ensureEnvIgnored(rootDir, log);
    return file;
  }
  const tpl = path.join(TEMPLATES_DIR, 'env.example');
  if (!fs.existsSync(tpl)) throw new Error(`.env 템플릿이 없다: ${tpl}`);
  fs.mkdirSync(rootDir, { recursive: true });
  writeSecretFile(file, fs.readFileSync(tpl, 'utf8'));
  log(`만들었다: ${file}`);
  log('  NOTION_TOKEN 은 비어 있다. 이 파일을 열어 NOTION_TOKEN= 뒤에 토큰을 붙여넣고 저장한다.');
  log('  발급: https://www.notion.so/profile/integrations');
  ensureEnvIgnored(rootDir, log);
  log('  누구에게도 보내지 않는다.');
  return file;
}

// 토큰 파일의 첫 줄을 `.env` 에 넣는다. **대상을 검증한 뒤에만** 파일을 지운다.
// 값은 어디에도 출력하지 않는다.
function setToken({ rootDir, tokenFile, log }) {
  const src = path.resolve(tokenFile);

  // 지우기 전에 확인한다 — 순서가 곧 안전장치다.
  if (!TOKEN_FILE_RE.test(src)) {
    throw new Error(
      `--token-file 은 .tmp 또는 .token 으로 끝나는 파일만 받는다: ${safePath(src)}\n` +
        '  → 실수로 다른 파일을 지우지 않기 위한 제한이다. 지우지 않았다.',
    );
  }
  const st = fs.statSync(src, { throwIfNoEntry: false });
  if (!st || !st.isFile()) throw new Error(`토큰 파일이 없다(또는 일반 파일이 아니다): ${safePath(src)}`);
  if (st.size > TOKEN_FILE_MAX_BYTES) {
    throw new Error(`토큰 파일이 너무 크다 (${st.size}바이트). 토큰만 한 줄 담긴 파일이어야 한다. 지우지 않았다.`);
  }

  const token = (fs.readFileSync(src, 'utf8').split(/\r?\n/)[0] || '').trim();
  shredTokenFile(src); // 읽었으면 바로 없앤다

  if (!token) throw new Error('토큰 파일의 첫 줄이 비어 있다. (파일은 지웠다)');
  if (/\s/.test(token)) throw new Error('토큰에 공백이 들어 있다 — 값만 한 줄로 준다. (파일은 지웠다)');

  const file = path.join(rootDir, ENV_FILE);
  fs.mkdirSync(rootDir, { recursive: true });
  const before = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : fs.readFileSync(path.join(TEMPLATES_DIR, 'env.example'), 'utf8');
  writeSecretFile(file, upsertEnvToken(before, token));

  const d = describeToken(token);
  const warn = d.looksLikeNotion ? '' : ' — 다만 ntn_ 으로 시작하지 않는다. 값을 다시 확인한다';
  log(`${file} 에 NOTION_TOKEN 을 기록했다 (${d.length}자)${warn}.`);
  log('토큰 파일은 지웠다.');
  ensureEnvIgnored(rootDir, log);
  log('값은 출력하지 않는다. 다음: check-notion.js 로 연결을 확인한다.');
  return file;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const ACTIONS = new Set(['status', 'init-config', 'init-env', 'set-token']);

function parseArgs(argv) {
  const out = { root: process.cwd(), rootExplicit: false, services: [], wikiRoot: null, tokenFile: null, json: false, actions: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      out.root = path.resolve(argv[++i]);
      out.rootExplicit = true;
    }
    else if (a === '--service') out.services.push(parseServiceArg(argv[++i]));
    else if (a === '--wiki-root') out.wikiRoot = argv[++i];
    else if (a === '--token-file') out.tokenFile = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--') && ACTIONS.has(a.slice(2))) out.actions.push(a.slice(2));
    else throw new Error(`모르는 인자: ${safe(a)}\n  → 토큰은 인자로 주지 않는다. --token-file <경로> 를 쓴다.`);
  }
  return out;
}

const USAGE = `setup.js — 위키 작업 공간을 준비한다 (사람에게 묻는 것은 스킬이 한다)

  --status                                       현재 상태만 본다 (아무것도 바꾸지 않는다)
  --init-config --service "<slug>|<이름>|<URL>" [반복] --wiki-root <URL>
                                                 notion-wiki.config.json 을 만든다 (이미 있으면 중단)
  --init-env                                     .env 를 NOTION_TOKEN= 빈 값으로 만든다 (이미 있으면 손대지 않는다)
  --set-token --token-file <경로>                 그 파일의 첫 줄을 .env 에 넣고 파일을 지운다 (토큰을 출력하지 않는다)
                                                 파일은 .tmp 또는 .token 으로 끝나야 한다
  --root <디렉터리>                               대상 작업 공간 (기본: 현재 디렉터리)
  --json                                         --status 결과를 JSON 으로도 낸다`;

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    shredTokenFileFromArgv(argv); // 파싱이 실패해도 토큰 파일을 남기지 않는다
    throw err;
  }

  const log = (m) => console.log(m);
  if (!args.actions.length) {
    console.log(USAGE);
    return 0;
  }
  // 준비가 끝나지 않은 작업 공간이면, 무엇을 하기 전에 **어디에** 만들지부터 알린다.
  if (!status(args.root).config.valid) {
    warnAboutRoot({ rootDir: args.root, log, explicitRoot: args.rootExplicit });
  }

  try {
    for (const action of args.actions) {
      if (action === 'init-config') initConfig({ rootDir: args.root, services: args.services, wikiRoot: args.wikiRoot, log });
      else if (action === 'init-env') initEnv({ rootDir: args.root, log });
      else if (action === 'set-token') {
        if (!args.tokenFile) throw new Error('--set-token 에는 --token-file <경로> 가 필요하다. 토큰을 인자로 주지 않는다.');
        setToken({ rootDir: args.root, tokenFile: args.tokenFile, log });
      }
    }
  } finally {
    // 어느 단계에서 실패했든 토큰 파일을 남기지 않는다 (화이트리스트 밖이면 아무것도 하지 않는다).
    shredTokenFile(args.tokenFile);
  }
  // 무엇을 했든 끝에는 현재 상태를 보여 준다 — 다음에 할 일이 한눈에 보이게.
  const out = status(args.root);
  reportStatus(out, log);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`중단: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  safe,
  safePath,
  resolvePageId,
  parseServiceArg,
  buildConfig,
  upsertEnvToken,
  describeToken,
  shredTokenFile,
  shredTokenFileFromArgv,
  ensureEnvIgnored,
  describeRootRisks,
  warnAboutRoot,
  status,
  reportStatus,
  initConfig,
  initEnv,
  setToken,
  parseArgs,
  TOKEN_FILE_RE,
  TOKEN_FILE_MAX_BYTES,
  TEMPLATES_DIR,
};
