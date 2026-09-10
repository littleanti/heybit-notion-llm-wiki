'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/sync-harness');
const { loadConfig } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const { lint, summaryLine } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lint');
const { buildIndex } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/build-index');
const fm = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/frontmatter');

const TODAY = '2026-09-09';

// 샘플 raw/ + wiki/ 를 임시 디렉터리로 복사한 뒤 mutate 로 결함 하나를 심는다
function sandbox(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwiki-lint-'));
  fs.copyFileSync(path.join(REPO_ROOT, 'notion-wiki.config.json'), path.join(dir, 'notion-wiki.config.json'));
  fs.cpSync(path.join(REPO_ROOT, 'raw'), path.join(dir, 'raw'), { recursive: true });
  if (fs.existsSync(path.join(REPO_ROOT, 'wiki'))) fs.cpSync(path.join(REPO_ROOT, 'wiki'), path.join(dir, 'wiki'), { recursive: true });
  const cfg = loadConfig(dir);
  if (mutate) mutate(dir, cfg);
  return { dir, cfg };
}

function firstRaw(dir, pred = () => true) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(dir, 'raw')).sort()) {
    let parsed;
    try { parsed = fm.split(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (!parsed.data) continue;
    if (pred(parsed.data, f)) return { file: f, ...parsed };
  }
  throw new Error('조건에 맞는 raw 파일이 없다');
}

function rewrite(file, data, body) {
  fs.writeFileSync(file, fm.join(data, body), 'utf8');
}

function codesDiff(base, mutated) {
  const count = (r) => r.issues.reduce((m, i) => ((m[i.code] = (m[i.code] || 0) + 1), m), {});
  const a = count(base), b = count(mutated);
  const diff = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] || 0) !== (b[k] || 0)) diff[k] = (b[k] || 0) - (a[k] || 0);
  return diff;
}

const baseline = (() => { const { dir, cfg } = sandbox(); return lint({ cfg, rootDir: dir, today: TODAY }); })();

test('T10 lint: 샘플에는 오류가 없고, 의도된 경고(meta-missing·stale)만 있다', () => {
  assert.equal(baseline.errors.length, 0, JSON.stringify(baseline.errors, null, 2));
  const codes = new Set(baseline.warnings.map((w) => w.code));
  assert.ok(codes.has('meta-missing'), '미등록 레거시 2건이 경고로 보여야 한다');
  assert.ok(codes.has('stale'), '검토기한 경과 1건이 경고로 보여야 한다');
  assert.match(summaryLine(baseline), /^lint: 경고 \d+ \(/);
});

test('T10 lint: L1 meta-missing — 요약을 지우면 그 파일에 경고 1건이 늘어난다', () => {
  const { dir, cfg } = sandbox((d) => {
    const r = firstRaw(d, (x) => x.status === '확정' && x.summary);
    rewrite(r.file, { ...r.data, summary: null }, r.body);
  });
  const res = lint({ cfg, rootDir: dir, today: TODAY });
  assert.deepEqual(codesDiff(baseline, res), { 'meta-missing': 1 });
  assert.equal(res.errors.length, 0);
});

test('T10 lint: L2 meta-invalid — 허용값 밖 상태 · 잘못된 날짜 · 미러에 남은 민감 페이지', () => {
  const { dir, cfg } = sandbox((d) => {
    const r = firstRaw(d, (x) => x.status === '확정');
    rewrite(r.file, { ...r.data, status: '승인됨', review_by: '2026/12/31' }, r.body);
    const s = firstRaw(d, (x) => x.status === '초안');
    rewrite(s.file, { ...s.data, sensitivity: '민감' }, s.body);
  });
  const res = lint({ cfg, rootDir: dir, today: TODAY });
  assert.deepEqual(codesDiff(baseline, res), { 'meta-invalid': 2 });
  assert.ok(res.errors.some((e) => /상태 "승인됨"/.test(e.message) && /날짜 형식/.test(e.message)));
  assert.ok(res.errors.some((e) => /있을 수 없는 상태/.test(e.message)));
});

test('T10 lint: L3 link-broken — 없는 파일로의 상대 링크', () => {
  const { dir, cfg } = sandbox((d) => {
    const r = firstRaw(d);
    rewrite(r.file, r.data, r.body + '\n[없는 문서](../legal/없는-문서-000000.md)\n');
  });
  const res = lint({ cfg, rootDir: dir, today: TODAY });
  assert.deepEqual(codesDiff(baseline, res), { 'link-broken': 1 });
});

test('T10 lint: L6 stale — 검토기한을 어제로 바꾸면 경고가 늘어난다', () => {
  const { dir, cfg } = sandbox((d) => {
    const r = firstRaw(d, (x) => x.status === '확정' && !x.review_by);
    rewrite(r.file, { ...r.data, review_by: '2026-09-08' }, r.body);
  });
  const res = lint({ cfg, rootDir: dir, today: TODAY });
  assert.deepEqual(codesDiff(baseline, res), { stale: 1 });
});

test('T10 lint: L7 frontmatter-invalid — 깨진 frontmatter 와 필수 키 누락', () => {
  const { dir, cfg } = sandbox((d) => {
    const r = firstRaw(d);
    fs.writeFileSync(r.file, '---\ntitle: "닫히지 않은\n---\n본문\n', 'utf8');
    const s = firstRaw(d, (x, f) => f !== r.file);
    const { notion_id, ...rest } = s.data;
    rewrite(s.file, rest, s.body);
  });
  const res = lint({ cfg, rootDir: dir, today: TODAY });
  const diff = codesDiff(baseline, res);
  assert.equal(diff['frontmatter-invalid'], 2);
});

test('T10 lint: 위키 — L5 source-missing · L4 orphan-wiki · L8 too-large · 위키 stale', () => {
  const { dir, cfg } = sandbox((d, c) => {
    const wikiDir = path.join(d, 'wiki', 'routinefit');
    fs.mkdirSync(wikiDir, { recursive: true });
    const raw = firstRaw(d, (x) => x.service === 'routinefit' && x.status === '확정');
    const rawRel = path.relative(d, raw.file).split(path.sep).join('/');
    // 정상 페이지 하나 (기준선용)
    fs.writeFileSync(path.join(wikiDir, 'overview.md'), fm.join(
      { title: '루틴핏', type: 'overview', service: 'routinefit', summary: '요약', keywords: [], sources: [rawRel], updated: '2026-09-09' },
      `## 이 서비스는\n설명 [출처](../../${rawRel})\n`,
    ));
    // 결함 페이지: sources 의 raw 없음 + 출처 없는 섹션 + updated 가 원본보다 과거(stale) + 200KB 초과
    fs.writeFileSync(path.join(wikiDir, 'conflicts.md'), fm.join(
      { title: '충돌', type: 'conflicts', service: 'routinefit', summary: '요약', keywords: [], sources: ['raw/routinefit/legal/없음-000000.md', rawRel], updated: '2020-01-01' },
      `## 충돌\n출처 없는 문장.\n\n## 큰 섹션\n${'가'.repeat(70 * 1024)} [출처](../../${rawRel})\n`,
    ));
    // 고아: index 에 없는 페이지 → index 를 만든 뒤 파일을 하나 더 추가
    buildIndex({ cfg: c, rootDir: d, nowIso: '2026-09-09T01:00:00.000Z' });
    fs.writeFileSync(path.join(wikiDir, 'orphan.md'), fm.join(
      { title: '고아', type: 'topic', service: 'routinefit', summary: '요약', keywords: [], sources: [rawRel], updated: '2026-09-09' },
      `## 한눈에\n[출처](../../${rawRel})\n`,
    ));
  });
  const res = lint({ cfg, rootDir: dir, today: TODAY });
  const byCode = {};
  for (const i of res.issues) if (i.path.startsWith('wiki/')) byCode[i.code] = (byCode[i.code] || 0) + 1;
  assert.equal(byCode['source-missing'], 2, JSON.stringify(res.issues.filter((i) => i.path.startsWith('wiki/')), null, 2));
  assert.equal(byCode['orphan-wiki'], 1);
  assert.equal(byCode['too-large'], 1);
  assert.equal(byCode['stale'], 1);
  assert.equal(byCode['frontmatter-invalid'], undefined);
  assert.equal(byCode['link-broken'], undefined);
  assert.ok(res.errors.length >= 4);
});
