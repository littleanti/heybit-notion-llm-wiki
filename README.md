# heybit-notion-llm-wiki

**Notion 에 쌓이는 실무 문서를 Claude Code 가 읽어 "LLM wiki" 로 합성하고, 그 위키를 다시 Notion 에 게시하며,
실무자의 질문에 RAG 없이 출처를 달아 답하는** — Claude Code 스킬과 운영 규약의 묶음(샘플).

heybit 의 Notion 은 `서비스 상위 페이지 → 카테고리(상품기획·상품설명·상품개발·CS·법무·마케팅) → 실무 페이지(사람·AI 작성)`
구조다. 페이지가 수십~수백 개로 늘면 "어디에 있는지", "무엇이 최신인지", "AI 에게 물으면 근거를 대는지" 가 문제가 된다.
이 저장소는 그 문제에 대한 **하나의 완결된 답**을 가상 데이터로 끝까지 만들어 보인 것이다.

> ⚠️ **샘플입니다.** 서비스명(루틴핏·머니노트)·사람·정책·수치는 전부 가상이며, 실제 Notion 워크스페이스에 연결해 검증하지
> **않았습니다**(fixture 로만 검증). 무엇이 실측되고 무엇이 미확정인지는 [8절](#8-한계와-미확정)에 숨기지 않고 적었습니다.

---

## 목차

1. [이 저장소가 답하는 세 질문](#1-이-저장소가-답하는-세-질문)
2. [한눈에 보는 흐름](#2-한눈에-보는-흐름)
3. [샘플 둘러보기](#3-샘플-둘러보기)
4. [저장소 구조](#4-저장소-구조)
5. [설치와 Notion 준비](#5-설치와-notion-준비)
6. [사용법 — 스킬 서브커맨드 5개](#6-사용법--스킬-서브커맨드-5개)
7. [테스트](#7-테스트)
8. [한계와 미확정](#8-한계와-미확정)
9. [문서](#9-문서)
10. [라이선스](#10-라이선스)

---

## 1. 이 저장소가 답하는 세 질문

| 질문 | 짧은 답 | 상세 |
|---|---|---|
| **① 실무 페이지를 앞으로 어떻게 써야 하나?** | 카테고리마다 **Notion 데이터베이스** 하나. 신규 페이지는 그 DB 의 항목으로, 채울 것은 **제목·문서유형·상태·요약·담당자 5개**. 본문은 유형별 템플릿(요약 → 유형별 섹션 → 미확정 → 변경 이력). **기존 페이지는 옮기지 않고** DB 에 `원본` 링크만 담은 등록 항목을 만든다. | [DESIGN 1·2절](./docs/DESIGN.md#1-notion-데이터베이스-스키마), 실무자용 요약 [`notion-authoring.md`](./.claude/skills/notion-llm-wiki/references/notion-authoring.md) |
| **② LLM wiki 는 어떤 구조로?** | 단일 페이지도, 원본 1:1 트리도 아니다. **색인 1장(페이지당 한 줄) + 서비스별 [개요 · 카테고리 다이제스트 · 교차 토픽 · 충돌/미확정] + 변경 이력.** 수십~수백 페이지에서 색인 한 장은 한 번에 읽히므로 임베딩이 필요 없다. 위키는 Notion 에 게시되어 실무자는 Notion 안에서 읽는다. | [DESIGN 3절](./docs/DESIGN.md#3-위키-페이지-종류와-템플릿), [TRD ADR-002·004](./docs/TRD.md#adr) |
| **③ 누가 어떻게 운영하나?** | Claude Code 스킬 `/notion-llm-wiki` 의 다섯 동작 — `sync`(Notion→미러) → `ingest`(위키 합성) → `lint` → `publish`(미러→Notion), 그리고 `query`(질문에 답). 벡터 DB·별도 LLM 서버 없음, 외부 npm 의존성 0개. | [6절](#6-사용법--스킬-서브커맨드-5개), [`SKILL.md`](./.claude/skills/notion-llm-wiki/SKILL.md) |

## 2. 한눈에 보는 흐름

```
 Notion (원본: 서비스/카테고리 DB/실무 페이지)          Notion (게시면: LLM Wiki 루트)
        │                                                        ▲
        │ sync  — search + data source query,                    │ publish — 위키 루트 아래 자기 페이지만,
        │         GET /pages/{id}/markdown (읽기 전용)            │           replace_content 로 통째 교체 (dry-run 기본)
        ▼                                                        │
   raw/<서비스>/<카테고리>/<제목>-<id>.md  ── ingest (Claude) ──▶  wiki/<서비스>/{overview, digest/*, topics/*, conflicts}.md
   (frontmatter = meta, 본문 = Notion 마크다운)                    wiki/index.md (스크립트 생성) · wiki/log.md (append-only)
                         ▲                                                  │
                         └──────────── query (Claude): index → 위키 → raw grep → 답 + 출처 + 동기화 시각
```

데이터는 **한 방향**으로만 흐른다. 게시된 위키가 다시 원본으로 수집되는 순환은 설정 검증과 조상 판정이 막는다.

## 3. 샘플 둘러보기

코드를 돌리지 않아도 결과물의 형태를 볼 수 있다.

- **원본 미러** — [`raw/`](./raw): 가상 서비스 2개(루틴핏·머니노트) × 카테고리 6개, 실무 페이지 33건.
  파일 하나를 열면 위에 meta(frontmatter), 아래에 Notion 이 준 마크다운 본문이 있다. 예:
  [`raw/routinefit/legal/구독-환불-규정-555555.md`](./raw/routinefit/legal/구독-환불-규정-555555.md)
- **색인** — [`wiki/index.md`](./wiki/index.md): 모든 페이지가 한 줄씩. `(초안)` 은 확정 아님, `⏰` 는 검토기한 경과, `⚠` 는 meta 없음.
- **위키** — [`wiki/routinefit/`](./wiki/routinefit), [`wiki/moneynote/`](./wiki/moneynote): 개요 · 카테고리 다이제스트 · 토픽 · 충돌/미확정, 합계 24 페이지.
  스킬의 `ingest` 절차 문서만 주고 Claude 가 합성한 결과다 (사람이 고친 것은 규칙 보강에 따른 표 열·절 추가 정도).
  샘플에는 **의도적으로 심은 문제**가 있다 — 법무 규정은 환불 기한 **14일**(2026-09-01 개정), CS 응대 가이드는 아직 **7일**.
  위키가 어느 쪽도 고르지 않고 [충돌](./wiki/routinefit/conflicts.md)로 기록하는지 보라. 근거 정책이 없는 FAQ, 검토기한이 지난 정책,
  폐기됐는데 참조되는 약관, AI 가 쓴 초안도 각각 어떻게 표시되는지 확인할 수 있다.
- **동기화 리포트** — [`raw/.sync-report.md`](./raw/.sync-report.md): 무엇이 추가·제외·건너뜀 됐는지. 민감 페이지 1건과 위키제외 1건이 **미러에 없는** 것도 여기서 확인된다.
- **변경 이력** — [`wiki/log.md`](./wiki/log.md): 위키가 왜 그렇게 쓰였는지 (판단·미확정).

이 샘플의 raw 는 [`test/fixtures/`](./test/fixtures) 의 가상 Notion 워크스페이스에 대해 **실제로 `sync` 를 돌려 만든 결과**(골든)다.
`node test/helpers/generate-golden.js` 로 언제든 다시 만들 수 있고, 테스트가 바이트 단위로 대조한다.

## 4. 저장소 구조

```
heybit-notion-llm-wiki/
├── CLAUDE.md                          작업 그라운드 룰 (3단 사고 · 문서 선행 워크플로)
├── README.md                          이 문서
├── notion-wiki.config.json            서비스·카테고리·속성 이름 매핑·루트 페이지 id
├── .env.example                       NOTION_TOKEN= (실제 .env 는 커밋되지 않는다)
├── package.json                       scripts 만 — dependencies 없음
│
├── docs/                              ★ 판단 근거. PRD(무엇·왜) · TRD(어떻게, ADR-001~008) · DESIGN(형식·템플릿) · PLAN · LOG
│
├── .claude/skills/notion-llm-wiki/    ★ 스킬
│   ├── SKILL.md                       /notion-llm-wiki <sync|ingest|query|lint|publish>
│   ├── references/                    wiki-schema(위키 규칙 정본) · ingest/query 절차 · 의미 lint · 실무자 안내
│   └── scripts/                       sync.js · build-index.js · lint.js · publish.js · register-legacy.js · lib/
│
├── raw/                               Notion 미러 (샘플 = 골든). .sync-state.json · .sync-report.md
├── wiki/                              LLM 이 합성한 위키. index.md · log.md · <서비스>/…  · .publish-state.json
│
├── test/                              node:test — fixture 워크스페이스 · mock Notion · 골든
│   ├── fixtures/                      workspace.json(구조) · pages-routinefit.json · pages-moneynote.json
│   ├── helpers/                       mock-notion.js · sync-harness.js · generate-golden.js
│   └── golden/                        index.md · publish-plan.json · md-notion.*.md
└── .github/workflows/ci.yml           Node 22·24 매트릭스: npm test → lint → 색인 최신 확인
```

## 5. 설치와 Notion 준비

### 5.1 사전 준비

- **Node.js 22 이상** (`node --version`). `npm install` 은 **필요 없다** — 외부 의존성이 0개다.
- Claude Code (스킬을 쓰려면). 스크립트만 쓰려면 Node 만 있으면 된다.

```bash
git clone https://github.com/littleanti/heybit-notion-llm-wiki.git
cd heybit-notion-llm-wiki
npm test                 # 토큰 없이 전 기능이 fixture 로 검증된다
```

### 5.2 Notion 쪽 준비 (실제 워크스페이스에 붙일 때)

1. **내부 연결(Internal Integration) 만들기** — Notion 설정 → 연결 → 새 연결. 권한: 콘텐츠 읽기 · 삽입 · 업데이트, 사용자 정보(이름만 쓴다).
   토큰을 `.env` 에 넣는다: `cp .env.example .env` → `NOTION_TOKEN=…`. **`.env` 는 커밋되지 않는다.**
2. **페이지에 연결 추가** — 연결은 기본적으로 아무 페이지에도 접근할 수 없다. **서비스 상위 페이지들**과 **위키 루트 페이지**(새로 만든 빈 페이지, 예: `LLM Wiki`) 각각에서
   `•••` → 연결 → 이 연결을 추가한다. 하위 페이지·DB 에 상속된다. 위키 루트는 서비스 페이지 **밖**에 둔다(안에 두면 설정 검증이 거부한다).
3. **카테고리 DB 만들기** — 각 카테고리 페이지 안에 데이터베이스를 만들고 속성을 [DESIGN 1.1](./docs/DESIGN.md#11-속성-표)대로 넣는다.
   템플릿(정책·규정 / FAQ·응대 / 회의록 / 레거시 등록 / AI 초안)을 등록해 두면 작성자가 형식을 외울 필요가 없다.
   기존 일반 페이지는 옮기지 말고 `register-legacy` 로 등록 항목을 만든다([DESIGN 1.3](./docs/DESIGN.md#13-레거시-페이지-등록-절차)).
4. **설정** — `notion-wiki.config.json` 의 `services[].rootPageId`, `wiki.rootPageId` 를 실제 페이지 id 로 바꾼다.
   속성 이름이 다르면 `properties` 매핑을 고친다. `sync.excludeWhenUnset` 을 `true` 로 하면 비밀등급이 비어 있는 페이지를 제외한다.

### 5.3 `notion-wiki.config.json` 요약

| 키 | 뜻 |
|---|---|
| `notionVersion` | `Notion-Version` 헤더. `2026-03-11` (Markdown 엔드포인트·data source 모델 포함) |
| `services[]` | `name`(Notion 제목) · `slug`(디렉터리) · `rootPageId` |
| `categories[]` | `name` · `slug` · `fallback: true` 하나(어느 카테고리에도 안 잡히는 페이지가 가는 곳) |
| `wiki.rootPageId` | 게시 루트. 서비스 루트와 같으면 기동 거부 |
| `properties` | 내부 키 → Notion 속성 이름 (`docType: "문서유형"` …) |
| `values` | select 허용값 — lint 가 검사한다 |
| `sync` | `sensitiveValues`(기본 `["민감"]`) · `excludeWhenUnset` · `rps`(기본 3) |

## 6. 사용법 — 스킬 서브커맨드 5개

Claude Code 에서 저장소를 열면 `.claude/skills/notion-llm-wiki/` 가 자동 인식된다. `/notion-llm-wiki <서브커맨드>` 로 부르거나
"노션 위키 동기화해", "위키에서 환불 정책 찾아줘" 처럼 말하면 스킬이 자동으로 선택된다.

| 서브커맨드 | 하는 일 | 주체 | 스크립트 직접 실행 |
|---|---|---|---|
| `sync` | Notion → `raw/` 증분 동기화. 바뀐 페이지만 받는다 | 스크립트 | `npm run sync` (`--full` 로 전체) |
| `ingest` | `raw/.sync-report.md` 의 변경분을 읽어 `wiki/` 갱신 → 색인 → lint → log | **Claude** | (LLM 절차 — [`ingest-procedure.md`](./.claude/skills/notion-llm-wiki/references/ingest-procedure.md)) |
| `query <질문>` | 색인 → 위키 → 원문 grep 순서로 찾아 **출처·상태·동기화 시각**을 붙여 답한다 | **Claude** | (LLM 절차 — [`query-procedure.md`](./.claude/skills/notion-llm-wiki/references/query-procedure.md)) |
| `lint` | 구조 lint(frontmatter·링크·출처·고아·크기) + 의미 lint(모순·불일치) | 둘 다 | `npm run lint` (`--json`, `--strict`) |
| `publish` | `wiki/` → Notion 위키 루트 아래 게시. **dry-run 기본**, `--apply` 로 실제 쓰기 | 스크립트 | `npm run publish:wiki` / `npm run publish:wiki -- --apply` |

권장 순서: **`sync → ingest → lint → publish`**. `query` 는 언제든.

### 스크립트만 쓸 때

```bash
npm run sync                                # NOTION_TOKEN 필요. raw/ 와 리포트 갱신
npm run index                               # raw/wiki frontmatter → wiki/index.md (결정적)
npm run lint                                # 오류가 있으면 종료 코드 1, 경고만 있으면 0
npm run publish:wiki                        # dry-run — 무엇을 만들고 바꿀지만 보여 준다
npm run publish:wiki -- --apply             # 실제 게시 (위키 루트 아래 자기 페이지만)
node .claude/skills/notion-llm-wiki/scripts/register-legacy.js --service routinefit --category cs [--apply]
```

`ingest` 와 `query` 는 스크립트가 아니라 **Claude Code 가 따르는 절차**다. 절차 문서는 사람이 읽어도 그대로 따라갈 수 있게 썼다.

### 실무자에게 알려 줄 것

한 장짜리 안내: [`references/notion-authoring.md`](./.claude/skills/notion-llm-wiki/references/notion-authoring.md).
핵심은 "채울 것은 5개, 확정만 사실로 쓰인다, 미확정은 미확정 섹션에, 키워드에 동의어".

## 7. 테스트

```bash
npm test
```

`node:test` 기반, 추가 의존성 0개. **Notion 토큰 없이** 전 경로가 돈다 — [`test/helpers/mock-notion.js`](./test/helpers/mock-notion.js) 가
fixture 워크스페이스를 Notion API 형태로 서빙하고, 쓰기 요청을 기록한다.

| 대상 | 무엇을 확인하나 |
|---|---|
| frontmatter · slug · meta · config · client | YAML 부분집합 라운드트립(한국어·특수문자), NFC, 속성 10종, 순환 설정 거부, 3 rps · 429 `Retry-After` · 토큰 미노출 |
| sync | fixture → `raw/` 골든 **바이트 일치**, 2회차 본문 조회 0, 민감·위키제외·휴지통 제외, 등록 항목 → 원본 본문, 위키 루트 하위 제외 |
| build-index · lint | 골든 일치·결정성, 결함 종류별로 정확히 그 코드만, 샘플은 오류 0 |
| md-notion · publish | 표·목록·인용·이스케이프 정규화 골든, dry-run 계획 골든, `--apply` 2회 멱등, 루트 밖 id 거부(쓰기 0) |
| skill · register-legacy | SKILL.md 구조, 서브커맨드↔references, 미등록 레거시만 등록 |

CI(`.github/workflows/ci.yml`)는 Node **22·24** 에서 같은 테스트를 돌리고, `wiki/index.md` 가 최신인지도 확인한다.

## 8. 한계와 미확정

숨기지 않고 적는다. 이것을 아는 것이 이 샘플의 내용의 일부다.

| 항목 | 상태 | 설명 |
|---|---|---|
| **실 Notion 워크스페이스 동작** | **미실측** | 모든 API 호출은 공식 문서(2026-09-09 확인, [TRD 3.1](./docs/TRD.md#31-notion-api--문서로-확인한-사실-2026-09-09))의 JSON 형태를 흉내 낸 mock 으로만 검증했다. 실제 응답이 다르면 fixture 와 코드를 함께 고쳐야 한다 |
| **enhanced markdown 렌더** | 미실측 | 게시기가 만드는 Notion 마크다운(표 `<table>`, 탭 들여쓰기, 이스케이프)이 Notion 에서 의도대로 보이는지는 확인하지 못했다. 변환 규칙은 순수 함수 + 골든으로 고정돼 있어 실측 후 골든만 갱신하면 된다 |
| **검색 인덱스 지연** | 미확정 | `POST /search` 가 새 페이지를 얼마나 늦게 보여 주는지 문서에 없다. 신규 페이지의 주 경로(DB 행)는 지연 없는 data source query 로 나열하므로 영향은 "새 DB 를 만든 직후" 에 한정된다 |
| **위키 신선도** | 구조적 | 미러는 `sync` 시점에 멈춘다. 그래서 모든 답에 **동기화 시각**을 붙인다. 실시간 동기화(webhook)는 범위 밖 |
| **권한(ACL)** | 범위 밖 | 위키 독자 = 동기화 범위 열람자 단일 집단을 가정한다. 권한이 다른 페이지는 `민감` 으로 표시해 빼는 것이 유일한 수단 |
| **코멘트 수집** | 범위 밖 | 위키 페이지에 달린 정정 요청 코멘트를 자동으로 읽어 오지 않는다. 블록 교체 시 페이지 코멘트가 유지되는지도 **미실측** |
| **Notion 파일 URL** | 알려진 한계 | 1시간 후 만료된다. 미러는 URL 만 두고 주석으로 명시한다 |

## 9. 문서

이 저장소는 **동작하는 스킬**과 함께 **거기까지 온 판단의 기록**을 남기는 것을 목표로 한다.
[`CLAUDE.md`](./CLAUDE.md)의 두 그라운드 룰(3단 사고 절차 / 문서 선행 워크플로)을 지키면서 만들었다.

| 문서 | 내용 |
|---|---|
| [`docs/PRD.md`](./docs/PRD.md) | **무엇을·왜** — 현재 Notion 구조의 문제, LLM wiki 패턴, FR1~FR7, DR1~DR7, Acceptance A1~A17, Out of scope |
| [`docs/TRD.md`](./docs/TRD.md) | **어떻게** — 아키텍처, Notion API 확인 사실, 모듈 계약, 테스트 전략, **ADR-001~008** (위키 위치 · RAG 없는 검색 · meta 위치 · 페이지 종류 · 편집 소유권 · Markdown 엔드포인트 · 발견 방식 · 스킬 구조) |
| [`docs/DESIGN.md`](./docs/DESIGN.md) | **어떤 형식으로** — Notion DB 스키마, 본문 템플릿, 레거시 등록, 위키 템플릿, frontmatter, 색인·이력·답변 형식, 문구 정본 |
| [`docs/PLAN.md`](./docs/PLAN.md) | **언제·어떤 순서로** — P0~P9 와 출구 조건 |
| [`docs/LOG.md`](./docs/LOG.md) | **변경 이력** — 각 단계에서 무엇을 검증했고, 무엇이 실측으로 뒤집혔나 |

읽을 순서를 하나만 추천한다면 [`docs/TRD.md`](./docs/TRD.md) 의 **ADR-006** 이다. "블록 API 로 변환기 두 개를 만든다" 던 첫 설계가
공식 문서 확인 한 번으로 "Markdown 엔드포인트 + 정규화기 하나" 로 바뀐 과정이 3단으로 적혀 있다.
`docs/LOG.md` 에는 첫 골든 생성에서 카테고리 페이지 12개가 미러에 섞여 들어온 것을 발견해 고친 기록 같은,
**실행이 드러낸 결함**들이 그대로 남아 있다.

## 10. 라이선스

[MIT License](./LICENSE) — Copyright (c) 2026 Wondeuk Yoon.
자유롭게 가져다 쓰되, 실제 조직에 붙일 때는 [8절](#8-한계와-미확정)의 미실측 항목을 먼저 해소하기를 권한다.
