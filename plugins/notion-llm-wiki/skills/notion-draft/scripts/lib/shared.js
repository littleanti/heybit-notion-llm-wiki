'use strict';
// 형제 스킬(notion-llm-wiki)의 공용 라이브러리를 재수출한다 — 두 스킬 사이의 **유일한 결합점**이다
// (docs/TRD.md ADR-010). 플러그인은 디렉터리 전체가 설치 캐시로 복사되므로 이 상대 경로는 설치본에서도 성립한다.
// 레이아웃이 바뀌면 고칠 곳은 이 파일뿐이다.

const config = require('../../../notion-llm-wiki/scripts/lib/config');
const notionClient = require('../../../notion-llm-wiki/scripts/lib/notion-client');
const frontmatter = require('../../../notion-llm-wiki/scripts/lib/frontmatter');
const meta = require('../../../notion-llm-wiki/scripts/lib/meta');
const slug = require('../../../notion-llm-wiki/scripts/lib/slug');
const mdNotion = require('../../../notion-llm-wiki/scripts/lib/md-notion');
const pages = require('../../../notion-llm-wiki/scripts/lib/pages');
const sync = require('../../../notion-llm-wiki/scripts/sync');
const registerLegacy = require('../../../notion-llm-wiki/scripts/register-legacy');

module.exports = { config, notionClient, frontmatter, meta, slug, mdNotion, pages, sync, registerLegacy };
