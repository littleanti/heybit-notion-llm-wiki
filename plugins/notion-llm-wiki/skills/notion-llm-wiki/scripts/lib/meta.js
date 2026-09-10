'use strict';
// Notion properties ↔ 내부 meta ↔ raw frontmatter (docs/DESIGN.md 1절·4절)

const { normalizeId } = require('./config');

function plainText(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map((t) => t.plain_text ?? (t.text && t.text.content) ?? '').join('');
}

function propValue(prop) {
  if (!prop || !prop.type) return null;
  const t = prop.type;
  const v = prop[t];
  switch (t) {
    case 'title':
    case 'rich_text': {
      const s = plainText(v).trim();
      return s === '' ? null : s;
    }
    case 'select':
    case 'status':
      return v && v.name ? v.name : null;
    case 'multi_select':
      return Array.isArray(v) ? v.map((o) => o.name).filter(Boolean) : [];
    case 'date':
      return v && v.start ? v.start : null;
    case 'people':
      return Array.isArray(v) ? v.map((u) => u.name).filter(Boolean) : [];
    case 'checkbox':
      return Boolean(v);
    case 'url':
    case 'email':
    case 'phone_number':
      return v || null;
    case 'number':
      return typeof v === 'number' ? v : null;
    case 'relation':
      return Array.isArray(v) ? v.map((r) => normalizeId(r.id)).filter(Boolean) : [];
    case 'created_time':
    case 'last_edited_time':
      return v || null;
    case 'formula':
      return v && v[v.type] !== undefined && v[v.type] !== null ? (typeof v[v.type] === 'object' ? v[v.type].start || null : v[v.type]) : null;
    default:
      return null;
  }
}

const LIST_KEYS = new Set(['owner', 'keywords', 'tags', 'related']);

// Notion 페이지 객체의 properties 를 설정의 이름 매핑으로 읽는다. 없는 속성은 null (배열 키는 []).
function extractMeta(page, cfg) {
  const props = (page && page.properties) || {};
  const map = cfg.properties;
  const out = {};
  for (const [key, notionName] of Object.entries(map)) {
    let prop = props[notionName];
    if (!prop && key === 'title') prop = Object.values(props).find((p) => p && p.type === 'title');
    const val = propValue(prop);
    out[key] = LIST_KEYS.has(key) ? (Array.isArray(val) ? val : val === null ? [] : [val]) : val;
  }
  if (out.exclude === null) out.exclude = false;
  return out;
}

function isExcluded(meta, cfg) {
  if (meta.exclude === true) return { excluded: true, reason: '위키제외' };
  const sens = meta.sensitivity;
  if (sens && (cfg.sync.sensitiveValues || []).includes(sens)) return { excluded: true, reason: '민감' };
  if (!sens && cfg.sync.excludeWhenUnset) return { excluded: true, reason: '비밀등급 미지정' };
  return { excluded: false, reason: null };
}

// Notion URL 에서 page id 를 뽑는다. 마지막 32자리 16진수 덩어리를 쓴다.
function pageIdFromUrl(url) {
  if (!url) return null;
  const s = String(url).split('?')[0].split('#')[0];
  const matches = s.match(/[0-9a-fA-F]{32}/g);
  if (matches && matches.length) return normalizeId(matches[matches.length - 1]);
  const dashed = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g);
  return dashed && dashed.length ? normalizeId(dashed[dashed.length - 1]) : null;
}

// raw frontmatter — 키 순서 고정 (docs/DESIGN.md 4절)
function toRawFrontmatter(ctx) {
  const m = ctx.meta;
  return {
    notion_id: ctx.pageId,
    title: ctx.title,
    service: ctx.service.slug,
    service_name: ctx.service.name,
    category: ctx.category.slug,
    category_name: ctx.category.name,
    doc_type: m.docType ?? null,
    status: m.status ?? null,
    author_type: m.authorType ?? null,
    owner: m.owner || [],
    summary: m.summary ?? null,
    keywords: m.keywords || [],
    tags: m.tags || [],
    review_by: m.reviewBy ?? null,
    verified_at: m.verifiedAt ?? null,
    sensitivity: m.sensitivity ?? null,
    related: ctx.related || [],
    source_url: ctx.sourceUrl,
    registry_url: ctx.registryUrl ?? null,
    meta_source: ctx.metaSource,
    created_time: ctx.createdTime ?? null,
    last_edited_time: ctx.lastEditedTime ?? null,
    synced_at: ctx.syncedAt,
    notion_truncated: Boolean(ctx.truncated),
    notion_unknown_blocks: ctx.unknownBlocks || 0,
  };
}

const REQUIRED_META = ['title', 'doc_type', 'status', 'summary', 'owner'];

module.exports = { plainText, propValue, extractMeta, isExcluded, pageIdFromUrl, toRawFrontmatter, REQUIRED_META };
