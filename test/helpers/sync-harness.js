'use strict';
// 테스트·골든 생성 공용: mock Notion 에 대해 sync 를 돌리는 하네스
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWorkspace, createMockNotion } = require('./mock-notion');
const { loadConfig } = require('../../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/config');
const { createClient } = require('../../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/lib/notion-client');
const { runSync } = require('../../plugins/notion-llm-wiki/skills/notion-llm-wiki/scripts/sync');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXED_NOW = '2026-09-09T01:00:00.000Z';

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwiki-'));
  fs.copyFileSync(path.join(REPO_ROOT, 'notion-wiki.config.json'), path.join(dir, 'notion-wiki.config.json'));
  return dir;
}

function makeClient(mock, extra = {}) {
  return createClient({ token: 'ntn_mock', version: '2026-03-11', rps: 1000, fetchImpl: mock.fetch, sleepImpl: async () => {}, now: () => 0, ...extra });
}

async function syncOnce({ rootDir, workspace, mock, nowIso = FIXED_NOW, full = false, mutateConfig } = {}) {
  const ws = workspace || loadWorkspace();
  const m = mock || createMockNotion(ws);
  const root = rootDir || tempRoot();
  if (mutateConfig) {
    const p = path.join(root, 'notion-wiki.config.json');
    const cfgJson = JSON.parse(fs.readFileSync(p, 'utf8'));
    mutateConfig(cfgJson);
    fs.writeFileSync(p, JSON.stringify(cfgJson, null, 2));
  }
  const cfg = loadConfig(root);
  const client = makeClient(m);
  const result = await runSync({ cfg, client, rootDir: root, nowIso: () => nowIso, clock: () => 0, full });
  return { ...result, rootDir: root, workspace: ws, mock: m, client, cfg };
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

module.exports = { REPO_ROOT, FIXED_NOW, tempRoot, makeClient, syncOnce, listFiles };
