#!/usr/bin/env node
'use strict';
// 신규 초안 골격 만들기 (docs/TRD.md 6.8). Notion 을 호출하지 않는다 — 토큰이 필요 없다.
// 섹션 누락을 LLM 의 성실성에 맡기지 않기 위해 골격은 코드가 만든다.

const fs = require('node:fs');
const path = require('node:path');
const { config, registerLegacy } = require('./lib/shared');
const templates = require('./lib/doc-templates');
const draftLib = require('./lib/draft');

function list(v) {
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function runNew({ cfg, rootDir, service: serviceSlug, category: categorySlug, docType, title, owner = [], summary = null,
                  keywords = [], tags = [], reviewBy = null, sensitivity = '내부', authorType = '사람+AI',
                  today, nowIso, force = false }) {
  const { service, category } = registerLegacy.requireScope(cfg, serviceSlug, categorySlug);
  if (!templates.SECTIONS[docType]) {
    throw new Error(`알 수 없는 문서유형: ${docType}\n허용: ${templates.docTypes().join(' · ')}`);
  }
  if (!String(title || '').trim()) throw new Error('--title 이 필요하다');

  const file = draftLib.draftPath(cfg, rootDir, { service: service.slug, category: category.slug, title });
  if (fs.existsSync(file) && !force) {
    throw new Error(`이미 있는 초안이다: ${draftLib.relDraftPath(cfg, rootDir, file)}\n고치려면 그 파일을 Edit 하고, 새로 만들려면 --force 를 붙인다.`);
  }
  const data = {
    kind: 'new',
    service: service.slug,
    category: category.slug,
    title: String(title).trim(),
    doc_type: docType,
    status: '초안',
    author_type: authorType,
    owner,
    summary: summary || null,
    keywords,
    tags,
    review_by: reviewBy || null,
    verified_at: null,
    sensitivity,
    exclude: false,
    related: [],
    drafted_at: nowIso,
  };
  const body = templates.skeleton(docType, { today, author: owner[0] || '작성자' });
  draftLib.writeDraft(file, data, body);
  return { file, rel: draftLib.relDraftPath(cfg, rootDir, file), sections: templates.sectionsFor(docType), data };
}

function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const rootDir = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const cfg = config.loadConfig(rootDir);
  const now = new Date();
  const nowIso = get('--now') || now.toISOString();
  const today = get('--today') || nowIso.slice(0, 10);
  if (!get('--service') || !get('--category') || !get('--type') || !get('--title')) {
    console.error('사용법: draft-new.js --service <slug> --category <slug> --type <문서유형> --title <제목>');
    console.error('        [--owner 이름[,이름]] [--summary "한 문장"] [--keywords a,b] [--tags a,b]');
    console.error('        [--review-by YYYY-MM-DD] [--sensitivity 공개|내부|민감] [--author-type 사람|AI|사람+AI] [--force]');
    console.error(`문서유형: ${templates.docTypes().join(' · ')}`);
    process.exit(1);
  }
  const r = runNew({
    cfg, rootDir,
    service: get('--service'), category: get('--category'), docType: get('--type'), title: get('--title'),
    owner: list(get('--owner')), summary: get('--summary'), keywords: list(get('--keywords')), tags: list(get('--tags')),
    reviewBy: get('--review-by'), sensitivity: get('--sensitivity') || '내부', authorType: get('--author-type') || '사람+AI',
    today, nowIso, force: argv.includes('--force'),
  });
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`초안 생성: ${r.rel}`);
  console.log(`섹션 ${r.sections.length}개: ${r.sections.join(' / ')}`);
  console.log('다음: 안내 주석(<!-- -->)을 지우고 내용을 채운 뒤 draft-submit.js 로 dry-run 한다.');
  const empty = [];
  if (!r.data.summary) empty.push('요약');
  if (!r.data.owner.length) empty.push('담당자');
  if (empty.length) console.log(`먼저 채울 것: ${empty.join(', ')} — 추측하지 말고 사람에게 묻는다.`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
}

module.exports = { runNew };
