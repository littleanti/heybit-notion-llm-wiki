#!/usr/bin/env node
'use strict';
// fixture 워크스페이스(test/fixtures/*)를 **실제 Notion** 에 올린다 — 실 워크스페이스 스모크 테스트용 더미 데이터.
// 기본은 dry-run. --apply 일 때만 쓴다. 만든 것은 .seed-state.json 에 적어 재실행 때 건너뛴다.
//
//   node test/helpers/seed-notion.js --parent <Notion 페이지 URL 또는 id> [--apply] [--write-config]
//
// 부모 페이지 하나가 필요하다. 내부 연결(integration)은 workspace 최상위에 페이지를 만들 수 없고,
// 연결이 추가된 페이지 아래에만 만들 수 있다 (Notion API 제약).

const fs = require('node:fs');
const path = require('node:path');
const P = '../../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/';
const { loadConfig, loadEnv, requireToken, normalizeId } = require(P + 'lib/config');
const { createClient } = require(P + 'lib/notion-client');
const { plainText, pageIdFromUrl } = require(P + 'lib/meta');

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const STATE_FILE = '.seed-state.json';
// 관련 페이지(relation)는 대상 data source id 가 있어야 만들 수 있어 순환이 생긴다 — 더미에서는 뺀다.
const SKIP_PROPS = new Set(['관련 페이지']);

// fixture 본문에는 실제 Notion 에 만들 수 없는 것이 둘 있다.
//  1) <unknown url=... alt=.../> — "알 수 없는 블록" 을 흉내 낸 합성 태그. 실 API 는 이것을 데이터베이스 참조로
//     해석하려다 400 을 낸다: "Cannot create database reference: Block ... does not exist in the current space".
//  2) <mention-page url=...> — fixture id 를 가리키므로 아직 존재하지 않는다. 만들 때는 텍스트로 낮추고,
//     모든 페이지가 생긴 뒤 2단계에서 실제 URL 로 다시 써 넣는다.
const UNKNOWN_TAG_RE = /<unknown\b[^>]*\/?>|<\/unknown>/g;
const MENTION_RE = /<mention-page\s+url="([^"]+)"[^>]*>([^<]*)<\/mention-page>|<mention-page\s+url="([^"]+)"[^>]*\/>/g;

function sanitizeForCreate(markdown) {
  return String(markdown || '')
    .replace(UNKNOWN_TAG_RE, '')
    .replace(MENTION_RE, (whole, u1, label) => (label || '').trim());
}

// fixture id → 실제 URL 로 멘션을 다시 쓴다. 해석 못 하면 텍스트로 남긴다.
function rewriteMentions(markdown, urlByFixtureId, normalize, idFromUrl) {
  let unresolved = 0;
  const out = String(markdown || '').replace(UNKNOWN_TAG_RE, '').replace(MENTION_RE, (whole, u1, label, u2) => {
    const url = u1 || u2;
    const target = normalize(idFromUrl(url) || '');
    const real = target ? urlByFixtureId.get(target) : null;
    if (!real) { unresolved++; return (label || '').trim(); }
    return `<mention-page url="${real}">${(label || '').trim()}</mention-page>`;
  });
  return { markdown: out, unresolved };
}

function rt(text) {
  const s = text === undefined || text === null ? '' : String(text);
  return s === '' ? [] : [{ type: 'text', text: { content: s } }];
}

function loadState(rootDir) {
  const f = path.join(rootDir, STATE_FILE);
  if (!fs.existsSync(f)) return { parent: null, pages: {}, databases: {}, dataSources: {}, mentions: {} };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function saveState(rootDir, state) {
  fs.writeFileSync(path.join(rootDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function schemaFor(propertySchema) {
  const out = {};
  for (const [name, type] of Object.entries(propertySchema)) {
    if (SKIP_PROPS.has(name)) continue;
    if (type === 'title') out[name] = { title: {} };
    else if (type === 'rich_text') out[name] = { rich_text: {} };
    else if (type === 'select') out[name] = { select: {} };
    else if (type === 'status') out[name] = { status: {} };
    else if (type === 'multi_select') out[name] = { multi_select: {} };
    else if (type === 'date') out[name] = { date: {} };
    else if (type === 'people') out[name] = { people: {} };
    else if (type === 'checkbox') out[name] = { checkbox: {} };
    else if (type === 'url') out[name] = { url: {} };
    else throw new Error(`seed: 만들 수 없는 속성 타입 ${type} (${name})`);
  }
  return out;
}

function rowProperties({ props, title, propertySchema, ownerRefs, sourceUrl }) {
  const out = {};
  for (const [name, type] of Object.entries(propertySchema)) {
    if (SKIP_PROPS.has(name)) continue;
    if (type === 'title') { out[name] = { title: rt(title) }; continue; }
    let v = props ? props[name] : undefined;
    if (name === '원본') v = sourceUrl || null;
    if (type === 'people') { out[name] = { people: ownerRefs }; continue; }
    if (type === 'select') out[name] = { select: v ? { name: String(v) } : null };
    else if (type === 'status') out[name] = { status: v ? { name: String(v) } : null };
    else if (type === 'rich_text') out[name] = { rich_text: rt(v) };
    else if (type === 'multi_select') out[name] = { multi_select: (v || []).map((x) => ({ name: String(x) })) };
    else if (type === 'date') out[name] = { date: v ? { start: String(v) } : null };
    else if (type === 'checkbox') out[name] = { checkbox: Boolean(v) };
    else if (type === 'url') out[name] = { url: v || null };
  }
  return out;
}

async function createDatabase({ client, parentPageId, title, properties }) {
  const body = { parent: { type: 'page_id', page_id: parentPageId }, title: rt(title), initial_data_source: { properties } };
  try {
    return await client.request('POST', '/v1/databases', { body });
  } catch (err) {
    if (!/validation|400/.test(err.message)) throw err;
    // 구버전 형태 대비: 스키마를 top-level properties 로
    return await client.request('POST', '/v1/databases', { body: { parent: { type: 'page_id', page_id: parentPageId }, title: rt(title), properties } });
  }
}

async function runSeed({ cfg, client, rootDir, parentArg, apply = false, writeConfig = false, log = console.log }) {
  const ws = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'workspace.json'), 'utf8'));
  const state = loadState(rootDir);
  state.mentions = state.mentions || {};
  const parentId = pageIdFromUrl(parentArg) || normalizeId(parentArg);
  if (!parentId) throw new Error(`부모 페이지를 알 수 없다: ${parentArg}\nNotion 페이지 URL 이나 32자리 id 를 준다.`);

  const parent = await client.request('GET', `/v1/pages/${parentId}`);
  const parentTitle = (() => {
    const t = Object.values(parent.properties || {}).find((x) => x && x.type === 'title');
    return plainText(t ? t.title : []).trim() || '(제목 없음)';
  })();
  log(`부모 페이지: "${parentTitle}" (${parentId})`);
  state.parent = parentId;

  // 담당자: 워크스페이스의 실제 사람 사용자 1명에게 모두 배정한다 (더미의 가상 이름은 실제 사용자가 아니다)
  const users = (await client.paginate('GET', '/v1/users')).results.filter((u) => u.type === 'person');
  const ownerRefs = users.length ? [{ object: 'user', id: users[0].id }] : [];
  log(`담당자: ${users.length ? `"${users[0].name}" 1명에게 전부 배정 (더미의 가상 이름은 본문에만 남는다)` : '워크스페이스에 사람 사용자가 없어 비워 둔다'}`);

  const services = ws.services;
  const categories = ws.categories; // 6개 (fallback 기타 는 페이지 없음)
  const rows = [];
  for (const svc of services) {
    const list = JSON.parse(fs.readFileSync(path.join(FIXTURES, svc.pagesFile), 'utf8'));
    for (const p of list) rows.push({ ...p, svc });
  }
  const alive = rows.filter((r) => !r.in_trash);
  const legacy = alive.filter((r) => r.kind === 'legacy');
  const plain = alive.filter((r) => r.kind === 'plain');
  const dbRows = alive.filter((r) => r.kind === 'db_row');

  const plan = {
    wikiRoot: 1,
    servicePages: services.length,
    categoryPages: services.length * categories.length,
    databases: services.length * categories.length,
    legacyPages: legacy.length,
    plainPages: plain.length,
    dbRows: dbRows.length,
    skippedTrash: rows.length - alive.length,
  };
  plan.total = plan.wikiRoot + plan.servicePages + plan.categoryPages + plan.databases + plan.legacyPages + plan.plainPages + plan.dbRows;
  log('');
  log('만들 것:');
  log(`  위키 루트 페이지      ${plan.wikiRoot}`);
  log(`  서비스 상위 페이지    ${plan.servicePages}   (${services.map((s) => s.name).join(' · ')})`);
  log(`  카테고리 페이지       ${plan.categoryPages}  (서비스마다 ${categories.map((c) => c.name).join('·')})`);
  log(`  카테고리 데이터베이스 ${plan.databases}  (속성 ${Object.keys(schemaFor(ws.propertySchema)).length}개, 관련 페이지 제외)`);
  log(`  레거시 일반 페이지    ${plan.legacyPages}`);
  log(`  서비스 직속 일반 페이지 ${plan.plainPages}`);
  log(`  데이터베이스 항목     ${plan.dbRows}  (본문 포함)`);
  log(`  휴지통 fixture 건너뜀 ${plan.skippedTrash}`);
  log(`  총 쓰기 호출 약 ${plan.total}회 · 3 rps 제한이라 대략 ${Math.ceil(plan.total / 3)}초`);
  if (!apply) {
    log('');
    log('dry-run 이다. 실제로 만들려면 --apply 를 붙인다.');
    return { plan, state, apply: false };
  }

  const key = (kind, id) => `${kind}:${id}`;
  async function ensurePage(k, body, label) {
    if (state.pages[k]) return state.pages[k];
    const created = await client.request('POST', '/v1/pages', { body });
    const rec = { id: normalizeId(created.id), url: created.url };
    state.pages[k] = rec;
    saveState(rootDir, state);
    log(`  + ${label}`);
    return rec;
  }

  // 1. 위키 루트
  const wikiRoot = await ensurePage(key('wiki', 'root'), {
    parent: { page_id: parentId },
    properties: { title: { title: rt('LLM Wiki (테스트)') } },
    markdown: '아래 페이지는 LLM wiki 가 자동 생성·갱신합니다.',
  }, '위키 루트 "LLM Wiki (테스트)"');

  // 2. 서비스 · 카테고리 페이지 · 데이터베이스
  const serviceIds = {};
  const dsByServiceCategory = {};
  for (const svc of services) {
    const sp = await ensurePage(key('service', svc.slug), {
      parent: { page_id: parentId },
      properties: { title: { title: rt(svc.name) } },
      markdown: `${svc.name} 서비스의 실무 문서 상위 페이지입니다. 카테고리별 데이터베이스가 아래에 있습니다.`,
    }, `서비스 "${svc.name}"`);
    serviceIds[svc.slug] = sp.id;

    for (const cat of categories) {
      const cp = await ensurePage(key('category', `${svc.slug}/${cat.slug}`), {
        parent: { page_id: sp.id },
        properties: { title: { title: rt(cat.name) } },
      }, `카테고리 "${svc.name} / ${cat.name}"`);

      const dbKey = key('db', `${svc.slug}/${cat.slug}`);
      if (!state.dataSources[dbKey]) {
        const db = await createDatabase({ client, parentPageId: cp.id, title: `${svc.name} · ${cat.name}`, properties: schemaFor(ws.propertySchema) });
        const dsId = db.data_sources && db.data_sources.length ? normalizeId(db.data_sources[0].id) : null;
        if (!dsId) throw new Error(`데이터베이스 응답에 data_sources 가 없다: ${JSON.stringify(db).slice(0, 200)}`);
        state.databases[dbKey] = { id: normalizeId(db.id), url: db.url };
        state.dataSources[dbKey] = { id: dsId };
        saveState(rootDir, state);
        log(`  + 데이터베이스 "${svc.name} · ${cat.name}"`);
      }
      dsByServiceCategory[`${svc.slug}/${cat.slug}`] = state.dataSources[dbKey].id;
    }
  }

  // 3. 레거시 일반 페이지 (등록 항목의 `원본` 이 이 URL 을 가리킨다)
  const legacyByFixtureId = {};
  for (const r of legacy) {
    const cat = categories.find((c) => c.slug === r.category);
    const catRec = state.pages[key('category', `${r.svc.slug}/${cat.slug}`)];
    const rec = await ensurePage(key('legacy', r.id), {
      parent: { page_id: catRec.id },
      properties: { title: { title: rt(r.title) } },
      markdown: sanitizeForCreate(r.markdown),
    }, `레거시 "${r.title}"`);
    legacyByFixtureId[r.id] = rec;
  }

  // 4. 서비스 직속 일반 페이지
  for (const r of plain) {
    await ensurePage(key('plain', r.id), {
      parent: { page_id: serviceIds[r.svc.slug] },
      properties: { title: { title: rt(r.title) } },
      markdown: sanitizeForCreate(r.markdown),
    }, `일반 페이지 "${r.title}"`);
  }

  // 5. 데이터베이스 항목
  for (const r of dbRows) {
    const k = key('row', r.id);
    if (state.pages[k]) continue;
    const dsId = dsByServiceCategory[`${r.svc.slug}/${r.category}`];
    if (!dsId) throw new Error(`data source 를 찾을 수 없다: ${r.svc.slug}/${r.category}`);
    let sourceUrl = null;
    if (r.props && r.props['원본']) {
      const targetId = pageIdFromUrl(r.props['원본']);
      const rec = Object.entries(legacyByFixtureId).find(([fid]) => normalizeId(fid) === targetId);
      sourceUrl = rec ? rec[1].url : null;
      if (!sourceUrl) log(`  ! "${r.title}" 의 원본 레거시 페이지를 찾지 못해 원본을 비운다`);
    }
    const created = await client.request('POST', '/v1/pages', {
      body: {
        parent: { type: 'data_source_id', data_source_id: dsId },
        properties: rowProperties({ props: r.props, title: r.title, propertySchema: ws.propertySchema, ownerRefs, sourceUrl }),
        markdown: sanitizeForCreate(r.markdown),
      },
    });
    state.pages[k] = { id: normalizeId(created.id), url: created.url };
    saveState(rootDir, state);
    log(`  + 항목 "${r.title}"`);
  }

  // 5.5 멘션 재작성 — 모든 페이지가 생긴 뒤 fixture id 를 실제 URL 로 바꿔 본문을 교체한다.
  //     이 단계가 있어야 미러가 실제로 해석되는 멘션을 담고, sync 의 멘션 → 상대 경로 보강 경로가 검증된다.
  const urlByFixtureId = new Map();
  for (const [k, rec] of Object.entries(state.pages)) {
    const m = /^(row|legacy|plain):(.+)$/.exec(k);
    if (m) urlByFixtureId.set(normalizeId(m[2]), rec.url);
  }
  let patched = 0;
  let unresolvedTotal = 0;
  for (const r of alive) {
    if (!/<mention-page/.test(r.markdown || '')) continue;
    const k = key(r.kind === 'db_row' ? 'row' : r.kind, r.id);
    const rec = state.pages[k];
    if (!rec) continue;
    const { markdown, unresolved } = rewriteMentions(r.markdown, urlByFixtureId, normalizeId, pageIdFromUrl);
    unresolvedTotal += unresolved;
    if (state.mentions[r.id] === markdown.length) continue; // 이미 같은 내용으로 넣었다
    await client.request('PATCH', `/v1/pages/${rec.id}/markdown`, {
      body: { type: 'replace_content', replace_content: { new_str: markdown, allow_deleting_content: false } },
    });
    state.mentions[r.id] = markdown.length;
    saveState(rootDir, state);
    patched++;
    log(`  ~ 멘션 재작성 "${r.title}"`);
  }
  if (patched || unresolvedTotal) log(`멘션: ${patched}개 페이지 본문 교체 · 해석 못 한 멘션 ${unresolvedTotal}건`);

  // 6. 설정 파일 갱신
  if (writeConfig) {
    const file = path.join(rootDir, 'notion-wiki.config.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const s of json.services) {
      const svc = services.find((x) => x.name === s.name || x.slug === s.slug);
      if (svc && serviceIds[svc.slug]) s.rootPageId = serviceIds[svc.slug];
    }
    json.wiki.rootPageId = wikiRoot.id;
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    log('');
    log(`설정 갱신: notion-wiki.config.json 의 services[].rootPageId · wiki.rootPageId`);
  }

  log('');
  log(`완료. 호출 ${client.stats().requests}회. 상태: ${STATE_FILE} (재실행하면 이미 만든 것은 건너뛴다)`);
  log(`위키 루트: ${wikiRoot.url}`);
  return { plan, state, apply: true, wikiRoot, serviceIds };
}

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const rootDir = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const parentArg = get('--parent');
  if (!parentArg) {
    console.error('사용법: seed-notion.js --parent <Notion 페이지 URL 또는 id> [--apply] [--write-config]');
    console.error('  부모 페이지에 연결(integration)이 추가돼 있어야 한다. 기본은 dry-run.');
    process.exit(1);
  }
  const cfg = loadConfig(rootDir);
  const token = requireToken(loadEnv(rootDir), 'seed-notion');
  const client = createClient({ token, version: cfg.notionVersion, rps: cfg.sync.rps, log: (m) => console.error(m) });
  await runSeed({
    cfg, client, rootDir, parentArg,
    apply: argv.includes('--apply'), writeConfig: argv.includes('--write-config'),
  });
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}

module.exports = { runSeed, schemaFor, rowProperties, sanitizeForCreate, rewriteMentions };
