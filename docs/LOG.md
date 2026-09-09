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

### `[docs]` P8 — README · 문서 마감 · Acceptance 일괄 · 상태: `진행중`

**착수 예정** (P6 ingest 에이전트 실행 대기 중 README 초안 먼저):
- `README.md` — 이 저장소가 답하는 세 질문(작성 규약 / 위키 구조 / 운영), 흐름도, 샘플 둘러보기, 구조, 설치(Notion 연결 절차 포함), 설정, 스킬 서브커맨드 5개, 실무자 안내, 테스트, **한계와 미확정**, 문서 인덱스, MIT
- docs 0.1 → 1.0 갱신, A1~A17 일괄 점검

---

### `[chore]` P7 — CI + `register-legacy.js` · 상태: `완료`

**내용** (fixture 대기 중 병행 착수):
- `.github/workflows/ci.yml` — push/PR, Node **22·24** 매트릭스, `npm test` → `npm run lint`
- `.claude/skills/notion-llm-wiki/scripts/register-legacy.js` — `--service <slug> --category <slug> [--apply]`: 카테고리 페이지 하위 일반 페이지 중 **아직 등록 항목이 없는 것**마다 카테고리 DB 에 `제목 + 원본` 만 채운 항목을 만든다. dry-run 기본
- `test/helpers/mock-notion.js` — `POST /v1/pages` 에 `parent.data_source_id` + 쓰기 형태 속성 지원 추가
- `test/register-legacy.test.js` — 생성 요청 수 = 미등록 레거시 수, 재실행 시 0

**검증 (실행함)**
- `ci.yml` 을 PyYAML 로 파싱: `on: [push, pull_request]`, matrix `node: ['22','24']`, steps 6 (checkout · setup-node · 버전/의존성 0 확인 · `npm test` · `npm run lint` · `build-index` 재실행 후 `git diff --exit-code wiki/index.md`).
  마지막 단계는 "색인을 손으로 고치거나 갱신을 잊은 커밋" 을 CI 가 잡기 위한 것이다. **실제 Actions 실행은 P9 push 때 확인**(미확정).
- `test/register-legacy.test.js` 4건 통과: dry-run 은 미등록 1건만 계획·쓰기 0, 이미 등록된 카테고리(상품기획)는 계획 0, `--apply` 는 `제목 + 원본 + 상태=초안` 만 채운 행 1건 생성(요약은 비움 — 사람이 채운다), **원본 페이지 객체는 바이트 단위로 불변**, 재실행 시 생성 0, 카테고리 페이지가 없으면 명확한 에러.
- mock 에 `POST /v1/pages` + `parent.data_source_id` 경로(쓰기 형태 속성 → 읽기 형태 변환)를 추가했다.

---

### `[feat]` P6 — 스킬(SKILL.md·references) + 샘플 위키 합성 + 질의 실행 · 상태: `진행중`

**착수 예정** (스킬 문서는 fixture 대기 중 먼저 작성, ingest·query 실행은 raw/ 골든 생성 후):
- `.claude/skills/notion-llm-wiki/SKILL.md` — frontmatter(`name`·`description`·`argument-hint`·`allowed-tools`), `$0` 분기, 서브커맨드 5개 절차 요약
- `references/wiki-schema.md` · `ingest-procedure.md` · `query-procedure.md` · `lint-semantic.md` · `notion-authoring.md`
- `test/skill.test.js` — T16 (frontmatter 필드 · 서브커맨드 5개가 references 를 가리킴 · 500줄 이내 · description 길이)
- **ingest 수행** → `wiki/` (개요 2 · 다이제스트 12 · 토픽 · 충돌 2 · log) → `build-index` → `lint` 오류 0
- **query 수행** → 질문 3개 답변을 이 LOG 에 기록 (A14)

**출구 조건**: T16 통과, lint 오류 0, A14 기록.

---

### `[feat]` P5 — `md-notion.js` + `publish.js` · 상태: `진행중`

**착수 예정** (P3 fixture 본문 대기 중 병행 착수 — 이 둘도 fixture 내용에 의존하지 않는다):

- `.claude/skills/notion-llm-wiki/scripts/lib/md-notion.js` — 표준 MD → enhanced MD 정규화 ([TRD 6.3](./TRD.md#63-libmd-notionjs--표준-md--enhanced-md)): 파이프 표 → `<table>`, 스페이스 들여쓰기 → 탭, 연속 인용 → `<br>`, h5/h6 → h4, 텍스트 특수문자 이스케이프(코드·링크 URL·태그 제외), HTML 주석 제거, 상대 링크 해석 콜백, 마커 콜아웃 헬퍼
- `.claude/skills/notion-llm-wiki/scripts/publish.js` — [TRD 6.2](./TRD.md#62-publishjs--wiki--notion): dry-run 기본 · `--apply` · 2단계(생성 → 본문 교체) · 해시 기반 멱등 · 안전 검사(부모 확인) · 고아 게시 페이지 보고(삭제 안 함) · `--json` 계획 출력
- `test/md-notion.test.js`(T11), `test/publish.test.js`(T12~T14)

**출구 조건**: T11(정규화 골든) · T12(dry-run 계획 골든) · T13(`--apply` 2회 → 생성 0·교체 0) · T14(루트 밖 id → 거부·쓰기 0).

---

### `[feat]` P4 — `build-index.js` + `lint.js` · 상태: `완료`

**내용** (P3 의 fixture 본문 작성을 기다리는 동안 착수 — 두 스크립트는 fixture 내용에 의존하지 않는다):

- `.claude/skills/notion-llm-wiki/scripts/lib/pages.js` — raw/wiki 페이지 목록·frontmatter 로드·게시 제목 규칙 (build-index·lint·publish 가 공유)
- `.claude/skills/notion-llm-wiki/scripts/build-index.js` — [TRD 6.4](./TRD.md#64-build-indexjs) · [DESIGN 5.1](./DESIGN.md#51-wikiindexmd--스크립트가-생성-손으로-고치지-않는다)
- `.claude/skills/notion-llm-wiki/scripts/lint.js` — L1~L8, `--json`, `--strict`
- `test/index.test.js`(T9), `test/lint.test.js`(T10)

**설계 조정 (구현 중 발견, 상위 문서 갱신 예정)**: PRD A9 는 "결함 없는 샘플 위키에서 lint 0" 을 요구하지만,
샘플 raw 에는 **의도적으로** meta 없는 레거시 페이지와 검토기한 경과 페이지가 들어 있다 — 이것들은 위키의
충돌·미확정 페이지가 사람에게 보여 줘야 할 **운영 신호**이지 저장소의 결함이 아니다. 따라서 lint 를
**경고(warning)** 와 **오류(error)** 로 나눈다: L1 `meta-missing`·L6 `stale` 은 경고(종료 코드 0, `--strict` 면 1),
L2·L3·L4·L5·L7·L8 은 오류(종료 코드 1). A9 의 "0" 은 "오류 0" 으로 정정한다. → PRD FR5.3·A9, TRD 6.5 갱신 완료.

**검증 (실행함)**: T9 3건 · T10 7건 통과.
- T9: 샘플 raw 33건으로 만든 색인이 `test/golden/index.md` 와 바이트 일치, 2회 생성 동일. 한 줄 형식(`⚠ meta 없음`, `(초안)`, `⏰`)과 서비스→카테고리→제목 정렬 확인. 민감·위키제외 페이지가 색인에 없음.
- T10: 샘플 저장소 lint = **오류 0, 경고 4** (meta-missing 3 — 미등록 레거시 2 + 루트 직속 안내 페이지 1, stale 1 — 검토기한 2026-06-30 경과). 결함을 하나씩 심은 사본에서 정확히 그 코드만 증가함을 확인(L1·L2×2·L3·L6·L7×2), 위키 결함 4종(L5·L4·L8·stale)은 임시 위키로 확인.
- `npm run lint` 실제 출력: `lint: 경고 4 (meta-missing 3, stale 1) → 종료 코드 0`.

---

### `[feat]` P3 — fixture 워크스페이스 + mock Notion + `sync.js` · 상태: `완료`

**내용**: 가상 데이터로 heybit 의 Notion 구조를 재현하고, 동기화가 그 구조를 `raw/` 로 정확히 옮기는지 골든으로 고정했다.
fixture 본문(루틴핏 23건 · 머니노트 15건 = 38건)은 별도 작성 에이전트 2개가 병렬로 썼고, 사양 대비 이탈은 기록만 남길 수준이었다
(짧은 본문 3건은 사양이 요구한 것, 회고가 하루 뒤 만들어진 FAQ 를 멘션하는 연대 어긋남 1건, 머니노트 `마이데이터 검토` 의 비밀등급을 `민감`→`내부` 로 조정해 미러에 포함).

- `test/fixtures/workspace.json` — 구조(서비스 루트 2 · 카테고리 페이지 12 · 카테고리 DB/data source 12 · 위키 루트 + 게시된 위키 페이지 1 · 루트 직속 페이지 1)
- `test/fixtures/pages-routinefit.json`, `test/fixtures/pages-moneynote.json` — 실무 페이지 약 30건 (압축 형식: `props` + `markdown`). **의도적으로 심는 것**: 환불 기한 충돌(법무 14일 vs CS 7일), 근거 정책 없는 FAQ, 검토기한 경과, 폐기 페이지 참조, AI 초안, 민감 1, 위키제외 1, 휴지통 1, 미등록 레거시 2, 등록 레거시 2, `truncated` 1
- `test/helpers/mock-notion.js` — fixture 를 Notion API 형태로 서빙하는 주입식 `fetch` (search · data source query · pages · databases · markdown · 생성/교체 기록 · N번째 요청 429 주입)
- `.claude/skills/notion-llm-wiki/scripts/sync.js` — [TRD 6.1](./TRD.md#61-syncjs--notion--raw) 알고리즘. `runSync()` 모듈 + CLI
- `.claude/skills/notion-llm-wiki/scripts/lib/report.js` — 동기화 리포트
- `raw/` — mock 에 대해 실행한 결과를 그대로 커밋 (= 골든)
- `test/sync.test.js` — T4~T8

**검증 (실행함)**: T4~T8 7건 통과 (`node --test test/sync.test.js`).
- `raw/` = **35 파일**(33 페이지 + 상태·리포트). 발견 53 페이지 → 범위 밖 1(위키 루트 아래 "색인") · 컨테이너 12(카테고리 페이지) · 제외 2(민감 1, 위키제외 1) · 휴지통 1 · 등록 항목이 대표한 원본 2. 호출 **59회** (search 2 + DB 12 + data source query 12 + markdown 33).
- 2회차: 본문 조회 **0건**, 변경 0. 1건의 `last_edited_time` 만 바꾸면 그 1건만 다시 받음.
- 등록 항목 → `meta_source: registry`, `source_url` = 원본, `created_time` = 원본의 것, 본문 = 원본 본문. 원본 단독 파일 없음. 미등록 레거시는 `meta_source: inferred` + 조상 제목으로 카테고리 추론(CS).
- 멘션 뒤에 미러 상대 링크가 덧붙고(`../legal/구독-환불-규정-555555.md`), related 는 제목·URL 로 해석, `truncated` 페이지는 frontmatter·본문 주석에 기록. people 의 이메일은 결과 어디에도 없음.
- 위키 루트가 서비스 하위인 워크스페이스 → `자기 출력을 다시 수집` 메시지로 거부. 원본 조회 실패는 그 항목만 실패로 남기고 나머지 계속.

**실행하면서 고친 것 2건 (실측이 드러낸 결함)**
1. **카테고리 페이지 12개가 `misc` 로 미러됐다.** 1차 구현은 "서비스 루트에 닿는 모든 페이지" 를 후보로 봤고, 카테고리 페이지("CS", "법무")도 루트 직속 페이지라 통과했다. 첫 골든 생성에서 45 파일이 나와 발견. → 서비스 루트 직속 + 제목이 카테고리 이름인 페이지는 **컨테이너**로 분류해 제외 (TRD 6.1 갱신, 리포트에 `컨테이너 N` 집계).
2. **미등록 레거시 페이지가 `cs` 가 아니라 `misc` 로 갔다.** 조상 해석 캐시를 쓰는 분기에서 **캐시된 노드 자신을 체인에 넣지 않아** 카테고리 페이지 제목이 체인에서 빠졌다. 1번을 고친 뒤에야 드러났다(그 전엔 카테고리 페이지가 후보로 먼저 해석돼 캐시가 없었다). → 노드를 먼저 체인에 넣고 캐시를 합치도록 수정. 삭제 사유도 `getPage` 로 실제 상태(휴지통/이동/삭제)를 확인해 정확히 적도록 바꿨다.

**골든 생성기**: `node test/helpers/generate-golden.js` 가 `raw/` 전체 · `test/golden/index.md` · `test/golden/publish-plan.json` 을 고정 시각으로 다시 만든다. fixture 나 wiki 를 바꾸면 이걸 돌리고 diff 를 검토한 뒤 커밋한다.

---

### `[feat]` P2 — 공통 라이브러리 · 상태: `완료`

**내용**: 나머지 스크립트가 공유하는 부품. frontmatter 는 raw·wiki·index 전부가 의존하므로 라운드트립을 먼저 굳힌다.

- `.claude/skills/notion-llm-wiki/scripts/lib/frontmatter.js` — YAML 부분집합 `stringify`/`parse`/`split`/`join`
- `.claude/skills/notion-llm-wiki/scripts/lib/slug.js` — [DESIGN 8절](./DESIGN.md#8-이름-규칙)
- `.claude/skills/notion-llm-wiki/scripts/lib/config.js` — 설정·`.env` 로드, [TRD 5.2](./TRD.md#52-설정-검증-기동-시) 검증(정적으로 가능한 것), 토큰 요구 메시지
- `.claude/skills/notion-llm-wiki/scripts/lib/notion-client.js` — `createClient` (토큰 버킷 · 429/529 `Retry-After` · 페이지네이션 · 호출 통계 · 헤더 미노출)
- `.claude/skills/notion-llm-wiki/scripts/lib/meta.js` — Notion `properties` → 내부 meta, raw frontmatter 조립(키 순서 고정), URL → page id
- `test/frontmatter.test.js`, `test/slug.test.js`, `test/meta.test.js`, `test/notion-client.test.js`, `test/config.test.js`

**검증 (실행함)**: `npm test` → **tests 27 / pass 27 / fail 0** (스모크 3 + config 4 + T1 5 + T2 4 + T3 5 + T15 6).

확인한 것 중 기록할 가치가 있는 것:
- **frontmatter 라운드트립**은 한국어·콜론(`: `)·`#`·따옴표·백슬래시·개행·`yes`/`007` 같은 "숫자·예약어로 오해될 문자열"·빈 배열·`null`·평면 객체 배열(related)을 전부 보존한다. 부분집합 밖(중첩 배열, 배열·객체 혼합 블록, 들여쓴 최상위 키)은 **명시적으로 거부**한다 — 조용히 잘못 읽는 것이 가장 나쁜 실패 모드라서다.
- **slug 의 NFC 정규화**를 분해형(NFD) 입력으로 실제 확인했다 — macOS 에서 만든 파일명이 Windows/Linux 와 달라지는 문제의 대응.
- **client 의 rps 제한**은 주입한 시계로 요청 간 대기가 300~340ms 임을 확인했고, **429 는 `Retry-After: 2` 를 2,000ms 대기로 존중**, 4xx 는 재시도 없음, 재시도 상한(6) 초과 시 마지막 에러. 에러 메시지에 토큰 문자열이 들어가지 않음을 검사한다.
- **meta 의 people 속성**은 이름만 남기고 이메일이 결과 JSON 어디에도 없음을 확인 (DR5).

**부수 수정**: `slug.js` 의 제어문자 제거 정규식에 리터럴 제어문자가 들어가 있어 `\u0000-\u001f` 표기로 바꿨다 (동작 동일, 소스 가독성 문제).

---

### `[chore]` P1 — 프로젝트 스캐폴드 · 상태: `완료`

**내용**: 의존성 0개 원칙과 스크립트 실행 경로를 굳혔다.

- `package.json` — `private`, `engines.node >= 22`, scripts(`sync`/`index`/`lint`/`publish:wiki`/`test`). **dependencies 없음**
- `notion-wiki.config.json` — 가상 서비스 2(루틴핏·머니노트), 카테고리 7, 속성 매핑, mock 용 페이지 id
- `.env.example`, `.gitignore`, `.gitattributes`(`* text=auto eol=lf` — Windows 에서 골든 비교가 CRLF 로 깨지지 않게), `LICENSE`(MIT)
- `test/smoke.test.js` — dependencies 키 없음 · Node ≥ 22 · 설정 파싱 확인 (빈 스위트로 `node --test` 가 실패하지 않게 하는 최소 테스트)
- 디렉터리 골격 — `.claude/skills/notion-llm-wiki/{scripts/lib,references}`, `raw/`, `wiki/`, `test/{fixtures,golden,helpers}`

**검증 (실행함)**: `npm test` → **tests 3 / pass 3 / fail 0** (Node v24.14.1, 약 0.1초).
`package.json` 에 dependencies·devDependencies 키 없음을 테스트가 확인한다. `npm install` 을 실행하지 않았고
`node_modules/` 도 없다 — 의존성 0개가 실제로 성립한다. Node 22 는 P9 의 CI 매트릭스에서 확인한다 (**미확정**).

**부수 정정**: P0 커밋에 `.omc/`(세션 상태 디렉터리)가 함께 들어갔다. 푸시 전이므로 인덱스에서 제거하고
커밋을 정정했다(`.gitignore` 에 `.omc/` 추가).

---

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
