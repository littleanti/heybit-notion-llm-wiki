# notion-llm-wiki (Claude Code 플러그인)

Notion 실무 문서를 Claude Code 가 **읽어 위키로 만들고**, **써서 다시 Notion 에 올린다.**
RAG·임베딩 없이 색인 → 위키 → 원문 grep 순서로 찾는다. Node.js 22+, 외부 의존성 0개.

| 스킬 | 방향 | 서브커맨드 |
|---|---|---|
| `notion-llm-wiki` | Notion → 위키 | `setup` · `sync` · `ingest` · `query` · `lint` · `publish` |
| `notion-draft` | 입력 → Notion | `new` · `edit` · `submit` |

설계 문서·샘플 데이터·테스트는 상위 저장소 [littleanti/heybit-notion-llm-wiki](https://github.com/littleanti/heybit-notion-llm-wiki) 에 있다.
이 디렉터리는 그중 **설치되는 부분**만 담는다.

## 설치

```bash
claude plugin marketplace add littleanti/heybit-notion-llm-wiki
claude plugin install notion-llm-wiki@heybit-notion-llm-wiki
```

Claude Code 안에서는 `/plugin marketplace add littleanti/heybit-notion-llm-wiki` → `/plugin install notion-llm-wiki@heybit-notion-llm-wiki`.
설치 없이 한 세션만 써 보려면 저장소를 clone 한 뒤 `claude --plugin-dir plugins/notion-llm-wiki`.

비개발자용 단계별 안내는 상위 저장소 README 의 [⚡ Quick Start](https://github.com/littleanti/heybit-notion-llm-wiki#-quick-start-5분-개발-지식-없이).

## 처음 한 번 — `setup`

위키를 둘 폴더에서 `claude` 를 열고 이렇게만 하면 된다.

```
/notion-llm-wiki setup
```

스킬이 **물어보고 만들어 준다**:

1. **작업 위치** — `.env`·설정이 놓이고 `raw/`·`wiki/`·`drafts/` 가 생길 폴더 (기본: 현재 폴더)
2. **동기화 대상** — 서비스 상위 페이지 URL(1개 이상)과 위키를 게시할 **빈 페이지** URL. URL 을 그대로 주면 id 를 뽑아 `notion-wiki.config.json` 을 만든다
3. **Notion 토큰** — `.env` 를 만들고 **넣는 방법을 묻는다.** 직접 붙여넣기(권장 — 토큰이 대화 기록에 남지 않는다) 또는 대화로 전달
4. 끝나면 읽기 전용 점검(`check-notion.js`)으로 연결·권한·속성 이름을 확인해 준다

말로 해도 된다 — `"노션 연결 설정해줘"`, `"처음인데 어떻게 시작해?"`.

### 파일이 어디에 생기나

**`claude` 를 실행한 폴더**가 기준이다 (`process.cwd()`). 플러그인 설치 폴더에는 아무것도 쓰지 않는다.

```
<작업 폴더>/
├── .env                      토큰 (커밋 금지)
├── notion-wiki.config.json   설정
├── raw/                      sync 결과 — Notion 미러 (읽기 전용)
├── wiki/                     ingest 결과
└── drafts/                   초안
```

`setup` 은 **설정이 아직 없는 폴더에서** 무엇을 하기 전에 어디에 만들지 먼저 알리고,
홈 디렉터리·플러그인 폴더 안·이미 다른 프로젝트(`package.json` 등)면 경고한다. 이미 준비된 곳에서는 조용하다.

다른 폴더를 쓰려면 `--root <경로>` 를 **모든 스크립트에 매번** 붙인다. 번거로우면 그 폴더에서 `claude` 를 다시 연다.
디렉터리 이름은 `notion-wiki.config.json` 의 `paths` 로 바꾼다.

> **Notion 쪽에서 사람이 해야 하는 것 하나**: 서비스 상위 페이지와 위키 루트 페이지에서 `•••` → `연결` → 만든 연결을 추가한다
> (하위 페이지는 상속된다). 내부 연결은 기본적으로 아무 페이지도 볼 수 없어서 이게 빠지면 페이지가 0개로 나온다.
> 연결 권한에 **사용자 정보**를 포함해야 담당자(people) 속성을 쓸 수 있다.
> DB 스키마: [DESIGN 1절](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/docs/DESIGN.md#1-notion-데이터베이스-스키마).

<details>
<summary>손으로 준비하고 싶을 때</summary>

플러그인은 **현재 작업 디렉터리**를 위키 작업 공간으로 본다. 그 디렉터리에 두 파일을 두면 `setup` 없이도 된다.

1. `notion-wiki.config.json` — 서비스·카테고리·속성 매핑·위키 루트 페이지 id.
   플러그인의 [`templates/notion-wiki.config.json`](./templates/notion-wiki.config.json) 또는
   상위 저장소의 [`notion-wiki.config.json`](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/notion-wiki.config.json) 을 복사해 id 만 바꾼다.
2. `.env` — `NOTION_TOKEN=…` (내부 연결 토큰). **커밋하지 않는다.** `sync`·`edit`·`submit`·`publish --apply` 가 토큰을 쓴다.

`raw/`, `wiki/`, `drafts/` 디렉터리는 스킬이 만든다.

</details>

## 사용

말로 시켜도 되고(`"노션 위키 동기화해"`, `"이 내용으로 FAQ 만들어줘"`), 스킬을 직접 불러도 된다.

```
/notion-llm-wiki setup                처음 준비 — 작업 위치·동기화 대상·토큰을 묻고 연결을 확인한다
/notion-llm-wiki sync [--full]        Notion → raw/ 증분 동기화
/notion-llm-wiki ingest [--full]      변경분을 읽어 wiki/ 갱신 → 색인 → lint → log
/notion-llm-wiki query <질문>          색인 → 위키 → 원문 순으로 찾아 출처·상태·동기화 시각과 함께 답한다
/notion-llm-wiki lint [semantic]      구조 lint + 의미 lint
/notion-llm-wiki publish [--apply]    wiki/ → Notion 게시 (dry-run 기본)

/notion-draft new <내용>               규약을 지킨 새 페이지 초안을 drafts/ 에 만든다
/notion-draft edit <대상>              기존 페이지의 현재 속성·본문을 초안으로 받아 온다
/notion-draft submit <초안> [--apply]  검증 → dry-run(속성·diff) → 게시 → raw/ 즉시 기록
```

권장 순서: 읽기는 `sync → ingest → lint → publish`, 쓰기는 `new|edit → submit`.
쓰기 뒤에는 `ingest` 로 위키에 반영한다. 규칙의 정본은 각 스킬의 `references/`.

**안전장치**: Notion 에 쓰는 경로는 `publish --apply` 와 `submit --apply` 둘뿐이다. 신규 페이지는 `상태: 초안` 으로만 만들어지고,
기존 페이지 수정은 초안 이후 원본이 바뀌면 중단하며, 민감·폐기·하위 페이지를 가진 페이지는 거부한다.

## 스크립트만 쓸 때

스킬 없이 Node 로 직접 실행할 수 있다. 위키 프로젝트 디렉터리에서:

```bash
S=<플러그인 경로>/skills
node $S/notion-llm-wiki/scripts/setup.js --status
node $S/notion-llm-wiki/scripts/check-notion.js
node $S/notion-llm-wiki/scripts/sync.js [--full]
node $S/notion-llm-wiki/scripts/build-index.js
node $S/notion-llm-wiki/scripts/lint.js [--json] [--strict]
node $S/notion-llm-wiki/scripts/publish.js [--apply]
node $S/notion-llm-wiki/scripts/register-legacy.js --service <slug> --category <slug> [--apply]
node $S/notion-draft/scripts/draft-new.js --service <slug> --category <slug> --type <문서유형> --title <제목> --owner <이름> --summary <한 문장>
node $S/notion-draft/scripts/draft-pull.js <raw 경로 | Notion URL | page id>
node $S/notion-draft/scripts/draft-submit.js <초안 경로> [--apply]
```

설치된 플러그인 경로는 `~/.claude/plugins/cache/heybit-notion-llm-wiki/notion-llm-wiki/<버전>/`.
모든 스크립트는 `--root <디렉터리>` 로 작업 공간을 바꿀 수 있다.

## 라이선스

MIT — 상위 저장소의 [LICENSE](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/LICENSE).
