# PLAN — heybit-notion-llm-wiki

- 문서 버전: 1.0 (2026-09-09) — P0~P9 완료
- 문서 역할: **언제 · 어떤 순서로** 만드는가
- 관련 문서: [PRD](./PRD.md) · [TRD](./TRD.md) · [DESIGN](./DESIGN.md) · [LOG](./LOG.md)

---

## 진행 규칙

[`CLAUDE.md`](../CLAUDE.md) 그라운드 룰 2를 따른다. 각 Phase 는 예외 없이 이 5단계를 거친다:

1. **① 문서** — [LOG](./LOG.md)에 해당 Phase 항목을 `진행중` 으로 먼저 기록
2. **② 구현**
3. **③ 검증** — 아래 각 Phase 의 *출구 조건*을 **실제로 실행해서** 확인
4. **④ 문서 완료 표시** — 출구 조건이 실제로 통과했을 때만 `완료`
5. **⑤ 커밋** — Phase 당 커밋 1개 이상

**출구 조건이 통과하지 못하면 `진행중` 으로 두고 ②~③을 반복한다.** 통과하지 않은 것을 `완료` 로 적지 않는다.

이 프로젝트의 특수한 제약: **실제 Notion 워크스페이스에 연결하지 않는다** (사용자 확인, 2026-09-09).
Notion API 를 호출하는 모든 경로는 fixture(mock) 로 검증하고, 실 Notion 에 대한 동작은 각 Phase 에서
**미확정** 으로 명시한다. 이 제약은 숨기지 않고 README 에도 적는다.

## Phase 요약

| Phase | 내용 | 검증 방식 | 상태 |
|---|---|---|---|
| P0 | CLAUDE.md + 문서 0.1 초안 (PRD·TRD·DESIGN·PLAN·LOG) | 파일 존재 · 상호 링크 | `완료` |
| P1 | 스캐폴드 (package.json·설정·스킬 디렉터리 골격·gitignore·LICENSE) | `npm test` 가 빈 스위트로 성공, Node 버전 확인 | `완료` |
| P2 | 공통 라이브러리 (frontmatter·slug·config·notion-client·meta) | 단위 테스트 T1·T2·T3·T15 | `완료` |
| P3 | fixture 워크스페이스(가상 서비스 2 × 카테고리 6 × 약 30페이지) + mock Notion + `sync.js` | T4~T8 · raw/ 골든 생성 | `완료` |
| P4 | `build-index.js` + `lint.js` | T9·T10 | `완료` |
| P5 | `md-notion.js` + `publish.js` | T11~T14 | `완료` |
| P6 | 스킬 (SKILL.md·references) + **ingest 실제 수행**으로 샘플 위키 합성 + query 3건 실행 | T16 · A14 실행 기록 | `완료` |
| P7 | CI (Node 22·24) + `register-legacy.js`(선택) | 워크플로 파싱 · 단위 테스트 | `완료` |
| P8 | README · 문서 마감 · Acceptance A1~A17 일괄 | 전 항목 실행 | `완료` |
| P9 | GitHub public 저장소 생성 · push · CI 통과 확인 | Actions 실행 결과 | `완료` |
| P10 | **Claude Code 플러그인 패키징** — 스킬을 `plugins/notion-llm-wiki/skills/` 로 옮기고 marketplace 등록, `${CLAUDE_SKILL_DIR}` 경로화 | `claude plugin validate --strict` · `--plugin-dir` 로 로드 · `npm test` · CI | `완료` |

---

## P0 — CLAUDE.md 및 문서 0.1 초안

**목표**: 코드를 쓰기 전에 무엇을·왜·어떻게·어떤 형식으로·언제를 확정한다. 이 저장소는 규약 문서
자체가 산출물의 절반이므로, 사용자에게 두 차례 질문해 갈림길을 먼저 닫았다
(위키 위치·검색 주체·범위·샘플 데이터 / 역방향 게시·meta 방식·규모·실측 가능 여부 — 답은 [LOG](./LOG.md) P0).

**작업**
- `CLAUDE.md` — 그라운드 룰 (사용자 제공 원문)
- `docs/PRD.md` — 제품 정의, 배경(LLM wiki 패턴), 사용자 U1~U4, FR1~FR7, DR1~DR7, Acceptance A1~A17, Out of scope
- `docs/TRD.md` — 아키텍처, Notion API 확인 사실 N1~N14, 스킬 규약, 저장소 구조, 설정, 모듈 계약, 테스트 전략, **ADR-001~008(3단 사고)**
- `docs/DESIGN.md` — Notion DB 스키마, 본문 템플릿(유형별), 레거시 등록 절차, 위키 페이지 템플릿, raw frontmatter, index/log 형식, 게시 트리, 답변 형식, 이름 규칙, 문구 정본
- `docs/PLAN.md` — 이 문서
- `docs/LOG.md` — 변경 이력

**출구 조건**: 파일 6개가 실제 내용으로 존재하고 상호 링크(앵커 포함)가 맞다. → 커밋 1

**상태: `완료`** — 파일 6개 존재, 상호 링크·앵커 65건 스크립트 검사 통과 ([LOG](./LOG.md) P0).

## P1 — 스캐폴드

**목표**: 의존성 0개 원칙이 이 환경에서 성립하는지, 스크립트 실행 경로가 맞는지 확인한다.

**작업**
- `package.json` — `"type": "commonjs"`, `engines.node >= 22`, scripts: `sync`/`index`/`lint`/`publish`/`test` (전부 `node .claude/skills/notion-llm-wiki/scripts/…`). **dependencies 없음**
- `notion-wiki.config.json` — 샘플 설정 (가상 서비스 2개, 카테고리 7개, 속성 매핑, mock 용 페이지 id)
- `.env.example` — `NOTION_TOKEN=` (빈 값) + 발급·연결 절차 주석
- `.gitignore` — `.env`, `node_modules/`, `tmp/`, `.omc/`, 편집기 파일. **`raw/.sync-state.json` 은 커밋** ([TRD 4절](./TRD.md#4-저장소-구조))
- `LICENSE` — MIT, Wondeuk Yoon, 2026
- 디렉터리 — `.claude/skills/notion-llm-wiki/{scripts/lib,references}`, `raw/`, `wiki/`, `test/{fixtures,golden,helpers}`

**출구 조건**: `node --version` ≥ 22, `npm test` 가 정상 종료, `package.json` 에 dependencies 키가 없다. → 커밋 2

**상태: `완료`** — Node v24.14.1, `npm test` 3/3 (스모크 테스트 3개 — 빈 스위트는 `node --test` 가 실패하므로 최소 테스트를 두었다), dependencies 없음.
`.gitattributes`(`eol=lf`) 를 추가했다 — Windows 환경에서 골든 비교가 CRLF 로 깨지는 리스크 대응.

## P2 — 공통 라이브러리

**목표**: 나머지 스크립트가 공유하는 부품을 먼저 굳힌다. 특히 frontmatter 는 raw·wiki·index 전부가
의존하므로 라운드트립을 가장 먼저 검증한다.

**작업**
- `lib/frontmatter.js` — YAML 부분집합 `stringify`/`parse`. 문자열은 필요할 때만 따옴표(콜론·`#`·앞뒤 공백·`[`·빈 문자열), 배열은 `[a, b]` 인라인, 객체 배열(related)은 `- { title: …, url: … }`
- `lib/slug.js` — [DESIGN 8절](./DESIGN.md#8-이름-규칙) 규칙
- `lib/config.js` — 설정·`.env` 로드, [TRD 5.2](./TRD.md#52-설정-검증-기동-시) 검증
- `lib/notion-client.js` — `createClient({ token, version, rps, fetchImpl, sleepImpl })`, `request`, `paginate`, `stats`
- `lib/meta.js` — Notion `properties` → frontmatter 값 (타입 10종), 이름 매핑은 설정에서

**출구 조건**: T1(라운드트립 — 한국어·콜론·따옴표·빈 배열·null), T2(slug 금지 문자·길이·NFC), T3(속성 10종·빈 값),
T15(429 → `Retry-After` 대기 후 재시도, 페이지네이션 이어 붙임, 호출 수 집계) 통과. → 커밋 3

**상태: `완료`** — `npm test` 27/27. 상세는 [LOG](./LOG.md) P2.

## P3 — fixture 워크스페이스 + mock Notion + `sync.js`

**목표**: 가상 데이터로 실제 heybit 구조를 재현하고, 동기화가 그 구조를 raw 로 정확히 옮기는지 골든으로 고정한다.

**작업**
- `test/fixtures/workspace.json` — 가상 서비스 **루틴핏**(습관 루틴 앱)·**머니노트**(가계부 앱).
  서비스 루트 2, 카테고리 DB 12(data source 12), 카테고리 페이지(레거시용) 일부,
  실무 페이지 약 30: DB 항목(대부분) + 레거시 등록 항목 3 + 등록 안 된 레거시 2 + 민감 1 + 위키제외 1 + 휴지통 1.
  본문은 [DESIGN 2절](./DESIGN.md#2-본문-템플릿-문서유형별) 템플릿을 따르는 enhanced markdown.
  **의도적으로 심는 것**: 환불 기한 충돌(법무 14일 vs CS 7일), 근거 정책 없는 FAQ 1, 검토기한 경과 1,
  폐기 페이지를 참조하는 확정 페이지 1, AI 초안 2. 이것들이 P6 의 위키 합성과 A14 질의의 재료다.
- `test/helpers/mock-notion.js` — [TRD 6.7](./TRD.md#67-testhelpersmock-notionjs)
- `scripts/sync.js` — [TRD 6.1](./TRD.md#61-syncjs--notion--raw)
- `raw/` — mock 에 대해 sync 를 실행한 결과를 **그대로 커밋** (= 골든)

**출구 조건**: T4(골든 일치), T5(2회차 호출 0 · 1건 변경만 재수집), T6(민감·제외·휴지통), T7(등록 항목 → 원본 본문·단독 원본 제거),
T8(위키 루트 하위 제외 · 순환 설정 거부) 통과. `raw/.sync-report.md` 가 [DESIGN 9절](./DESIGN.md#9-리포트메시지-문구-정본) 형식. → 커밋 4

**상태: `완료`** — T4~T8 7/7. fixture 38 페이지 → raw 33 파일, 호출 59회, 2회차 본문 조회 0.
**실측으로 고친 것 2건**: 카테고리 페이지가 `misc` 로 미러되던 것, 조상 캐시 분기에서 카테고리 제목이 빠져 레거시가 `misc` 로 가던 것 ([LOG](./LOG.md) P3).

## P4 — `build-index.js` + `lint.js`

**작업**
- `scripts/build-index.js` — [TRD 6.4](./TRD.md#64-build-indexjs), [DESIGN 5.1](./DESIGN.md#51-wikiindexmd--스크립트가-생성-손으로-고치지-않는다)
- `scripts/lint.js` — L1~L8 ([TRD 6.5](./TRD.md#65-lintjs--구조-lint)), `--json`
- `test/fixtures/lint/` — 결함 7종을 하나씩 심은 최소 워크스페이스

**출구 조건**: T9(골든 · 2회 실행 바이트 일치), T10(결함 종류별로 정확히 그 코드만 · 샘플은 오류 0) 통과. → 커밋 5

**상태: `완료`** — T9 3/3 · T10 7/7. 샘플 저장소 lint = 오류 0 · 경고 4(의도된 것).
**설계 조정**: lint 를 경고/오류 두 등급으로 나눔 (PRD FR5.3·A9, TRD 6.5 갱신 — [LOG](./LOG.md) P4).

## P5 — `md-notion.js` + `publish.js`

**작업**
- `lib/md-notion.js` — [TRD 6.3](./TRD.md#63-libmd-notionjs--표준-md--enhanced-md) 정규화 + 링크 해석 + 마커 콜아웃
- `scripts/publish.js` — [TRD 6.2](./TRD.md#62-publishjs--wiki--notion). dry-run 기본, `--apply`
- mock 에 `POST /pages`·`PATCH /pages/{id}/markdown`·`GET /pages/{id}` 쓰기 기록 추가

**출구 조건**: T11(표·중첩 목록·인용·이스케이프·링크 해석 골든), T12(dry-run 골든), T13(`--apply` 2회 → 생성 0·교체 0),
T14(루트 밖 id → 거부·쓰기 0) 통과. → 커밋 6

**상태: `완료`** — T11 7/7 · T12~T14 5/5. 게시 계획 28항목 골든, `--apply` 2회 멱등, 안전 검사 확인. 완료 판정은 P6 의 샘플 위키가 생긴 뒤에 했다 ([LOG](./LOG.md) P5).

## P6 — 스킬 + 샘플 위키 합성 + 질의 실행

**목표**: 스킬 문서를 쓰고, **그 스킬 절차를 실제로 따라** 샘플 raw 에서 위키를 합성한다. 절차 문서가
실행 가능한지는 실행해 봐야 안다.

**작업**
- `SKILL.md` — frontmatter(`name`, `description`(5개 동작 모두 언급), `argument-hint`, `allowed-tools`), `$0` 분기, 각 서브커맨드의 절차 요약과 references 링크
- `references/wiki-schema.md` — [DESIGN 3절](./DESIGN.md#3-위키-페이지-종류와-템플릿) 규칙의 스킬용 정본 (페이지 종류·상한·출처·모순·신선도·금지 사항)
- `references/ingest-procedure.md`, `references/query-procedure.md`, `references/lint-semantic.md`, `references/notion-authoring.md`
- **ingest 수행** — `raw/.sync-report.md` 를 입력으로 `wiki/` 합성: 개요 2, 다이제스트 12, 토픽(기준 충족분), 충돌 2, `log.md`. 그 뒤 `build-index` → `index.md`, `lint` → 0
- **query 수행** — 질문 3개(카테고리 내부 · 교차 · 없는 것) 를 절차대로 실행, 답변을 LOG 에 기록 (A14)
- `test/skill.test.js` — T16

**출구 조건**: T16 통과, `lint` 오류 0, A14 의 3개 답변이 [DESIGN 7절](./DESIGN.md#7-질의-답변-형식-query) 형식으로 LOG 에 기록됨. → 커밋 7

**상태: `완료`** — T16 4/4. 스킬 절차만 준 작업자 2개가 위키 24 페이지를 합성(lint 오류 0), 심어 둔 문제 전부 표면화.
**절차 문서의 모호점 21건**이 실행에서 드러나 wiki-schema·ingest-procedure·SKILL 을 보강했다. A14 질의 3건 기록 ([LOG](./LOG.md) P6).

## P7 — CI + `register-legacy.js`(선택)

**작업**
- `.github/workflows/ci.yml` — push/PR, Node **22·24** 매트릭스, `npm test`, `npm run lint`(샘플 위키 무결함 확인)
- `scripts/register-legacy.js` — 카테고리 페이지 하위 일반 페이지마다 DB 등록 항목 생성(`제목`+`원본`). dry-run 기본.
  시간이 부족하면 **문서상 절차만 남기고 보류**하며 그 사실을 기록한다

**출구 조건**: YAML 파싱 성공(매트릭스 확인). register-legacy 는 mock 에 대해 생성 요청 수 = 미등록 레거시 수. → 커밋 8

**상태: `완료`** — YAML 파싱(매트릭스 22·24, steps 6), register-legacy 4/4 (생성 = 미등록 수, 재실행 0, 원본 불변). Actions 실제 실행은 P9 에서 확인.

## P8 — README · 문서 마감 · Acceptance 일괄

**작업**
- `README.md` — 소개, "이 저장소가 답하는 세 질문"(작성 규약 / 위키 구조 / 운영), 구조 트리, 설치(연결 추가 절차 포함),
  설정, 서브커맨드 5개 사용법, 샘플 둘러보기, 한계(실측 미완 · 권한 · 신선도), 문서 인덱스, MIT
- docs 전체 0.1 → 1.0: 실제 결과 반영, 상태 갱신, 미확정 목록 정리
- A1~A17 일괄 실행 ([PRD 6절](./PRD.md#6-acceptance-기준))

**출구 조건**: A1~A17 중 fixture 로 검증 가능한 전 항목 PASS, 실 Notion 항목은 미확정으로 명시. → 커밋 9

**상태: `완료`** — `npm test` 64/64 · lint 오류 0. A6·A13 은 ADR-006 채택으로 재정의해 통과, A16 은 로컬 통과 + CI 확인 예정, A17 은 자체 점검(실무자 사용성 실측 없음). 상세는 [PRD 6절](./PRD.md#6-acceptance-기준).
docs 4종을 1.0 으로 올리고, P6 실행에서 보강한 위키 템플릿 규칙(충돌 표 `비고` 열 · conflicts `미확정` 절 · 표기 규칙)을 DESIGN 3절에 동기화했다.

## P9 — GitHub public 저장소 생성 · push

**작업**: `gh repo create littleanti/heybit-notion-llm-wiki --public`, push, CI 실행 확인.
push 전 확인: `.env` 미포함, `raw/`·fixture 에 실제 정보 없음(가상 데이터만), 토큰 문자열 grep 0건.

**출구 조건**: Actions 가 Node 22·24 에서 통과. 통과 결과를 LOG 에 기록. → 커밋 10(필요 시)

**상태: `완료`** — 저장소 생성·최초 push(2026-09-09). 첫 CI 실행에서 `npm test`·`lint` 는 Node 22·24 모두 통과했으나
"색인 최신 확인" 단계가 실패 — 색인 헤더의 생성 시각이 실행마다 달라지는 결함. 색인을 입력만으로 결정되게 고쳐 재푸시 →
**CI run 34367811565 Node 22·24 전 단계 통과.** Node 22 실동작·A16 재현성이 실측으로 해소됐다 ([LOG](./LOG.md) P9).

---

## P10 — Claude Code 플러그인 패키징

**배경**: 스킬이 `.claude/skills/` 프로젝트 스킬로만 존재해, 다른 저장소에서 쓰려면 디렉터리를 복사해야 했다.
사용자 요청(2026-09-10): "이 스킬 claude plugin 으로 설치 가능하게". 결정 근거는 [TRD ADR-009](./TRD.md#adr-009--배포-단위는-플러그인-스킬-복사가-아니라).

**작업**
- `plugins/notion-llm-wiki/` (플러그인 루트) — `.claude-plugin/plugin.json`, `skills/notion-llm-wiki/{SKILL.md, references/, scripts/}` (기존 스킬 디렉터리를 **그대로** 이동 — 스크립트는 스킬 디렉터리 안에 남긴다, ADR-009)
- 저장소 루트 `.claude-plugin/marketplace.json` — 마켓플레이스 `heybit-notion-llm-wiki`, 플러그인 `notion-llm-wiki`, `source: ./plugins/notion-llm-wiki`
- `SKILL.md` — 스크립트 경로를 `${CLAUDE_SKILL_DIR}/scripts/…` 로(본문·`allowed-tools` 양쪽 — 공식 문서가 두 곳 모두 치환한다고 명시). `npm run …` 은 샘플 저장소 한정으로 표기
- `.claude/skills/notion-llm-wiki/` 제거(중복 방지). 샘플 저장소 자체는 `.claude/settings.json` 의 `extraKnownMarketplaces`+`enabledPlugins` 로 같은 플러그인을 권장하고, 개발 중에는 `claude --plugin-dir plugins/notion-llm-wiki`
- 경로 참조 갱신 — `package.json` scripts, `test/*.test.js`·`test/helpers/*`, `.github/workflows/ci.yml`, `README.md`, `docs/PRD.md` FR7, `docs/TRD.md` 3.2·3.3·4절
- `test/plugin.test.js`(T18) — plugin.json·marketplace.json·settings.json 의 이름·버전·경로 정합성
- CI 에 `claude plugin validate --strict` 잡 추가 (Claude Code CLI 를 러너에 설치. 저장소 의존성은 여전히 0)

**출구 조건**: `claude plugin validate --strict` 통과(플러그인·마켓플레이스 둘 다), `claude --plugin-dir` 로 로드한 세션에서 스킬이 보임, `npm test` 전부 통과, `npm run lint` 오류 0, CI 통과. → 커밋 13

**상태: `완료`** (2026-09-10) — `claude plugin validate --strict` 플러그인·마켓플레이스 둘 다 통과(CLI 2.1.267).
`claude --plugin-dir plugins/notion-llm-wiki -p "/notion-llm-wiki:notion-llm-wiki"` 로 헤드리스 세션을 띄우자 스킬이 로드되고 `$0` 분기가 사용법 표를 출력했다.
`npm test` **69/69**(T18 5건 추가), `npm run lint` 오류 0, 색인 재생성 diff 없음. `wiki/log.md` 의 경로 문구를 바꾸면서 게시 골든(`publish-plan.json`)의 log.md 해시가 바뀌어 골든을 재생성했다.
push 후: **CI run 34457349321 3 잡(test 22·24, plugin) 통과**, **GitHub 경유 설치 실측**(캐시에 플러그인 파일 21개만). 설치본으로 `lint` 를 헤드리스 실행해
권한 거부 결함(따옴표·`cd &&` 로 접두 규칙 불일치)을 발견 → `allowed-tools` 따옴표 변형 + SKILL.md 실행 규칙으로 고쳐 재실측 거부 0건 — [LOG](./LOG.md) P10.

---

## 리스크 대응 (사전 식별)

| 리스크 | 대응 | 결과 |
|---|---|---|
| 실 Notion 미실측으로 fixture 가 실제 응답과 다를 수 있음 | 공식 문서의 JSON 형태를 fixture 에 그대로 사용, 문서 URL 을 TRD 3.1 에 남김. **미확정** 으로 명시 | — |
| enhanced markdown 정규화가 실제 렌더와 다를 수 있음 | 순수 함수 + 골든으로 규칙을 고정, 실측 시 골든만 갱신하면 되게 | — |
| YAML 부분집합 파서가 실제 값(따옴표·콜론)에서 깨짐 | T1 에 한국어·특수문자 케이스 포함 | — |
| 샘플 콘텐츠 작성 분량(약 30페이지)이 일정을 잠식 | 페이지당 300~600자, 템플릿 골격 재사용. 위키 합성 재료(충돌·미확정)에 집중 | — |
| 스킬 `allowed-tools` 에서 변수 치환 불확실 | 프로젝트 상대 경로 사용, README 에 권한 프롬프트 가능성 명시 | P10 에서 해소 — 공식 문서(skills.md)가 `${CLAUDE_SKILL_DIR}` 를 본문·`allowed-tools` 두 곳에서 치환한다고 명시. 플러그인 전환 시 이 변수로 통일 |
| Windows 경로·개행이 골든 비교를 깨뜨림 | 스크립트가 항상 `/` 와 `\n` 으로 쓰고, 비교 전 정규화. `.gitattributes` 로 `* text=auto eol=lf` | — |
