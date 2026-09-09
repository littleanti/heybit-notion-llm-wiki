'use strict';
// 동기화 리포트 (docs/DESIGN.md 9절 문구 정본)

function summaryLine(r) {
  const excluded = r.excluded.length;
  const byReason = {};
  for (const e of r.excluded) byReason[e.reason] = (byReason[e.reason] || 0) + 1;
  const reasons = Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(', ');
  return `sync: 추가 ${r.added.length} · 변경 ${r.changed.length} · 이동 ${r.moved.length} · 삭제 ${r.deleted.length} · 제외 ${excluded}${excluded ? `(${reasons})` : ''} · 실패 ${r.failed.length} · 호출 ${r.calls}회 · ${(r.durationMs / 1000).toFixed(1)}초`;
}

function list(title, items, fmt) {
  if (!items.length) return `### ${title} (0)\n- 없음\n`;
  return `### ${title} (${items.length})\n${items.map((x) => `- ${fmt(x)}`).join('\n')}\n`;
}

function formatSyncReport(r) {
  const out = [];
  out.push(`# 동기화 리포트`);
  out.push('');
  out.push(`- 시각: ${r.syncedAt}`);
  out.push(`- 요약: ${summaryLine(r)}`);
  out.push(`- 범위: 서비스 ${r.services.join(', ')} · 발견 페이지 ${r.discovered} · 범위 밖 ${r.outOfScope} · 컨테이너(카테고리 페이지) ${r.containers} · 변경 없음(건너뜀) ${r.unchanged.length}`);
  out.push('');
  out.push(list('추가', r.added, (x) => `${x.path} — ${x.title}`));
  out.push(list('변경', r.changed, (x) => `${x.path} — ${x.title}`));
  out.push(list('이동', r.moved, (x) => `${x.from} → ${x.to}`));
  out.push(list('삭제', r.deleted, (x) => `${x.path} — ${x.reason}`));
  out.push(list('제외', r.excluded, (x) => `${x.title} — ${x.reason}`));
  out.push(list('실패', r.failed, (x) => `${x.title || x.id} — ${x.error}`));
  out.push(list('절단(truncated) · 미지원 블록', r.truncated, (x) => `${x.path} — truncated=${x.truncated}, unknown_blocks=${x.unknownBlocks}`));
  out.push(list('meta 없음 (등록 항목 필요)', r.metaMissing, (x) => `${x.path} — ${x.title}`));
  return out.join('\n');
}

function emptyReport() {
  return { added: [], changed: [], moved: [], deleted: [], excluded: [], failed: [], unchanged: [], truncated: [], metaMissing: [], services: [], discovered: 0, outOfScope: 0, containers: 0, calls: 0, durationMs: 0, syncedAt: null };
}

module.exports = { summaryLine, formatSyncReport, emptyReport };
