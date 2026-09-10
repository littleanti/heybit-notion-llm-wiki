'use strict';
// 파일명 규칙: docs/DESIGN.md 8절

const MAX_TITLE_CHARS = 60;

function sanitizeTitle(title) {
  let s = String(title || '').normalize('NFC');
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  s = s.replace(/[\s/\\:*?"<>|#%&{}$!'`@+=,;\[\]()]+/g, '-');
  s = s.replace(/\.+/g, '.');
  s = s.replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  s = Array.from(s).slice(0, MAX_TITLE_CHARS).join('').replace(/[-.]+$/g, '');
  return s || 'untitled';
}

function shortId(notionId) {
  const hex = String(notionId).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`slug: Notion id 형식이 아니다: ${notionId}`);
  return hex.slice(0, 6);
}

function rawFileName(title, notionId) {
  return `${sanitizeTitle(title)}-${shortId(notionId)}.md`;
}

const SLUG_RE = /^[a-z0-9-]+$/;

module.exports = { sanitizeTitle, shortId, rawFileName, SLUG_RE, MAX_TITLE_CHARS };
