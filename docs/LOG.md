# LOG — 변경 이력 (Changelog)

- 문서 역할: **무엇이 언제 바뀌었는가**
- 규칙: [`CLAUDE.md`](../CLAUDE.md) 그라운드 룰 2. **최신 항목을 맨 위**에 둔다.
  태그(`[feat]`/`[fix]`/`[test]`/`[docs]`/`[chore]`), 변경 파일 경로, 상태(`진행중`/`완료`)를 함께 적는다.
  날짜는 **절대 날짜**로 기록한다.
- 검증 정책: 매 변경마다 검증하지 않는다. 마일스톤·커밋 직전·회귀 위험이 큰 변경에만 실행하고,
  **실행하지 않았으면 "검증 비대상/미실행"으로 적는다.** 통과하지 못한 항목은 `완료`로 적지 않는다.
- 관련 문서: [PRD](./PRD.md) · [TRD](./TRD.md) · [DESIGN](./DESIGN.md) · [PLAN](./PLAN.md)

---

## 2026-09-09

### `[docs]` P0 — CLAUDE.md 및 문서 0.1 초안 · 상태: `완료`

**내용**: 코드를 쓰기 전에 그라운드 룰과 5개 문서 초안을 작성했다. 자매 저장소
`heybit-dynamic-sample` 과 같은 문서 체계(PRD·TRD·DESIGN·PLAN·LOG)를 쓴다.

**사용자에게 확인한 결정** (문서화 전에 두 차례 질문)

| 질문 | 답 | 반영 위치 |
|---|---|---|
| 위키는 어디에 존재하나 | **Notion 안에 위키 페이지** | PRD 1·7절, TRD ADR-001 |
| 검색·생성 주체 | **Claude Code**. 별도 LLM 엔드포인트 없음. **고도화된 스킬**로 만든다 | PRD FR3·FR4·FR7, TRD 3.2·ADR-008 |
| 범위 | 문서 + 샘플 위키 데이터 + **Notion→Markdown 동기화 스크립트** | PLAN P3 |
| 샘플 데이터 | **가상 서비스명 + 가상 내용** | PRD DR6, PLAN P3 |
| Markdown→Notion 역방향 게시 | **포함** | PRD FR6, TRD 6.2 |
| meta 방식 | 신규 페이지는 **카테고리별 Notion DB 항목**, 기존 페이지는 **DB 에 등록 항목 추가(원본 유지)** | PRD FR1, DESIGN 1절, TRD ADR-003 |
| 규모 | **수십~수백 페이지** | TRD ADR-002 (단일 색인 + 임계값) |
| 실 Notion 실측 | **불가 — fixture 테스트만** | PRD 6절, PLAN 진행 규칙 |

**변경 파일**
- `CLAUDE.md` (신규) — 사용자 제공 원문
- `docs/PRD.md` (신규) — 제품 정의, 배경(현재 Notion 구조 가정 · 문제 · LLM wiki 패턴), U1~U4, FR1~FR7, DR1~DR7, A1~A17, Out of scope 9항목
- `docs/TRD.md` (신규) — 아키텍처, **Notion API 문서 확인 사실 N1~N14**, 스킬 규약, 저장소 구조, 설정과 검증, 모듈 계약(sync·publish·md-notion·build-index·lint·client·mock), 테스트 T1~T16, **ADR-001~008**
- `docs/DESIGN.md` (신규) — Notion DB 스키마(속성 17개 · 필수 5개), 뷰, 레거시 등록 절차, AI 작성 규칙, 본문 템플릿 6종, 위키 페이지 4종 템플릿 + 상한, raw frontmatter, index/log 형식, 게시 트리·마커 문구, 답변 형식, 이름 규칙, 문구 정본
- `docs/PLAN.md` (신규) — P0~P9, 리스크
- `docs/LOG.md` (신규) — 이 문서

**이번 단계에서 실제로 확인한 것**

1. **Notion API 최신 사양을 공식 문서로 확인** (developers.notion.com, 2026-09-09). 결과가 초기 설계를 뒤집었다:
   - 1차 설계는 `GET /blocks/{id}/children` 재귀 + 블록↔Markdown 변환기 2개였다.
   - 확인 결과 Notion 은 **2026-02-26 부터 페이지 본문 Markdown 읽기/생성/통째 교체 엔드포인트**를 제공하고
     (`GET /pages/{id}/markdown`, `POST /pages` + `markdown`, `PATCH /pages/{id}/markdown` `replace_content`),
     최신 버전은 `2026-03-11` 이다. 블록 API 에는 "교체" 가 없어 흉내 내야 했던 문제도 함께 사라진다.
   - → **변환기 2개 → 정규화기 1개(표준 MD → enhanced MD, 게시 방향만)** 로 축소. 페이지당 호출 1회.
     상세는 [TRD ADR-006](./TRD.md#adr-006--본문-io-는-블록-api-가-아니라-markdown-엔드포인트).
   - 같은 조사에서 `2025-09-03` 의 **database → data source 분리**(`POST /databases/{id}/query` 폐기),
     `2026-03-11` 의 `archived → in_trash`, search 가 제목 일치만 한다는 점, rate limit ~3 rps 를 확인했다 (TRD 3.1 N1~N14).
2. **Claude Code 스킬 규약 확인** — `.claude/skills/<name>/SKILL.md`, frontmatter 필드, `$0`/`$ARGUMENTS`/`${CLAUDE_SKILL_DIR}`,
   서브커맨드는 공식 기능이 아님 → 단일 스킬 + `$0` 분기 채택 ([TRD ADR-008](./TRD.md#adr-008--스킬은-하나-서브커맨드는-인자로)).
3. **발견(discovery) 방식 재검토** — 블록 트리 순회 대신 `search` + `data_sources/{id}/query`.
   search 의 인덱스 지연은 문서화되어 있지 않아 **미확정**으로 남기고, 신규 페이지의 주 경로(DB 행)는
   지연이 없는 data source query 로 나열하도록 설계 ([TRD ADR-007](./TRD.md#adr-007--발견은-블록-트리-순회가-아니라-search--data-source-query)).

**검증**: 문서만 추가한 변경이므로 코드 검증은 **비대상**. 출구 조건은 실행해 확인했다 —
파일 6개 존재, 문서 간 상대 링크·앵커 65건을 스크립트(GitHub 앵커 규칙 근사)로 검사해 **실제 링크는 전부 해석됨**.
검사기가 지적한 3건은 DESIGN 의 형식 예시(`[제목](경로)` 같은 자리표시자)라 링크가 아니다.

**작성 시점의 미확정 항목** (숨기지 않고 명시)
- Notion API 의 모든 동작 — **실 워크스페이스 미실측**. 공식 문서 근거만 있다 (토큰 확보 후 해소).
- enhanced markdown 정규화기의 출력이 Notion 에서 의도대로 렌더되는지.
- `POST /search` 인덱스 지연의 실제 크기.
- 블록 교체 시 페이지 코멘트 유지 여부.
- 한국어 색인의 실제 토큰 수(300페이지 규모) — 샘플 30페이지로 측정해 외삽 예정.
- 스킬 `allowed-tools` 에서 `${CLAUDE_SKILL_DIR}` 치환 여부.
