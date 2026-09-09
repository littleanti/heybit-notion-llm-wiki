#!/usr/bin/env node
'use strict';
// 골든을 다시 만든다. fixture 나 wiki/ 를 바꾼 뒤 실행한다:
//   node test/helpers/generate-golden.js            # raw/ + index 골든 + publish 계획 골든
//   node test/helpers/generate-golden.js --no-raw   # raw/ 는 그대로 두고 index·publish 골든만
// 시각은 FIXED_NOW 로 고정해 결정적이다. 결과를 커밋하면 테스트가 이를 기준으로 비교한다.
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, FIXED_NOW, syncOnce, listFiles } = require('./sync-harness');
const { loadConfig } = require('../../.claude/skills/notion-llm-wiki/scripts/lib/config');
const { buildIndex } = require('../../.claude/skills/notion-llm-wiki/scripts/build-index');
const { runPublish } = require('../../.claude/skills/notion-llm-wiki/scripts/publish');

async function main(argv) {
  const goldenDir = path.join(REPO_ROOT, 'test', 'golden');
  fs.mkdirSync(goldenDir, { recursive: true });

  if (!argv.includes('--no-raw')) {
    const rawDir = path.join(REPO_ROOT, 'raw');
    if (fs.existsSync(rawDir)) fs.rmSync(rawDir, { recursive: true, force: true });
    const { report } = await syncOnce({ rootDir: REPO_ROOT });
    console.log(`raw/ 재생성: 파일 ${listFiles(rawDir).length}개 (추가 ${report.added.length}, 제외 ${report.excluded.length}, 실패 ${report.failed.length})`);
    for (const f of report.failed) console.log(`  실패: ${f.title} — ${f.error}`);
  }

  const cfg = loadConfig(REPO_ROOT);
  const { text, counts } = buildIndex({ cfg, rootDir: REPO_ROOT, nowIso: FIXED_NOW, write: false });
  fs.writeFileSync(path.join(goldenDir, 'index.md'), text, 'utf8');
  console.log(`test/golden/index.md: raw ${counts.raw} · wiki ${counts.wiki} · ${text.split('\n').length}줄`);

  // publish 계획은 상태 파일 없는 사본에서 만든다 (전부 create)
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nwiki-golden-'));
  fs.copyFileSync(path.join(REPO_ROOT, 'notion-wiki.config.json'), path.join(tmp, 'notion-wiki.config.json'));
  fs.cpSync(path.join(REPO_ROOT, 'raw'), path.join(tmp, 'raw'), { recursive: true });
  if (fs.existsSync(path.join(REPO_ROOT, 'wiki'))) fs.cpSync(path.join(REPO_ROOT, 'wiki'), path.join(tmp, 'wiki'), { recursive: true });
  fs.rmSync(path.join(tmp, 'wiki', '.publish-state.json'), { force: true });
  const { plan } = await runPublish({ cfg: loadConfig(tmp), rootDir: tmp, apply: false, nowIso: FIXED_NOW });
  const summary = plan.map(({ key, kind, parentKey, title, action, hash, unresolved, markdown }) => ({ key, kind, parentKey, title, action, hash, unresolved, bytes: markdown ? Buffer.byteLength(markdown) : 0 }));
  fs.writeFileSync(path.join(goldenDir, 'publish-plan.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log(`test/golden/publish-plan.json: 항목 ${summary.length}개`);
}

main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
