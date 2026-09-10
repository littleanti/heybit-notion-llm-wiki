# notion-llm-wiki (Claude Code 플러그인)

Notion 실무 문서를 Claude Code 가 **읽어 위키로 만들고**, **써서 다시 Notion 에 올린다.**
RAG·임베딩 없이 색인 → 위키 → 원문 grep 순서로 찾는다. Node.js 22+, 외부 의존성 0개.

| 스킬 | 방향 | 서브커맨드 |
|---|---|---|
| `notion-llm-wiki` | Notion → 위키 | `sync` · `ingest` · `query` · `lint` · `publish` |
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

## 위키를 둘 프로젝트에서 준비할 것

플러그인은 **현재 작업 디렉터리**를 위키 작업 공간으로 본다. 그 디렉터리에:

1. `notion-wiki.config.json` — 서비스·카테고리·속성 매핑·위키 루트 페이지 id.
   상위 저장소의 [`notion-wiki.config.json`](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/notion-wiki.config.json) 을 복사해 id 만 바꾸면 된다.
2. `.env` — `NOTION_TOKEN=…` (내부 연결 토큰). **커밋하지 않는다.** `sync`·`edit`·`submit`·`publish --apply` 가 토큰을 쓴다.
3. Notion 쪽 — 서비스 상위 페이지들과 위키 루트 페이지에 연결을 추가하고, 카테고리마다 데이터베이스를 만든다.
   연결 권한에 **사용자 정보**를 포함해야 담당자(people) 속성을 쓸 수 있다.
   절차: [README 5.2](https://github.com/littleanti/heybit-notion-llm-wiki#52-notion-쪽-준비-실제-워크스페이스에-붙일-때),
   DB 스키마: [DESIGN 1절](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/docs/DESIGN.md#1-notion-데이터베이스-스키마).

`raw/`, `wiki/`, `drafts/` 디렉터리는 스킬이 만든다.

## 사용

말로 시켜도 되고(`"노션 위키 동기화해"`, `"이 내용으로 FAQ 만들어줘"`), 스킬을 직접 불러도 된다.

```
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
