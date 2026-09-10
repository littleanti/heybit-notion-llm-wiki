#!/usr/bin/env node
'use strict';
// 토큰·연결·설정을 확인한다 (docs/README 5.2). **읽기 전용** — 쓰기 호출 경로가 없다.
// 실 워크스페이스에 처음 붙일 때 sync 전에 돌린다. 무엇이 안 보이는지와 다음에 할 일을 알려 준다.

const path = require('node:path');
const { loadConfig, loadEnv, requireToken, normalizeId } = require('./lib/config');
const { createClient } = require('./lib/notion-client');
const { plainText } = require('./lib/meta');

function titleOf(page) {
  const t = Object.values((page && page.properties) || {}).find((x) => x && x.type === 'title');
  return plainText(t ? t.title : []).trim() || '(제목 없음)';
}

async function runCheck({ cfg, client, log = console.log }) {
  const out = { integration: null, users: 0, pages: 0, dataSources: 0, services: [], wikiRoot: null, categories: [], calls: 0 };

  const me = await client.request('GET', '/v1/users/me');
  out.integration = { name: me.name || null, type: me.type || null };
  log(`연결      ${me.name || '(이름 없음)'} · type=${me.type}`);

  try {
    const users = await client.paginate('GET', '/v1/users');
    out.users = users.results.filter((u) => u.type !== 'bot').length;
    log(`사용자    ${out.users}명 — 담당자(people) 속성을 쓰려면 필요하다`);
  } catch (err) {
    log(`사용자    조회 실패: ${err.message}`);
    log('          → 연결 권한에 "사용자 정보 읽기" 를 켠다 (담당자 속성을 쓰지 않으면 없어도 된다)');
  }

  const pages = await client.paginate('POST', '/v1/search', { filter: { property: 'object', value: 'page' } });
  const dss = await client.paginate('POST', '/v1/search', { filter: { property: 'object', value: 'data_source' } });
  out.pages = pages.results.length;
  out.dataSources = dss.results.length;
  log(`접근 범위  페이지 ${out.pages}개 · 데이터베이스(data source) ${out.dataSources}개`);
  if (out.pages === 0) {
    log('          → 0개다. 연결이 어느 페이지에도 추가되지 않았다.');
    log('            Notion 에서 서비스 상위 페이지 ••• → 연결 → 이 연결을 추가한다 (하위에 상속된다).');
  }

  const byId = new Map(pages.results.map((p) => [normalizeId(p.id), p]));
  for (const svc of cfg.services) {
    const p = byId.get(svc.rootPageId);
    out.services.push({ slug: svc.slug, found: Boolean(p), title: p ? titleOf(p) : null });
    log(`서비스     ${svc.name} (${svc.slug}) — ${p ? `보인다: "${titleOf(p)}"` : '안 보인다 ← rootPageId 가 틀렸거나 연결이 없다'}`);
  }
  const wiki = byId.get(cfg.wiki.rootPageId);
  out.wikiRoot = { found: Boolean(wiki), title: wiki ? titleOf(wiki) : null };
  log(`위키 루트   ${wiki ? `보인다: "${titleOf(wiki)}"` : '안 보인다 — sync·query 만 할 거면 없어도 되고, publish 에는 필요하다'}`);

  // 카테고리 DB 가 보이는지 (서비스 루트 직속 페이지 중 카테고리 이름을 가진 것 아래의 DB)
  for (const ds of dss.results) {
    const title = plainText(ds.title);
    out.categories.push({ id: normalizeId(ds.id), title });
  }
  if (out.dataSources) log(`데이터베이스 ${out.categories.map((c) => c.title || '(제목 없음)').join(' · ')}`);
  else log('데이터베이스 없다 — 카테고리마다 DB 를 만들면 신규 페이지를 항목으로 쓸 수 있다 (docs/DESIGN.md 1절)');

  // 속성 스키마가 설정의 이름 매핑과 맞는지 (첫 DB 하나만 확인한다)
  if (dss.results.length) {
    const first = await client.request('GET', `/v1/data_sources/${normalizeId(dss.results[0].id)}`);
    const names = Object.keys(first.properties || {});
    const wanted = Object.entries(cfg.properties);
    const missing = wanted.filter(([, name]) => !names.includes(name)).map(([key, name]) => `${name}(${key})`);
    log(`속성 매핑   "${plainText(first.title)}" 의 속성 ${names.length}개 확인`);
    if (missing.length) log(`          → 설정에 있으나 이 DB 에 없는 속성: ${missing.join(', ')} (선택 속성이면 무시해도 된다)`);
    else log('          → 설정의 모든 속성 이름이 이 DB 에 있다');
  }

  out.calls = client.stats().requests;
  log(`호출 ${out.calls}회. 쓰기는 하지 않았다.`);
  return out;
}

async function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
  const cfg = loadConfig(rootDir);
  const token = requireToken(loadEnv(rootDir), 'check-notion');
  const client = createClient({ token, version: cfg.notionVersion, rps: cfg.sync.rps, log: (m) => console.error(m) });
  const out = await runCheck({ cfg, client });
  if (argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    if (/401|unauthorized/i.test(err.message)) {
      console.error('→ 토큰이 틀렸거나 만료됐다. Notion 설정 → 연결에서 다시 확인한다 (값은 ntn_ 으로 시작한다).');
    }
    process.exitCode = 1;
  });
}

module.exports = { runCheck };
