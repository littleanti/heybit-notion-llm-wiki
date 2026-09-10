'use strict';
// 초안 파일 읽기·쓰기·검증 — 형식의 정본은 docs/DESIGN.md 10.3~10.5.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { frontmatter: fm, slug } = require('./shared');
const templates = require('./doc-templates');

// DESIGN 10.3 의 키 순서. 없는 키는 쓰지 않는다.
const KEY_ORDER = [
  'kind', 'service', 'category', 'title', 'doc_type', 'status', 'author_type', 'owner', 'summary',
  'keywords', 'tags', 'review_by', 'verified_at', 'sensitivity', 'exclude', 'related', 'drafted_at',
  'target_meta_id', 'target_body_id', 'source_url', 'registry_url', 'base_last_edited_time', 'base_hash',
];
const KINDS = ['new', 'edit'];
const REQUIRED = [['title', '제목'], ['doc_type', '문서유형'], ['status', '상태'], ['summary', '요약'], ['owner', '담당자']];
const SUMMARY_MAX = 120;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const H2_RE = /^##\s+(.+?)\s*$/;

function stripComments(text) {
  return String(text || '').replace(/<!--[\s\S]*?-->/g, '');
}

// 본문 동일성 판정의 기준. 끝의 빈 줄 차이는 무시한다 (파일 저장 때 개행이 붙는다).
function normalizeBody(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

function bodyHash(text) {
  return crypto.createHash('sha256').update(normalizeBody(text), 'utf8').digest('hex');
}

// 본문을 H2 단위로 나눈다. 첫 H2 앞의 글은 preamble 로 둔다.
function splitSections(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let preamble = [];
  let cur = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = inFence ? null : H2_RE.exec(line);
    if (m) {
      if (cur) sections.push(cur);
      cur = { name: m[1].trim(), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  if (cur) sections.push(cur);
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((s, i) => ({ name: s.name, index: i, content: s.lines.join('\n').trim() })),
  };
}

function readDraft(file) {
  const text = fs.readFileSync(file, 'utf8');
  let data = {};
  let body = text;
  let parseError = null;
  try {
    const parsed = fm.split(text);
    data = parsed.data || {};
    body = parsed.body || '';
  } catch (err) {
    parseError = err.message;
  }
  return { file, text, data, body, parseError, ...splitSections(body) };
}

function orderedFrontmatter(data) {
  const out = {};
  for (const k of KEY_ORDER) if (data[k] !== undefined) out[k] = data[k];
  for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k]; // 알 수 없는 키도 잃지 않는다
  return out;
}

function writeDraft(file, data, body) {
  const text = fm.join(orderedFrontmatter(data), body.endsWith('\n') ? body : `${body}\n`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return text;
}

function draftPath(cfg, rootDir, { service, category, title, targetId = null }) {
  const name = targetId ? `${slug.sanitizeTitle(title)}-${slug.shortId(targetId)}.md` : `${slug.sanitizeTitle(title)}.md`;
  return path.join(rootDir, cfg.paths.drafts, service, category, name);
}

function relDraftPath(cfg, rootDir, file) {
  return path.relative(rootDir, file).split(path.sep).join('/');
}

// DESIGN 10.5 — 등급이 둘인 항목은 kind 로 갈린다.
function validate({ cfg, draft, today }) {
  const errors = [];
  const warnings = [];
  const E = (code, message) => errors.push({ code, message });
  const W = (code, message) => warnings.push({ code, message });
  const d = draft.data || {};

  if (draft.parseError) {
    E('draft-frontmatter-invalid', `frontmatter 를 읽을 수 없다: ${draft.parseError}`);
    return { errors, warnings };
  }
  if (!KINDS.includes(d.kind)) {
    E('draft-frontmatter-invalid', `kind 가 ${KINDS.join('|')} 가 아니다: ${d.kind === undefined ? '(없음)' : d.kind}`);
    return { errors, warnings };
  }
  const isNew = d.kind === 'new';

  const service = (cfg.services || []).find((s) => s.slug === d.service);
  const category = (cfg.categories || []).find((c) => c.slug === d.category);
  if (!service) E('draft-scope-unknown', `service slug 가 설정에 없다: ${d.service === undefined ? '(없음)' : d.service}`);
  if (!category) E('draft-scope-unknown', `category slug 가 설정에 없다: ${d.category === undefined ? '(없음)' : d.category}`);

  for (const [key, label] of REQUIRED) {
    const v = d[key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) E('draft-meta-missing', `${label}(${key}) 이 비어 있다 — 사람에게 물어서 채운다`);
  }

  const allowed = [
    ['doc_type', 'docType', '문서유형'],
    ['status', 'status', '상태'],
    ['author_type', 'authorType', '작성주체'],
    ['sensitivity', 'sensitivity', '비밀등급'],
  ];
  for (const [key, valuesKey, label] of allowed) {
    const v = d[key];
    const list = (cfg.values || {})[valuesKey];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(list) && list.length && !list.includes(v)) {
      E('draft-value-invalid', `${label}(${key}) 값이 설정 허용값 밖이다: ${v} (허용: ${list.join(', ')})`);
    }
  }

  if (typeof d.summary === 'string' && Array.from(d.summary).length > SUMMARY_MAX) {
    E('draft-summary-long', `요약이 ${Array.from(d.summary).length}자다 — ${SUMMARY_MAX}자 이내로 (색인 한 줄이 이것으로 만들어진다)`);
  }

  for (const key of ['review_by', 'verified_at']) {
    const v = d[key];
    if (v === undefined || v === null || v === '') continue;
    if (!DATE_RE.test(String(v))) E('draft-date-invalid', `${key} 가 YYYY-MM-DD 형식이 아니다: ${v}`);
  }

  const bodyText = stripComments(draft.body).trim();
  if (!bodyText) E('draft-body-empty', '본문이 없다');

  if (isNew && d.status !== undefined && d.status !== '초안') {
    E('draft-status-not-draft', `신규 페이지는 "초안" 으로만 만든다 (현재 ${d.status}). Notion 에서 담당자가 확인한 뒤 상태를 올린다 (DESIGN 1.4)`);
  }

  if (!isNew) {
    if (!d.target_body_id) E('draft-target-missing', 'target_body_id 가 없다 — draft-pull 로 만든 초안이어야 한다');
    if (!d.base_last_edited_time) E('draft-target-missing', 'base_last_edited_time 이 없다 — draft-pull 로 다시 받는다');
  }

  // 섹션: 필수 목록의 존재와 상대 순서
  const known = templates.SECTIONS[d.doc_type];
  if (known) {
    const names = draft.sections.map((s) => s.name);
    const missing = known.filter((n) => !names.includes(n));
    const report = isNew ? E : W;
    for (const n of missing) report('draft-section-missing', `\`## ${n}\` 이 없다 (${d.doc_type} 의 필수 섹션)`);
    const present = known.filter((n) => names.includes(n));
    const positions = present.map((n) => names.indexOf(n));
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] < positions[i - 1]) {
        report('draft-section-missing', `\`## ${present[i]}\` 이 \`## ${present[i - 1]}\` 보다 앞에 있다 — DESIGN 10.4 의 순서를 따른다`);
        break;
      }
    }
    for (const s of draft.sections) {
      if (!known.includes(s.name)) continue;
      if (!stripComments(s.content).trim()) W('draft-section-empty', `\`## ${s.name}\` 이 비었다 — 없으면 "없음" 이라고 쓴다`);
    }
  }

  // 변경 이력: 오늘 날짜 항목. 수정 초안에서 **본문이 그대로면** 기록할 변경이 없으므로 요구하지 않는다
  // (속성만 바뀐 경우는 Notion 자체 속성 이력이 남긴다).
  const bodyUntouched = !isNew && Boolean(d.base_hash) && bodyHash(draft.body) === d.base_hash;
  const history = draft.sections.find((s) => s.name === '변경 이력');
  if (bodyUntouched) return { errors, warnings };
  const todayRe = new RegExp(`^\\s*-\\s*${String(today).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm');
  if (!history) {
    if (known) { /* draft-section-missing 이 이미 보고했다 */ } else E('draft-history-missing', '`## 변경 이력` 섹션이 없다');
  } else if (!todayRe.test(history.content)) {
    E('draft-history-missing', `\`## 변경 이력\` 에 오늘(${today}) 항목이 없다 — \`- ${today} (이름) 무엇을 바꿨나\` 를 추가한다`);
  }

  return { errors, warnings };
}

function formatIssues(issues, prefix) {
  return issues.map((i) => `${prefix} ${i.code}: ${i.message}`);
}

module.exports = {
  KEY_ORDER, KINDS, REQUIRED, SUMMARY_MAX, DATE_RE,
  stripComments, normalizeBody, bodyHash, splitSections, readDraft, writeDraft, orderedFrontmatter, draftPath, relDraftPath, validate, formatIssues,
};
