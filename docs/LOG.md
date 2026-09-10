# LOG — 변경 이력 (Changelog)

- 문서 역할: **무엇이 언제 바뀌었는가**
- 규칙: [`CLAUDE.md`](../CLAUDE.md) 그라운드 룰 2. **최신 항목을 맨 위**에 둔다.
  태그(`[feat]`/`[fix]`/`[test]`/`[docs]`/`[chore]`), 변경 파일 경로, 상태(`진행중`/`완료`)를 함께 적는다.
  날짜는 **절대 날짜**로 기록한다.
- 검증 정책: 매 변경마다 검증하지 않는다. 마일스톤·커밋 직전·회귀 위험이 큰 변경에만 실행하고,
  **실행하지 않았으면 "검증 비대상/미실행"으로 적는다.** 통과하지 못한 항목은 `완료`로 적지 않는다.
- 관련 문서: [PRD](./PRD.md) · [TRD](./TRD.md) · [DESIGN](./DESIGN.md) · [PLAN](./PLAN.md)

---

## 2026-09-10

### `[fix]` 실 Notion 워크스페이스 스모크 테스트 — 멘션 태그 결함 발견·수정 · 상태: `진행중`

**요청**: "토큰 추가했어. dummy 를 Notion 에 먼저 올리고, 작성한 프로젝트가 Notion 에서 데이터를 잘 가져와서 wiki 를 잘 작성하는지 테스트해줘." (2026-09-10)

**환경**: 워크스페이스 `littleanti`, 내부 연결 `wiki`(소유 형태 workspace), 사람 사용자 1명.
사용자가 `general` 팀스페이스에 빈 페이지 `heybit LLM Wiki 테스트` 를 만들고 그 페이지에 연결을 추가했다.

**시딩**: `test/helpers/seed-notion.js`(신규)로 fixture 38페이지를 실제 구조로 올렸다 —
위키 루트 1 · 서비스 2 · 카테고리 12 · 데이터베이스 12(속성 13개) · 레거시 4 · 일반 1 · DB 항목 32. 휴지통 fixture 1건은 제외.
담당자는 워크스페이스의 사람 사용자 1명에게 전부 배정했다(가상 이름은 실제 사용자가 아니다). 관련 페이지(relation)는 대상 id 순환 때문에 제외했다.

**실측이 드러낸 API 사실 3건** (TRD 3.1 N17~N19 에 기록)
1. **내부 연결은 workspace 최상위에 페이지를 만들 수 없다.** 공식 문서: "For internal connections, a page or data source parent is currently required."
   → 사람이 페이지 하나를 공유해 주는 단계는 자동화할 수 없다. README Quick Start 3단계가 그것이다.
2. **본문에 존재하지 않는 페이지 참조가 있으면 `POST /v1/pages` 가 400 으로 거부한다** — fixture 의 합성 태그 `<unknown url=… alt="form"/>` 가
   `Cannot create database reference: Block … does not exist in the current space` 를 냈다. 시딩기가 생성 시 이런 태그를 걷어내고,
   모든 페이지가 생긴 뒤 2단계로 멘션을 실제 URL 로 다시 써 넣도록 고쳤다(멘션 42건 전부 해석, 미해석 0).
3. **`GET /v1/pages/{id}/markdown` 은 멘션을 라벨 없이 자기닫는 태그로 돌려준다**: `<mention-page url="https://app.notion.com/p/<id>"/>`.
   만들 때 `<mention-page url="…">제목</mention-page>` 로 보내도 저장되는 것은 참조뿐이고, 표시 텍스트는 대상 페이지의 제목에서 온다.
   URL 도 `app.notion.com/p/<id>` 로 정규화된다.

**발견한 결함 (`[fix]` 완료)**: `sync.js` 의 멘션 정규식이 **여는·닫는 태그 쌍만** 받았다
(`/<(page|mention-page) url="…"[^>]*>([^<]*)<\/\1>/`). 실 Notion 은 자기닫는 형태로 주므로 **실제 미러에서는 멘션 옆
"([제목](../카테고리/파일.md))" 보강이 전부 빠졌다.** 위키 합성기가 "이 멘션이 어느 원문인가" 를 알 수 없게 되는, 조용한 품질 저하다.
fixture 만으로는 절대 드러나지 않았다 — fixture 가 문서 예시의 쌍 형태만 담고 있었기 때문이다.
- 수정: 정규식이 두 형태를 모두 받고, 라벨이 없으면 **대상 페이지 제목**을 링크 텍스트로 쓴다. 로직을 순수 함수 `appendMentionLinks` 로 분리해 단위 테스트 가능하게 했다.
- fixture 한 건(`9월 신규 가입 프로모션`)을 자기닫는 형태로 바꿔 **골든이 현실을 담게** 했고, T4 에 두 형태·미러 밖 대상·자기 참조·표 셀을 검사하는 회귀 테스트를 넣었다.
- 재실측: 실 워크스페이스 `sync --full` 후 멘션 42건 전부 상대 경로가 붙었다.

**미러 검증 (실 Notion vs fixture 골든)**: 33개 페이지 전부 대응, 서비스·카테고리 분류 동일,
`doc_type`·`status`·`summary`·`keywords`·`tags`·`review_by`·`verified_at`·`sensitivity`·`meta_source` **전부 일치**.
수치도 같다 — 추가 33 · 제외 2(민감 1, 위키제외 1) · 컨테이너 12 · 범위 밖 1 · 실패 0.
lint 경고도 같은 4건(meta 없는 레거시 3 + 검토기한 경과 1). 남은 본문 차이는 파일명의 실제 id, 멘션 태그 형태,
시딩에서 제외한 합성 블록, 그리고 **Notion 이 표 `<tr>`·`<td>` 를 들여쓰기 없이 돌려주는 것**(N18) 뿐이다.

**변경 파일**: `plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/sync.js`(정규식·순수 함수 분리),
`test/fixtures/pages-routinefit.json`, `raw/routinefit/marketing/9월-신규-가입-프로모션-555555.md`(골든 재생성),
`test/sync.test.js`(T4 회귀), `test/helpers/seed-notion.js`(신규), `docs/TRD.md` 3.1 N17~N19, `.gitignore`.

**검증**: `npm test` **99/99**, `npm run lint` 오류 0, 저장소 색인 재생성 diff 없음.
실 워크스페이스에서 `check-notion` → `sync --full` → `build-index` → `lint` 까지 통과.

**증분 동기화 실측**: 2회차 실행에서 **변경 없음 33 · markdown 호출 0건 · 총 호출 14회**. A2 가 실 워크스페이스에서 확인됐다.

**게시 문법 실측**: 게시기가 쓰는 형태를 실제 페이지에 넣고 다시 읽었다 —
`<callout icon="🤖" color="gray_bg">` 는 그대로 왕복하고, 표·중첩 목록(탭)·인용·언어 지정 코드 펜스도 보존됐다.
표는 돌려받을 때 들여쓰기가 없어진다(N18). "enhanced markdown 이 의도대로 렌더되는가" 라는 P0 부터의 미확정이 **정규화기 출력이 수용·왕복된다**는 수준까지 해소됐다.
확인용 페이지는 휴지통으로 정리했다.

**작성 스킬(`notion-draft`) 실측**: 실제 카테고리 DB 에 새 FAQ 페이지를 만들어 봤다.
- dry-run 이 대상 DB `루틴핏 · CS` 를 찾고, 담당자 이름 `Wondeuk Yoon` 을 실제 사용자 id 로 해석했고,
  시딩에서 제외한 `관련 페이지` 를 "데이터베이스에 없는 속성" 으로 정확히 건너뛰었고,
  본문의 미러 상대 경로 링크를 **"해석 불가 — Notion URL 이나 @ 멘션으로 바꾼다"** 로 지적했다. 규약대로 Notion URL 로 바꾸자 경고가 사라졌다.
- `--apply` 로 페이지가 생성되고(속성 12개 반영) `raw/` 에 즉시 기록됐다. A20·A21 이 실 API 에서 확인됐다.

**두 번째 결함 (`[fix]` 완료)**: 위 게시에서 본문의 Notion 링크가 **멘션으로 바뀌지 않았다.**
`lib/md-notion.js` 의 `NOTION_URL_RE` 가 `notion.so`·`notion.site` 만 보는데, **현재 Notion 의 "링크 복사" 는 `app.notion.com/p/<id>` 를 준다.**
호스트 목록에 `notion.com` 을 더하고, 세 호스트와 비-Notion 호스트·id 없는 주소를 검사하는 회귀 테스트(T11)를 넣었다.
이것도 fixture 로는 드러날 수 없었다 — fixture URL 이 전부 `www.notion.so` 였기 때문이다.

**남은 것**: 위키 합성(`ingest`)과 게시(`publish`) 를 실 미러에 대해 수행 중이다. 결과는 이 항목에 이어 적는다.

### `[chore]` 연결 점검 스크립트 `check-notion.js` · 상태: `완료`

**요청**: "실 노션 워크스페이스로 테스트할 수 있게 토큰 설정 방법 알려줘." (2026-09-10)

**왜 코드가 붙었나**: 설정 절차를 설명하려니 **확인할 방법이 없었다.** 연결을 페이지에 추가하지 않는 것이 가장 흔한 실패인데(N12),
그 상태에서 `sync` 는 "발견 0 · 추가 0" 이라는 모호한 결과만 낸다. 토큰이 틀렸는지, id 가 틀렸는지, 연결이 없는지 구분되지 않는다.
그래서 읽기 전용 점검을 스킬에 넣었다: 연결 이름 → 사용자 수 → 접근 가능한 페이지·DB 수 → 서비스/위키 루트가 보이는지 → 속성 이름 매핑 대조.
실패마다 **다음에 할 일**을 함께 출력한다.

**변경 파일**
- `plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/check-notion.js` (신규, 읽기 전용)
- `SKILL.md` — `sync` 절차 앞에 점검 단계. "페이지 0개면 연결 추가를 안 한 것" 을 명시
- `README.md` — Quick Start 에 확인 절과 예시 출력, 5.2 에 확인 단계와 URL → 페이지 id 변환 one-liner
- `.env.example` — 토큰이 필요한 명령 목록 정정(P11 에서 `draft-pull`·`draft-submit` 이 추가됐는데 반영되지 않았다) + `npm run check` 안내
- `package.json` — `npm run check`, `docs/TRD.md` 6.7.1

**검증**: 토큰 없음 → 규정된 안내 문구 + 종료 코드 1. 잘못된 토큰(`ntn_invalid_for_test`) → 실제 Notion API 가 `401 unauthorized`
"API token is invalid" 를 돌려주고 스크립트가 다음 할 일을 덧붙였다 — **네트워크 경로와 오류 처리는 실측**했다.
`npm test` 98/98 · lint 오류 0 · `plugin validate --strict` 통과.

**미확정**: 정상 토큰으로 성공 경로를 돌려 보지 못했다(워크스페이스·토큰 없음). 성공 시 출력 형식은 코드에 고정돼 있고 README 예시와 같다.

### `[feat]` P11 — 작성 스킬 `notion-draft` (신규 작성 + 기존 페이지 수정) · 상태: `완료`

**요청**: "사람들이 claude code 로 노션 페이지 작성할 때, 스킬을 호출하고 데이터를 입력으로 넣으면 신규 생성 규칙을 지킨 페이지가
만들어지고, 사람이 검토 후 Notion 에 게시할 수 있게 해 달라. 기존 스킬 확장인지 별도 SKILL.md 인지 먼저 인터뷰해 달라." (2026-09-10)

**인터뷰로 정한 것 (7개)**

| 질문 | 답 | 반영 |
|---|---|---|
| 기능의 위치 | **같은 플러그인 안에 별도 스킬** (`notion-draft`) | [TRD ADR-010](./TRD.md#adr-010--작성-기능은-별도-스킬-lib-는-형제-스킬에서-공유) |
| 검토 지점 | **로컬 초안 파일**을 사람이 검토한 뒤 게시 | [DESIGN 10.2](./DESIGN.md#102-초안-파일의-위치와-이름) |
| 부족한 필수 속성 | **물어본다** (요약·담당자·문서유형은 추측하지 않는다) | [DESIGN 10.5](./DESIGN.md#105-검증-규칙) · SKILL.md `new` 절차 |
| 범위 | **신규 생성 + 기존 페이지 수정** | FR8 |
| 수정 방식 | 현재 본문을 **전부 받아** 고치고 **diff 검토 후 교체**. 초안 이후 원본이 바뀌면 중단 | [TRD ADR-011](./TRD.md#adr-011--기존-페이지를-고치는-경로의-안전-모델) |
| 수정 대상 | **제한 없이** (폐기·민감만 제외) — 확정 페이지도 고칠 수 있다 | [DESIGN 10.7](./DESIGN.md#107-기존-페이지-수정의-안전-거부) |
| 게시 후 미러 | 게시한 **그 페이지만 즉시** `raw/` 에 기록 | [DESIGN 10.8](./DESIGN.md#108-게시-후-raw-즉시-반영) |

**문서로 확인한 새 API 사실 (2026-09-10)**: `GET /v1/users`(사용자 목록 — 담당자 이름을 사용자 id 로 해석. 연결에 사용자 정보 권한 필요, 게스트 제외),
`PATCH /v1/pages/{id}`(속성만 수정, 본문은 못 건드림. people 은 `{id}` 배열). TRD 3.1 의 N15·N16 으로 추가했다.

**계획**: [PLAN P11](./PLAN.md#p11--작성-스킬-notion-draft). 문서(이 항목·PRD FR8·TRD·DESIGN 10절) 먼저, 그 다음 구현·테스트.

**만든 것**
- 스킬 `plugins/notion-llm-wiki/skills/notion-draft/` — `SKILL.md`($0 로 `new`|`edit`|`submit`), `references/draft-templates.md`·`draft-procedure.md`
- 스크립트 3개 — `draft-new.js`(골격 생성, 토큰 불필요) · `draft-pull.js`(현재 속성·본문 → 초안) · `draft-submit.js`(검증 → dry-run → `--apply` → `raw/` 즉시 기록)
- lib 6개 — `shared.js`(형제 스킬과의 **유일한 결합점**) · `draft.js`(검증 13종) · `doc-templates.js`(유형별 섹션) · `props.js`(쓰기 형태 속성·담당자 해석) · `diff.js`(LCS) · `target.js`(대상 식별·안전 거부)
- 공용 코드는 **추가만** 했다: `sync.js` 가 `sortedJson` export, `config.js` 의 `paths.drafts` 기본값, `md-notion.js` 의 `mentionLinks` 옵션(기본 false — 위키 게시 출력은 바이트까지 그대로),
  `register-legacy.js` 에서 카테고리 DB 탐색을 `findCategoryDataSource` 로 추출해 **두 스킬이 한 구현을 공유**
- mock 확장 — `GET /v1/users`(N15), `PATCH /v1/pages` 의 속성 전체 반영(N16), people 을 **id 로** 받게 정정
- 테스트 34건 추가 (T19 검증 · T20 속성·diff · T21 신규 · T22 수정 · T23 스킬 구조), 샘플 초안 1개, 버전 0.1.0 → **0.2.0**

**실행이 잡은 결함 3건**
1. **`related` 가 항상 "변경됨" 으로 잡혔다.** 초안은 `[{title,url}]`, Notion 은 `[id]` 라 형태가 달랐다. 그래서 아무것도 고치지 않은 초안도
   "속성 변경 있음" 이 되고, `draft-unchanged` 경고는 영원히 나오지 않았다. → 비교 전에 **페이지 id 로 정규화**한다.
2. **"바뀐 게 없다" 를 말할 수 없었다.** 본문을 안 고친 수정 초안은 `## 변경 이력` 에 오늘 항목이 없어 검증에서 먼저 막혔다 — "변경 이력을 쓰라" 는
   안내는 이 상황에서 틀린 조언이다. → **본문이 그대로면(`base_hash` 일치) 변경 이력을 요구하지 않는다.** 규칙 자체가 더 정확해졌다 (DESIGN 10.5 정정).
3. **바뀐 줄이 없는데 diff 가 "… N줄 생략 …" 을 출력했다.** → 변경이 없으면 빈 문자열.

**도그푸딩 (스킬 문서만 주고 실행)**: `--plugin-dir` 로 로드한 헤드리스 세션에 CS 회의 메모 한 줄을 주자 —
references 2개를 먼저 읽고 → 작업 디렉터리의 설정을 확인하고 → `draft-new.js` 를 **단독 명령·따옴표 없이** 호출(권한 거부 **0건**) →
섹션을 입력 내용만으로 채우고 → 근거 정책이 없으니 `없음 — 정책 필요` 로 쓰고 → **모르는 것 7건을 `미확정 · 열린 질문` 에 질문으로** 남겼다.
그 산출물을 검증기에 넣으니 **오류 0 · 경고 0**. 입력에 없는 수치를 지어낸 흔적은 없었다.
- 여기서 하나가 드러났다: 헤드리스 세션에는 `AskUserQuestion` 이 없어 **묻지 못하고 진행**했다(이번에는 필수 속성이 입력에 다 있어 문제가 되지 않았다).
  → SKILL.md 규칙 1 에 "그 도구가 없으면 묻는 문장을 출력하고 멈춘다" 를 추가했다.

**검증 (2026-09-10)**
- `npm test` **98/98** (기존 64 + 신규 34). `npm run lint` 오류 0 · 경고 4(샘플에 심어 둔 운영 신호).
- `build-index` 재생성 diff 없음. `claude plugin validate --strict` — 플러그인·마켓플레이스 모두 통과.
- A19(dry-run 쓰기 0건) · A20(속성 매핑·담당자 해석) · A21(게시 후 sync 가 본문을 다시 받지 않음) · A22(거부 4종 각각 쓰기 0건) 을 mock 으로 실측.

**남은 미확정**
- 실 Notion 에서 `POST /v1/pages` 가 `properties` 와 `markdown` 을 한 번에 받는지, `PATCH /v1/pages` 의 속성 부분 갱신, `GET /v1/users` 의 이름 해석 — **전부 문서 확인 + mock 검증**이다.
- 동명이인·게스트·비활성 사용자에서 담당자 해석이 어떻게 되는지 (지금은 중단하고 사람에게 넘긴다).
- 속성 호출과 본문 호출 사이의 부분 실패 (트랜잭션이 없다 — 무엇이 반영됐는지 보고만 한다).
- 실무자가 이 흐름을 실제로 쓰는지 (사용성 실측 없음).

### `[feat]` P10 — Claude Code 플러그인 패키징 · 상태: `완료`

**요청**: "이 스킬 claude plugin 으로 설치 가능하게 수정해줘." (2026-09-10)

**내용**: 스킬 디렉터리를 `.claude/skills/notion-llm-wiki/` → `plugins/notion-llm-wiki/skills/notion-llm-wiki/` 로 **내부 구조 그대로** 옮기고(git rename 19개),
플러그인 매니페스트와 저장소 루트 마켓플레이스를 추가했다. 설치 id `notion-llm-wiki@heybit-notion-llm-wiki`.
설치: `claude plugin marketplace add littleanti/heybit-notion-llm-wiki` → `claude plugin install notion-llm-wiki@heybit-notion-llm-wiki`.
결정 기록 [TRD ADR-009](./TRD.md#adr-009--배포-단위는-플러그인-스킬-복사가-아니라), 확인한 규약 [TRD 3.3](./TRD.md#33-claude-code-플러그인-규약--문서로-확인한-사실-2026-09-10).

**3단 사고에서 뒤집힌 것**
- 1차: 저장소 루트를 통째로 플러그인으로(`source: "./"`). → 설치가 플러그인 디렉터리 **전체를 캐시로 복사**한다는 문서 사실에 막혔다 — 샘플 `raw/`·`wiki/`·`test/` 가 모든 사용자 캐시에 실려 간다. 서브디렉터리 플러그인으로.
- 1차: 스크립트를 플러그인 루트 `scripts/` 로 올리고 `${CLAUDE_PLUGIN_ROOT}`. → skills.md 가 **`${CLAUDE_SKILL_DIR}` 를 본문과 `allowed-tools` 두 곳에서 치환**한다고 명시. 스크립트를 스킬 디렉터리 안에 두면 플러그인으로도, `.claude/skills/` 복사본으로도 같은 SKILL.md 가 동작한다. 이쪽을 택했다.
  P0 부터 미확정이던 "allowed-tools 치환 여부" 가 함께 해소됐고, 그래서 `Bash(node .claude/skills/…/*)` 상대 경로 규칙과 `Bash(npm run *)`·`Bash(npm test)` 를 `allowed-tools` 에서 뺐다(권한 표면 축소).
- 보조 조사 결과 하나는 문서와 어긋났다: 조사 보고는 "allowed-tools 에서는 변수가 치환되지 않는다" 였으나 skills.md 원문은 반대였다. **원문을 직접 읽어 확인**하고 원문을 따랐다.

**변경 파일**
- 이동: `plugins/notion-llm-wiki/skills/notion-llm-wiki/{SKILL.md, references/*, scripts/**}` (내용은 SKILL.md·ingest-procedure·lint-semantic 의 경로 문구만 변경)
- 신규: `plugins/notion-llm-wiki/.claude-plugin/plugin.json`, `plugins/notion-llm-wiki/README.md`, `.claude-plugin/marketplace.json`, `.claude/settings.json`(extraKnownMarketplaces·enabledPlugins), `test/plugin.test.js`(T18 5건)
- `SKILL.md`: `allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*) Read Grep Glob Write Edit`, 본문 스크립트 호출 7곳을 `${CLAUDE_SKILL_DIR}/scripts/…` 로, "`npm run` 은 샘플 저장소 안에서만" 명시, 설정 파일 없을 때의 안내 추가
- `references/ingest-procedure.md`·`lint-semantic.md`: 경로 직접 표기 → "SKILL.md 의 스크립트 디렉터리" (references 에는 치환이 적용되지 않는다)
- `package.json` scripts, `test/*.test.js`·`test/helpers/*` require 경로, `test/skill.test.js` allowed-tools 검사, `test/golden/publish-plan.json`(log.md 해시), `wiki/log.md` 4행 경로 문구
- `.github/workflows/ci.yml`: 색인 확인 단계 경로 + **`plugin` 잡 추가**(러너에 CLI 전역 설치 → `validate --strict` 플러그인·마켓플레이스 → T18)
- 문서: `README.md`(설치 두 갈래·구조·한계·문서 표), `docs/PRD.md` FR7.1·7.2, `docs/TRD.md` 3.2 정정·3.3 신설·4절·ADR-009, `docs/PLAN.md` P10

**검증 (2026-09-10, 로컬)**
- `claude plugin validate --strict plugins/notion-llm-wiki` ✔ · `claude plugin validate --strict .` ✔ (CLI 2.1.267)
- `claude --plugin-dir plugins/notion-llm-wiki -p "/notion-llm-wiki:notion-llm-wiki" --max-turns 1` → 스킬이 로드되어 `$0` 없음 → **사용법 표 출력** (실제 로드 확인). bare `/notion-llm-wiki` 는 print 모드에서 스킬 호출로 해석되지 않았다 — 대화형 동작은 미실측.
- `npm test` **69/69** (64 + T18 5). 첫 실행에서 2건이 실패했다: (1) `wiki/log.md` 경로 문구 변경으로 게시 골든의 log.md 해시 불일치 → 골든 재생성. (2) T18 이 SKILL.md 의 "`.claude/skills/` 에 복사했든" 이라는 **설명 문장**을 옛 경로 잔존으로 오판 → 검사를 스크립트 경로 문자열로 좁혔다.
- `npm run lint` 오류 0(경고 4 — 샘플에 심어 둔 것), `build-index` 재실행 diff 없음, CI YAML 파싱(jobs: test·plugin).

**push 후 실측 (2026-09-10, 커밋 138f4cd)**
- **CI run 34457349321 — 3 잡 전부 통과**: test(Node 22) · test(Node 24) · plugin. plugin 잡은 러너에서 `npm i -g @anthropic-ai/claude-code` 로 CLI 를 설치한 뒤 인증 없이
  `validate --strict` 두 번(플러그인·마켓플레이스)과 T18 을 통과했다(잡 소요 약 10초). P10 의 두 미확정("CI 러너의 CLI 설치", "인증 없는 validate")이 해소됐다.
- **GitHub 경유 실제 설치 성공**: `claude plugin marketplace add littleanti/heybit-notion-llm-wiki`(SSH clone) → `claude plugin install notion-llm-wiki@heybit-notion-llm-wiki`
  → `~/.claude/plugins/cache/heybit-notion-llm-wiki/notion-llm-wiki/0.1.0/` 에 **플러그인 디렉터리의 21개 파일만** 복사됐다(샘플 `raw/`·`wiki/`·`test/` 없음 — ADR-009 공격 ① 의 판단대로).
  `claude plugin details`: 상시 비용 약 260 토큰, 호출 시 약 3.5k.
- **설치본으로 `lint` 를 헤드리스 실행하자 권한에서 막혔다 — `[fix]` 완료**: 본문의 `${CLAUDE_SKILL_DIR}` 는 캐시 절대 경로로 치환됐지만, 모델이
  `cd "<프로젝트>" && node "<경로>/lint.js"` 처럼 **경로를 따옴표로 감싸고 `cd` 와 묶어** 실행했다. 권한 규칙 `Bash(node <경로>/scripts/*)` 는 접두 일치라 따옴표 한 글자에도
  어긋나고, 복합 명령은 "multiple operations" 로 승인 대상이 된다. 비대화형이라 4회 모두 거부 → max turns.
  수정: (1) `allowed-tools` 에 따옴표 변형 `Bash(node "${CLAUDE_SKILL_DIR}/scripts/*)` 추가, (2) SKILL.md 에 **실행 규칙** 명시 — `cd` 금지, `&&`·`;`·`|` 로 묶지 않기,
  따옴표 없이 글자 그대로, 현재 디렉터리가 이미 프로젝트 루트, `--root` 는 뒤에.
  재실측(`--plugin-dir` 로컬 사본, 헤드리스 `lint`): Glob 로 설정 파일 확인 → `node D:/…/scripts/lint.js` 단독·무따옴표 실행 → **거부 0건**, lint 결과 보고까지 3턴.
  "`${CLAUDE_SKILL_DIR}` 는 본문과 `allowed-tools` 두 곳에서 치환된다" 는 문서 사실이 **실행으로 확인**됐다. `npm test` 69/69 · `validate --strict` 통과 유지.
- **부작용 발견**: 검증 설치를 되돌리는 `claude plugin uninstall` + `claude plugin marketplace remove`(사용자 스코프)가 **프로젝트 `.claude/settings.json` 의
  `enabledPlugins`·`extraKnownMarketplaces` 를 빈 객체로 덮어썼다**. `git checkout -- .claude/settings.json` 으로 복구. README 8절에 주의로 적었다.
- 검증 설치는 되돌려 사용자 환경을 요청 전 상태로 두었다(캐시에는 CLI 가 `.orphaned_at` 표시를 남겨 스스로 정리한다). 실제 설치 명령 두 줄은 README 5.1.

> 교훈: "치환된다" 는 문서 사실과 "권한 프롬프트 없이 실행된다" 는 결과 사이에 **모델의 표기 습관**(따옴표·`cd &&`)이 끼어 있었다. 규칙을 맞추는 것으로 끝나지 않고
> 스킬이 모델에게 표기까지 지시해야 했다. 설치본으로 한 번 실행해 보지 않았으면 배포 뒤에 사용자가 겪었을 결함이다.

**남은 미확정**
- 대화형 세션에서 bare `/notion-llm-wiki` 가 스킬로 잡히는지(print 모드에서는 `/notion-llm-wiki:notion-llm-wiki` 만 동작) 와 `.claude/settings.json` 의 설치 제안 UI — 미실측.
- `claude plugin update` 갱신 경로 — 버전을 올린 릴리스가 아직 없다.
- 홈 경로에 공백이 있는 사용자: 공백 구분 `allowed-tools` 문자열이 규칙을 쪼갤 수 있다 — 미실측. 발생하면 YAML 리스트 형식이 대안.

---

## 2026-09-09

### `[chore]` P9 — GitHub public 저장소 생성 · push · CI 확인 · 상태: `완료`

**내용**: push 전 점검(`.env` 미포함 · 토큰 형태 문자열 없음 · `node_modules`/lockfile 없음) 후
`gh repo create littleanti/heybit-notion-llm-wiki --public --push` 로 생성·푸시했다 (2026-09-09, 커밋 10개).

**CI 첫 실행(run 34367367488) 이 잡은 결함 — `[fix]` 진행중**
- Node 22·24 매트릭스 모두 **`npm test` 64/64 통과, `npm run lint` 통과** → A16(clone 후 `npm test` 만으로 재현)과 Node 22 실동작이 **실측으로 확인**됐다.
- 마지막 단계 "색인이 최신인지(build-index 재실행 후 diff 없음)" 가 **양쪽에서 실패**. 원인: `wiki/index.md` 헤더의 `생성: <현재 시각>` 이 실행마다 달라진다.
  TRD 6.4 가 약속한 "같은 입력이면 바이트까지 같은 출력" 을 색인이 스스로 어기고 있었다 — 테스트는 시각을 주입해 통과했으므로 로컬에서는 드러나지 않았다.
  같은 종류의 시한폭탄이 하나 더 있다: `⏰`(검토기한 경과) 판정의 기준일이 벽시계라, 날짜가 바뀌어 어떤 `review_by` 를 지나치면 아무도 손대지 않은 색인이 CI 에서 "낡았다" 고 실패한다.
- 수정 (`[fix]` 완료 — 로컬 검증): (1) 헤더에서 `생성:` 을 뺐다 — 생성 시각은 git 커밋이 기록한다. (2) 검토기한 기준일을 **동기화 날짜(`syncedAt`)** 로 바꿨다 — "마지막 동기화 시점 기준 경과" 라는 뜻이 되고 입력만으로 결정된다.
  변경 파일: `scripts/build-index.js`, `test/index.test.js`(실행 시각을 2030년으로 바꿔도 출력이 같은지 확인하는 검사 추가), `test/golden/index.md`, `wiki/index.md`, `docs/DESIGN.md` 5.1, `docs/TRD.md` 6.4.
  검증: `npm test` **64/64**, 커밋 후 색인 재생성 diff 없음(로컬).
- **CI 재실행 (run 34367811565): Node 22·24 양쪽 전 단계 통과** — 테스트 64 · lint · 색인 최신 확인. 이로써 P0 부터 미확정이던 "Node 22 실동작" 과
  A16(clone 후 `npm test` 만으로 재현)이 실측으로 해소됐다. 저장소: `github.com/littleanti/heybit-notion-llm-wiki` (public).

> 교훈: 결정성은 "테스트에서 시각을 고정할 수 있다" 가 아니라 "실제 실행이 시각에 의존하지 않는다" 여야 한다. 테스트가 주입한 시각은
> 이 결함을 가렸고, 아무것도 주입하지 않는 CI 가 드러냈다. 자매 저장소의 "검증 스크립트가 틀렸던" 사례와 같은 계열 — **측정 환경이 통과시킨 것을 실환경이 뒤집었다.**

---

### `[docs]` P8 — README · 문서 마감 · Acceptance 일괄 · 상태: `완료`

**내용**
- `README.md` (신규) — 이 저장소가 답하는 세 질문(작성 규약 / 위키 구조 / 운영), 흐름도, 샘플 둘러보기(심어 둔 문제를 위키가 어떻게 표시하는지), 구조, 설치(Notion 연결 추가 절차·카테고리 DB·설정), 스킬 서브커맨드 5개 표, 스크립트 직접 실행, 실무자 안내 링크, 테스트 표, **한계와 미확정 표**, 문서 인덱스, MIT
- `docs/PRD.md` 1.0 — Acceptance 결과 표 추가. **A6·A13 을 ADR-006 에 맞춰 재정의**(블록 변환·분할이 사라졌으므로 원 조건은 검증 대상이 아니다 — 재정의 사실을 표에 남겼다)
- `docs/TRD.md` 1.0 — 3절 검증 상태 열을 실측 결과로 갱신
- `docs/DESIGN.md` 1.0 — 3.2 표기 규칙(원본 일부 누락·검토기한 경과·겹침), 3.4 다이제스트(충돌 인라인·미확정 선택 절·자주 찾는 페이지 예외), 3.5 토픽(최소 조건·첫 줄 문구), 3.6 충돌(`비고` 열·대조표·`미확정` 절·절 추가 허용) — `references/wiki-schema.md` 와 동기화
- `docs/PLAN.md` 1.0 — 상태 갱신

**검증 (실행함)**: `npm test` → **tests 64 / pass 64 / fail 0**. `npm run lint` → 오류 0 · 경고 4. `npm run publish:wiki`(dry-run) → 생성 28 · 해석 불가 링크 0.
문서 간 링크·앵커 127건 스크립트 검사 — 실제 링크 전부 해석(지적 8건은 형식 예시 자리표시자). Acceptance 결과는 [PRD 6절](./PRD.md#6-acceptance-기준).

**A17 에 대한 정직한 기록**: "실무자가 DESIGN 1·2절만 보고 새 페이지를 만들 수 있다" 는 **실무자에게 시켜 보지 않았다.** 자체 점검이며, 간접 증거는
스킬 절차 문서만으로 위키를 합성한 P6 의 실행뿐이다. 실제 실무자 검증은 조직에 붙일 때의 첫 과제다.

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

### `[feat]` P6 — 스킬(SKILL.md·references) + 샘플 위키 합성 + 질의 실행 · 상태: `완료`

**내용** (스킬 문서는 fixture 대기 중 먼저 작성, ingest·query 실행은 raw/ 골든 생성 후):
- `.claude/skills/notion-llm-wiki/SKILL.md` — frontmatter(`name`·`description`·`argument-hint`·`allowed-tools`), `$0` 분기, 서브커맨드 5개 절차 요약
- `references/wiki-schema.md` · `ingest-procedure.md` · `query-procedure.md` · `lint-semantic.md` · `notion-authoring.md`
- `test/skill.test.js` — T16 (frontmatter 필드 · 서브커맨드 5개가 references 를 가리킴 · 500줄 이내 · description 길이)
- **ingest 수행** → `wiki/` (개요 2 · 다이제스트 12 · 토픽 · 충돌 2 · log) → `build-index` → `lint` 오류 0
- **query 수행** → 질문 3개 답변을 이 LOG 에 기록 (A14)

**검증 (실행함)**
- T16 4건 통과 (frontmatter · 서브커맨드 5개 ↔ references · 500줄 이내 · references 의 상한·허용값이 설정과 일치).
- **ingest 실제 수행** — 스킬 절차를 그대로 따르는 **작업자 2개(서비스별)** 에게 SKILL.md·wiki-schema.md·ingest-procedure.md 만 주고 `ingest --full` 을 시켰다.
  결과: `wiki/` **24 페이지** (루틴핏 13: 개요 1 · 다이제스트 7 · 토픽 4 · 충돌 1 / 머니노트 11: 개요 1 · 다이제스트 6 · 토픽 3 · 충돌 1) + `log.md`.
  `build-index` → 색인 96줄(raw 33 · wiki 24). `lint` → **오류 0** · 경고 4(raw 쪽 운영 신호). `publish` dry-run → 생성 28(잎 26 + 컨테이너 2), 해석 불가 링크 0.
- 위키가 **심어 둔 문제를 실제로 잡았다**: 환불 기한 14일/7일 충돌(양쪽 기록 + "A 가 최신·7일은 제정 당시 값" 만 사실로), 정책 없는 응대 1,
  검토기한 경과 1, meta 없음 3, 폐기됐지만 참조됨 1, AI 초안 3(사실로 쓰지 않음), 절단 원본의 서술에 `(원본 일부 누락)`.
  머니노트는 충돌 0 — 대신 대조한 값 9건의 표를 남겨 "검증했다" 는 증거를 남겼다. 보관 30일/7일은 충돌이 아니라 미확정으로 분류(원본이 스스로 검토중이라 썼다).

**절차 문서의 결함 — 실행이 드러낸 것 (그라운드 룰 1: 문서가 맞다고 가정하지 않고 실행으로 반증)**

두 작업자가 합쳐 **21건**의 모호점을 보고했다. 문서만 읽었을 때는 완결처럼 보였던 규칙들이다. 반영한 것:

| 지적 | 조치 |
|---|---|
| conflicts 템플릿에 `미확정` 자리가 없어 토픽 없는 원본의 미확정이 갈 곳이 없다 | conflicts 에 `## 미확정` 추가. digest 에는 `(선택)` 으로 |
| 충돌 표 4열에 "어느 쪽이 최신/확정" 을 담을 수 없다. "발견일" 정의 없음 | `비고` 열 추가, 발견일 = 이번 ingest 날짜로 정의 |
| digest 에는 `## 충돌` 이 없는데 절차는 토픽의 충돌만 말한다 | 핵심 사실 항목 끝 `⚠ 충돌 → conflicts` 인라인 + 검토 필요 로 규정 |
| digest/topics 의 상대 경로(`../../../`)와 색인 링크 경로가 문서에 없다 | 5.1절에 위치별 경로 명시 |
| "최근 30일 확정 사항 5개" 선정 기준 없음 | `last_edited_time` 최신 5개로 |
| `⚠ 충돌 있음 → ## 충돌` 을 그대로 쓰면 줄 안에 `## ` 가 들어간다 | 문구를 "아래 충돌 절 참조" 로 |
| 절대 규칙 3(raw 링크) vs 6절(색인 편법) vs lint(.md 면 통과) 가 셋이 다르다 | "raw 우선 → 위키 → 색인" 우선순위로 통일 |
| 토픽 최소 조건(원본 2·카테고리 2)이 의무로 읽힌다 | "최소 조건이지 의무 아님 — 가로지르는 질문이 올 것인가로 고른다" |
| 검토기한 지난 확정 페이지를 사실로 써도 되나 | 사실로 쓰되 `(검토기한 경과)` 표기 + 표에 올림 |
| 확정 + 절단 원본의 표기 중복 | 표기 겹침 규칙 명시 |
| 충돌 0 일 때 "없음" 한 단어 vs 대조표 — 대조표는 새 결론인가 | 대조표는 검증 증거로 허용 |
| 한 원본의 표를 세어 나온 개수는 "원본에 없는 수치" 인가 | 단일 원본 집계는 `(원본 표에서 집계)` 로 허용, 다원본 계산은 금지 |
| 자주 찾는 페이지 5~10 인데 원본이 2~3개 | "그보다 적으면 전부" |
| `wiki/log.md` 가 없는 최초 실행 | SKILL 에 "없으면 건너뛴다" |
| `## 근거 정책` 값이 정확히 `없음` 이 아니라 "없음 — 정책 필요" | "없음 으로 시작" 으로 |
| digest 가 다른 카테고리 raw 를 인용하면 sources 가 카테고리 단위가 아니게 됨 | sources 는 "실제로 읽은 것" 이라고 명시, 교차 인용 허용 |

반영하지 않은 것: "이번 지시가 log.md 작성을 금지했다" — 두 작업자가 동시에 한 파일에 덧붙이는 충돌을 피한 의도적 지시였고, log 는 통합 후 내가 썼다.
샘플 위키에는 새 규칙에 맞춰 `refund-policy.md` 첫 줄 문구와 두 `conflicts.md` 의 표 열·`## 미확정` 절을 손봤다.

**A14 — 질의 3건 실제 수행** (`references/query-procedure.md` 절차대로. 색인 → 위키 → raw Grep. 동기화 시각 2026-09-09 01:00)

① 카테고리 내부 — "루틴핏에서 8월에 iOS 알림이 안 갔던 원인이 뭐였어?"

> **답** — 2026-08-19 부터 사흘간 iOS 알림이 발송되지 않았고, 원인은 **앱 재설치·기기 복원 뒤 APNs 토큰 갱신 요청이 서버에 반영되지 않은 것**이다. 만료된 토큰으로 발송을 계속 시도하며 실패 응답을 무시하고 있었다. 토큰 갱신 경로 수정은 2026-08-21 배포 완료. (확정)
>
> **근거**
> 1. [iOS 알림 미수신 장애 회고 (2026-08)](https://www.notion.so/heybit/55555555000140038000000000000002) · 상품개발 · 확정 · 최종수정 2026-08-22 — "원인은 앱 재설치와 기기 복원 이후 APNs 토큰 갱신 요청이 서버에 반영되지 않은 것이다"
> 2. [알림 발송 아키텍처](https://www.notion.so/heybit/55555555000140038000000000000001) · 상품개발 · 확정 · 2026-08-25 — 같은 원인을 결과·영향 절에 기록
>
> **주의** — CS 의 [알림이 안 와요 응대](https://www.notion.so/heybit/55555555000140048000000000000002) 는 아직 **초안**(2026-09-02)이라 응대 문구는 확정이 아니다.
>
> **찾은 경로** — index → 토픽 "알림 발송과 미수신" → raw 2건 확인 (Grep `APNs 토큰|토큰 갱신` 6건). 동기화 시각 2026-09-09 01:00 (이후 Notion 변경은 반영 안 됨)

② 카테고리 교차 — "루틴핏 환불 기한이 며칠이야? CS 응대랑 법무 규정이 같아?"

> **답** — 법무 규정은 **결제 후 14일** 이내 전액 환불(2026-09-01 개정, 확정), 이후 이용 일수 일할 차감이다. **CS 응대 가이드는 아직 7일**로 적혀 있어(확정, 2026-08-30) 두 확정 문서가 **다르다**. 상품설명 문서는 14일을 쓴다.
>
> **근거**
> 1. [구독 환불 규정](https://www.notion.so/heybit/55555555000140058000000000000001) · 법무 · 확정 · 최종수정 2026-09-01 — 변경 이력 "2026-03-01 제정 7일 → 2026-09-01 개정 14일"
> 2. [환불 처리 응대 가이드](https://www.notion.so/heybit/55555555000140048000000000000001) · CS · 확정 · 2026-08-30 — "결제 후 7일 이내면 전액 환불로 안내한다"
>
> **주의** — 충돌 1건 → [충돌 · 미확정](../wiki/routinefit/conflicts.md) 1행. 7일은 법무 규정의 제정 당시 값과 같다(오기인지 미반영인지는 원본이 말하지 않는다). 담당 정수아·김하늘 확인 필요.
>
> **찾은 경로** — index → 토픽 "환불 정책"(충돌 표기 있음) → raw 2건 대조. 동기화 시각 2026-09-09 01:00

③ 위키에 없는 것 — "머니노트 다크 모드 지원 계획이 있어?"

> **답** — 위키와 원본 어디에도 "머니노트 다크 모드" 에 대한 페이지가 없다.
>
> **찾아본 곳** — index 전체(raw 33 · wiki 24) 의 제목·요약·키워드에 없음. `raw/moneynote/` Grep: "다크", "dark", "테마", "theme" (대소문자 무시) → **0건**.
> **제안** — 상품기획 DB 에 페이지가 없다면 논의된 적이 없거나 Notion 에 기록되지 않은 것이다. 담당 카테고리: 상품기획(오세린).

세 답 모두 [DESIGN 7절](./DESIGN.md#7-질의-답변-형식-query) 형식을 지켰고, ③ 은 비슷한 것으로 채우지 않고 "없다" 로 끝냈다. 근거 링크는 raw frontmatter 의 `source_url`(가상 Notion URL)이다.

---

### `[feat]` P5 — `md-notion.js` + `publish.js` · 상태: `완료`

**내용** (P3 fixture 본문 대기 중 병행 착수 — 이 둘도 fixture 내용에 의존하지 않는다):

- `.claude/skills/notion-llm-wiki/scripts/lib/md-notion.js` — 표준 MD → enhanced MD 정규화 ([TRD 6.3](./TRD.md#63-libmd-notionjs--표준-md--enhanced-md)): 파이프 표 → `<table>`, 스페이스 들여쓰기 → 탭, 연속 인용 → `<br>`, h5/h6 → h4, 텍스트 특수문자 이스케이프(코드·링크 URL·태그 제외), HTML 주석 제거, 상대 링크 해석 콜백, 마커 콜아웃 헬퍼
- `.claude/skills/notion-llm-wiki/scripts/publish.js` — [TRD 6.2](./TRD.md#62-publishjs--wiki--notion): dry-run 기본 · `--apply` · 2단계(생성 → 본문 교체) · 해시 기반 멱등 · 안전 검사(부모 확인) · 고아 게시 페이지 보고(삭제 안 함) · `--json` 계획 출력
- `test/md-notion.test.js`(T11), `test/publish.test.js`(T12~T14)

**검증 (실행함 — 완료 판정은 P6 의 샘플 위키가 생긴 뒤)**: T11 7건 · T12~T14 5건 통과.
- T11: 파이프 표 → `<table header-row>`, 2/4칸 들여쓰기 → 탭 1/2단, 연속 `>` → `<br>`, h5/h6 → h4, 주석 제거, 특수문자 이스케이프(코드 스팬·링크 URL·기존 태그 블록 제외), 상대 링크 콜백 해석·실패 시 텍스트만. 골든 파일 2개.
- T12: 샘플 위키 dry-run 계획 **28항목**(잎 26 + 컨테이너 2, 전부 `create`)이 `test/golden/publish-plan.json` 과 일치. Notion 호출 0, 상태 파일 미생성. 모든 잎의 첫 블록이 마커 콜아웃, frontmatter 제거 확인.
- T13: mock 에 `--apply` → 생성 28 · 교체 26(잎), 전부 위키 루트 아래. 게시된 본문에 `notion://pending/` 잔존 0(위키 간 링크가 실제 URL 로 해석됨). **2회차 쓰기 0건**, 페이지 수 불변. 파일 1개 수정 → 교체 1건만. 컨테이너 본문은 교체되지 않음.
- T14: 상태 파일에 원본(법무 환불 규정) id 를 심음 → `중단:` 메시지, 쓰기 0, 원본 본문 불변. 다른 워크스페이스의 상태 파일(루트 불일치) 거부.

**실행하면서 고친 것 2건**
1. 정규화기가 **이미 enhanced 태그인 블록**(`<callout>` 등) 안의 탭 들여쓴 줄을 문단으로 오해해 탭을 지웠다. 첫 테스트가 잡았다 → 여는 태그부터 닫는 태그까지 그대로 통과시키는 분기 추가.
2. 골든 기대값의 링크 해시를 손으로 적었다가 틀렸다(테스트가 실패하며 실제 값을 보여 줬다). **골든은 손으로 쓰지 않고 실행 결과를 검토해 채택한다**는 원칙을 `generate-golden.js` 로 굳혔다.

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
