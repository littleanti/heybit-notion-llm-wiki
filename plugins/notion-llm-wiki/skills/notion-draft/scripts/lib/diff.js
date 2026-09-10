'use strict';
// 줄 단위 diff (LCS). 의존성 0개 원칙이라 직접 쓴다. 순수 함수 — dry-run 검토용.

// 두 줄 배열의 최장 공통 부분수열로 편집 스크립트를 만든다.
function lineDiff(aText, bText) {
  const a = String(aText == null ? '' : aText).replace(/\r\n/g, '\n').split('\n');
  const b = String(bText == null ? '' : bText).replace(/\r\n/g, '\n').split('\n');
  const n = a.length;
  const m = b.length;
  // (n+1) x (m+1) LCS 길이 표. 초안은 수백 줄 규모라 이 크기로 충분하다.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ op: ' ', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { rows.push({ op: '-', text: a[i] }); i++; }
    else { rows.push({ op: '+', text: b[j] }); j++; }
  }
  while (i < n) rows.push({ op: '-', text: a[i++] });
  while (j < m) rows.push({ op: '+', text: b[j++] });
  return rows;
}

function counts(rows) {
  return {
    added: rows.filter((r) => r.op === '+').length,
    removed: rows.filter((r) => r.op === '-').length,
    same: rows.filter((r) => r.op === ' ').length,
  };
}

// 바뀐 줄 주변 context 줄만 보여 준다. 생략 구간은 "… N줄 생략 …" 으로 접는다.
function formatDiff(rows, { context = 2, maxWidth = 160 } = {}) {
  if (!rows.some((r) => r.op !== ' ')) return ''; // 바뀐 줄이 없으면 보여 줄 것이 없다
  const keep = new Set();
  rows.forEach((r, idx) => {
    if (r.op === ' ') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k++) keep.add(k);
  });
  const out = [];
  let skipped = 0;
  const flushSkip = () => {
    if (skipped) { out.push(`  … ${skipped}줄 생략 …`); skipped = 0; }
  };
  rows.forEach((r, idx) => {
    if (!keep.has(idx)) { skipped++; return; }
    flushSkip();
    const text = r.text.length > maxWidth ? `${r.text.slice(0, maxWidth)}…` : r.text;
    out.push(`${r.op} ${text}`);
  });
  flushSkip();
  return out.join('\n');
}

module.exports = { lineDiff, formatDiff, counts };
