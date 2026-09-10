'use strict';
// 수정 대상 페이지의 식별과 안전 검사 (docs/DESIGN.md 10.7, TRD ADR-011).
// pull 과 submit 이 같은 함수를 쓴다 — 고칠 수 없는 페이지로 사람을 데려가지 않기 위해 pull 에서 먼저 막는다.

const fs = require('node:fs');
const path = require('node:path');
const { config, frontmatter: fm, meta: metaLib, sync } = require('./shared');

const CHILD_TAG_RE = /<(?:page|database)\s+url=/;

// 초안·미러의 정보로 대상 id 와 범위(서비스·카테고리·제목)를 정한다.
function resolveTarget({ cfg, rootDir, arg, serviceSlug = null, categorySlug = null }) {
  const abs = path.isAbsolute(arg) ? arg : path.join(rootDir, arg);
  // 1) raw 파일 경로
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const { data } = fm.split(fs.readFileSync(abs, 'utf8'));
    const metaId = config.normalizeId(data.notion_id);
    if (!metaId) throw new Error(`${arg} 의 frontmatter 에 notion_id 가 없다 — raw 미러 파일이 아니다`);
    const bodyId = data.registry_url ? metaLib.pageIdFromUrl(data.source_url) : metaId;
    return {
      metaId, bodyId: bodyId || metaId, service: data.service, category: data.category, title: data.title,
      sourceUrl: data.source_url || null, registryUrl: data.registry_url || null, from: 'raw',
    };
  }
  // 2) Notion URL 또는 id
  const id = metaLib.pageIdFromUrl(arg) || config.normalizeId(arg);
  if (!id) throw new Error(`대상을 알 수 없다: ${arg}\nraw 파일 경로, Notion 페이지 URL, 또는 페이지 id 를 준다.`);
  // 동기화 상태에서 범위를 찾는다 (대표 id 또는 원본 id 로)
  const state = sync.loadState(path.join(rootDir, cfg.paths.raw));
  for (const [pageId, entry] of Object.entries(state.pages || {})) {
    const isMeta = pageId === id;
    const isSource = entry.sourceId && config.normalizeId(entry.sourceId) === id;
    if (!isMeta && !isSource) continue;
    const parts = String(entry.path || '').split('/');
    return {
      metaId: pageId, bodyId: entry.sourceId ? config.normalizeId(entry.sourceId) : pageId,
      service: parts[1], category: parts[2], title: entry.title,
      sourceUrl: null, registryUrl: null, from: 'sync-state',
    };
  }
  if (!serviceSlug || !categorySlug) {
    throw new Error(`이 페이지는 raw 미러에 없다 (${id}). --service 와 --category 를 함께 준다 — 초안 파일과 미러 경로를 정하는 데 필요하다.`);
  }
  return { metaId: id, bodyId: id, service: serviceSlug, category: categorySlug, title: null, sourceUrl: null, registryUrl: null, from: 'flags' };
}

function publishedWikiIds(cfg, rootDir) {
  const file = path.join(rootDir, cfg.paths.wiki, '.publish-state.json');
  if (!fs.existsSync(file)) return new Set();
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(Object.values(s.pages || {}).map((p) => config.normalizeId(p.id)).filter(Boolean));
  } catch { return new Set(); }
}

// 페이지 객체(+본문)를 받아 거부 사유를 돌려준다. 없으면 null.
function refuseReason({ cfg, rootDir, metaPage, bodyPage, markdown }) {
  const wikiIds = publishedWikiIds(cfg, rootDir);
  for (const p of [metaPage, bodyPage].filter(Boolean)) {
    const id = config.normalizeId(p.id);
    if (p.in_trash) return '중단: 대상 페이지가 휴지통에 있습니다.';
    if (id === cfg.wiki.rootPageId || wikiIds.has(id) || (p.parent && p.parent.page_id && config.normalizeId(p.parent.page_id) === cfg.wiki.rootPageId)) {
      return '중단: 대상 페이지가 위키 루트 아래입니다. 위키 페이지는 publish 가 관리합니다 — 원본을 고치고 ingest 를 다시 하세요.';
    }
  }
  const meta = metaLib.extractMeta(metaPage, cfg);
  if (meta.sensitivity && (cfg.sync.sensitiveValues || []).includes(meta.sensitivity)) {
    return '중단: 대상 페이지의 비밀등급이 "민감" 입니다. 이 스킬은 민감 페이지를 다루지 않습니다.';
  }
  if (meta.status === '폐기') {
    return '중단: 대상 페이지의 상태가 "폐기" 입니다. 사람이 Notion 에서 상태를 되돌린 뒤에 고치세요.';
  }
  if (markdown !== undefined && markdown !== null && CHILD_TAG_RE.test(String(markdown))) {
    return '중단: 대상 페이지가 하위 페이지·데이터베이스를 갖고 있어 본문을 교체하면 함께 지워집니다 (Notion API 제약). Notion 에서 직접 고치세요.';
  }
  return null;
}

function staleReason(base, current) {
  if (!base) return null;
  if (base === current) return null;
  return `중단: 원본이 초안을 만든 뒤에 수정됐습니다 (초안 기준 ${base}, 현재 ${current}). draft-pull 로 다시 받아 고치세요. 아무것도 쓰지 않았습니다.`;
}

module.exports = { resolveTarget, refuseReason, staleReason, publishedWikiIds, CHILD_TAG_RE };
