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
   │  plugins/notion-llm-wiki/skills/notion-llm-wiki/  SKILL.md·references/·scripts/ │
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
| 런타임 | Node.js `>=22` | 자매 저장소와 동일. 내장 `fetch`·`node:test`·`node:fs` 만 사용 → **의존성 0개**, `npm install` 불필요 | Node 24.14.1 로컬 실측(98 테스트). Node 22 는 CI 매트릭스 |
| Notion API | REST, `Notion-Version: 2026-03-11` | 최신 버전. `2025-09-03` 의 data source 모델과 `2026-02-26` 의 Markdown 엔드포인트를 포함 | **공식 문서로 확인** (3.1). 실 워크스페이스 **미실측** |
| 본문 I/O | **Markdown 엔드포인트** (`GET /v1/pages/{id}/markdown`, `POST /v1/pages` + `markdown`, `PATCH /v1/pages/{id}/markdown`) | 블록 변환기를 만들지 않는다 (ADR-006) | 문서 확인. mock 으로 계약 고정 (T4·T12·T13) |
| 발견(discovery) | `POST /v1/search` + `POST /v1/data_sources/{id}/query` | 블록 트리 순회 없이 전체 목록과 `last_edited_time` 을 얻는다 (ADR-007) | 문서 확인. mock 으로 38 페이지 → 호출 59회 실측 |
| 설정 | `notion-wiki.config.json` + `.env` | dotenv 없이 `.env` 를 직접 파싱 (KEY=VALUE 줄) | 실측 (config 테스트 4건) |
| frontmatter | YAML **부분집합** (스칼라·문자열·불리언·숫자·스칼라 배열·평면 객체 배열) | 파서 의존성을 피한다. 부분집합 밖의 YAML 은 명시적으로 거부한다 | 실측 (라운드트립 T1) |
| 테스트 | `node:test` + golden 파일 + **주입식 mock fetch** | 토큰 없이 전 경로 실행 | 실측 — 98 테스트, 약 5초 |
| 스킬 | `plugins/notion-llm-wiki/skills/notion-llm-wiki/SKILL.md` — Claude Code **플러그인**으로 배포 (3.3, ADR-009) | 공식 스킬·플러그인 규약 (3.2·3.3) | 문서 확인 + 구조 테스트(T16·T18) + `claude plugin validate --strict` + `--plugin-dir` 로드 + 절차 문서만으로 위키 합성 실행(P6) |

### 3.1 Notion API — 문서로 확인한 사실 (2026-09-09, N15·N16 은 2026-09-10)

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
| N15 | `GET /v1/users` — 사용자 목록(페이지네이션 `start_cursor`·`page_size`). 사용자 객체는 `{object, id, type, name, avatar_url, person.email}`. **연결에 "사용자 정보" 권한이 필요**하고 **게스트는 빠진다**. 단건은 `GET /v1/users/{id}`, 봇 자신은 `GET /v1/users/me` (2026-09-10 확인) | `people` 속성을 **쓰려면** 이름이 아니라 사용자 id 가 필요하다. 담당자 이름 → id 해석에 쓴다 (6.11). 못 찾거나 동명이인이면 중단 |
| N17 | **실측(2026-09-10)** `GET /v1/pages/{id}/markdown` 은 멘션을 **라벨 없이 자기닫는 태그**로 돌려준다: `<mention-page url="https://app.notion.com/p/<id>"/>`. 만들 때 `<mention-page url="…">제목</mention-page>` 로 보내도 저장되는 것은 참조뿐이고 표시 텍스트는 대상 페이지 제목에서 온다. 페이지 URL 도 `app.notion.com/p/<id>` 로 정규화된다 | 멘션 → 미러 상대 경로 보강 정규식이 **자기닫는 형태를 받아야** 한다(6.1). 라벨이 없으므로 링크 텍스트는 대상 페이지 제목을 쓴다 |
| N18 | **실측(2026-09-10)** Notion 이 돌려주는 표는 `<tr>`·`<td>` 에 **들여쓰기가 없다**. 우리 정규화기가 넣는 탭 들여쓰기도 문제없이 받아들여진다 | 정규화기의 탭 들여쓰기는 유지해도 된다. 골든과 실제 출력의 이 차이는 의미가 없다 |
| N19 | **실측(2026-09-10)** 본문 markdown 에 존재하지 않는 페이지·DB 참조가 있으면 `POST /v1/pages` 가 400 `validation_error` 로 거부한다: `Cannot create database reference: Block … does not exist in the current space` | 작성 스킬이 만드는 본문의 링크는 **접근 가능한 실제 페이지**여야 한다. 해석 불가 링크를 텍스트로 남기는 현재 동작(6.3)이 맞다 |
| N16 | `PATCH /v1/pages/{id}` — **속성만** 수정한다(본문은 못 건드림. 본문은 N5 의 markdown 엔드포인트). `properties`·`icon`·`cover`·`in_trash`·`is_archived` 등을 받는다. 쓰기 형태: people 은 `[{id}]`, select·status 는 `{name}` 또는 `{id}`, multi_select 는 `[{name}]`, date 는 `{start,end?}`, rich_text 는 rich text 배열, url 은 문자열, checkbox 는 불리언, relation 은 `[{id}]` (2026-09-10 확인) | 기존 페이지 수정에서 속성 변경분만 이 호출로, 본문은 N5 로 — **두 호출은 각각 실패할 수 있으므로 속성 → 본문 순서로 하고 실패를 그대로 보고한다** |

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
- 검증: `claude plugin validate <dir> --strict`.
- **(2026-09-10 확인, skills.md)** `${CLAUDE_SKILL_DIR}` 와 `${CLAUDE_PROJECT_DIR}` 는 **스킬 본문과 `allowed-tools` 의 Bash 규칙 두 곳**에서
  치환된다. 플러그인 스킬에서는 `${CLAUDE_PLUGIN_ROOT}`·`${CLAUDE_PLUGIN_DATA}` 도 같은 두 곳에서 치환된다. 문서의 예:
  `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)` — "같은 변수를 두 곳에 쓰면 권한 프롬프트 없이 번들 스크립트를 실행할 수 있다".
  P0 의 미확정("allowed-tools 안에서 치환되는가")은 이것으로 해소. `${CLAUDE_SKILL_DIR}` 는 플러그인 스킬에서 **플러그인 루트가 아니라 스킬 하위 디렉터리**를 가리킨다.
- `references/` 파일에는 치환이 적용되지 않는다(SKILL.md 본문만). references 는 경로를 직접 쓰지 않고 "SKILL.md 의 스크립트 디렉터리" 로 가리킨다.

### 3.3 Claude Code 플러그인 규약 — 문서로 확인한 사실 (2026-09-10)

출처: code.claude.com/docs/en/{plugins, plugins-reference, plugin-marketplaces, discover-plugins, skills}.md. 로컬 CLI 2.1.267 의 `--help` 로 명령 존재를 확인.

- **플러그인 루트** = `.claude-plugin/plugin.json` 이 있는 디렉터리. 스킬은 `skills/<name>/SKILL.md`. 스킬 디렉터리 안의 `references/`·`scripts/` 등
  **모든 파일이 설치 시 캐시(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`)로 통째 복사**된다. 락파일이 있으면 `node_modules` 를 자동 설치한다(이 플러그인은 의존성 0, 락파일 없음).
- `plugin.json`: `name`(필수, kebab-case `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`), `version`(semver 문자열 — 적으면 이 값을 올릴 때만 사용자가 갱신을 받는다), `description`, `author{name,email,url}`,
  `homepage`, `repository`, `license`, `keywords[]`. 컴포넌트 경로(`skills` 등)는 기본 위치를 쓰면 생략.
- **마켓플레이스** `.claude-plugin/marketplace.json`(저장소 루트): 필수 `name`, `owner{name}`, `plugins[]{name, source}`. `source` 가 `./plugins/x` 같은 상대 경로면
  **마켓플레이스 루트(`.claude-plugin/` 을 담은 디렉터리) 기준**으로 해석되고 `../` 는 금지. 같은 저장소에 마켓플레이스와 플러그인을 함께 두는 것이 문서의 기본 예다.
- **설치**: `claude plugin marketplace add <owner>/<repo>` → `claude plugin install <plugin>@<marketplace>`. 모노레포는 `--sparse .claude-plugin plugins`.
  갱신은 `claude plugin marketplace update` → `claude plugin update <plugin>`.
- **로컬 검증**: `claude plugin validate <dir> [--strict]` — 매니페스트 구조·컴포넌트 배치·frontmatter 를 검사한다(플러그인 디렉터리와 마켓플레이스 디렉터리 모두 가능).
  `claude --plugin-dir <dir>` 로 설치 없이 한 세션에 로드한다.
- **이름**: 플러그인 스킬은 `/<plugin>:<skill>` 로 노출되고, 충돌이 없으면 bare `/<skill>` 도 동작한다. `name` 이 플러그인 접두로 시작하면 2.1.246+ 에서 접두를 겹쳐 붙이지 않는다.
  frontmatter(`allowed-tools`·`argument-hint`·`$0`…)는 프로젝트 스킬과 동일.
- **팀 배포**: 프로젝트 `.claude/settings.json` 의 `extraKnownMarketplaces: {<mk>: {source: {source: "github", repo: "owner/repo"}}}` 와 `enabledPlugins: {"<plugin>@<mk>": true}` —
  폴더를 신뢰한 팀원에게 마켓플레이스가 추가되고 플러그인 설치가 제안된다.
- **실측(2026-09-10, CLI 2.1.267)**: `claude plugin validate --strict` 가 `plugins/notion-llm-wiki`(플러그인)와 `.`(마켓플레이스) 모두 통과.
  `claude --plugin-dir plugins/notion-llm-wiki -p "/notion-llm-wiki:notion-llm-wiki" --max-turns 1` 로 띄운 헤드리스 세션에서 스킬이 로드되어 `$0` 분기의 사용법 표가 출력됐다
  (print 모드에서 bare `/notion-llm-wiki` 는 스킬 호출로 해석되지 않았다 — 대화형에서의 동작은 미실측). `claude plugin details` 는 설치된 플러그인만 받는다(`--plugin-dir` 미지원).
- **실측(push 후, 같은 날)**: `marketplace add littleanti/heybit-notion-llm-wiki` → `install notion-llm-wiki@heybit-notion-llm-wiki` 성공. 캐시 `~/.claude/plugins/cache/<mk>/<plugin>/0.1.0/` 에
  플러그인 디렉터리의 **21개 파일만** 복사됐다. CI 러너(ubuntu)에서 `npm i -g @anthropic-ai/claude-code` 후 인증 없이 `validate --strict` 동작.
- **권한 규칙의 실제 동작**: `allowed-tools` 의 `Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)` 는 치환 후 **접두 일치**다. 모델이 경로를 따옴표로 감싸거나 `cd … &&` 로 묶으면
  일치하지 않아 승인 대상이 된다(비대화형에서는 거부). 대응: 따옴표 변형 규칙을 함께 두고, SKILL.md 가 "글자 그대로·단독 명령" 을 지시한다. 그렇게 하자 헤드리스 실행에서 거부 0건.
- **부작용**: `claude plugin uninstall` / `marketplace remove` 가 현재 디렉터리의 프로젝트 `.claude/settings.json` 에 있는 `enabledPlugins`·`extraKnownMarketplaces` 를
  빈 객체로 덮어썼다(CLI 2.1.267). 팀 권장 선언을 둔 저장소에서는 되돌린 뒤 `git diff` 를 확인해야 한다.
- 미실측: 대화형 세션의 bare `/notion-llm-wiki` 해석, `.claude/settings.json` 설치 제안 UI, `plugin update`(릴리스 전), 홈 경로에 공백이 있을 때의 `allowed-tools` 분리.

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
├── .claude-plugin/marketplace.json    마켓플레이스 `heybit-notion-llm-wiki` — 플러그인 `notion-llm-wiki` → `./plugins/notion-llm-wiki`
├── .claude/settings.json              이 저장소를 여는 사람에게 위 마켓플레이스·플러그인을 권장 (extraKnownMarketplaces · enabledPlugins)
│
├── plugins/notion-llm-wiki/           ★ 플러그인 루트 (설치 id `notion-llm-wiki@heybit-notion-llm-wiki`)
│   ├── .claude-plugin/plugin.json     name · version(package.json 과 동일) · description · author · repository · license · keywords
│   ├── README.md                      플러그인 단독 안내(설치·설정·서브커맨드)
│   ├── skills/notion-llm-wiki/        ★ 위키 운영 스킬 — 옛 `.claude/skills/notion-llm-wiki/` 를 그대로 옮긴 것
│       ├── SKILL.md                   진입점. $0 로 sync/ingest/query/lint/publish 분기. 스크립트는 `${CLAUDE_SKILL_DIR}/scripts/…`
│       ├── references/
│       │   ├── wiki-schema.md         위키 규칙 (페이지 종류·상한·출처·모순·신선도) — ingest/query 가 먼저 읽는다
│       │   ├── ingest-procedure.md    변경분 → 위키 갱신 절차
│       │   ├── query-procedure.md     3층 검색 절차와 답변 형식
│       │   ├── lint-semantic.md       의미 lint 체크리스트
│       │   └── notion-authoring.md    실무자용 작성 규약 요약 (DESIGN 1·2절의 사본이 아니라 링크)
│       └── scripts/
│           ├── sync.js                Notion → raw
│           ├── build-index.js         raw+wiki → wiki/index.md
│           ├── lint.js                구조 lint
│           ├── publish.js             wiki → Notion (dry-run 기본, --apply)
│           ├── register-legacy.js     (선택) 카테고리 페이지 하위 일반 페이지 → DB 등록 항목 생성
│           └── lib/
│               ├── notion-client.js   fetch 래퍼: 인증·버전·토큰 버킷·429 재시도·페이지네이션
│               ├── config.js          설정·.env 로드·검증
│               ├── frontmatter.js     YAML 부분집합 직렬화/파싱
│               ├── meta.js            Notion properties ↔ frontmatter 매핑
│               ├── slug.js            파일명 생성
│               ├── md-notion.js       표준 MD → enhanced MD 정규화, 링크 해석
│               └── report.js          동기화 리포트 작성
│   └── skills/notion-draft/            ★ 작성 스킬 (P11, ADR-010) — 입력 → 초안 → 검토 → Notion
│       ├── SKILL.md                    $0 로 new/edit/submit 분기. 스크립트는 `${CLAUDE_SKILL_DIR}/scripts/…`
│       ├── references/
│       │   ├── draft-templates.md      문서유형 9종의 본문 골격 (DESIGN 2절의 스킬용 사본)
│       │   └── draft-procedure.md      new·edit·submit 절차 상세, 물어볼 것과 묻지 않을 것
│       └── scripts/
│           ├── draft-new.js            유형별 골격 초안 파일 생성
│           ├── draft-pull.js           기존 페이지 → 초안 파일 (속성 + 현재 본문 + 기준 시각·해시)
│           ├── draft-submit.js         검증 → dry-run(속성·크기·diff) → --apply(생성/교체) → raw 즉시 반영
│           └── lib/
│               ├── shared.js           형제 스킬의 lib 재수출 — **두 스킬의 결합은 이 파일 하나**
│               ├── draft.js            초안 파일 읽기·쓰기·검증
│               ├── doc-templates.js    문서유형별 필수 섹션 (T23 이 DESIGN 2절과 대조)
│               ├── props.js            내부 meta → Notion 쓰기 형태 properties, 담당자 이름 → 사용자 id
│               └── diff.js             줄 단위 LCS diff (dry-run 검토용)
│
├── drafts/                             작성 중인 초안 (샘플 1개). 게시하면 지워도 된다 — 설정 `paths.drafts`
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

### 6.7.1 `check-notion.js` — 연결 점검 (읽기 전용)

```
check-notion.js [--json] [--root <dir>]
```

`GET /v1/users/me`(연결 이름) → `GET /v1/users`(담당자 해석 가능 여부) → `POST /v1/search` 2회(접근 범위) →
`GET /v1/data_sources/{첫 DB}`(속성 이름 매핑 대조). **쓰기 호출 경로가 없다.** 실 워크스페이스에 처음 붙일 때
"무엇이 안 보이는가" 를 먼저 알려 주는 것이 목적이다 — 가장 흔한 실패는 연결을 페이지에 추가하지 않은 것(N12)이고,
그때 `sync` 는 "발견 0" 이라는 모호한 결과를 낸다. 이 스크립트는 그 상태를 이름으로 말한다.

### 6.8 `draft-new.js` — 골격 초안 만들기

```
draft-new.js --service <slug> --category <slug> --type <문서유형> --title <제목> [--owner <이름>] [--root <dir>]
```

`lib/doc-templates.js` 의 유형별 섹션 순서대로 `##` 골격과 frontmatter 를 쓴다. 본문 내용은 **비운다** —
Claude 가 Edit 로 채운다. 이미 파일이 있으면 덮어쓰지 않고 중단한다. **Notion 을 호출하지 않는다(토큰 불필요).**

이 스크립트가 있는 이유는 "섹션 누락" 을 LLM 의 성실성에 맡기지 않기 위해서다. 골격을 코드가 만들면 검증(6.10)과 골격이 같은 표를 본다.

### 6.9 `draft-pull.js` — 기존 페이지를 초안으로

```
draft-pull.js <raw 경로 | Notion URL | page id> [--root <dir>]
```

1. 대상 식별: raw 파일이면 그 frontmatter 의 `notion_id`(속성 위치)와 `source_url`(본문 위치)을 쓴다.
   등록 항목이면 둘이 다르다 — `target_meta_id` 와 `target_body_id` 를 초안에 각각 적는다.
2. `GET /v1/pages/{target_meta_id}` 로 속성, `GET /v1/pages/{target_body_id}/markdown` 으로 현재 본문.
3. 거부 조건(민감·폐기·휴지통·하위 페이지 포함·위키 루트 아래)을 여기서 먼저 검사한다 — 고칠 수 없는 페이지로 사람을 데려가지 않는다.
4. `drafts/<svc>/<cat>/<제목>-<id6>.md` 에 `kind: edit` 초안을 쓴다. `base_last_edited_time`(대상의 최종수정)과
   `base_hash`(받은 본문의 sha256)를 함께 적는다. 읽기 전용이다.

**본문은 Notion 이 준 enhanced markdown 그대로** 둔다(표는 `<table>`, 들여쓰기는 탭, `\<` 같은 이스케이프 포함).
정규화기를 다시 돌리면 이스케이프가 이중으로 걸리므로, `kind: edit` 의 본문은 제출 때도 **그대로 보낸다** (6.10).

### 6.10 `draft-submit.js` — 검증 · dry-run · 게시

```
draft-submit.js <초안 파일> [--apply] [--json] [--root <dir>]
```

`--apply` 가 없어도 **읽기 호출은 한다** — 대상 DB 확인, 담당자 해석, 현재 본문과의 diff 가 dry-run 의 내용이기 때문이다.
쓰기 호출은 `--apply` 에서만 한다.

| 단계 | 신규(`kind: new`) | 수정(`kind: edit`) |
|---|---|---|
| 1. 검증 | `lib/draft.js` — 필수 속성 5, 허용값, 요약 120자, 유형별 섹션(오류), 오늘 날짜 변경 이력, `상태: 초안` | 같음. 단 섹션 누락은 **경고** (템플릿을 안 따르는 레거시가 있다) |
| 2. 대상 | 서비스 루트 → 카테고리 페이지 → 그 안의 데이터베이스 → data source (register-legacy 와 같은 경로) | `target_meta_id`·`target_body_id` 로 직접 조회 |
| 3. 안전 | — | `last_edited_time` ≠ `base_last_edited_time` → 중단. 민감·폐기·휴지통·하위 페이지 포함 → 중단 |
| 4. 본문 | 표준 MD → enhanced MD 정규화(6.3, `mentionLinks: true`) | **정규화하지 않고 그대로.** 현재 본문과 같으면 "본문 변경 없음" |
| 5. 속성 | `lib/props.js` 로 전체 속성 생성 | 초안과 현재 속성의 **차이만** 생성 |
| 6. dry-run | 대상 DB 이름, 속성 표, 본문 바이트 | 속성 변경 표 + 본문 **줄 단위 diff** |
| 7. `--apply` | `POST /v1/pages`(parent = data source, properties + markdown) | 속성 변경이 있으면 `PATCH /v1/pages/{meta}`(N16) → 본문이 바뀌면 `PATCH /v1/pages/{body}/markdown` `replace_content`(N5, `allow_deleting_content: false`) |
| 8. raw | 게시된 페이지를 다시 읽어 `raw/` 에 기록 + `.sync-state.json` 갱신 (DESIGN 10.8) | 같음 |

`allow_deleting_content` 는 **항상 `false`** 로 보낸다. 하위 페이지가 있으면 3단계에서 이미 중단시켰고, 그래도 서버가 거부하면
그 오류를 그대로 보여 준다 — 우회하지 않는다.

### 6.11 작성 스킬의 라이브러리

| 모듈 | 계약 |
|---|---|
| `lib/shared.js` | 형제 스킬의 `lib/{config,notion-client,frontmatter,meta,slug,md-notion,pages}` 와 `sync.js`(`sortedJson`·`STATE_FILE`) 를 **상대 경로로 한 번** require 해서 재수출한다. 레이아웃이 바뀌면 고칠 곳은 이 파일뿐이다 |
| `lib/doc-templates.js` | `SECTIONS: { <문서유형>: string[] }` — 유형별 필수 H2 섹션(순서 포함)과 `skeleton(type)`. DESIGN 2절이 정본이고 T23 이 대조한다 |
| `lib/draft.js` | `readDraft(file)` → `{data, body, sections}`; `validate({cfg, draft, today, mode})` → `{errors, warnings}`(코드는 DESIGN 10.5); `draftPath(cfg, {...})`; `writeDraft(...)` |
| `lib/props.js` | `buildProperties({cfg, meta, users})` → Notion 쓰기 형태 객체(설정의 이름 매핑 사용). `resolveOwners({client, names})` → `[{id}]`, 미발견·동명이인은 `Error`. `diffProperties(cfg, draftMeta, page)` → 바뀐 속성만 |
| `lib/diff.js` | `lineDiff(a, b)` → `[{op:' '|'-'|'+', text}]` (LCS). `formatDiff(rows, {context})` → 사람이 읽는 블록. 순수 함수 |

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
| T17 | register-legacy | 미등록 레거시 수 = 생성 요청 수, 재실행 시 0, 원본 페이지 불변 |
| T18 | 플러그인 패키징 | `plugin.json`·`marketplace.json`·`settings.json` 정합성, 플러그인 디렉터리에 샘플·락파일 없음, SKILL.md 가 `${CLAUDE_SKILL_DIR}` 로만 스크립트를 부름 |
| T19 | 초안 검증 | 단위. 검증 코드 13종([DESIGN 10.5](./DESIGN.md#105-검증-규칙)) 각각 + 무결함 (A18, A23) |
| T20 | 속성 쓰기 매핑 | 단위 + mock. 타입 9종, 담당자 이름 → id, 미발견·동명이인 중단, 변경분만 뽑기 (A20) |
| T21 | draft-submit 신규 | mock. dry-run 쓰기 0건 → apply 로 DB 행 생성 → raw 즉시 기록 → 이어서 sync 시 markdown 호출 0 (A19, A20, A21) |
| T22 | draft-submit 수정 | mock. pull → 수정 → diff → 교체. 거부 4종(원본 변경·민감·폐기·하위 페이지) 각각 쓰기 0건 (A22) |
| T23 | 작성 스킬 구조 | `notion-draft/SKILL.md` frontmatter·서브커맨드 3개·references 존재, `doc-templates.js` 가 DESIGN 2절 표와 일치 |

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

### ADR-009 — 배포 단위는 플러그인 (스킬 복사가 아니라)

**맥락.** P0~P9 의 스킬은 `.claude/skills/` 프로젝트 스킬이었다. 다른 저장소에서 쓰려면 디렉터리를 복사해야 하고, 갱신도 손으로 한다.
2026-09-10 요청: "claude plugin 으로 설치 가능하게".

**1차 사고.** 저장소 루트를 통째로 플러그인으로 만든다 — 루트에 `.claude-plugin/plugin.json` 과 `skills/` 를 두고 마켓플레이스 `source: "./"`.
파일 이동이 가장 적다.

**비판적 재사고.**
- 공격 ①: 설치는 **플러그인 디렉터리 전체를 캐시로 복사**한다(3.3). 루트가 플러그인이면 `raw/`·`wiki/`·`test/`·`docs/` 샘플 수백 KB 가 모든 사용자의
  캐시에 따라가고, 캐시 안의 샘플 `raw/` 가 스킬이 다루는 프로젝트의 `raw/` 와 이름이 같아 혼동을 부른다. → 플러그인은 **서브디렉터리** `plugins/notion-llm-wiki/`,
  마켓플레이스는 루트. 문서의 기본 예이고 `--sparse .claude-plugin plugins` 규약과도 맞는다.
- 공격 ②: 스크립트를 플러그인 루트 `scripts/` 로 올리고 `${CLAUDE_PLUGIN_ROOT}` 를 쓰면, 스킬 디렉터리만 `.claude/skills/` 로 복사하는 옛 방식이 깨진다.
  문서(skills.md)는 `${CLAUDE_SKILL_DIR}` 가 프로젝트 스킬·플러그인 스킬 모두에서 **본문과 `allowed-tools` 두 곳**에 치환된다고 명시한다.
  → 스크립트를 **스킬 디렉터리 안에 그대로** 두고 `${CLAUDE_SKILL_DIR}/scripts/…` 로 부른다. 한 디렉터리가 플러그인 스킬로도, 복사한 프로젝트 스킬로도 동작한다.
  부수 효과: P0 부터 미확정이던 "allowed-tools 치환 여부" 가 문서로 해소되어 상대 경로 `Bash(node .claude/skills/…/*)` 를 버릴 수 있다.
- 공격 ③: 플러그인 이름과 스킬 이름이 같으면 `/notion-llm-wiki:notion-llm-wiki` 가 된다. 그러나 bare `/notion-llm-wiki` 도 충돌이 없으면 동작하고(3.3),
  Anthropic 자체 플러그인도 같은 패턴(`frontend-design:frontend-design`)을 쓴다. 스킬 이름을 바꾸면 T16·문서·자동 호출 description 을 모두 바꿔야 하므로 유지.
- 공격 ④: 스킬을 옮기면 **이 샘플 저장소 자체**가 스킬을 잃는다. → `.claude/settings.json` 의 `extraKnownMarketplaces`+`enabledPlugins` 로 같은 플러그인을 권장하고,
  플러그인을 고치는 사람은 `claude --plugin-dir plugins/notion-llm-wiki` 로 로컬 사본을 로드한다. 둘을 동시에 켜면 같은 스킬이 두 번 보일 수 있다 — README 에 적는다.
- 공격 ⑤: SKILL.md 가 `npm run sync` 를 "같은 것" 이라고 안내하는데 `package.json` 은 샘플 저장소에만 있다. 설치한 프로젝트에서는 틀린 안내다.
  → 정본 경로는 `${CLAUDE_SKILL_DIR}/scripts/…` 하나. `npm run` 은 "이 샘플 저장소에서는" 으로 한정.
- 공격 ⑥: `references/*.md` 에도 스크립트 경로가 적혀 있는데 거기에는 치환이 없다. → references 는 "SKILL.md 의 스크립트 디렉터리" 로 가리키고 경로를 직접 쓰지 않는다.
- 공격 ⑦: CI 에서 매니페스트를 검증하려면 러너에 Claude Code CLI 가 필요하다. 저장소 의존성 0 원칙과 충돌하는가? — CLI 는 러너 전역 설치(`npm i -g`)이고 `package.json` 은 그대로다.
  별도 잡으로 분리해 테스트 잡의 "의존성 0" 검사와 섞지 않는다. 러너에서 인증 없이 `validate` 가 되는지는 **실행해 봐야 안다**.

**종합.** `plugins/notion-llm-wiki/` 서브디렉터리 플러그인 + 루트 `.claude-plugin/marketplace.json`(마켓플레이스 `heybit-notion-llm-wiki`).
스킬 디렉터리는 내부 구조 그대로 이동, 스크립트 호출은 `${CLAUDE_SKILL_DIR}/scripts/…` 로 본문·`allowed-tools` 를 통일. 설치 id `notion-llm-wiki@heybit-notion-llm-wiki`.
`plugin.json` 의 `version` 은 `package.json` 과 같게 유지하고(T18 이 검사) 릴리스마다 올린다.
**미확정**: GitHub 경유 실제 설치·갱신(로컬은 `validate --strict` 와 `--plugin-dir` 로 대체), CI 러너의 CLI 설치.

### ADR-010 — 작성 기능은 별도 스킬, lib 는 형제 스킬에서 공유

**맥락.** 2026-09-10 요청: 실무자가 Claude Code 에 내용을 주면 규약을 지킨 Notion 페이지가 만들어지게. 인터뷰로
"같은 플러그인 안의 별도 스킬" 이 선택됐다([LOG P11](./LOG.md)). 남은 문제는 **공용 코드를 어떻게 나누는가** 였다.

**1차 사고.** 새 스킬 디렉터리에 필요한 lib 를 복사한다. 스킬마다 자기 것만 갖고 있으면 디렉터리 하나만 떼어 써도 동작한다.

**비판적 재사고.**
- 공격 ①: 복사한 `config.js`·`notion-client.js` 는 곧 어긋난다. 설정 검증 규칙이 두 벌이 되면 "설정은 맞는데 스킬 하나만 거부" 같은
  진단 불가능한 상태가 생긴다. → 복사는 탈락.
- 공격 ②: 그러면 공용 lib 를 **플러그인 루트**(`plugins/notion-llm-wiki/scripts/lib/`)로 올리고 두 스킬이 `${CLAUDE_PLUGIN_ROOT}` 로 참조한다.
  그러나 ADR-009 는 스크립트를 스킬 디렉터리 안에 두어 `.claude/skills/` 복사 경로를 살렸다. lib 를 올리면 그 경로가 **위키 스킬까지** 깨진다.
  이미 동작하고 CI 로 검증된 것을 새 기능 때문에 깨는 것은 손해다. → 탈락.
- 공격 ③: 새 스킬이 형제 스킬의 lib 를 **파일 상대 경로로 require** 한다(`../../notion-llm-wiki/scripts/lib/config`).
  플러그인은 디렉터리 전체가 캐시로 복사되므로(3.3) 설치본에서도 경로가 성립한다. 잃는 것은 "`notion-draft` 디렉터리만 떼어 복사" 인데,
  그 경로는 애초에 존재하지 않았다(이 스킬은 처음부터 플러그인으로 배포된다).
- 공격 ④: 상대 경로가 여러 파일에 흩어지면 레이아웃 변경에 약하다. → `lib/shared.js` **한 파일**에 모아 재수출하고, 다른 파일은 그것만 본다.
  T23 이 이 파일이 실제로 해석되는지 확인한다.
- 공격 ⑤: 스킬이 둘이면 사용자가 어느 것을 부를지 헷갈린다. → description 을 방향으로 나눈다: `notion-llm-wiki` 는 **Notion → 위키**(동기화·합성·질의·게시),
  `notion-draft` 는 **입력 → Notion**(작성·수정). 두 스킬의 description 에 서로를 한 줄로 가리킨다.

**종합.** `skills/notion-draft/` 를 새로 만들고, 공용 lib 는 `lib/shared.js` 한 파일이 형제 스킬에서 상대 경로로 재수출한다.
설정 파일과 `raw/`·`.sync-state.json` 형식은 그대로 공유한다. 공용 코드에 대한 변경은 **추가만** 한다
(`sync.js` 의 `sortedJson` export, `config.js` 의 `paths.drafts` 기본값, `md-notion.js` 의 `mentionLinks` 옵션 — 기본값은 기존 동작).
**미확정**: 플러그인 캐시에서 상대 require 가 실제로 해석되는지는 설치본으로 실행해 확인해야 한다(로컬 `--plugin-dir` 로는 확인 가능).

### ADR-011 — 기존 페이지를 고치는 경로의 안전 모델

**맥락.** 인터뷰에서 범위가 "신규 + 기존 페이지 수정" 으로, 대상은 "제한 없이(폐기·민감 제외)" 로 정해졌다. 즉 **AI 가 사람이 쓴 확정 문서의
본문을 교체할 수 있다.** 이 경로에서 데이터를 잃지 않는 것이 이 ADR 의 목적이다.

**1차 사고.** dry-run 으로 diff 를 보여 주고 사람이 확인하면 교체한다. 확인이 있으니 충분하다.

**비판적 재사고.**
- 공격 ①: **동시 편집.** 초안을 만든 뒤 담당자가 Notion 에서 같은 페이지를 고치면, 교체는 그 편집을 통째로 지운다. dry-run 의 diff 는
  "내가 받은 옛 본문" 기준이라 이 사실이 보이지도 않는다. → 초안에 `base_last_edited_time` 을 적고, 제출 때 **현재 값과 다르면 중단**한다.
  낙관적 잠금이며, Notion 에 잠금 API 가 없으므로 이것이 할 수 있는 최선이다.
- 공격 ②: **하위 페이지 삭제.** N5 에 따르면 본문 교체는 하위 페이지·DB 를 지울 수 있고, 그때는 `allow_deleting_content: true` 가 필요하다.
  그 플래그를 켜는 것은 "지워도 좋다" 는 뜻이다. → 켜지 않는다. 대신 **받은 본문에 `<page url=` 또는 `<database url=` 가 있으면 거부**하고
  Notion 에서 직접 고치라고 안내한다. 검사가 서버 거부보다 앞서므로 사람은 이유를 먼저 안다.
- 공격 ③: **민감 페이지.** 미러에 없으니 안전할 것 같지만, 수정 경로는 id·URL 로 직접 조회하므로 우회된다. → 조회 결과의 비밀등급을 보고 거부한다.
- 공격 ④: **위키 페이지.** 위키 루트 아래 페이지는 `publish` 가 소유한다. 이 스킬이 고치면 다음 게시가 덮어쓴다(마커 문구가 이미 그렇게 예고한다).
  → 대상이 위키 루트 아래면 거부한다.
- 공격 ⑤: **이력 없는 수정.** 무엇이 왜 바뀌었는지 Notion 쪽에 남지 않으면, 위키가 "언제 바뀌었나" 를 복원할 수 없다.
  → `## 변경 이력` 에 **오늘 날짜 항목**이 없으면 검증이 막는다(신규·수정 모두).
- 공격 ⑥: **속성과 본문의 부분 실패.** 속성은 `PATCH /v1/pages`, 본문은 `PATCH …/markdown` 으로 호출이 둘이다. 앞이 성공하고 뒤가 실패하면
  절반만 반영된다. 트랜잭션은 없다. → 순서를 **속성 → 본문**으로 고정하고(속성만 바뀐 상태는 무해하다), 실패 시 무엇이 반영됐는지 그대로 보고한다.
- 공격 ⑦: **이스케이프 이중 적용.** 받은 본문은 이미 enhanced markdown 이다. 제출 때 정규화기를 다시 돌리면 `\<` 가 `\\<` 가 된다.
  → `kind: edit` 의 본문은 정규화하지 않고 그대로 보낸다. 대신 초안 파일 머리말과 SKILL.md 가 "이 형식을 유지하라" 고 지시한다.

**종합.** 수정 경로의 안전은 네 겹이다 — (1) 낙관적 잠금(`base_last_edited_time`), (2) 거부 목록(민감·폐기·휴지통·하위 페이지·위키 하위),
(3) 강제 diff 와 dry-run 기본, (4) 변경 이력 항목 강제. `allow_deleting_content` 는 켜지 않는다.
**미확정**: 실 Notion 에서 본문 교체가 페이지 코멘트를 유지하는지(P0 부터의 미확정), 그리고 `last_edited_time` 이 속성 변경으로도 바뀌는지 —
바뀐다면 낙관적 잠금이 "본문은 그대로인데 중단" 을 낼 수 있다. 그때는 본문 해시(`base_hash`) 비교로 완화할 수 있게 초안에 해시를 함께 적어 둔다.
