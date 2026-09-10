'use strict';
// 표준 Markdown → Notion enhanced Markdown 정규화 (docs/TRD.md 6.3). 순수 함수 — 골든 테스트로 고정한다.
// 실 Notion 렌더는 미실측이다. 규칙이 틀렸다면 골든도 함께 틀리다는 한계를 문서에 남겼다.

const ESCAPE_RE = /[<>{}$^|[\]]/g;
// Notion 페이지 URL (32자리 16진수 id 를 담은 주소).
// 호스트는 세 가지를 받는다 — **현재 Notion 의 "링크 복사" 는 `app.notion.com/p/<id>` 를 준다** (2026-09-10 실측).
// notion.so 만 보던 정규식 때문에 실제 URL 이 멘션으로 바뀌지 않는 결함이 있었다.
const NOTION_URL_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?notion\.(?:so|site|com)\/[^\s)]*[0-9a-fA-F]{32}/;

function escapeText(s) {
  // 텍스트 런: 태그·괄호·수식·표 구분자·대괄호를 이스케이프. `*`·`_`·`` ` `` 는 마크다운 서식이므로 둔다.
  return s.replace(ESCAPE_RE, (c) => `\\${c}`).replace(/(^|[^~])~(?!~)/g, '$1\\~');
}

// 인라인: 코드 스팬과 링크를 토큰으로 떼어 낸 뒤 나머지 텍스트만 이스케이프한다.
function inline(text, ctx) {
  let out = '';
  let i = 0;
  const re = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(text))) {
    out += escapeText(text.slice(i, m.index));
    if (m[1] !== undefined) {
      out += m[0]; // 코드 스팬 그대로
    } else {
      const isImage = m[0].startsWith('!');
      const label = m[3];
      const href = m[4];
      if (isImage) out += `![${escapeText(label)}](${href})`;
      else if (ctx.mentionLinks && NOTION_URL_RE.test(href)) out += `<mention-page url="${href}">${escapeText(label)}</mention-page>`;
      else if (/^(https?:|mailto:)/.test(href)) out += `[${escapeText(label)}](${href})`;
      else {
        const resolved = ctx.resolveLink ? ctx.resolveLink(href) : null;
        if (resolved) out += `[${escapeText(label)}](${resolved})`;
        else { ctx.unresolved.push(href); out += escapeText(label); }
      }
    }
    i = m.index + m[0].length;
  }
  out += escapeText(text.slice(i));
  return out;
}

function splitCells(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (t[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isSeparatorRow(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

function tableBlock(rows, ctx) {
  const header = rows.length > 1 && isSeparatorRow(rows[1]);
  const dataRows = header ? [rows[0], ...rows.slice(2)] : rows;
  const out = [`<table header-row="${header ? 'true' : 'false'}">`];
  for (const r of dataRows) {
    out.push('\t<tr>');
    for (const c of splitCells(r)) out.push(`\t\t<td>${inline(c, ctx)}</td>`);
    out.push('\t</tr>');
  }
  out.push('</table>');
  return out.join('\n');
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

function toEnhancedMarkdown(markdown, opts = {}) {
  // mentionLinks: Notion 페이지 링크를 <mention-page> 로 바꾼다 (작성 스킬용). 기본값 false — 위키 게시 출력은 그대로다
  const ctx = { resolveLink: opts.resolveLink || null, mentionLinks: Boolean(opts.mentionLinks), unresolved: [] };
  const lines = markdown.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let i = 0;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) { out.push(inline(paragraph.join(' '), ctx)); paragraph = []; }
  };

  const TAG_OPEN = /^\s*<([a-z][a-z_-]*)(\s[^>]*)?>\s*$/;
  while (i < lines.length) {
    const line = lines[i];
    const open = TAG_OPEN.exec(line);
    if (open) {
      // 이미 enhanced 태그 블록(callout, table, details …)이면 닫는 태그까지 그대로 통과시킨다
      flushParagraph();
      const name = open[1];
      const close = new RegExp(`^\\s*</${name}>\\s*$`);
      out.push(line.trim());
      i++;
      while (i < lines.length && !close.test(lines[i])) out.push(lines[i++]);
      if (i < lines.length) out.push(lines[i++].trim());
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushParagraph();
      const fence = [line.trim()];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) fence.push(lines[i++]);
      fence.push('```');
      i++;
      out.push(fence.join('\n'));
      continue;
    }
    if (line.trim() === '') { flushParagraph(); i++; continue; }
    if (/^\s*\|/.test(line)) {
      flushParagraph();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      out.push(tableBlock(rows, ctx));
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const parts = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) parts.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`> ${parts.map((p) => inline(p, ctx)).join('<br>')}`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushParagraph();
      const level = Math.min(h[1].length, 4);
      out.push(`${'#'.repeat(level)} ${inline(h[2], ctx)}`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushParagraph(); out.push('---'); i++; continue; }
    if (/^\s*<[a-z_-]+[\s>]/.test(line) || /^\s*<\/[a-z_-]+>/.test(line) || /^\s*<[a-z_-]+\/>/.test(line)) {
      // 이미 enhanced 태그인 줄(callout, table, mention 등)은 그대로 둔다
      flushParagraph();
      out.push(line);
      i++;
      continue;
    }
    const l = LIST_RE.exec(line);
    if (l) {
      flushParagraph();
      const depth = Math.floor(l[1].replace(/\t/g, '  ').length / 2);
      const marker = /\d/.test(l[2]) ? l[2].replace(')', '.') : '-';
      const todo = l[3] ? `[${l[3].trim()[1] === ' ' ? ' ' : 'x'}] ` : '';
      out.push(`${'\t'.repeat(depth)}${marker} ${todo}${inline(l[4], ctx)}`);
      i++;
      continue;
    }
    if (/^\s{2,}\S/.test(line) && out.length && /^\t*(-|\d+\.)\s/.test(out[out.length - 1])) {
      // 목록 항목의 연속 줄 → 하위 문단(탭 들여쓰기)
      const depth = Math.floor(line.match(/^\s*/)[0].replace(/\t/g, '  ').length / 2);
      out.push(`${'\t'.repeat(Math.max(depth, 1))}${inline(line.trim(), ctx)}`);
      i++;
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return { markdown: out.join('\n'), unresolved: ctx.unresolved };
}

function callout(text, { icon = '🤖', color = 'gray_bg' } = {}) {
  return `<callout icon="${icon}" color="${color}">\n\t${text}\n</callout>`;
}

module.exports = { toEnhancedMarkdown, escapeText, inline, callout, splitCells, NOTION_URL_RE };
