---
name: notion-llm-wiki
description: Notion 실무 문서를 로컬 raw/ 미러로 동기화(sync)하고, 변경분을 읽어 LLM wiki 를 합성(ingest)하고, 위키에서 질문에 출처를 달아 답하고(query), 구조·의미 lint 를 돌리고(lint), 위키를 Notion 에 게시(publish)한다. "위키 동기화해", "노션에서 ~ 찾아줘/검색해", "위키 갱신/합성해", "위키 게시해", "위키 점검해" 같은 요청에 쓴다. RAG·임베딩 없이 색인 → 위키 → 원문 grep 순서로 찾는다.
argument-hint: "<sync|ingest|query|lint|publish> [--full | --apply | 질문]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/*) Read Grep Glob Write Edit
---

# notion-llm-wiki

Notion(원본) → `raw/`(미러) → `wiki/`(합성) → Notion(게시) 의 한 방향 흐름을 운영하는 스킬이다.
규칙의 정본은 `references/wiki-schema.md` 다. **`ingest` 와 `query` 를 시작하기 전에 반드시 그 파일을 읽는다.**

서브커맨드는 첫 인자(`$0`)로 정한다. 나머지 인자는 `$ARGUMENTS` 에서 첫 단어를 뺀 것이다.
모르는 서브커맨드이거나 인자가 없으면 아래 표를 보여 주고 멈춘다.

| `$0` | 하는 일 | 주체 | 필요한 것 |
|---|---|---|---|
| `sync` | Notion → `raw/` 증분 동기화 | 스크립트 | `NOTION_TOKEN` |
| `ingest` | `raw/.sync-report.md` 의 변경분을 읽어 `wiki/` 갱신, 색인·lint·log | **Claude (나)** | `references/wiki-schema.md`, `references/ingest-procedure.md` |
| `query` | 질문에 출처를 달아 답한다 | **Claude (나)** | `references/query-procedure.md` |
| `lint` | 구조 lint(스크립트) + 의미 lint(Claude) | 둘 다 | `references/lint-semantic.md` |
| `publish` | `wiki/` → Notion 위키 루트 아래 게시 (dry-run 기본) | 스크립트 | `--apply` 시 `NOTION_TOKEN` |

스크립트 디렉터리는 `${CLAUDE_SKILL_DIR}/scripts` 다 (Claude Code 가 이 스킬의 절대 경로로 치환한다 — 플러그인으로 설치했든
`.claude/skills/` 에 복사했든 같다). 스크립트는 **위키 프로젝트 루트**(`notion-wiki.config.json` 이 있는 디렉터리)를 작업 공간으로 삼는데,
그 디렉터리는 곧 Claude Code 의 현재 작업 디렉터리다.

**실행 규칙 — 아래 명령을 글자 그대로 실행한다.**
- `cd … &&` 를 붙이지 않는다. 다른 명령과 `&&`·`;`·`|` 로 묶지 않는다. 경로를 따옴표로 감싸지 않는다.
  (이 스킬의 권한 사전 승인은 `node ${CLAUDE_SKILL_DIR}/scripts/…` 로 **시작하는 단독 명령**에만 걸린다. 복합 명령이나 다른 표기는 승인 프롬프트를 만들고,
  비대화형 실행에서는 거부된다.)
- 다른 디렉터리를 대상으로 할 때만 옵션 `--root <프로젝트 디렉터리>` 를 **뒤에** 붙인다.
- `notion-wiki.config.json` 이 없으면 만들라고 안내하고 멈춘다 — 샘플 저장소 heybit-notion-llm-wiki 의 것을 복사해 id 만 바꾸면 된다.
- `npm run sync|index|lint|publish:wiki` 는 샘플 저장소 안에서만 존재한다. 이 스킬은 항상 위의 `node` 명령을 쓴다.

## 절대 규칙 (모든 서브커맨드 공통)

1. **`raw/` 는 읽기만 한다.** 파일을 고치지도, 만들지도 않는다. 원본이 틀렸으면 사람이 Notion 에서 고친다.
2. **위키에는 원본에 있는 것만 쓴다.** 종합·비교는 하되 새 결론을 만들지 않는다. 추론은 `> 추론:` 으로 분리한다.
3. **모든 서술에 출처.** H2 섹션마다 링크 1개 이상 — raw 원본 우선, 해당 사항이 없는 섹션은 위키·색인 링크로 대신한다(`references/wiki-schema.md` 6절). 원본 `status` 가 `확정` 이 아니면 `(초안)` 등을 붙인다.
4. **모순은 고르지 않고 기록한다.** 충돌 페이지에 양쪽을 출처와 함께 적는다.
5. **토큰을 출력하지 않는다.** `.env` 를 읽거나 인용하지 않는다.
6. **삭제는 사람이 결정한다.** 위키 페이지·Notion 페이지를 지우려면 운영자에게 먼저 묻는다.

## `sync`

**실 워크스페이스에 처음 붙이는 경우**, 또는 권한·설정 문제가 의심되면 먼저 읽기 전용 점검을 돌린다:

```
node ${CLAUDE_SKILL_DIR}/scripts/check-notion.js
```

연결 이름·사용자 수·접근 가능한 페이지 수·서비스 루트와 위키 루트가 보이는지·속성 이름 매핑을 확인해 준다.
`접근 범위 페이지 0개` 면 Notion 페이지에 **연결을 추가하지 않은 것**이다(가장 흔한 원인). 그 사실을 그대로 전한다.

```
node ${CLAUDE_SKILL_DIR}/scripts/sync.js [--full]
```

1. 실행하고 요약 줄(`sync: 추가 N · 변경 N · …`)을 그대로 보고한다.
2. `raw/.sync-report.md` 를 읽고 **실패**·**절단(truncated)**·**meta 없음** 항목이 있으면 운영자에게 알린다
   (실패는 다음 실행에서 재시도된다. meta 없음은 레거시 등록이 필요하다는 뜻이다 — `references/notion-authoring.md`).
3. 변경이 있으면 "`ingest` 를 이어서 할까요?" 라고 묻는다. 시키지 않은 ingest 를 하지 않는다.
4. `NOTION_TOKEN` 이 없다는 메시지가 나오면 `.env.example` 절차를 안내하고 멈춘다.

## `ingest`

**먼저 읽는다**: `references/wiki-schema.md`, `references/ingest-procedure.md`, `wiki/log.md` 의 마지막 항목(최초 실행이라 파일이 없으면 건너뛴다 — 이번 ingest 가 첫 항목을 만든다).

요약 절차 (상세는 ingest-procedure.md):
1. `raw/.sync-report.md` 의 추가·변경·이동·삭제 목록이 입력이다. `--full` 이 붙었거나 `wiki/` 가 비어 있으면 전체 재합성.
2. 변경된 raw 마다: frontmatter 를 읽고 → 영향받는 위키 페이지(해당 카테고리 다이제스트, 키워드가 겹치는 토픽, 충돌 페이지, 서비스 개요)를 정한다.
3. 위키 페이지를 고치거나 만든다 (템플릿·상한은 wiki-schema.md).
4. `node ${CLAUDE_SKILL_DIR}/scripts/build-index.js` → `node ${CLAUDE_SKILL_DIR}/scripts/lint.js`. **오류가 0 이 될 때까지** 고친다. 경고(meta 없음·검토기한)는 충돌 페이지에 반영한다.
5. `wiki/log.md` 끝에 항목을 덧붙인다 — 입력·갱신한 페이지·판단·미확정.
6. 운영자에게 무엇을 바꿨는지 5줄 이내로 보고하고, `publish` 를 이어서 할지 묻는다.

## `query <질문>`

**먼저 읽는다**: `references/query-procedure.md`.

1. `wiki/index.md` 를 읽고 질문의 키워드(동의어 포함)로 후보 페이지를 고른다.
2. 위키 페이지(토픽 → 다이제스트) 를 읽는다. 답이 있으면 원문(raw) 1~2건으로 확인한다.
3. 없으면 `raw/` 를 Grep 한다 — 키워드 + `keywords:` frontmatter + 영문/약어.
4. 답을 `references/query-procedure.md` 의 형식으로 낸다: **답 · 근거(Notion URL, 상태, 날짜) · 주의(충돌·초안) · 찾은 경로 · 동기화 시각**.
5. 못 찾으면 "없다" 고 말하고 어디를 봤는지 적는다. 추측으로 채우지 않는다.
6. 답이 반복될 질문이면 운영자에게 토픽 페이지로 환류할지 제안한다 (제안만).

## `lint`

```
node ${CLAUDE_SKILL_DIR}/scripts/lint.js [--json] [--strict]
```

1. 구조 lint 를 실행하고 결과를 보고한다. 오류(E)는 저장소 결함이므로 원인을 찾아 위키 쪽을 고친다 (raw 는 고치지 않는다 — raw 쪽 결함은 `sync --full` 재실행 또는 Notion 수정 대상).
2. 인자에 `semantic` 이 있으면 `references/lint-semantic.md` 체크리스트로 의미 lint 를 수행하고 결과를 각 서비스의 `conflicts.md` 에 반영한다.

## `publish [--apply]`

```
node ${CLAUDE_SKILL_DIR}/scripts/publish.js            # dry-run
node ${CLAUDE_SKILL_DIR}/scripts/publish.js --apply    # 실제 게시
```

1. 항상 dry-run 을 먼저 돌려 생성·교체·고아 목록을 운영자에게 보여 준다.
2. 운영자가 확인하면 `--apply`. 게시기는 위키 루트 아래 자기가 만든 페이지만 만진다. **"중단:" 으로 시작하는 메시지가 나오면 상태 파일을 고치기 전까지 다시 시도하지 않는다.**
3. 고아 게시 페이지(파일은 사라졌는데 Notion 페이지가 남은 것)는 자동 삭제되지 않는다 — 운영자에게 목록을 넘긴다.
4. 해석 불가 링크가 보고되면 어느 위키 페이지의 어느 링크인지 알려 준다.

## 자주 하는 실수

- `ingest` 없이 `publish` → 위키가 낡은 채 게시된다. 순서는 `sync → ingest → lint → publish`.
- 위키 페이지에 원본에 없는 수치를 "정리" 하며 적는 것 → 규칙 2 위반. 원본으로 돌려보낸다.
- `raw/` 파일을 고쳐서 lint 를 통과시키는 것 → 규칙 1 위반. 다음 sync 가 되돌린다.
- 답변에 동기화 시각을 빼는 것 → 독자가 신선도를 판단할 수 없다.
