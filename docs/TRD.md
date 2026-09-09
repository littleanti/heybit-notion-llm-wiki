# TRD — heybit-notion-llm-wiki

- 문서 버전: 1.0 (2026-09-09) — P0 에서 0.1 초안으로 작성, P1~P8 의 구현·검증 결과를 반영해 확정
- 문서 역할: **어떻게** 만드는가 (아키텍처 · 계약 · 알고리즘 · 결정 기록 · 검증)
- 관련 문서: [PRD](./PRD.md) · [DESIGN](./DESIGN.md) · [PLAN](./PLAN.md) · [LOG](./LOG.md)

---

## 1. 목표와 비목표

**목표** — Notion 에 있는 실무 문서를 Claude Code 가 (a) 로컬 Markdown 으로 미러링하고,
(b) 위키로 합성하고, (c) Notion 에 게시하고, (d) 질문에 출처를 달아 답하는 데 필요한
**스크립트·스킬·규약**을, 외부 의존성 없이, Notion 토큰 없이도 전 기능을 테스트할 수 있는 형태로 만든다.

**비목표** — 권한 반영 답변, 실시간 동기화, 임베딩 검색, Notion 외 원본, 원본 자동 수정
([PRD 8절](./PRD.md#8-out-of-scope-범위-밖--이유와-함께)).

### 1.1 "LLM wiki" 패턴에서 그대로 둔 것 / 바꾼 것

| 패턴의 요소 | 이 프로젝트 | 왜 |
|---|---|---|
| raw 는 불변, LLM 은 raw 를 고치지 않는다 | **그대로.** `raw/` 는 동기화 스크립트만 쓴다 | 원본의 단일 출처가 Notion 이어야 사람이 어디를 고칠지 헷갈리지 않는다 |
| wiki 는 LLM 이 유지 | **그대로.** `wiki/` 는 스킬(Claude Code)만 쓴다 | — |
| index / log | **그대로**, 단 index 는 frontmatter 로부터 **스크립트가 결정적으로 생성** | LLM 이 색인을 손으로 관리하면 누락·중복이 생기고 재현이 안 된다 |
| schema 문서 (LLM 이 먼저 읽는 규칙) | 스킬 `references/wiki-schema.md` | 스킬 패키지 안에 있어야 다른 저장소로 옮겨도 규칙이 따라간다 |
| raw 의 출처 = 사람이 던져 넣는 파일 | **바꿈.** 출처는 Notion 이고 미러는 자동 | heybit 의 문서는 이미 Notion 에 있다 |
| wiki 의 독자 = LLM 과 저장소를 보는 사람 | **바꿈.** Notion 에 **게시**해 실무자가 Notion 안에서 읽는다 | 실무자는 Notion 을 벗어나지 않는다 (사용자 결정) |
| lint = LLM 이 수행 | **나눔.** 구조 lint 는 스크립트, 의미 lint 는 스킬 | 기계적으로 잡히는 것에 LLM 토큰을 쓰지 않는다 |

## 2. 아키텍처 개요

```
                    Notion 워크스페이스
   ┌───────────────────────────────────────────────────────────┐
   │  [서비스 A]                     [서비스 B]     [LLM Wiki 루트] │
   │   ├─ 상품기획 DB ─ 항목…          ├─ …           ├─ 색인       │
   │   ├─ CS DB ─ 항목…               │              ├─ 서비스 A   │
   │   ├─ 법무 (카테고리 페이지)        │              │   ├─ 개요   │
   │   │   ├─ 레거시 페이지 (원본)      │              │   ├─ CS 다이제스트
   │   │   └─ …                       │              │   └─ 토픽: 환불 정책
   │   └─ 법무 DB ─ [등록 항목: 원본→]  │              └─ 서비스 B … │
   └───────────┬──────────────────────────────────────┬────────┘
               │ ① sync (읽기 전용)                     │ ⑤ publish (루트 아래
               │   POST /search  · POST /data_sources/{id}/query   자기 페이지만 쓰기)
               │   GET  /pages/{id}/markdown           │   POST /pages (markdown)
               ▼                                        │   PATCH /pages/{id}/markdown replace_content
   ┌──────────────────────────── 로컬 작업 공간 (git) ───┴──────────────────────┐
   │  raw/<service>/<category>/<slug>.md   ← frontmatter(meta) + 본문(Notion MD) │
   │  raw/.sync-state.json  raw/.sync-report.md                                 │
   │                                                                            │
   │  ② build-index  ─→ wiki/index.md   (raw + wiki frontmatter 로 결정적 생성)   │
   │  ③ ingest (스킬) ─→ wiki/<service>/{overview,digest/*,topics/*,conflicts}.md │
   │                     wiki/log.md (append-only)                              │
   │  ④ lint (스크립트: 구조 / 스킬: 의미)                                         │
   │  wiki/.publish-state.json                                                  │
   │                                                                            │
   │  .claude/skills/notion-llm-wiki/  SKILL.md · references/ · scripts/         │
   │  notion-wiki.config.json · .env(NOTION_TOKEN, gitignore)                    │
   └────────────────────────────────────────────────────────────────────────────┘
               ▲
               │ query (스킬): index.md → wiki 페이지 → raw grep → 답변 + 출처 + 동기화 시각
          실무자 / 운영자 (Claude Code)
```

데이터는 **한 방향으로 흐른다**: Notion(원본) → raw → wiki → Notion(게시). 게시된 위키가
다시 raw 로 들어오는 **순환을 막는 것**이 설정 검증의 첫 항목이다 (5.2절).

## 3. 기술 스택과 검증 계획

> 이 절은 **실제로 실행해서 확인한 사실**과 **문서로만 확인한 사실**을 구분해 적는다.
> 개발 환경: Windows 10 Pro (19045), Node **v24.14.1**, npm 8.5.2, git 2.45.2.

| 영역 | 선택 | 근거 | 검증 상태 |
|---|---|---|---|
| 런타임 | Node.js `>=22` | 자매 저장소와 동일. 내장 `fetch`·`node:test`·`node:fs` 만 사용 → **의존성 0개**, `npm install` 불필요 | Node 24.14.1 로컬 실측(64 테스트). Node 22 는 P9 CI 매트릭스 |
| Notion API | REST, `Notion-Version: 2026-03-11` | 최신 버전. `2025-09-03` 의 data source 모델과 `2026-02-26` 의 Markdown 엔드포인트를 포함 | **공식 문서로 확인** (3.1). 실 워크스페이스 **미실측** |
| 본문 I/O | **Markdown 엔드포인트** (`GET /v1/pages/{id}/markdown`, `POST /v1/pages` + `markdown`, `PATCH /v1/pages/{id}/markdown`) | 블록 변환기를 만들지 않는다 (ADR-006) | 문서 확인. mock 으로 계약 고정 (T4·T12·T13) |
| 발견(discovery) | `POST /v1/search` + `POST /v1/data_sources/{id}/query` | 블록 트리 순회 없이 전체 목록과 `last_edited_time` 을 얻는다 (ADR-007) | 문서 확인. mock 으로 38 페이지 → 호출 59회 실측 |
| 설정 | `notion-wiki.config.json` + `.env` | dotenv 없이 `.env` 를 직접 파싱 (KEY=VALUE 줄) | 실측 (config 테스트 4건) |
| frontmatter | YAML **부분집합** (스칼라·문자열·불리언·숫자·스칼라 배열·평면 객체 배열) | 파서 의존성을 피한다. 부분집합 밖의 YAML 은 명시적으로 거부한다 | 실측 (라운드트립 T1) |
| 테스트 | `node:test` + golden 파일 + **주입식 mock fetch** | 토큰 없이 전 경로 실행 | 실측 — 64 테스트, 약 3초 |
| 스킬 | `.claude/skills/notion-llm-wiki/SKILL.md` | 공식 스킬 규약 (3.2) | 문서 확인 + 구조 테스트(T16) + 절차 문서만으로 위키 합성 실행(P6) |

### 3.1 Notion API — 문서로 확인한 사실 (2026-09-09)

구현이 의존하는 사실만 적는다. 각 항목은 공식 레퍼런스(developers.notion.com)에서 확인했다.
**실 워크스페이스에 대해 실측한 것은 없다** — 전부 "문서 확인" 상태이며, 토큰을 확보하면
[PRD 6절](./PRD.md#6-acceptance-기준)의 미확정 항목으로 해소한다.

| # | 사실 | 구현에 미치는 영향 |
|---|---|---|
| N1 | 최신 버전 `2026-03-11`. `2025-09-03` 에서 database(컨테이너)와 **data source(스키마+행)** 가 분리됨. `POST /v1/databases/{id}/query` 는 폐기, `POST /v1/data_sources/{id}/query` 사용 | 행 조회는 data source 단위. `GET /v1/databases/{id}` 는 `data_sources[]` 와 `parent` 를 준다 |
| N2 | `2026-03-11` 에서 `archived` → `in_trash` | 삭제 판정은 `in_trash` 로 |
| N3 | `GET /v1/pages/{id}/markdown` → `{ markdown, truncated, unknown_block_ids[] }`. 하위 페이지는 `<page url="…">제목</page>`, 하위 DB 는 `<database url="…">제목</database>` 로 렌더. 약 20,000 블록에서 절단. 파일 URL 은 **1시간 만료** pre-signed | 본문은 이 한 번의 호출로 끝. `truncated`/`unknown_block_ids` 를 frontmatter 에 기록 |
| N4 | `POST /v1/pages` 에 `markdown`(문자열) 을 주면 본문 생성. `children` 과 상호 배타. `properties.title` 을 생략하면 첫 `# h1` 이 제목 | 게시는 제목을 명시하고 본문 첫 줄에 h1 을 넣지 않는다 |
| N5 | `PATCH /v1/pages/{id}/markdown` `replace_content` 는 **본문 전체 교체**. 하위 페이지/DB 를 지우게 되면 `allow_deleting_content: true` 없이는 `validation_error` | 교체는 **하위 페이지가 없는 잎 페이지**에만. 컨테이너 페이지 본문은 교체하지 않는다 (6.2절) |
| N6 | "enhanced markdown": **탭 들여쓰기**, 표는 `<table>` 태그, 콜아웃 `<callout icon color>`, 토글 `<details>`, 멘션 `<mention-page url>`, 텍스트 밖 특수문자(`\ * ~ \` $ [ ] < > { } \| ^`) 이스케이프, 헤딩 5·6 → 4, 여러 줄 `>` 는 각각 별도 인용 블록 | 게시 전 **표준 MD → enhanced MD 정규화기**가 필요 (6.3절). raw 는 받은 그대로 저장 |
| N7 | `POST /v1/search`: `query` 없으면 **연결에 공유된 모든 페이지/data source** 를 반환. 결과 page 는 `parent`(`page_id` / `data_source_id`+`database_id` / `database_id` / `block_id` / `workspace`), `last_edited_time`, `properties`, `url`, `in_trash` 포함. 제목 일치 검색만 가능(전문 검색 아님) | 발견은 search 로. **검색 인덱스 지연은 문서화되지 않음 → 미확정** (ADR-007) |
| N8 | `POST /v1/data_sources/{id}/query`: 페이지네이션, `is_archived`, 10,000 행 상한, `request_status.type = incomplete` | 카테고리 DB 행은 이 경로로 **권위 있게** 나열 |
| N9 | rate limit 평균 **~3 req/s**, 429/529 시 `Retry-After`(초) | 토큰 버킷 3 rps + `Retry-After` 존중 + 지수 백오프 |
| N10 | 속성 값 형태: title/rich_text 는 rich text 배열, select `{name}`, multi_select `[{name}]`, status `{name}`, date `{start,end}`, people `[user]`(이름은 `name`), checkbox, url, relation `[{id}]`. select/multi_select 는 **없는 옵션 이름을 쓰면 자동 생성**, status 는 아님 | meta 매핑(6.1절). people 은 `name` 만 남긴다 (DR5) |
| N11 | `GET /v1/pages/{id}` 는 속성만 반환(본문 없음) | 속성 재조회가 필요할 때만 사용 |
| N12 | 연결(integration)은 기본적으로 **아무 페이지에도 접근 못 함** — 페이지 `•••` → Connections 에서 추가해야 하고, 하위에 상속 | README 의 설치 절차. 서비스 루트와 위키 루트 각각 연결 |
| N13 | 요청 한도: 블록 100개/요청, rich text 2,000자, 1,000 블록 요소·500KB/요청 | Markdown 엔드포인트를 쓰면 블록 분할은 서버가 처리. 500KB 를 넘는 위키 페이지는 **만들지 않는다**(lint 상한 200KB) |
| N14 | 공식 JS SDK `@notionhq/client` 5.x 가 위 버전을 지원 | **쓰지 않는다** (의존성 0개 원칙). 호출 수가 적고 fetch 로 충분 |

### 3.2 Claude Code 스킬 규약 — 문서로 확인한 사실

- 프로젝트 스킬은 `.claude/skills/<name>/SKILL.md`. `/<name> <args>` 로 직접 호출하거나
  `description` 에 근거해 자동 호출된다.
- frontmatter: `name`, `description`(자동 호출 근거, `when_to_use` 와 합쳐 1,536자 이내),
  `argument-hint`, `disable-model-invocation`, `allowed-tools`, `model`, `context: fork`, `agent` 등.
- 치환 변수: `$ARGUMENTS`(전체), `$0`/`$1`(위치), `${CLAUDE_SKILL_DIR}`(스킬 디렉터리 절대 경로),
  `${CLAUDE_PROJECT_DIR}`.
- `` !`command` `` 로 SKILL.md 본문에 셸 출력 주입 가능.
- 권장 구조: SKILL.md 500줄 이내, 상세는 `references/`·`scripts/` 로 분리해 필요할 때 읽게 한다.
- 서브커맨드는 공식 기능이 아니다. 단일 스킬 + 인자 분기 또는 스킬 여러 개. → 이 프로젝트는
  **단일 스킬 + `$0` 분기**를 택한다 (ADR-008).
- 검증: `claude plugin validate <dir> --strict`. **미확정**: `allowed-tools` 안에서
  `${CLAUDE_SKILL_DIR}` 치환이 되는지 — 되지 않을 것을 전제로 프로젝트 상대 경로를 쓴다.

## 4. 저장소 구조

```
heybit-notion-llm-wiki/
├── CLAUDE.md                          그라운드 룰
├── README.md
├── LICENSE                            MIT
├── package.json                       scripts 만 (의존성 0개)
├── notion-wiki.config.json            서비스·카테고리·속성 매핑·루트 페이지 id
├── .env.example                       NOTION_TOKEN=
├── .gitignore                         .env, raw/.sync-state.json 은 커밋(재현용) — 아래 참조
│
├── docs/                              PRD · TRD · DESIGN · PLAN · LOG
│
├── .claude/skills/notion-llm-wiki/
│   ├── SKILL.md                       진입점. $0 로 sync/ingest/query/lint/publish 분기
│   ├── references/
│   │   ├── wiki-schema.md             위키 규칙 (페이지 종류·상한·출처·모순·신선도) — ingest/query 가 먼저 읽는다
│   │   ├── ingest-procedure.md        변경분 → 위키 갱신 절차
│   │   ├── query-procedure.md         3층 검색 절차와 답변 형식
│   │   ├── lint-semantic.md           의미 lint 체크리스트
│   │   └── notion-authoring.md        실무자용 작성 규약 요약 (DESIGN 1·2절의 사본이 아니라 링크)
│   └── scripts/
│       ├── sync.js                    Notion → raw
│       ├── build-index.js             raw+wiki → wiki/index.md
│       ├── lint.js                    구조 lint
│       ├── publish.js                 wiki → Notion (dry-run 기본, --apply)
│       ├── register-legacy.js         (선택) 카테고리 페이지 하위 일반 페이지 → DB 등록 항목 생성
│       └── lib/
│           ├── notion-client.js       fetch 래퍼: 인증·버전·토큰 버킷·429 재시도·페이지네이션
│           ├── config.js              설정·.env 로드·검증
│           ├── frontmatter.js         YAML 부분집합 직렬화/파싱
│           ├── meta.js                Notion properties ↔ frontmatter 매핑
│           ├── slug.js                파일명 생성
│           ├── md-notion.js           표준 MD → enhanced MD 정규화, 링크 해석
│           └── report.js              동기화 리포트 작성
│
├── raw/                               샘플 미러 (fixture 워크스페이스에서 생성한 golden)
│   ├── .sync-state.json
│   ├── .sync-report.md
│   ├── routinefit/{product-planning,product-description,product-dev,cs,legal,marketing,misc}/*.md
│   └── moneynote/…
│
├── wiki/                              샘플 위키 (스킬 ingest 로 합성)
│   ├── index.md  log.md
│   ├── routinefit/{overview.md, digest/*.md, topics/*.md, conflicts.md}
│   └── moneynote/…
│
└── test/
    ├── fixtures/workspace.json        mock Notion 워크스페이스 (페이지·data source·markdown 본문)
    ├── fixtures/mutations/*.json      A3~A5·A12 용 변형
    ├── golden/                        기대 출력 (index, publish dry-run, lint 결과…)
    ├── helpers/mock-notion.js         fixture 를 서빙하는 주입식 fetch (search/query/markdown/pages)
    └── *.test.js
```

`raw/.sync-state.json` 은 보통은 커밋하지 않을 파일이지만, 이 샘플에서는 **"mock 워크스페이스에
2회 동기화하면 호출 0건"**(A2) 을 clone 직후 재현하기 위해 커밋한다. 실사용 저장소에서는
gitignore 에 넣어도 되고 커밋해도 된다 — 커밋하면 팀원 간 증분 상태가 공유된다.

## 5. 설정 (`notion-wiki.config.json`)

```jsonc
{
  "notionVersion": "2026-03-11",
  "services": [
    { "name": "루틴핏",  "slug": "routinefit", "rootPageId": "<page id>" },
    { "name": "머니노트", "slug": "moneynote",  "rootPageId": "<page id>" }
  ],
  "categories": [
    { "name": "상품기획", "slug": "product-planning" },
    { "name": "상품설명", "slug": "product-description" },
    { "name": "상품개발", "slug": "product-dev" },
    { "name": "CS",      "slug": "cs" },
    { "name": "법무",     "slug": "legal" },
    { "name": "마케팅",   "slug": "marketing" },
    { "name": "기타",     "slug": "misc", "fallback": true }
  ],
  "wiki": { "rootPageId": "<page id>", "indexTitle": "색인" },
  "properties": {                      // Notion 속성 이름 → 내부 키. 조직마다 바꿀 수 있다
    "title": "제목", "service": "서비스", "category": "카테고리",
    "docType": "문서유형", "status": "상태", "authorType": "작성주체",
    "owner": "담당자", "summary": "요약", "keywords": "키워드", "tags": "태그",
    "reviewBy": "검토기한", "verifiedAt": "최종확인일",
    "sensitivity": "비밀등급", "exclude": "위키제외", "source": "원본", "related": "관련 페이지"
  },
  "sync": {
    "sensitiveValues": ["민감"],
    "excludeWhenUnset": false,         // 비밀등급이 비어 있으면 동기화(true 면 제외)
    "rps": 3
  },
  "paths": { "raw": "raw", "wiki": "wiki" }
}
```

### 5.2 설정 검증 (기동 시)
1. 서비스 `slug` 와 카테고리 `slug` 는 `^[a-z0-9-]+$`, 중복 없음. `fallback` 카테고리 정확히 1개.
2. **위키 루트가 어느 서비스 루트의 하위이면 거부** — 위키가 자기 출력을 다시 먹는 순환.
   (fixture 로 재현: 위키 루트를 서비스 아래에 둔 설정 → 기동 실패, A12 계열)
3. `NOTION_TOKEN` 은 `sync`/`publish --apply`/`register-legacy` 에만 필요. 없으면 그 명령만 거부하고
   이유를 출력한다. `build-index`/`lint`/`publish`(dry-run) 은 토큰 없이 돈다.

## 6. 모듈 계약

### 6.1 `sync.js` — Notion → raw

**입력**: 설정, `.env`, `raw/.sync-state.json`(없으면 빈 상태). **출력**: `raw/**.md`,
갱신된 상태 파일, `raw/.sync-report.md`, 표준출력 요약. **Notion 에 쓰지 않는다.**

알고리즘:

```
1. 발견
   a. search(object=page)        → 공유된 모든 page (parent, last_edited_time, properties, url, in_trash)
   b. search(object=data_source) → 공유된 모든 data source (id, parent database)
   c. 조상 해석: page.parent 를 따라 올라가 서비스 루트에 닿는지 판정
      - parent.page_id  → 결과 집합에서 찾고, 없으면 GET /pages/{id} (캐시)
      - parent.data_source_id → parent.database_id → GET /databases/{id}.parent (캐시, 상태 파일에 저장)
      - 위키 루트 하위 / 어느 루트에도 닿지 않음 → 범위 밖
   d. 범위 안 data source 각각 → query(전체 페이지네이션) → 행(page) 목록 (권위 있는 목록)
   e. 후보 = (a 중 범위 안 페이지) ∪ (d 의 행). id 로 중복 제거.
      **카테고리 페이지**(서비스 루트 직속 + 제목이 설정의 카테고리 이름과 일치)는 컨테이너로 보고 후보에서 뺀다
      (구현 중 발견: 빼지 않으면 "CS", "법무" 같은 빈 페이지가 `misc` 로 미러된다).
2. meta 추출 (lib/meta.js)
   - 카테고리: 속성 `카테고리` > 조상 중 카테고리 이름과 일치하는 페이지/DB 제목 > fallback
   - 서비스: 조상 루트
   - 등록 항목(`원본` url 있음): 원본 page id 추출 → 본문은 원본에서, meta 는 등록 항목에서.
     원본 페이지가 후보에도 있으면 **원본 단독 항목은 제거**(등록 항목이 대표)
   - 제외: sensitivity ∈ sensitiveValues 또는 exclude=true (또는 excludeWhenUnset && 비어 있음)
3. 변경 판정
   - key = 대표 page id. 비교값 = 등록 항목 last_edited_time + 원본 last_edited_time
   - 상태와 같으면 skip. 다르면 GET /pages/{원본 id}/markdown
4. 쓰기
   - 경로 raw/<service>/<category>/<slug>.md, slug = sanitize(title) + '-' + id 앞 6자 (lib/slug.js)
   - 제목·카테고리가 바뀌어 경로가 달라지면 옛 파일 삭제 + 새 파일 (리포트에 "이동")
   - frontmatter (DESIGN 4절) + 빈 줄 + 본문(받은 enhanced markdown 그대로)
   - 본문 후처리 1가지만: <page url> / <mention-page url> 의 대상이 미러 안에 있으면
     `[제목](../<category>/<slug>.md)` 상대 링크를 **덧붙인다** (원문 태그는 유지)
5. 삭제
   - 상태에 있으나 후보에 없거나 in_trash → 파일 삭제. 제외로 바뀐 것도 삭제 (FR2.3)
6. 상태·리포트
   - state: { version, syncedAt, pages: { id: { path, lastEdited, sourceId, sourceLastEdited, excluded } }, databases: { id: parentPageId } }
   - report: 추가/변경/이동/삭제/제외/실패/절단(truncated)/미지원 블록 수, 소요 호출 수
```

실패 처리: 페이지 하나의 markdown 조회가 실패하면 그 페이지만 `실패` 로 리포트하고 계속한다.
상태 파일은 **성공한 페이지만** 갱신한다 (다음 실행에서 재시도).

### 6.2 `publish.js` — wiki → Notion

**입력**: `wiki/**.md`(index/log 포함, `_` 로 시작하는 파일 제외), `wiki/.publish-state.json`,
`raw/**` frontmatter(링크 해석용). **기본은 dry-run** — 만들/바꿀 페이지와 본문 크기를 출력하고
Notion 에 쓰지 않는다. `--apply` 일 때만 쓴다.

Notion 트리와 파일의 대응:

| 파일 | Notion 페이지 | 본문 정책 |
|---|---|---|
| `wiki/index.md` | 위키 루트 / **색인** | 잎 → `replace_content` |
| `wiki/log.md` | 위키 루트 / **변경 이력** | 잎 → `replace_content` |
| (없음) | 위키 루트 / **<서비스명>** (컨테이너) | 최초 1회 생성. 이후 본문 **교체하지 않음** (하위 페이지를 품고 있어 N5) |
| `wiki/<svc>/overview.md` | <서비스명> / 개요 | 잎 |
| `wiki/<svc>/digest/<cat>.md` | <서비스명> / <카테고리> 다이제스트 | 잎 |
| `wiki/<svc>/topics/<slug>.md` | <서비스명> / 토픽: <제목> | 잎 |
| `wiki/<svc>/conflicts.md` | <서비스명> / 충돌·미확정 | 잎 |

알고리즘:

```
1. 상태 로드. 각 파일의 frontmatter 파싱, 제목 결정 (DESIGN 3절 규칙).
2. 안전 검사 (--apply 일 때, 쓰기 전에 전부 수행)
   - 상태의 모든 page id 에 대해 GET /pages/{id}: parent 가 위키 루트 또는 우리 컨테이너인지 확인.
     아니면 **전체 중단** (A12). 매핑에 없는 id 는 절대 대상이 되지 않는다.
3. 1단계: 컨테이너·잎 중 상태에 없는 것을 POST /pages 로 생성 (제목 + 최소 본문 "생성 중").
   생성된 id 를 상태에 즉시 기록 (중간 실패 시 중복 생성 방지).
4. 링크 해석 (lib/md-notion.js)
   - `raw/...md` 링크 → 해당 raw frontmatter 의 source_url (원본 Notion URL)
   - `wiki/...md` / 상대 링크 → 상태의 게시 URL
   - 해석 불가 링크는 텍스트만 남기고 리포트
5. 정규화: 표준 MD → enhanced MD (6.3). 상단에 마커 콜아웃 삽입 (FR6.4). frontmatter 제거.
6. 2단계: 본문 해시(sha256) 가 상태와 다른 잎만 PATCH replace_content (allow_deleting_content: false).
   컨테이너는 건너뜀. 해시 갱신.
7. 상태에 있으나 파일이 사라진 잎 → **삭제하지 않고** 리포트에 "고아 게시 페이지" 로 표시
   (사람이 Notion 에서 정리. 자동 삭제는 되돌리기 어렵다)
```

`--apply` 2회 실행 시: 3단계 생성 0건, 6단계 교체 0건 (해시 동일) → A11.

### 6.3 `lib/md-notion.js` — 표준 MD → enhanced MD

우리 위키는 Claude 가 쓰기 편한 **표준 Markdown** 으로 유지하고, 게시 직전에만 변환한다.

| 표준 | enhanced | 비고 |
|---|---|---|
| 파이프 표 `\| a \| b \|` | `<table header-row="true"><tr><td>…</td></tr></table>` | 셀 안 인라인 서식만 허용 (N6) |
| 목록 중첩 (스페이스 2/4) | 탭 들여쓰기 | 깊이 = ⌊스페이스/2⌉ 규칙을 고정하고 골든으로 검증 |
| 연속 `>` 줄 | 한 인용 블록 + `<br>` | N6 |
| `#####`, `######` | `####` | 서버도 같은 변환을 하지만 명시적으로 |
| 텍스트의 `< > { } $ ^ \|` | `\<` 등 이스케이프 | 코드 스팬·코드 블록·우리가 생성한 태그 안은 제외 |
| `~` 단독 | `\~` | `~~취소선~~` 은 유지 |
| frontmatter | 제거 | 제목은 properties.title 로 |
| 링크 | 6.2 의 4단계 | — |
| 콜아웃 마커 | `<callout icon="🤖" color="gray_bg">…</callout>` | 첫 블록 |

변환기는 **순수 함수**로 두고 골든 테스트로 고정한다. 실 Notion 렌더 결과는 미실측 —
변환 규칙 자체가 틀렸다면 fixture 도 같이 틀린다는 한계를 명시한다.

### 6.4 `build-index.js`

`raw/**.md` 와 `wiki/**.md`(index/log 제외) 의 frontmatter 만 읽어 `wiki/index.md` 를 만든다
(DESIGN 5절 형식). 정렬은 설정의 서비스 순 → 카테고리 순 → 제목(코드 포인트) 순. 같은 입력이면
**바이트까지 같은 출력** (A8) — 벽시계를 쓰지 않는다(생성 시각 없음, `⏰` 기준일 = `raw/.sync-state.json` 의 `syncedAt` 날짜).
이 성질 덕분에 CI 가 색인을 다시 만들어 diff 로 "갱신을 잊은 커밋" 을 잡는다. 본문은 읽지 않으므로 수백 페이지에서도 1초 미만을 목표로 한다.

> 처음 구현은 헤더에 `생성: <현재 시각>` 을 넣었고, 테스트는 시각을 주입해 통과했다. **첫 CI 실행이 이것을 잡았다**
> (재생성 diff 가 매번 생김). 결정성은 "테스트에서 시각을 고정할 수 있다" 가 아니라 "실제 실행이 시각에 의존하지 않는다" 여야 했다.

### 6.5 `lint.js` — 구조 lint

| 코드 | 등급 | 검사 | 대상 |
|---|---|---|---|
| L1 `meta-missing` | 경고 | 필수 meta(제목·문서유형·상태·요약·담당자) 누락. 등록 항목 없는 레거시 페이지는 `meta-missing` + 안내 | raw |
| L2 `meta-invalid` | 오류 | 허용값 밖 (문서유형·상태·작성주체·비밀등급), 날짜 형식, 설정에 없는 서비스/카테고리, **미러에 남은 `민감` 페이지**(있을 수 없는 상태) | raw |
| L3 `link-broken` | 오류 | 상대 링크 대상 파일 없음 | raw, wiki |
| L4 `orphan-wiki` | 오류 | wiki 페이지가 index 에 없음 / index 가 가리키는 파일 없음 | wiki |
| L5 `source-missing` | 오류 | wiki `sources` 가 비었거나 가리키는 raw 없음, 또는 H2 섹션에 링크(raw·wiki `.md` 또는 notion.so URL) 0개 | wiki |
| L6 `stale` | 경고 | raw `review_by` 경과, 또는 wiki `sources` 의 raw 가 wiki `updated` 이후 바뀜 | raw, wiki |
| L7 `frontmatter-invalid` | 오류 | YAML 부분집합 파싱 실패, 필수 키 없음, wiki `type`·`updated`·`sources` 형식 | 둘 다 |
| L8 `too-large` | 오류 | wiki 페이지 200KB 초과, index 2,000줄 초과 (ADR-002 임계) | wiki |

**경고와 오류를 나누는 이유**: 샘플 raw 에는 meta 없는 레거시 페이지와 검토기한 경과 페이지가 **의도적으로**
들어 있다. 이것들은 Notion 에서 사람이 처리해야 할 운영 신호이고 위키의 충돌·미확정 페이지가 보여 주는
대상이지, 저장소가 깨진 것이 아니다. CI 가 그것 때문에 실패하면 lint 는 곧 무시된다.

출력은 `E|W <코드> <경로>: <메시지>` 한 줄씩 + 요약. **오류가 하나라도 있으면 종료 코드 1**, 경고만 있으면 0
(`--strict` 면 경고도 1). `--json` 으로 기계가 읽을 수 있게도 낸다. **고치지 않는다.**

### 6.6 `lib/notion-client.js`

```js
createClient({ token, version, rps, fetchImpl, sleepImpl, log })
  .request(method, path, { body, query })     // JSON in/out, 429/529 → Retry-After 대기 후 재시도(최대 6회, 지수+지터)
  .paginate(method, path, body)               // start_cursor/next_cursor 를 따라 results 를 이어 붙임
  .stats()                                    // 호출 수 (테스트에서 A2 확인)
```

`fetchImpl`·`sleepImpl` 을 주입할 수 있어 테스트는 실제 네트워크와 시간을 쓰지 않는다.

### 6.7 `test/helpers/mock-notion.js`

fixture(`workspace.json`) 를 읽어 다음을 흉내 내는 `fetch` 함수를 만든다:
`POST /v1/search`(필터·페이지네이션 100개), `POST /v1/data_sources/{id}/query`,
`GET /v1/pages/{id}`, `GET /v1/databases/{id}`, `GET /v1/pages/{id}/markdown`,
`POST /v1/pages`, `PATCH /v1/pages/{id}/markdown`, 그리고 옵션으로 **N번째 요청에 429 + Retry-After**.
쓰기 요청은 메모리 상의 워크스페이스를 바꾸고 기록한다 (A11 의 요청 수 검증).

## 7. 데이터 모델 요약

frontmatter 의 정확한 키·허용값·예시는 [DESIGN 4절](./DESIGN.md#4-raw-frontmatter--notion-속성-매핑)에,
위키 페이지 frontmatter 는 [DESIGN 3절](./DESIGN.md#3-위키-페이지-종류와-템플릿)에 둔다.
여기서는 불변 규칙만 적는다:

- raw 파일의 **정체성은 Notion page id** 다. 경로는 제목·카테고리에 따라 바뀔 수 있다.
- wiki 파일의 정체성은 **경로**다. 게시 상태는 경로 → Notion page id 매핑이다.
- `sources` 는 raw **경로**를 가리킨다. raw 경로가 바뀌면(이동) lint L5 가 잡고 ingest 가 고친다.

## 8. 보안

| 위험 | 대응 |
|---|---|
| 토큰 유출 | `.env` gitignore. 스크립트는 토큰을 로그·리포트·상태에 쓰지 않는다. 에러 메시지에서 `Authorization` 헤더를 찍지 않는다 |
| 민감 문서가 위키에 들어감 | `민감`/`위키제외` 는 미러 단계에서 차단 (FR2.3). 이미 미러된 파일도 삭제. lint 가 raw 에 `sensitivity: 민감` 이 있으면 L2 로 지적 (있을 수 없는 상태) |
| 게시기가 원본을 덮어씀 | 매핑 + parent 확인 (6.2 2단계). 매핑에 없는 페이지는 대상이 될 수 없음. 동기화기는 쓰기 코드 경로가 없음 |
| 위키가 자기 출력을 재수집 | 설정 검증 5.2-2 + sync 조상 판정에서 위키 루트 하위 제외 |
| 사람 식별 정보 | people 속성은 `name` 만. 이메일·id 폐기 (DR5) |
| Notion 파일 URL 만료 | 그대로 두고 frontmatter 주석으로 명시. 다운로드는 범위 밖 |
| 요청 폭주 | 토큰 버킷 3 rps, `Retry-After` 존중 |

## 9. 테스트 전략

| ID | 대상 | 방법 |
|---|---|---|
| T1 | frontmatter 직렬화/파싱 라운드트립 | 단위. 한국어·콜론·따옴표·빈 배열 |
| T2 | slug | 단위. 금지 문자, 길이 상한, NFC 정규화, 중복 회피 |
| T3 | meta 매핑 | 단위. 속성 타입 10종, 비어 있는 값, 이름 매핑 변경 |
| T4 | sync 골든 | mock 워크스페이스 → raw/ 전체 비교 (A1) |
| T5 | sync 증분 | 2회 실행 호출 수 (A2), 1건 변경 (A3) |
| T6 | sync 제외·삭제 | 민감/제외/휴지통 변형 (A4, A5) |
| T7 | sync 등록 항목 | 원본 링크 따라가기, 단독 원본 제거 (A7) |
| T8 | sync 순환 방지 | 위키 루트 하위 페이지가 후보에 없음; 위키 루트가 서비스 하위인 설정 거부 |
| T9 | build-index 골든·결정성 | (A8) |
| T10 | lint | 결함 7종 각각 + 무결함 (A9) |
| T11 | md-notion 정규화 골든 | 표·중첩 목록·이스케이프·인용·링크 해석 |
| T12 | publish dry-run 골든 | (A10) |
| T13 | publish apply 멱등 | mock 에 2회 (A11) |
| T14 | publish 안전 검사 | 루트 밖 id 거부 (A12) |
| T15 | client 재시도 | 429 + Retry-After 대기·재시도, 페이지네이션 (A13) |
| T16 | 스킬 구조 | SKILL.md frontmatter 필드, 5개 서브커맨드가 references 를 가리킴 (A15) |

`npm test` = `node --test "test/*.test.js"`. CI 는 Node 22·24 매트릭스.

---

<a id="adr"></a>
## 10. 결정 기록 (ADR) — 3단 사고 형식

### ADR-001 — 위키는 어디에, 작업은 어디서

**1차 사고.** 실무자가 Notion 안에서 읽어야 하니 위키는 Notion 페이지다. 만드는 주체가
Claude Code 라면 Notion MCP 로 원본을 읽고 위키 페이지를 직접 써도 된다 — 로컬 파일이 필요 없다.

**비판적 재사고.**
- 공격 ①: **수백 페이지를 MCP 로 매번 읽으면?** 페이지당 수천 토큰 × 수백 = 컨텍스트 한계를
  바로 넘는다. 게다가 "무엇이 바뀌었는가" 를 알 수 없어 매번 전체를 읽어야 한다.
- 공격 ②: **Notion 검색 API 로 grep 을 대체할 수 있나?** 없다 — 제목 일치 검색만 한다(N7).
  "환불" 이 본문에만 있는 페이지는 못 찾는다.
- 공격 ③: **로컬 미러가 없으면 lint·diff·이력이 없다.** 위키가 어제와 무엇이 달라졌는지,
  어느 원본이 바뀌어 위키가 낡았는지 판정할 근거가 없다.
- 반대 방향의 공격 ④: **로컬 미러는 낡는다.** 질의 시점에 Notion 이 더 최신일 수 있다.
  → 증분 동기화는 검색 몇 번 + 변경 페이지 수만큼의 호출이라 수십 초 안에 끝난다. 그래도 남는
  간극은 답변에 **동기화 시각을 표기**해 독자가 판단하게 한다 (FR4.2). 완전히 없앨 수는 없다.

**종합.** 원본 = Notion, 작업 공간·검색 대상 = 로컬 미러(git), 게시면 = Notion 의 위키 루트.
벌크 I/O 는 REST 스크립트, MCP 는 사람이 단건을 확인할 때의 선택지로만 둔다.
**미확정**: 조직의 편집 빈도가 매우 높으면(시간당 수십 건) 동기화 주기를 어떻게 잡아야 하는지 — 실측 없음.

### ADR-002 — RAG 없이 검색 가능한 구조

**1차 사고.** 임베딩 없이는 "환불" 로 "취소 정책" 을 못 찾는다. 결국 벡터 검색이 필요하다.

**비판적 재사고.**
- 공격 ①: **규모를 따져봤나?** 수십~수백 페이지다. 페이지당 한 줄(경로·유형·상태·요약·키워드
  ≈ 150~250자)의 색인은 300페이지에 60KB 안팎, 한국어 기준 대략 2~3만 토큰 — **한 번에 읽을 수
  있는 크기**다. 임베딩이 해결하는 문제(코퍼스가 컨텍스트에 안 들어감)가 이 규모에선 없다.
- 공격 ②: **동의어 문제는?** grep 은 문자열 일치다. → 두 겹으로 흡수한다.
  (a) meta 의 `키워드` 속성에 작성자가 별칭을 적는다(환불·취소·refund). (b) 위키 **토픽 페이지**가
  주제 단위로 원본을 묶어 두므로, "환불" 토픽 페이지를 찾으면 "취소 정책" 원본으로 이어진다.
  즉 동의어 해소를 **작성 시점(meta)과 합성 시점(위키)** 에 사람과 LLM 이 하고, 질의 시점에는
  일치 검색만 한다.
- 공격 ③: **RAG 가 잃는 것은?** 청킹은 frontmatter(상태·유효기간)와 페이지 경계를 잃는다. 검색된
  청크가 폐기된 초안인지 알 수 없다. 이 프로젝트의 문제("무엇이 최신인가") 에 정면으로 불리하다.
- 공격 ④: **깨지는 지점은?** 색인이 한 번에 못 읽히는 규모. 임계: **index 2,000줄 또는 200KB**.
  넘으면 서비스별 index 로 분할한다(구조는 이미 서비스별로 나뉘어 있어 분할이 자연스럽다).
  lint L8 이 임계 접근을 경고한다.

**종합.** 3층 경로 — ① `wiki/index.md`(요약으로 후보 선정) → ② 위키 다이제스트/토픽(합성된 답)
→ ③ `raw/` grep·읽기(원문 확인). 임베딩은 임계를 넘기 전까지 도입하지 않는다.
**미확정**: 한국어 색인의 실제 토큰 수 — 샘플 30페이지로 측정해 외삽할 뿐, 300페이지 실측은 없다.

### ADR-003 — meta 는 어디에 두는가

**1차 사고.** 모든 페이지 상단에 2열 표(속성/값)를 두면 DB 전환 없이 끝난다.

**비판적 재사고.**
- 공격 ①: 표는 **형식을 강제하지 못한다.** 열을 지우거나 오타를 내도 아무것도 막지 않는다.
  API 로 파싱하려면 표 구조와 라벨을 추측해야 하고, 사람마다 다른 표기가 나온다.
- 공격 ②: Notion DB 속성은 **타입·선택지·템플릿·뷰·필터**를 준다. "상태=초안인 문서만 보기" 가
  DB 에서는 클릭 한 번이지만 표에서는 불가능하다. AI 작성 페이지에 `작성주체=AI` 를 강제하는 것도
  DB 템플릿으로만 확실하다.
- 공격 ③(DB 쪽 공격): **기존 페이지를 전부 옮겨야 하나?** 이관은 링크가 깨지고 이력이 사라진다.
  → **등록 항목** 으로 해결: DB 에 meta + `원본` 링크만 담은 항목을 만들고, 본문은 원본에 둔다.
  동기화기가 링크를 따라간다. 이관 0건. (사용자가 이 방향을 선택했다, 2026-09-09)
- 공격 ④: 등록 항목과 원본, **두 페이지가 존재하면 혼란은?** 원본이 검색에도 잡히고 등록 항목도
  잡힌다. → 동기화기가 원본 단독 항목을 제거하고 등록 항목을 대표로 삼는다. 위키의 출처 링크는
  **원본**을 가리킨다(사람이 읽을 본문이 거기 있다).

**종합.** 하이브리드. 신규 = 카테고리 DB 항목, 레거시 = 등록 항목 + 원본 유지.
등록 항목 없는 레거시 페이지도 동기화하되 lint 가 `meta-missing` 으로 지적해 등록을 유도한다.

### ADR-004 — 위키 페이지의 종류와 개수

**1차 사고.** 원본 페이지마다 요약 위키 페이지 하나씩 만들면 구조가 단순하다.

**비판적 재사고.**
- 공격 ①: 원본 300개 → 위키 300개. 원본이 바뀔 때마다 갱신할 페이지가 1:1 로 늘고, 위키가
  원본의 요약본에 그쳐 **합성(여러 원본을 종합)** 의 가치가 없다. 그건 색인이 이미 한다.
- 공격 ②: 반대로 **서비스당 한 장**이면? 6개 카테고리 × 수십 원본을 한 페이지에 넣으면 길고,
  카테고리 실무자가 자기 부분만 보기 어렵다. Notion 에서는 긴 페이지가 느리다.
- 공격 ③: 카테고리를 가로지르는 질문(환불: CS 문구 vs 법무 검토 vs 기획 정책)은 카테고리
  다이제스트로는 답이 안 된다 → **토픽 페이지**가 필요하다. 그런데 토픽을 무한정 만들면 ①과 같다.
  → 토픽은 "원본 2개 이상, 카테고리 2개 이상에 걸친 주제" 에만 만든다는 기준을 둔다.

**종합.** 서비스별: 개요 1 + 카테고리 다이제스트(카테고리 수) + 토픽(기준 충족 시) +
충돌·미확정 1. 전체: 색인 1 + 이력 1. 300페이지 조직에서 위키는 대략 30~50페이지.
상한을 넘기려는 ingest 는 wiki-schema 가 막는다.

### ADR-005 — 위키 페이지의 편집 소유권

**1차 사고.** 사람도 위키를 고칠 수 있어야 유용하다.

**비판적 재사고.**
- 공격 ①: 사람이 Notion 위키 페이지를 고치면 다음 `publish` 의 `replace_content` 가 **덮어쓴다.**
  덮어쓰지 않으려면 게시기가 Notion 쪽 변경을 읽어 병합해야 하고, 그러면 위키의 출처가
  둘(raw, 사람 편집)이 되어 lint 가 성립하지 않는다.
- 공격 ②: 그렇다고 사람 의견을 막으면 오류가 고쳐지지 않는다. → 두 경로를 열어 둔다:
  (a) **원본을 고친다** — 위키가 틀렸다면 대개 원본이 모호하거나 모순된 것이다.
  (b) **페이지 코멘트**를 남긴다 — 운영자가 다음 ingest 때 반영한다.
- 공격 ③: 블록 교체 시 **블록에 달린 코멘트는 사라질 것**이다(블록이 삭제되므로). 페이지 코멘트는
  남을 것이다. → 마커 문구에 "페이지 코멘트로" 를 명시한다. **미실측**.

**종합.** 위키 페이지는 스킬 소유. 상단 마커 콜아웃으로 명시(FR6.4). 사람은 원본 수정 또는
페이지 코멘트. 코멘트 자동 수집은 범위 밖(PRD 8절).

### ADR-006 — 본문 I/O 는 블록 API 가 아니라 Markdown 엔드포인트

**1차 사고.** `GET /blocks/{id}/children` 을 재귀 호출해 블록 트리를 받고 Markdown 으로 변환한다.
게시는 반대로 Markdown → 블록 JSON 을 만들어 `PATCH /blocks/{id}/children` 으로 붙인다.
블록 32종의 변환 표를 만들고 골든으로 고정한다. (P0 초기 설계)

**비판적 재사고.**
- 공격 ①: **공식 문서를 확인했나?** 확인 결과, Notion 은 2026-02-26 부터 페이지 본문을 Markdown 으로
  읽고(`GET /pages/{id}/markdown`), 만들고(`POST /pages` + `markdown`), **통째로 교체**하는
  (`PATCH /pages/{id}/markdown` `replace_content`) 엔드포인트를 제공한다 (N3~N5).
  블록 API 에는 "교체" 가 없어 삭제 N회 + 추가로 흉내 내야 했는데, 그 문제가 사라진다.
- 공격 ②: **호출 수.** 블록 방식은 페이지당 1+⌈블록/100⌉ 회 + 중첩 블록마다 추가. 300페이지면
  수백~천 회 → 3 rps 에서 수 분. Markdown 방식은 **페이지당 1회**.
- 공격 ③: **코드 표면.** 변환기 두 개(블록→MD, MD→블록)는 수백 줄이고, 실 Notion 에 대해
  실측할 수 없는 조건에서 가장 틀리기 쉬운 부분이다. 없는 코드는 틀리지 않는다.
- 공격 ④(Markdown 쪽 공격): **enhanced markdown 은 표준이 아니다.** 탭 들여쓰기, `<table>`, 이스케이프
  규칙(N6). → raw 는 받은 그대로 저장한다(Claude 는 태그를 읽는 데 문제가 없고 grep 도 된다).
  게시 방향만 **정규화기**가 필요하다(6.3) — 변환기 두 개가 정규화기 한 개로 줄어든 것이다.
- 공격 ⑤: **신생 API 의 변경 위험.** 도입 7개월. → 버전 헤더로 고정하고, Notion 의 버전 정책
  (호환성 깨지는 변경은 새 버전으로만)에 의존한다. 폐기되면 그때 블록 경로를 추가한다.
- 공격 ⑥: **하위 DB 행이 본문에 안 들어오면?** `<database>` 태그만 온다(N3). 행은 어차피 발견
  단계(search/query)에서 별도 페이지로 잡히므로 문제가 아니다 — 오히려 원하는 동작이다.
- 공격 ⑦: **`replace_content` 가 하위 페이지를 지우는 경우.** `allow_deleting_content: false` 로
  막힌다 → 교체는 잎 페이지에만, 컨테이너 본문은 불변으로 설계한다(6.2).

**종합.** Markdown 엔드포인트 채택. 블록 API 는 쓰지 않는다. `truncated`·`unknown_block_ids` 는
frontmatter 에 기록해 손실을 숨기지 않는다.
**미확정**: 실 렌더 fidelity(정규화기의 출력이 Notion 에서 의도대로 보이는지), 20,000 블록 절단의
실제 위치, 한국어 특수문자 이스케이프의 실제 동작 — 전부 토큰 확보 후 실측 항목.

### ADR-007 — 발견은 블록 트리 순회가 아니라 search + data source query

**1차 사고.** 서비스 루트에서 `GET /blocks/{id}/children` 을 재귀해 `child_page`/`child_database`
를 찍어 내려간다. 결정적이고 지연이 없다.

**비판적 재사고.**
- 공격 ①: 순회는 페이지마다 최소 1회 호출이고, 토글·컬럼 안의 하위 페이지까지 찾으려면
  **모든 블록**을 내려가야 한다. 변경이 없어도 매번 수백 회. 증분의 이점이 사라진다.
- 공격 ②: `POST /search` 는 `query` 없이 **공유된 전체**를 100개씩 돌려주고, 각 결과에
  `parent`·`last_edited_time`·`properties` 가 있다(N7). 300페이지 = 3~4회. 조상 해석은 `parent`
  체인을 따라가면 되고, DB 행은 `database_id` → `GET /databases/{id}` 1회(캐시).
- 공격 ③(search 쪽 공격): **검색 인덱스 지연**은 문서화되어 있지 않다. 방금 만든 페이지가 몇 분
  안 보일 수 있다. → 신규 페이지의 주 경로인 **DB 행은 `data_sources/{id}/query` 로 권위 있게**
  나열한다(N8, 인덱스 지연 없음). search 는 (a) data source 자체의 발견, (b) 레거시 일반 페이지의
  발견에만 쓰이고, 둘 다 드물게 생기는 대상이다. 남는 지연 위험은 "새 DB 를 만든 직후" 한 경우다.
- 공격 ④: search 는 **연결에 공유된 모든 것**을 준다 — 위키 루트와 게시된 위키 페이지도 포함.
  → 조상 판정에서 서비스 루트에 닿지 않는 것은 버린다. 위키 루트가 서비스 아래면 순환이므로
  설정 단계에서 거부(5.2).

**종합.** search(전체 목록·조상) + data source query(행 권위 목록). 블록 순회는 없다.
**미확정**: 검색 인덱스 지연의 실제 크기. 필요해지면 `sync --walk` 로 순회 폴백을 추가한다(구현 안 함).

### ADR-008 — 스킬은 하나, 서브커맨드는 인자로

**1차 사고.** `/notion-wiki-sync`, `/notion-wiki-query` … 스킬 5개가 규약상 깔끔하다.

**비판적 재사고.**
- 공격 ①: 다섯 스킬이 같은 `references/wiki-schema.md` 와 설정을 공유한다. 디렉터리 5개로
  나누면 상대 경로가 어긋나고 복사·설치가 5배가 된다.
- 공격 ②: 서브커맨드는 공식 기능이 아니다(3.2). 그러나 `$0` 로 첫 단어를 받는 것은 공식 치환
  변수만 쓴다. 분기 실패 모드는 "모르는 서브커맨드 → 사용법 출력" 하나다.
- 공격 ③: 자동 호출(`description` 기반)은 스킬 단위다. "위키에서 찾아줘" 가 `query` 로,
  "동기화해" 가 `sync` 로 가도록 description 에 다섯 동작을 모두 적는다.

**종합.** 단일 스킬 `notion-llm-wiki`, `$0 ∈ {sync, ingest, query, lint, publish}`.
`ingest`·`query` 는 LLM 절차(references 를 읽고 수행), 나머지는 스크립트 실행 + 결과 해석.
