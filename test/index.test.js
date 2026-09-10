'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, FIXED_NOW } = require('./helpers/sync-harness');
const { loadConfig } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const { buildIndex } = require('../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/build-index');

const cfg = loadConfig(REPO_ROOT);
const GOLDEN = path.join(REPO_ROOT, 'test', 'golden', 'index.md');

test('T9 index: 샘플 raw+wiki 로 만든 색인이 골든과 일치하고 두 번 만들어도 같다', () => {
  const a = buildIndex({ cfg, rootDir: REPO_ROOT, nowIso: FIXED_NOW, write: false });
  const b = buildIndex({ cfg, rootDir: REPO_ROOT, nowIso: FIXED_NOW, write: false });
  assert.equal(a.text, b.text, '결정적이어야 한다');
  assert.ok(fs.existsSync(GOLDEN), 'test/golden/index.md 가 없다 — node test/helpers/generate-golden.js 실행');
  assert.equal(a.text, fs.readFileSync(GOLDEN, 'utf8'));
});

test('T9 index: 한 줄 형식 — 상태 표기·meta 없음·검토기한 경과 마커', () => {
  const { text, counts } = buildIndex({ cfg, rootDir: REPO_ROOT, nowIso: FIXED_NOW, write: false });
  assert.ok(counts.raw >= 12);
  assert.match(text, /^# 색인\n/);
  assert.match(text, new RegExp(`^- 동기화: 2026-09-09T01:00:00.000Z · raw ${counts.raw} · wiki ${counts.wiki}$`, 'm'));
  assert.equal(text.includes('생성:'), false, '색인은 벽시계를 담지 않는다 (CI 가 재생성해 diff 를 비교한다)');
  assert.match(text, /검토기한 경과\(2026-09-09 기준\)/);
  const other = buildIndex({ cfg, rootDir: REPO_ROOT, nowIso: '2030-01-01T00:00:00.000Z', write: false });
  assert.equal(other.text, text, '실행 시각이 달라도 출력이 같다');
  assert.match(text, /^### 루틴핏 \/ CS$/m);
  assert.match(text, /^- ⚠ \[2025 CS 응대 원칙\]\(\.\.\/raw\/routinefit\/cs\/[^)]+\) · meta 없음 · 2025-11-20/m);
  assert.match(text, /^- \[환불 처리 응대 가이드\]\(\.\.\/raw\/routinefit\/cs\/[^)]+\) · FAQ·응대 · 확정 · 김하늘 · 2026-08-30 — .+ · 키워드: .*환불/m);
  assert.match(text, /\[2025 루틴핏 기획 원칙\]\([^)]+\) · 정책·규정 · 확정 ⏰ · 이도윤/);
  assert.match(text, /\[알림이 안 와요 응대\]\([^)]+\) · FAQ·응대 · \(초안\) · 박서준/);
  assert.equal(text.includes('VIP 고객'), false, '민감 페이지는 색인에 없다');
  assert.equal(text.includes('마케팅팀 개인 메모'), false, '위키제외 페이지는 색인에 없다');
});

test('T9 index: 서비스 → 카테고리 → 제목 순으로 정렬된다', () => {
  const { text } = buildIndex({ cfg, rootDir: REPO_ROOT, nowIso: FIXED_NOW, write: false });
  const headers = [...text.matchAll(/^### (.+)$/gm)].map((m) => m[1]).filter((h) => h.includes(' / '));
  const rank = (h) => {
    const [s, c] = h.split(' / ');
    return cfg.services.findIndex((x) => x.name === s) * 100 + cfg.categories.findIndex((x) => x.name === c);
  };
  for (let i = 1; i < headers.length; i++) assert.ok(rank(headers[i - 1]) < rank(headers[i]), `${headers[i - 1]} → ${headers[i]}`);
});
