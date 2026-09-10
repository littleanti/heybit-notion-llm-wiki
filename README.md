# heybit-notion-llm-wiki

**Notion 에 쌓이는 실무 문서를 Claude Code 가 읽어 "LLM wiki" 로 합성하고, 그 위키를 다시 Notion 에 게시하며,
실무자의 질문에 RAG 없이 출처를 달아 답하고, 규약을 지킨 새 페이지를 대신 써 주는** — Claude Code 플러그인과 운영 규약의 묶음(샘플).

heybit 의 Notion 은 `서비스 상위 페이지 → 카테고리(상품기획·상품설명·상품개발·CS·법무·마케팅) → 실무 페이지(사람·AI 작성)`
구조다. 페이지가 수십~수백 개로 늘면 "어디에 있는지", "무엇이 최신인지", "AI 에게 물으면 근거를 대는지" 가 문제가 된다.
이 저장소는 그 문제에 대한 **하나의 완결된 답**을 가상 데이터로 끝까지 만들어 보인 것이다.

> ⚠️ **샘플입니다.** 서비스명(루틴핏·머니노트)·사람·정책·수치는 전부 가상이며, 실제 Notion 워크스페이스에 연결해 검증하지
> **않았습니다**(fixture 로만 검증). 무엇이 실측되고 무엇이 미확정인지는 [8절](#8-한계와-미확정)에 숨기지 않고 적었습니다.


---

## ⚡ Quick Start (5분, 개발 지식 없이)

> Claude Code 에 이 플러그인을 설치하면, **말로 시키는 것만으로** Notion 문서를 찾고·쓰고·정리할 수 있습니다.
> 아래 4단계면 끝입니다. 명령어는 **복사해서 붙여넣기만** 하세요.

### 1단계 — Claude Code 준비

Claude Code 는 터미널에서 쓰는 Claude 입니다. 이미 쓰고 있다면 이 단계는 건너뛰세요.

- 설치 안내: [claude.com/claude-code](https://claude.com/claude-code)
- 터미널(맥: 터미널 앱, 윈도우: PowerShell)에서 `claude` 라고 치면 실행됩니다.

### 2단계 — 플러그인 설치 (복사해서 붙여넣기)

터미널에 아래 두 줄을 차례로 붙여넣습니다.

```bash
claude plugin marketplace add littleanti/heybit-notion-llm-wiki
claude plugin install notion-llm-wiki@heybit-notion-llm-wiki
```

Claude Code 안에 이미 들어와 있다면 `/plugin marketplace add littleanti/heybit-notion-llm-wiki` → `/plugin install notion-llm-wiki@heybit-notion-llm-wiki` 로 해도 같습니다.
설치했는지 확인은 `claude plugin list`.

### 3단계 — Notion 과 연결 (한 번만)

1. **연결(토큰) 만들기** — Notion 오른쪽 위 `설정` → `연결` → `새 연결`. 이름은 아무렇게나(예: `LLM Wiki`).
   권한은 **콘텐츠 읽기·삽입·업데이트**와 **사용자 정보**를 켭니다. 만들면 `ntn_...` 로 시작하는 **비밀 값**이 나옵니다.
2. **문서를 담을 폴더에 연결 추가** — 팀의 서비스 상위 페이지에서 `•••` → `연결` → 방금 만든 연결을 추가합니다.
   (하위 페이지에는 자동으로 적용됩니다.) 위키를 게시할 **빈 페이지**도 하나 만들어 같은 방법으로 연결을 추가합니다.
3. **작업 폴더 만들기** — 컴퓨터에 폴더 하나를 만들고(예: `내문서/heybit-wiki`) 그 안에 파일 두 개를 둡니다.
   - `.env` — 한 줄만 적습니다: `NOTION_TOKEN=ntn_...` (1번에서 받은 값). **이 파일은 누구에게도 보내지 마세요.**
   - `notion-wiki.config.json` — [이 저장소의 파일](./notion-wiki.config.json)을 복사해서, 서비스 이름과 페이지 주소(id)만 우리 것으로 바꿉니다.
     페이지 id 는 Notion 페이지 URL 끝의 32자리 문자입니다. 어려우면 Claude 에게 **"이 URL 로 설정 파일 채워줘"** 라고 하면 해 줍니다.

> 3번이 부담스러우면 이 저장소를 그대로 내려받아 **샘플 데이터로 먼저 구경**할 수 있습니다 → [3. 샘플 둘러보기](#3-샘플-둘러보기).
> 토큰 없이도 구조와 결과물을 다 볼 수 있습니다.

### 4단계 — 말로 시키기

2단계에서 만든 작업 폴더에서 `claude` 를 실행하고, 아래처럼 **평소 말투로** 요청하면 됩니다.

| 하고 싶은 일 | 이렇게 말하세요 |
|---|---|
| 📥 Notion 문서 가져오기 | "노션 문서 동기화해줘" |
| 🔎 **찾기 (가장 많이 씁니다)** | "환불 기한이 며칠이야?" · "알림 미수신 응대 어떻게 해?" |
| ✍️ **새 페이지 쓰기** | "오늘 CS 회의에서 정한 내용으로 FAQ 페이지 만들어줘: (내용 붙여넣기)" |
| ✏️ 기존 페이지 고치기 | "환불 처리 응대 가이드에 14일 기준 추가해줘" |
| 📚 위키 정리·게시 | "위키 갱신해줘" → "노션에 게시해줘" |

**세 가지만 기억하세요.**

1. **답에는 항상 출처가 붙습니다.** Notion 링크·상태(확정/초안)·동기화 시각이 함께 나옵니다. 근거 없는 답은 하지 않습니다.
2. **Notion 에 쓰기 전에 항상 먼저 보여 줍니다.** 새 페이지·수정은 **초안 파일**로 만들어 보여 주고,
   여러분이 "게시해" 라고 확인해야 Notion 에 올라갑니다. 새 페이지는 `초안` 상태로 올라가고, `확정` 은 담당자가 Notion 에서 누릅니다.
3. **모르는 것은 지어내지 않습니다.** 요약·담당자처럼 꼭 필요한 정보가 없으면 여러분에게 물어봅니다.
   내용에 없는 것은 페이지의 `미확정 · 열린 질문` 에 질문으로 남습니다.

<details>
<summary>정확한 명령으로 부르고 싶을 때 (선택)</summary>

말로 하는 대신 스킬을 직접 부를 수도 있습니다.

```
/notion-llm-wiki sync              # Notion → 내 컴퓨터로 가져오기
/notion-llm-wiki query 환불 기한    # 찾아서 출처와 함께 답하기
/notion-llm-wiki ingest            # 위키 다시 정리
/notion-llm-wiki publish           # 위키를 Notion 에 게시 (먼저 미리보기)
/notion-draft new  (내용)          # 새 페이지 초안 만들기
/notion-draft edit (대상)          # 기존 페이지 고칠 초안 받기
/notion-draft submit (초안 경로)    # 검토 후 Notion 에 올리기
```

</details>

### 설정이 맞았는지 확인 (읽기만 합니다)

작업 폴더에서 아래를 실행하면 **아무것도 바꾸지 않고** 연결 상태만 알려 줍니다. Claude 에게 **"노션 연결 확인해줘"** 라고 해도 됩니다.

```bash
node <플러그인 경로>/skills/notion-llm-wiki/scripts/check-notion.js
```

이 저장소를 clone 해서 쓰는 경우에는 `npm run check` 로 같은 일을 합니다. 이렇게 나오면 성공입니다.

```
연결      LLM Wiki · type=bot
사용자    12명 — 담당자(people) 속성을 쓰려면 필요하다
접근 범위  페이지 34개 · 데이터베이스(data source) 6개
서비스     루틴핏 (routinefit) — 보인다: "루틴핏"
위키 루트   보인다: "LLM Wiki"
속성 매핑   "루틴핏 · CS" 의 속성 14개 확인
          → 설정의 모든 속성 이름이 이 DB 에 있다
호출 5회. 쓰기는 하지 않았다.
```

**막히면**: `NOTION_TOKEN 이 없습니다` → 3단계의 `.env` 를 확인하세요.
`API token is invalid` → 토큰 값이 잘못됐습니다. `ntn_` 으로 시작하는 값을 그대로 붙여넣었는지 보세요.
`접근 범위 페이지 0개` 또는 `카테고리 페이지를 찾을 수 없다` → Notion 페이지에 **연결 추가**(3단계 2번)를 안 한 경우입니다.
`중단:` 으로 시작하는 메시지가 나오면 **아무것도 쓰이지 않은 상태**입니다. 메시지에 이유와 다음 할 일이 적혀 있습니다.

---

## 목차

0. [⚡ Quick Start (5분, 개발 지식 없이)](#-quick-start-5분-개발-지식-없이)
1. [이 저장소가 답하는 세 질문](#1-이-저장소가-답하는-세-질문)
2. [한눈에 보는 흐름](#2-한눈에-보는-흐름)
3. [샘플 둘러보기](#3-샘플-둘러보기)
4. [저장소 구조](#4-저장소-구조)
5. [설치와 Notion 준비](#5-설치와-notion-준비)
6. [사용법 — 스킬 2개](#6-사용법--스킬-2개)
7. [테스트](#7-테스트)
8. [한계와 미확정](#8-한계와-미확정)
9. [문서](#9-문서)
10. [라이선스](#10-라이선스)

---

## 1. 이 저장소가 답하는 세 질문

| 질문 | 짧은 답 | 상세 |
|---|---|---|
| **① 실무 페이지를 앞으로 어떻게 써야 하나?** | 카테고리마다 **Notion 데이터베이스** 하나. 신규 페이지는 그 DB 의 항목으로, 채울 것은 **제목·문서유형·상태·요약·담당자 5개**. 본문은 유형별 템플릿(요약 → 유형별 섹션 → 미확정 → 변경 이력). **기존 페이지는 옮기지 않고** DB 에 `원본` 링크만 담은 등록 항목을 만든다. | [DESIGN 1·2절](./docs/DESIGN.md#1-notion-데이터베이스-스키마), 실무자용 요약 [`notion-authoring.md`](./plugins/notion-llm-wiki/skills/notion-llm-wiki/references/notion-authoring.md) |
| **② LLM wiki 는 어떤 구조로?** | 단일 페이지도, 원본 1:1 트리도 아니다. **색인 1장(페이지당 한 줄) + 서비스별 [개요 · 카테고리 다이제스트 · 교차 토픽 · 충돌/미확정] + 변경 이력.** 수십~수백 페이지에서 색인 한 장은 한 번에 읽히므로 임베딩이 필요 없다. 위키는 Notion 에 게시되어 실무자는 Notion 안에서 읽는다. | [DESIGN 3절](./docs/DESIGN.md#3-위키-페이지-종류와-템플릿), [TRD ADR-002·004](./docs/TRD.md#adr) |
| **③ 누가 어떻게 운영하나?** | 플러그인 `notion-llm-wiki@heybit-notion-llm-wiki` 의 **스킬 2개**. `/notion-llm-wiki` 의 다섯 동작 — `sync`(Notion→미러) → `ingest`(위키 합성) → `lint` → `publish`(미러→Notion), 그리고 `query`(질문에 답). 벡터 DB·별도 LLM 서버 없음, 외부 npm 의존성 0개. | [6절](#6-사용법--스킬-서브커맨드-5개), [`SKILL.md`](./plugins/notion-llm-wiki/skills/notion-llm-wiki/SKILL.md) |

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
├── docs/                              ★ 판단 근거. PRD(무엇·왜) · TRD(어떻게, ADR-001~009) · DESIGN(형식·템플릿) · PLAN · LOG
│
├── .claude-plugin/marketplace.json    마켓플레이스 heybit-notion-llm-wiki (플러그인 1개 → ./plugins/notion-llm-wiki)
├── .claude/settings.json              이 저장소를 열면 위 마켓플레이스·플러그인 설치를 권장
├── plugins/notion-llm-wiki/           ★ Claude Code 플러그인 — 설치되는 것은 이 디렉터리만
│   ├── .claude-plugin/plugin.json     name notion-llm-wiki · version(package.json 과 동일)
│   ├── README.md                      플러그인 단독 안내
│   ├── skills/notion-llm-wiki/        ★ 스킬 ① Notion → 위키
│   │   ├── SKILL.md                   /notion-llm-wiki <sync|ingest|query|lint|publish>. 스크립트는 ${CLAUDE_SKILL_DIR}/scripts/…
│   │   ├── references/                wiki-schema(위키 규칙 정본) · ingest/query 절차 · 의미 lint · 실무자 안내
│   │   └── scripts/                   check-notion.js · sync.js · build-index.js · lint.js · publish.js · register-legacy.js · lib/
│   └── skills/notion-draft/           ★ 스킬 ② 입력 → Notion
│       ├── SKILL.md                   /notion-draft <new|edit|submit>
│       ├── references/                draft-templates(유형 9종 골격) · draft-procedure(절차)
│       └── scripts/                   draft-new.js · draft-pull.js · draft-submit.js · lib/(shared·draft·props·diff·doc-templates·target)
│
├── drafts/                            작성 중인 초안 (샘플 1개). 게시하면 지워도 된다
├── raw/                               Notion 미러 (샘플 = 골든). .sync-state.json · .sync-report.md
├── wiki/                              LLM 이 합성한 위키. index.md · log.md · <서비스>/…  · .publish-state.json
│
├── test/                              node:test — fixture 워크스페이스 · mock Notion · 골든
│   ├── fixtures/                      workspace.json(구조) · pages-routinefit.json · pages-moneynote.json
│   ├── helpers/                       mock-notion.js · sync-harness.js · generate-golden.js
│   └── golden/                        index.md · publish-plan.json · md-notion.*.md
└── .github/workflows/ci.yml           Node 22·24 매트릭스: npm test → lint → 색인 최신 확인 · 플러그인 매니페스트 validate --strict
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

**스킬 설치 — 두 가지 길**

| 상황 | 방법 |
|---|---|
| **내 저장소에서 쓴다** (보통의 경우) | `claude plugin marketplace add littleanti/heybit-notion-llm-wiki` → `claude plugin install notion-llm-wiki@heybit-notion-llm-wiki`. Claude Code 안에서는 `/plugin marketplace add …` → `/plugin install …`. 그 저장소 루트에 `notion-wiki.config.json` 과 `.env` 를 두면 끝이다 (5.2·5.3). 갱신은 `claude plugin marketplace update` → `claude plugin update notion-llm-wiki` |
| **이 샘플 저장소를 연다** | `.claude/settings.json` 이 같은 마켓플레이스·플러그인을 선언해 두었으므로, 폴더를 신뢰하면 Claude Code 가 설치를 제안한다. 스킬 자체를 고치는 중이라면 설치 대신 `claude --plugin-dir plugins/notion-llm-wiki` 로 로컬 사본을 로드한다 (둘을 동시에 켜면 같은 스킬이 두 번 보인다) |

플러그인의 실체는 [`plugins/notion-llm-wiki/`](./plugins/notion-llm-wiki/) 하나다. 예전처럼 `skills/notion-llm-wiki/` 디렉터리를 `.claude/skills/` 로 복사해도
동작한다 — 스크립트 경로가 `${CLAUDE_SKILL_DIR}` 기준이라 위치에 무관하다 ([TRD ADR-009](./docs/TRD.md#adr-009--배포-단위는-플러그인-스킬-복사가-아니라)).

### 5.2 Notion 쪽 준비 (실제 워크스페이스에 붙일 때)

1. **내부 연결(Internal Integration) 만들기** — Notion 설정 → 연결 → 새 연결. 권한: 콘텐츠 읽기 · 삽입 · 업데이트, **사용자 정보**(미러에는 이름만 남기고, 담당자 속성을 쓸 때 이름 → 사용자 id 해석에 쓴다 — [TRD N15](./docs/TRD.md#31-notion-api--문서로-확인한-사실-2026-09-09-n15n16-은-2026-09-10)).
   토큰을 `.env` 에 넣는다: `cp .env.example .env` → `NOTION_TOKEN=…`. **`.env` 는 커밋되지 않는다.**
2. **페이지에 연결 추가** — 연결은 기본적으로 아무 페이지에도 접근할 수 없다. **서비스 상위 페이지들**과 **위키 루트 페이지**(새로 만든 빈 페이지, 예: `LLM Wiki`) 각각에서
   `•••` → 연결 → 이 연결을 추가한다. 하위 페이지·DB 에 상속된다. 위키 루트는 서비스 페이지 **밖**에 둔다(안에 두면 설정 검증이 거부한다).
3. **카테고리 DB 만들기** — 각 카테고리 페이지 안에 데이터베이스를 만들고 속성을 [DESIGN 1.1](./docs/DESIGN.md#11-속성-표)대로 넣는다.
   템플릿(정책·규정 / FAQ·응대 / 회의록 / 레거시 등록 / AI 초안)을 등록해 두면 작성자가 형식을 외울 필요가 없다.
   기존 일반 페이지는 옮기지 말고 `register-legacy` 로 등록 항목을 만든다([DESIGN 1.3](./docs/DESIGN.md#13-레거시-페이지-등록-절차)).
4. **설정** — `notion-wiki.config.json` 의 `services[].rootPageId`, `wiki.rootPageId` 를 실제 페이지 id 로 바꾼다.
   속성 이름이 다르면 `properties` 매핑을 고친다. `sync.excludeWhenUnset` 을 `true` 로 하면 비밀등급이 비어 있는 페이지를 제외한다.
   페이지 id 는 Notion URL 끝의 32자리 16진수다. URL 에서 뽑으려면:
   ```bash
   node -e "console.log(require('./plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/meta').pageIdFromUrl(process.argv[1]))" "<붙여넣은 Notion URL>"
   ```
5. **확인** — `npm run check` (읽기 전용). 연결 이름·사용자 수·접근 가능한 페이지·서비스/위키 루트·속성 매핑을 점검한다.
   여기서 통과하면 `npm run sync` 로 넘어간다. **첫 실행은 `sync` 까지만** 하고 결과를 보는 것을 권한다 —
   `sync` 는 읽기 전용이고, 쓰기는 `publish --apply` 와 `draft-submit --apply` 뿐이다.

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

## 6. 사용법 — 스킬 2개

플러그인 하나에 스킬이 **둘** 있다. 방향이 다르다.

| 스킬 | 방향 | 무엇을 |
|---|---|---|
| [`notion-llm-wiki`](./plugins/notion-llm-wiki/skills/notion-llm-wiki/SKILL.md) | **Notion → 위키** | 동기화(`sync`) · 위키 합성(`ingest`) · 질의(`query`) · 점검(`lint`) · 게시(`publish`) |
| [`notion-draft`](./plugins/notion-llm-wiki/skills/notion-draft/SKILL.md) | **입력 → Notion** | 새 페이지 초안(`new`) · 기존 페이지 수정 초안(`edit`) · 검토 후 게시(`submit`) |

`/notion-llm-wiki <서브커맨드>` · `/notion-draft <서브커맨드>` 로 부르거나(정식 이름은 `/notion-llm-wiki:<스킬>`),
"노션 위키 동기화해" · "이 내용으로 FAQ 만들어줘" 처럼 말하면 자동으로 선택된다. 스크립트는 **현재 디렉터리**를 위키 작업 공간으로 본다.

### 6.1 `notion-llm-wiki` — Notion 을 읽어 위키로

| 서브커맨드 | 하는 일 | 주체 | 스크립트 직접 실행 |
|---|---|---|---|
| `sync` | Notion → `raw/` 증분 동기화. 바뀐 페이지만 받는다 | 스크립트 | `npm run sync` (`--full` 로 전체) |
| `ingest` | `raw/.sync-report.md` 의 변경분을 읽어 `wiki/` 갱신 → 색인 → lint → log | **Claude** | (LLM 절차 — [`ingest-procedure.md`](./plugins/notion-llm-wiki/skills/notion-llm-wiki/references/ingest-procedure.md)) |
| `query <질문>` | 색인 → 위키 → 원문 grep 순서로 찾아 **출처·상태·동기화 시각**을 붙여 답한다 | **Claude** | (LLM 절차 — [`query-procedure.md`](./plugins/notion-llm-wiki/skills/notion-llm-wiki/references/query-procedure.md)) |
| `lint` | 구조 lint(frontmatter·링크·출처·고아·크기) + 의미 lint(모순·불일치) | 둘 다 | `npm run lint` (`--json`, `--strict`) |
| `publish` | `wiki/` → Notion 위키 루트 아래 게시. **dry-run 기본**, `--apply` 로 실제 쓰기 | 스크립트 | `npm run publish:wiki` / `npm run publish:wiki -- --apply` |

권장 순서: **`sync → ingest → lint → publish`**. `query` 는 언제든.

### 6.2 `notion-draft` — 입력을 규약을 지킨 Notion 페이지로

| 서브커맨드 | 하는 일 | Notion 쓰기 |
|---|---|---|
| `new <내용>` | 서비스·카테고리·문서유형을 판단하고 **유형별 필수 섹션을 갖춘 초안**을 `drafts/` 에 만든다. 필수 속성(제목·문서유형·상태·요약·담당자) 중 모르는 것은 **묻는다** | 없음 |
| `edit <대상>` | 기존 페이지의 현재 속성·본문을 초안으로 받아 온다. 대상은 raw 경로·Notion URL·페이지 id | 없음 |
| `submit <초안> [--apply]` | 검증 → dry-run(대상 DB · 속성 표 · 본문 크기 · 수정이면 줄 단위 diff) → `--apply` 로 게시 → 그 페이지만 `raw/` 에 즉시 기록 | `--apply` 일 때만 |

- **신규 페이지는 `상태: 초안` · `작성주체: 사람+AI`** 로만 만들어진다. 확정은 Notion 에서 담당자가 한다 ([DESIGN 1.4](./docs/DESIGN.md#14-ai-가-작성한-페이지의-규칙)).
- **수정은 네 겹으로 막는다**: ① 초안을 만든 뒤 원본이 바뀌면 중단(낙관적 잠금) ② 민감·폐기·휴지통·하위 페이지 포함·위키 페이지는 거부
  ③ diff 를 보여 주는 dry-run 이 기본 ④ `## 변경 이력` 에 오늘 항목이 없으면 막는다 ([TRD ADR-011](./docs/TRD.md#adr-011--기존-페이지를-고치는-경로의-안전-모델)).
- 형식·검증 규칙의 정본은 [DESIGN 10절](./docs/DESIGN.md#10-초안-파일과-작성-스킬-notion-draft), 절차는 [`draft-procedure.md`](./plugins/notion-llm-wiki/skills/notion-draft/references/draft-procedure.md).
- 게시 후 색인·위키는 자동 갱신되지 않는다 — `notion-llm-wiki` 의 `ingest` 를 이어서 돌린다.

샘플 초안: [`drafts/routinefit/cs/알림이-안-온다는-문의-1차-응대.md`](./drafts/routinefit/cs/알림이-안-온다는-문의-1차-응대.md)

### 스크립트만 쓸 때

```bash
npm run check                               # 읽기 전용. 토큰·연결·설정이 맞는지 먼저 확인
npm run sync                                # NOTION_TOKEN 필요. raw/ 와 리포트 갱신
npm run index                               # raw/wiki frontmatter → wiki/index.md (결정적)
npm run lint                                # 오류가 있으면 종료 코드 1, 경고만 있으면 0
npm run publish:wiki                        # dry-run — 무엇을 만들고 바꿀지만 보여 준다
npm run publish:wiki -- --apply             # 실제 게시 (위키 루트 아래 자기 페이지만)
node plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/register-legacy.js --service routinefit --category cs [--apply]

npm run draft:new -- --service routinefit --category cs --type "FAQ·응대" --title "제목" --owner 이름 --summary "한 문장"
npm run draft:pull -- raw/routinefit/cs/<파일>.md      # 기존 페이지 → 수정 초안 (NOTION_TOKEN 필요)
npm run draft:submit -- drafts/routinefit/cs/<파일>.md            # dry-run (읽기만)
npm run draft:submit -- drafts/routinefit/cs/<파일>.md --apply    # 게시
```

`npm run …` 은 이 샘플 저장소 안에서만 있다. 다른 프로젝트에서는 설치된 플러그인의 스크립트를 직접 부른다
(경로는 [`plugins/notion-llm-wiki/README.md`](./plugins/notion-llm-wiki/README.md)).

`ingest` 와 `query` 는 스크립트가 아니라 **Claude Code 가 따르는 절차**다. 절차 문서는 사람이 읽어도 그대로 따라갈 수 있게 썼다.

### 실무자에게 알려 줄 것

한 장짜리 안내: [`references/notion-authoring.md`](./plugins/notion-llm-wiki/skills/notion-llm-wiki/references/notion-authoring.md).
핵심은 "채울 것은 5개, 확정만 사실로 쓰인다, 미확정은 미확정 섹션에, 키워드에 동의어".

## 7. 테스트

```bash
npm test
```

`node:test` 기반 **98개**, 추가 의존성 0개. **Notion 토큰 없이** 전 경로가 돈다 — [`test/helpers/mock-notion.js`](./test/helpers/mock-notion.js) 가
fixture 워크스페이스를 Notion API 형태로 서빙하고, 쓰기 요청을 기록한다.

| 대상 | 무엇을 확인하나 |
|---|---|
| frontmatter · slug · meta · config · client | YAML 부분집합 라운드트립(한국어·특수문자), NFC, 속성 10종, 순환 설정 거부, 3 rps · 429 `Retry-After` · 토큰 미노출 |
| sync | fixture → `raw/` 골든 **바이트 일치**, 2회차 본문 조회 0, 민감·위키제외·휴지통 제외, 등록 항목 → 원본 본문, 위키 루트 하위 제외 |
| build-index · lint | 골든 일치·결정성, 결함 종류별로 정확히 그 코드만, 샘플은 오류 0 |
| md-notion · publish | 표·목록·인용·이스케이프 정규화 골든, dry-run 계획 골든, `--apply` 2회 멱등, 루트 밖 id 거부(쓰기 0) |
| skill · plugin · register-legacy | SKILL.md 구조, 서브커맨드↔references, 매니페스트 정합성, 미등록 레거시만 등록 |
| **초안 검증 · 속성 쓰기** | 검증 코드 13종 각각, 유형별 섹션·순서, 스키마 타입별 쓰기 형태 9종, 담당자 이름→id·동명이인 중단, 변경분만 추출 |
| **작성·수정 왕복** | dry-run 쓰기 0건 → 생성 → `raw/` 즉시 기록 → 이어지는 sync 의 본문 조회 0, 수정 거부 4종(원본 변경·민감·폐기·하위 페이지) 각각 쓰기 0건 |

CI(`.github/workflows/ci.yml`)는 Node **22·24** 에서 같은 테스트를 돌리고, `wiki/index.md` 가 최신인지도 확인한다.
별도 잡이 Claude Code CLI 로 `claude plugin validate --strict` 를 플러그인과 마켓플레이스 양쪽에 돌린다.

## 8. 한계와 미확정

숨기지 않고 적는다. 이것을 아는 것이 이 샘플의 내용의 일부다.

| 항목 | 상태 | 설명 |
|---|---|---|
| **실 Notion 워크스페이스 동작** | **실측 완료 (2026-09-10)** | 실제 워크스페이스에 더미 37페이지·DB 12개를 올리고 `check → sync → ingest → lint → publish` 전 경로를 돌렸다. 위키 30페이지를 합성해 34페이지를 게시했고, 2회차는 쓰기 0건(멱등). fixture 로는 드러나지 않던 **결함 3건을 이때 찾아 고쳤다** ([LOG](./docs/LOG.md) 2026-09-10) |
| **enhanced markdown 렌더** | 실측 완료 | 콜아웃·표·중첩 목록(탭)·인용·언어 지정 코드 펜스를 실제 페이지에 넣고 다시 읽어 그대로 왕복함을 확인했다. Notion 은 표를 들여쓰기 없이 돌려주고, 멘션은 **라벨 없이 자기닫는 태그**로 준다 ([TRD N17·N18](./docs/TRD.md#31-notion-api--문서로-확인한-사실-2026-09-09-n15n16-은-2026-09-10)) |
| **검색 인덱스 지연** | 미확정 | `POST /search` 가 새 페이지를 얼마나 늦게 보여 주는지 문서에 없다. 신규 페이지의 주 경로(DB 행)는 지연 없는 data source query 로 나열하므로 영향은 "새 DB 를 만든 직후" 에 한정된다 |
| **위키 신선도** | 구조적 | 미러는 `sync` 시점에 멈춘다. 그래서 모든 답에 **동기화 시각**을 붙인다. 실시간 동기화(webhook)는 범위 밖 |
| **권한(ACL)** | 범위 밖 | 위키 독자 = 동기화 범위 열람자 단일 집단을 가정한다. 권한이 다른 페이지는 `민감` 으로 표시해 빼는 것이 유일한 수단 |
| **코멘트 수집** | 범위 밖 | 위키 페이지에 달린 정정 요청 코멘트를 자동으로 읽어 오지 않는다. 블록 교체 시 페이지 코멘트가 유지되는지도 **미실측** |
| **Notion 파일 URL** | 알려진 한계 | 1시간 후 만료된다. 미러는 URL 만 두고 주석으로 명시한다 |
| **플러그인 uninstall 의 부작용** | 실측 | `claude plugin uninstall`·`marketplace remove` 가 프로젝트 `.claude/settings.json` 의 `enabledPlugins`·`extraKnownMarketplaces` 를 빈 객체로 덮어썼다(CLI 2.1.267). 되돌리려면 `git checkout -- .claude/settings.json`. 설치 자체는 실측 완료 — 캐시에 플러그인 파일 21개만 복사된다 ([TRD 3.3](./docs/TRD.md#33-claude-code-플러그인-규약--문서로-확인한-사실-2026-09-10)) |
| **스킬 스크립트의 권한 사전 승인** | 실측·주의 | 규칙은 `node <스킬 경로>/scripts/…` 로 시작하는 **단독 명령**에만 걸린다. SKILL.md 가 따옴표·`cd &&` 를 쓰지 말라고 지시하며, 지시대로 실행될 때 승인 프롬프트가 없다. 홈 경로에 공백이 있으면 규칙이 쪼개질 수 있다(미실측) |
| **작성·수정 스킬의 실 Notion 동작** | 실측 완료(일부) | 실제 카테고리 DB 에 새 FAQ 페이지를 만들어 속성 12개와 본문이 한 호출로 들어가고 담당자 이름이 사용자 id 로 해석되는 것을 확인했다. **동명이인·게스트·비활성 사용자**는 여전히 미실측이다 |
| **속성·본문 부분 실패** | 구조적 | 수정은 속성(`PATCH /v1/pages`)과 본문(`PATCH …/markdown`) 두 호출이고 트랜잭션이 없다. 앞이 성공하고 뒤가 실패하면 절반만 반영되며, 그 사실을 그대로 보고한다 ([TRD ADR-011](./docs/TRD.md#adr-011--기존-페이지를-고치는-경로의-안전-모델) 공격 ⑥) |
| **비대화형에서의 질문** | 실측 | 필수 속성이 빠졌을 때 `AskUserQuestion` 으로 묻게 했으나, `-p`(헤드리스) 세션에서는 그 도구가 없어 **묻지 못하고 진행**한다. SKILL.md 가 이 경우 문장으로 묻고 멈추도록 지시한다 |

## 9. 문서

이 저장소는 **동작하는 스킬**과 함께 **거기까지 온 판단의 기록**을 남기는 것을 목표로 한다.
[`CLAUDE.md`](./CLAUDE.md)의 두 그라운드 룰(3단 사고 절차 / 문서 선행 워크플로)을 지키면서 만들었다.

| 문서 | 내용 |
|---|---|
| [`docs/PRD.md`](./docs/PRD.md) | **무엇을·왜** — 현재 Notion 구조의 문제, LLM wiki 패턴, FR1~FR7, DR1~DR7, Acceptance A1~A17, Out of scope |
| [`docs/TRD.md`](./docs/TRD.md) | **어떻게** — 아키텍처, Notion API·플러그인 규약 확인 사실, 모듈 계약, 테스트 전략, **ADR-001~009** (위키 위치 · RAG 없는 검색 · meta 위치 · 페이지 종류 · 편집 소유권 · Markdown 엔드포인트 · 발견 방식 · 스킬 구조 · 플러그인 배포) |
| [`docs/DESIGN.md`](./docs/DESIGN.md) | **어떤 형식으로** — Notion DB 스키마, 본문 템플릿, 레거시 등록, 위키 템플릿, frontmatter, 색인·이력·답변 형식, **초안 파일과 검증 규칙(10절)**, 문구 정본 |
| [`docs/PLAN.md`](./docs/PLAN.md) | **언제·어떤 순서로** — P0~P11 과 출구 조건 |
| [`docs/LOG.md`](./docs/LOG.md) | **변경 이력** — 각 단계에서 무엇을 검증했고, 무엇이 실측으로 뒤집혔나 |

읽을 순서를 하나만 추천한다면 [`docs/TRD.md`](./docs/TRD.md) 의 **ADR-006** 이다. "블록 API 로 변환기 두 개를 만든다" 던 첫 설계가
공식 문서 확인 한 번으로 "Markdown 엔드포인트 + 정규화기 하나" 로 바뀐 과정이 3단으로 적혀 있다.
`docs/LOG.md` 에는 첫 골든 생성에서 카테고리 페이지 12개가 미러에 섞여 들어온 것을 발견해 고친 기록 같은,
**실행이 드러낸 결함**들이 그대로 남아 있다.

## 10. 라이선스

[MIT License](./LICENSE) — Copyright (c) 2026 Wondeuk Yoon.
자유롭게 가져다 쓰되, 실제 조직에 붙일 때는 [8절](#8-한계와-미확정)의 미실측 항목을 먼저 해소하기를 권한다.
