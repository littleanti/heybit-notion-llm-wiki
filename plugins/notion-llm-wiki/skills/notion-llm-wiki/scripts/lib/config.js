'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SLUG_RE } = require('./slug');

const CONFIG_FILE = 'notion-wiki.config.json';

function normalizeId(id) {
  const hex = String(id || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validate(cfg) {
  const errors = [];
  if (!cfg.notionVersion) errors.push('notionVersion 이 없다');
  if (!Array.isArray(cfg.services) || cfg.services.length === 0) errors.push('services 가 비어 있다');
  if (!Array.isArray(cfg.categories) || cfg.categories.length === 0) errors.push('categories 가 비어 있다');
  const seen = new Set();
  for (const s of cfg.services || []) {
    if (!SLUG_RE.test(s.slug || '')) errors.push(`서비스 slug 형식 오류: ${s.slug}`);
    if (seen.has(`s:${s.slug}`)) errors.push(`서비스 slug 중복: ${s.slug}`);
    seen.add(`s:${s.slug}`);
    if (!normalizeId(s.rootPageId)) errors.push(`서비스 "${s.name}" 의 rootPageId 형식 오류`);
  }
  let fallbacks = 0;
  for (const c of cfg.categories || []) {
    if (!SLUG_RE.test(c.slug || '')) errors.push(`카테고리 slug 형식 오류: ${c.slug}`);
    if (seen.has(`c:${c.slug}`)) errors.push(`카테고리 slug 중복: ${c.slug}`);
    seen.add(`c:${c.slug}`);
    if (c.fallback) fallbacks++;
  }
  if (fallbacks !== 1) errors.push(`fallback 카테고리는 정확히 1개여야 한다 (현재 ${fallbacks})`);
  if (!cfg.wiki || !normalizeId(cfg.wiki.rootPageId)) errors.push('wiki.rootPageId 형식 오류');
  else {
    const wikiRoot = normalizeId(cfg.wiki.rootPageId);
    for (const s of cfg.services || []) {
      if (normalizeId(s.rootPageId) === wikiRoot) {
        errors.push(`설정 오류: wiki.rootPageId 가 서비스 "${s.name}" 의 루트와 같습니다. 위키가 자기 출력을 다시 수집하게 되므로 거부합니다.`);
      }
    }
  }
  if (!cfg.properties || !cfg.properties.title) errors.push('properties.title 매핑이 없다');
  if (errors.length) throw new Error(`설정 검증 실패 (${CONFIG_FILE}):\n- ${errors.join('\n- ')}`);
}

function loadConfig(rootDir) {
  const file = path.join(rootDir, CONFIG_FILE);
  if (!fs.existsSync(file)) throw new Error(`${CONFIG_FILE} 이 없습니다: ${file}`);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  validate(cfg);
  cfg.services = cfg.services.map((s) => ({ ...s, rootPageId: normalizeId(s.rootPageId) }));
  cfg.wiki.rootPageId = normalizeId(cfg.wiki.rootPageId);
  cfg.sync = { sensitiveValues: ['민감'], excludeWhenUnset: false, rps: 3, ...(cfg.sync || {}) };
  cfg.paths = { raw: 'raw', wiki: 'wiki', ...(cfg.paths || {}) };
  cfg.values = cfg.values || {};
  cfg.rootDir = rootDir;
  return cfg;
}

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

function loadEnv(rootDir, env = process.env) {
  const file = path.join(rootDir, '.env');
  const fromFile = fs.existsSync(file) ? parseDotEnv(fs.readFileSync(file, 'utf8')) : {};
  return { ...fromFile, ...env };
}

function requireToken(env, command) {
  const token = env.NOTION_TOKEN && String(env.NOTION_TOKEN).trim();
  if (!token) {
    throw new Error(`NOTION_TOKEN 이 없습니다. .env 에 설정하세요 (.env.example 참고). 이 명령(${command})은 토큰이 필요합니다.`);
  }
  return token;
}

function categoryByName(cfg, name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return cfg.categories.find((c) => c.name.toLowerCase() === n || (c.aliases || []).some((a) => a.toLowerCase() === n)) || null;
}

function fallbackCategory(cfg) {
  return cfg.categories.find((c) => c.fallback);
}

function serviceByRootId(cfg, id) {
  const n = normalizeId(id);
  return cfg.services.find((s) => s.rootPageId === n) || null;
}

module.exports = { loadConfig, validate, loadEnv, parseDotEnv, requireToken, normalizeId, categoryByName, fallbackCategory, serviceByRootId, CONFIG_FILE };
