# notion-llm-wiki (Claude Code 플러그인)

Notion 실무 문서 → 로컬 `raw/` 미러 → Claude Code 가 합성하는 `wiki/` → 다시 Notion 게시.
RAG·임베딩 없이 **색인 → 위키 → 원문 grep** 순서로 찾는다. Node.js 22+, 외부 의존성 0개.

설계 문서·샘플 데이터·테스트는 상위 저장소 [littleanti/heybit-notion-llm-wiki](https://github.com/littleanti/heybit-notion-llm-wiki) 에 있다.
이 디렉터리는 그중 **설치되는 부분**만 담는다.

## 설치

```bash
claude plugin marketplace add littleanti/heybit-notion-llm-wiki
claude plugin install notion-llm-wiki@heybit-notion-llm-wiki
```

Claude Code 안에서는 `/plugin marketplace add littleanti/heybit-notion-llm-wiki` → `/plugin install notion-llm-wiki@heybit-notion-llm-wiki`.
설치 없이 한 세션만 써 보려면 저장소를 clone 한 뒤 `claude --plugin-dir plugins/notion-llm-wiki`.

## 위키를 둘 프로젝트에서 준비할 것

플러그인은 **현재 작업 디렉터리**를 위키 작업 공간으로 본다. 그 디렉터리에:

1. `notion-wiki.config.json` — 서비스·카테고리·속성 매핑·위키 루트 페이지 id.
   상위 저장소의 [`notion-wiki.config.json`](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/notion-wiki.config.json) 을 복사해 id 만 바꾸면 된다.
   키 설명은 [README 5.3](https://github.com/littleanti/heybit-notion-llm-wiki#53-notion-wikiconfigjson-요약).
2. `.env` — `NOTION_TOKEN=…` (내부 연결 토큰). **커밋하지 않는다.** `sync` 와 `publish --apply` 만 토큰이 필요하다.
3. Notion 쪽 — 서비스 상위 페이지들과 위키 루트 페이지에 연결을 추가하고, 카테고리마다 데이터베이스를 만든다.
   절차: [README 5.2](https://github.com/littleanti/heybit-notion-llm-wiki#52-notion-쪽-준비-실제-워크스페이스에-붙일-때),
   DB 스키마: [DESIGN 1절](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/docs/DESIGN.md#1-notion-데이터베이스-스키마).

`raw/`, `wiki/` 디렉터리는 스킬이 만든다.

## 사용

`/notion-llm-wiki <서브커맨드>` (또는 `/notion-llm-wiki:notion-llm-wiki …`). "노션 위키 동기화해", "위키에서 환불 정책 찾아줘" 처럼 말해도 스킬이 선택된다.

| 서브커맨드 | 하는 일 | 주체 |
|---|---|---|
| `sync [--full]` | Notion → `raw/` 증분 동기화 | 스크립트 |
| `ingest [--full]` | `raw/.sync-report.md` 의 변경분을 읽어 `wiki/` 갱신 → 색인 → lint → log | Claude |
| `query <질문>` | 색인 → 위키 → 원문 grep 순으로 찾아 **출처·상태·동기화 시각**을 붙여 답한다 | Claude |
| `lint [semantic]` | 구조 lint(스크립트) + 의미 lint(Claude) | 둘 다 |
| `publish [--apply]` | `wiki/` → Notion 위키 루트 아래 게시. dry-run 기본 | 스크립트 |

권장 순서 `sync → ingest → lint → publish`. 규칙의 정본은 `skills/notion-llm-wiki/references/wiki-schema.md`.

## 스크립트만 쓸 때

스킬 없이도 Node 로 직접 실행할 수 있다. 위키 프로젝트 디렉터리에서:

```bash
node <플러그인 경로>/skills/notion-llm-wiki/scripts/sync.js [--full]
node <플러그인 경로>/skills/notion-llm-wiki/scripts/build-index.js
node <플러그인 경로>/skills/notion-llm-wiki/scripts/lint.js [--json] [--strict]
node <플러그인 경로>/skills/notion-llm-wiki/scripts/publish.js [--apply]
node <플러그인 경로>/skills/notion-llm-wiki/scripts/register-legacy.js --service <slug> --category <slug> [--apply]
```

설치된 플러그인 경로는 `~/.claude/plugins/cache/heybit-notion-llm-wiki/notion-llm-wiki/<버전>/`. 모든 스크립트는 `--root <디렉터리>` 로 작업 공간을 바꿀 수 있다.

## 라이선스

MIT — 상위 저장소의 [LICENSE](https://github.com/littleanti/heybit-notion-llm-wiki/blob/main/LICENSE).
