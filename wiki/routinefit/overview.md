---
title: 루틴핏 개요
type: overview
service: routinefit
summary: 루틴핏은 습관·운동 루틴 앱이다. 환불 기한 충돌 1건과 미확정 다수가 열려 있다.
keywords: [루틴핏, routinefit, 개요, 습관, 운동, 구독]
sources:
  - raw/routinefit/product-description/루틴핏-서비스-소개-555555.md
  - raw/routinefit/product-description/요금제와-구독-플랜-555555.md
  - raw/routinefit/product-planning/루틴핏-2026-하반기-로드맵-555555.md
  - raw/routinefit/product-planning/2025-루틴핏-기획-원칙-555555.md
  - raw/routinefit/product-dev/알림-발송-아키텍처-555555.md
  - raw/routinefit/product-dev/iOS-알림-미수신-장애-회고-2026-08-555555.md
  - raw/routinefit/cs/환불-처리-응대-가이드-555555.md
  - raw/routinefit/legal/구독-환불-규정-555555.md
  - raw/routinefit/misc/루틴핏-팀-위키-안내-777777.md
updated: 2026-09-09
---

## 이 서비스는

루틴핏은 습관과 운동 루틴을 만들고 이어가도록 돕는 iOS·Android 앱이다. 루틴을 등록하면 사용자가 정한 시각에 알림이 오고 기록은 한 번의 탭으로 끝난다. 웹 버전은 없다 — [루틴핏 서비스 소개](../../raw/routinefit/product-description/루틴핏-서비스-소개-555555.md).

- 무료 플랜은 루틴 3개까지, 프리미엄은 개수 제한이 없다. 프리미엄은 월 9,900원과 연 89,000원이다 — [요금제와 구독 플랜](../../raw/routinefit/product-description/요금제와-구독-플랜-555555.md)
- 2026 하반기는 스트릭 보호권·친구 챌린지·알림 안정화 3개 테마로 진행한다 — [루틴핏 2026 하반기 로드맵](../../raw/routinefit/product-planning/루틴핏-2026-하반기-로드맵-555555.md)
- 팀 문서는 카테고리 6개로 나눠 관리하고 2025년 이전 문서는 카테고리 페이지 직속으로 남아 있다 (meta 없음) — [루틴핏 팀 위키 안내](../../raw/routinefit/misc/루틴핏-팀-위키-안내-777777.md)

## 지금 알아야 할 것

최근 30일(2026-08-10 이후)에 바뀐 확정 사항이다.

1. 2026-09-01 — 구독 환불 기한이 7일에서 14일로 개정됐다 — [구독 환불 규정](../../raw/routinefit/legal/구독-환불-규정-555555.md)
2. 2026-09-01 — 요금제 문서에 환불 기준 14일이 반영됐다 — [요금제와 구독 플랜](../../raw/routinefit/product-description/요금제와-구독-플랜-555555.md)
3. 2026-08-30 — CS 환불 응대에 스토어 결제 확인 절차가 추가됐다. 이 문서의 기한은 여전히 7일이다 (충돌 → [충돌 · 미확정](conflicts.md)) — [환불 처리 응대 가이드](../../raw/routinefit/cs/환불-처리-응대-가이드-555555.md)
4. 2026-08-28 — 서비스 소개의 지원 환경과 요금제 안내 문구가 정리됐다 — [루틴핏 서비스 소개](../../raw/routinefit/product-description/루틴핏-서비스-소개-555555.md)
5. 2026-08-25 — 알림 발송 아키텍처에 2026-08 iOS 장애 결과가 반영됐다 — [알림 발송 아키텍처](../../raw/routinefit/product-dev/알림-발송-아키텍처-555555.md)

## 카테고리별 입구

| 카테고리 | 다이제스트 | 한 줄 |
|---|---|---|
| 상품기획 | [상품기획](digest/product-planning.md) | 하반기 로드맵 3개 테마와 스트릭 보호권·친구 챌린지 기획 |
| 상품설명 | [상품설명](digest/product-description.md) | 서비스 한 줄 정의, 지원 환경, 요금제 3종 |
| 상품개발 | [상품개발](digest/product-dev.md) | 하이브리드 알림 구조, 2026-08 iOS 장애, 데이터 보관 구현 |
| CS | [CS](digest/cs.md) | 환불·알림 미수신·계정 삭제 응대 기준 |
| 법무 | [법무](digest/legal.md) | 환불 규정 14일, 개인정보 처리방침 검토, 폐기된 약관 v3 |
| 마케팅 | [마케팅](digest/marketing.md) | 9월 프로모션 초안, 스토어 리뷰 답글 기준 |
| 기타 | [기타](digest/misc.md) | 팀 문서 체계 안내 (meta 없음) |

원본 전체 목록은 [색인](../index.md) 에 있다.

## 토픽

- [환불 정책](topics/refund-policy.md) — 법무·CS·상품설명·마케팅에 걸친 환불 기준. ⚠ 기한 충돌 있음 — [구독 환불 규정](../../raw/routinefit/legal/구독-환불-규정-555555.md)
- [알림 발송과 미수신](topics/notification-delivery.md) — 하이브리드 발송 구조, 2026-08 장애, CS 응대 — [iOS 알림 미수신 장애 회고 (2026-08)](../../raw/routinefit/product-dev/iOS-알림-미수신-장애-회고-2026-08-555555.md)
- [탈퇴 데이터 보관 기간](topics/data-retention.md) — 현행 30일과 7일 단축 검토안, CS 관행 — [구독 환불 규정](../../raw/routinefit/legal/구독-환불-규정-555555.md)
- [프리미엄 플랜과 가격](topics/premium-plan.md) — 플랜 3종, 프리미엄 전용 기능 후보, 9월 할인 초안 — [요금제와 구독 플랜](../../raw/routinefit/product-description/요금제와-구독-플랜-555555.md)

## 충돌 · 미확정

[충돌 · 미확정](conflicts.md) 에 모아 뒀다.

- 충돌 1건 — 전액 환불 기한 14일(법무) 대 7일(CS). 양쪽 모두 확정이다 — [구독 환불 규정](../../raw/routinefit/legal/구독-환불-규정-555555.md), [환불 처리 응대 가이드](../../raw/routinefit/cs/환불-처리-응대-가이드-555555.md)
- 정책 없는 응대 1건 · 검토기한 경과 1건 · meta 없음 2건 · 폐기됐지만 참조됨 1건
- 원본별 미확정 항목은 각 토픽의 `## 미확정` 에 모았다 — [2025 루틴핏 기획 원칙](../../raw/routinefit/product-planning/2025-루틴핏-기획-원칙-555555.md)
