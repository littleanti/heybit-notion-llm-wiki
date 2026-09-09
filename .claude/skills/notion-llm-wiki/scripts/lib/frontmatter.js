'use strict';
// YAML 부분집합: 스칼라(문자열·숫자·불리언·null), 스칼라 배열(인라인), 평면 객체 배열(블록), 평면 객체(블록).
// 이 밖의 YAML 은 의도적으로 지원하지 않는다 (docs/TRD.md 3절).

const RESERVED = new Set(['null', '~', 'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n']);

function needsQuote(s, flow) {
  if (s === '') return true;
  if (s !== s.trim()) return true;
  if (RESERVED.has(s.toLowerCase())) return true;
  if (/^[-+]?(\d[\d_]*)?(\.\d+)?([eE][-+]?\d+)?$/.test(s) && /\d/.test(s)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (/: |\s#|[\n\r\t]/.test(s)) return true;
  if (s.endsWith(':')) return true;
  if (flow && /[,[\]{}]/.test(s)) return true;
  return false;
}

function quote(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

function scalar(v, flow) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`frontmatter: 유한하지 않은 숫자 ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return needsQuote(v, flow) ? quote(v) : v;
  throw new Error(`frontmatter: 지원하지 않는 스칼라 타입 ${typeof v}`);
}

function isScalar(v) {
  return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);
}

function isFlatObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isScalar);
}

function flowMap(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `${scalar(k, true)}: ${scalar(v, true)}`);
  return `{ ${parts.join(', ')} }`;
}

function stringify(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (isScalar(value)) {
      lines.push(`${key}: ${scalar(value)}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${key}: []`);
      else if (value.every(isScalar)) lines.push(`${key}: [${value.map((v) => scalar(v, true)).join(', ')}]`);
      else if (value.every(isFlatObject)) {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${flowMap(item)}`);
      } else throw new Error(`frontmatter: 배열 "${key}" 는 스칼라만 또는 평면 객체만 담아야 한다`);
    } else if (isFlatObject(value)) {
      if (Object.keys(value).length === 0) lines.push(`${key}: {}`);
      else {
        lines.push(`${key}:`);
        for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${scalar(v)}`);
      }
    } else throw new Error(`frontmatter: 키 "${key}" 의 값은 지원하지 않는 형태다`);
  }
  return lines.join('\n') + '\n';
}

// ---- parse ----

function parseQuoted(s) {
  // s 는 " 또는 ' 로 시작. 닫는 따옴표까지 소비하고 [값, 남은 문자열] 반환
  const q = s[0];
  let out = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (q === '"' && c === '\\') {
      const n = s[i + 1];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      i++;
      continue;
    }
    if (c === q) {
      if (q === "'" && s[i + 1] === "'") { out += "'"; i++; continue; }
      return [out, s.slice(i + 1)];
    }
    out += c;
  }
  throw new Error(`frontmatter: 닫히지 않은 따옴표: ${s}`);
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s[0] === '"' || s[0] === "'") {
    const [v, rest] = parseQuoted(s);
    if (rest.trim() !== '') throw new Error(`frontmatter: 따옴표 뒤에 잉여 문자: ${s}`);
    return v;
  }
  if (/^[-+]?\d+$/.test(s) && !/^[-+]?0\d/.test(s)) return Number(s);
  if (/^[-+]?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

function splitFlow(inner) {
  // 최상위 콤마로 분리 (따옴표·중첩 괄호 존중)
  const items = [];
  let depth = 0, cur = '', q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') { cur += inner[++i]; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') items.push(cur);
  return items.map((x) => x.trim()).filter((x) => x !== '');
}

function parseFlowValue(s) {
  const t = s.trim();
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new Error(`frontmatter: 닫히지 않은 배열: ${t}`);
    return splitFlow(t.slice(1, -1)).map(parseFlowValue);
  }
  if (t.startsWith('{')) {
    if (!t.endsWith('}')) throw new Error(`frontmatter: 닫히지 않은 객체: ${t}`);
    const obj = {};
    for (const part of splitFlow(t.slice(1, -1))) {
      const [k, v] = splitKeyValue(part);
      obj[k] = parseFlowValue(v);
    }
    return obj;
  }
  return parseScalar(t);
}

function splitKeyValue(line) {
  // "key: value" — 키는 따옴표 없는 단순 식별자 또는 따옴표 문자열
  let key, rest;
  if (line[0] === '"' || line[0] === "'") {
    [key, rest] = parseQuoted(line);
    rest = rest.trim();
    if (!rest.startsWith(':')) throw new Error(`frontmatter: 키 뒤에 ':' 가 없다: ${line}`);
    rest = rest.slice(1);
  } else {
    const m = /^([^:]+?):(\s|$)(.*)$/s.exec(line);
    if (!m) throw new Error(`frontmatter: "key: value" 형식이 아니다: ${line}`);
    key = m[1].trim();
    rest = m[3];
  }
  return [key, rest];
}

function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const obj = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }
    if (/^\s/.test(line)) throw new Error(`frontmatter: 예상치 못한 들여쓰기 (${i + 1}행): ${line}`);
    const [key, rest] = splitKeyValue(line);
    if (rest.trim() !== '') {
      obj[key] = parseFlowValue(rest);
      i++;
      continue;
    }
    // 블록: 다음 들여쓴 줄들
    const block = [];
    i++;
    while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === '')) {
      if (lines[i].trim() !== '') block.push(lines[i]);
      i++;
    }
    if (block.length === 0) { obj[key] = null; continue; }
    if (block.every((l) => /^\s+-\s/.test(l))) {
      obj[key] = block.map((l) => parseFlowValue(l.replace(/^\s+-\s/, '')));
    } else if (block.every((l) => !/^\s+-\s/.test(l))) {
      const sub = {};
      for (const l of block) {
        const [k, v] = splitKeyValue(l.trim());
        sub[k] = parseFlowValue(v);
      }
      obj[key] = sub;
    } else throw new Error(`frontmatter: 키 "${key}" 의 블록이 배열과 객체를 섞었다`);
  }
  return obj;
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

function split(markdown) {
  const text = markdown.replace(/\r\n/g, '\n');
  const m = FM_RE.exec(text);
  if (!m) return { data: null, body: text };
  return { data: parse(m[1]), body: text.slice(m[0].length).replace(/^\n/, '') };
}

function join(data, body) {
  return `---\n${stringify(data)}---\n\n${body.replace(/^\n+/, '')}`;
}

module.exports = { stringify, parse, split, join, needsQuote };
