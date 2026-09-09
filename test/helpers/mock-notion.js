'use strict';
// fixture 워크스페이스를 Notion REST API 형태로 서빙하는 주입식 fetch (docs/TRD.md 6.7).
// 공식 문서의 JSON 형태(2026-03-11)를 따른다. 실 Notion 에 대해 실측한 것은 아니다.

const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures');

function hex(id) { return id.replace(/-/g, ''); }
function pageUrl(id) { return `https://www.notion.so/heybit/${hex(id)}`; }
function rt(text) { return text ? [{ type: 'text', text: { content: text, link: null }, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, plain_text: text, href: null }] : []; }
function fill(pattern, vars) { return pattern.replace(/\{(\w+)\}/g, (_, k) => vars[k]); }

const USERS = {};
function user(name) {
  if (!USERS[name]) {
    const n = Object.keys(USERS).length + 1;
    USERS[name] = { object: 'user', id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`, type: 'person', name, avatar_url: null, person: { email: `user${n}@example.com` } };
  }
  return USERS[name];
}

function expandProps(compact, schema, title) {
  const out = {};
  for (const [name, type] of Object.entries(schema)) {
    const v = compact ? compact[name] : undefined;
    const id = `prop_${hex(name.length.toString(16)).padStart(4, '0')}${Object.keys(out).length}`;
    switch (type) {
      case 'title': out[name] = { id: 'title', type: 'title', title: rt(title) }; break;
      case 'select': out[name] = { id, type: 'select', select: v ? { id: `opt_${v}`, name: v, color: 'default' } : null }; break;
      case 'status': out[name] = { id, type: 'status', status: v ? { id: `st_${v}`, name: v, color: 'default' } : null }; break;
      case 'people': out[name] = { id, type: 'people', people: (v || []).map(user) }; break;
      case 'rich_text': out[name] = { id, type: 'rich_text', rich_text: rt(v || '') }; break;
      case 'multi_select': out[name] = { id, type: 'multi_select', multi_select: (v || []).map((x) => ({ id: `opt_${x}`, name: x, color: 'default' })) }; break;
      case 'date': out[name] = { id, type: 'date', date: v ? { start: v, end: null, time_zone: null } : null }; break;
      case 'checkbox': out[name] = { id, type: 'checkbox', checkbox: Boolean(v) }; break;
      case 'url': out[name] = { id, type: 'url', url: v || null }; break;
      case 'relation': out[name] = { id, type: 'relation', relation: (v || []).map((rid) => ({ id: rid })), has_more: false }; break;
      default: throw new Error(`mock: 알 수 없는 속성 타입 ${type}`);
    }
  }
  return out;
}

// fixture 디렉터리를 읽어 메모리 워크스페이스를 만든다 (깊은 복사이므로 테스트마다 독립).
function loadWorkspace(dir = FIXTURE_DIR) {
  const ws = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8'));
  const pages = new Map();
  const databases = new Map();
  const dataSources = new Map();

  const structural = (p) => ({
    object: 'page', id: p.id, parent: p.parent, created_time: p.created_time, last_edited_time: p.last_edited_time,
    in_trash: Boolean(p.in_trash), is_archived: Boolean(p.in_trash), is_locked: false, url: pageUrl(p.id), public_url: null,
    icon: null, cover: null, properties: { title: { id: 'title', type: 'title', title: rt(p.title) } },
    _markdown: p.markdown || '', _truncated: false, _unknown: [],
  });
  for (const p of ws.structuralPages) pages.set(p.id, structural(p));

  for (const svc of ws.services) {
    for (const cat of ws.categories) {
      const vars = { S: svc.code, CC: cat.code };
      const catPageId = fill(ws.idScheme.categoryPage, vars);
      const dbId = fill(ws.idScheme.database, vars);
      const dsId = fill(ws.idScheme.dataSource, vars);
      pages.set(catPageId, structural({ id: catPageId, parent: { type: 'page_id', page_id: svc.rootPageId }, title: cat.name, created_time: '2026-01-15T00:00:00.000Z', last_edited_time: '2026-03-01T00:00:00.000Z', markdown: `## ${cat.name}\n카테고리 페이지.` }));
      databases.set(dbId, { object: 'database', id: dbId, parent: { type: 'page_id', page_id: catPageId }, title: rt(`${svc.name} · ${cat.name}`), is_inline: true, in_trash: false, url: pageUrl(dbId), data_sources: [{ id: dsId, name: `${svc.name} · ${cat.name}` }] });
      dataSources.set(dsId, { object: 'data_source', id: dsId, parent: { type: 'database_id', database_id: dbId }, database_parent: { type: 'page_id', page_id: catPageId }, title: rt(`${svc.name} · ${cat.name}`), in_trash: false, url: pageUrl(dsId), created_time: '2026-01-15T00:00:00.000Z', last_edited_time: '2026-03-01T00:00:00.000Z', properties: Object.fromEntries(Object.entries(ws.propertySchema).map(([n, t]) => [n, { id: n, name: n, type: t, [t]: {} }])) });
    }
    const list = JSON.parse(fs.readFileSync(path.join(dir, svc.pagesFile), 'utf8'));
    for (const p of list) {
      const cat = ws.categories.find((c) => c.slug === p.category);
      let parent;
      if (p.kind === 'db_row') {
        if (!cat) throw new Error(`mock: db_row 에 카테고리가 없다: ${p.title}`);
        const vars = { S: svc.code, CC: cat.code };
        parent = { type: 'data_source_id', data_source_id: fill(ws.idScheme.dataSource, vars), database_id: fill(ws.idScheme.database, vars) };
      } else if (p.kind === 'legacy') {
        if (!cat) throw new Error(`mock: legacy 에 카테고리가 없다: ${p.title}`);
        parent = { type: 'page_id', page_id: fill(ws.idScheme.categoryPage, { S: svc.code, CC: cat.code }) };
      } else if (p.kind === 'plain') {
        parent = { type: 'page_id', page_id: svc.rootPageId };
      } else throw new Error(`mock: 알 수 없는 kind ${p.kind} (${p.title})`);
      const properties = p.kind === 'db_row'
        ? expandProps(p.props, ws.propertySchema, p.title)
        : { title: { id: 'title', type: 'title', title: rt(p.title) } };
      pages.set(p.id, {
        object: 'page', id: p.id, parent, created_time: p.created_time, last_edited_time: p.last_edited_time,
        in_trash: Boolean(p.in_trash), is_archived: Boolean(p.in_trash), is_locked: false, url: pageUrl(p.id), public_url: null,
        icon: null, cover: null, properties,
        _markdown: p.markdown || '', _truncated: Boolean(p.truncated), _unknown: p.unknown_block_ids || [],
      });
    }
  }
  return { meta: ws, pages, databases, dataSources };
}

function publicPage(p) {
  const { _markdown, _truncated, _unknown, ...rest } = p;
  return rest;
}

function paginate(items, body) {
  const size = Math.min(Number(body.page_size) || 100, 100);
  const start = body.start_cursor ? Number(body.start_cursor) : 0;
  const slice = items.slice(start, start + size);
  const hasMore = start + size < items.length;
  return { results: slice, has_more: hasMore, next_cursor: hasMore ? String(start + size) : null };
}

function errorBody(status, code, message) {
  return { object: 'error', status, code, message, request_id: 'mock' };
}

// createMockNotion(workspace, { failAt: { [requestIndex]: { status, retryAfter } } })
function createMockNotion(workspace, opts = {}) {
  const ws = workspace;
  const calls = [];
  const writes = [];
  let createdCount = 0;
  const failAt = opts.failAt || {};

  function response(status, body, headers = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => JSON.stringify(body),
    };
  }

  function hasChildPages(pageId) {
    for (const p of ws.pages.values()) if (!p.in_trash && p.parent && p.parent.page_id === pageId) return true;
    return false;
  }

  async function fetchImpl(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : {};
    const idx = calls.length;
    calls.push({ method, path: u.pathname, body });
    const fail = failAt[idx];
    if (fail) return response(fail.status, errorBody(fail.status, fail.code || 'rate_limited', 'mock failure'), fail.retryAfter ? { 'retry-after': String(fail.retryAfter) } : {});
    if (!init.headers || !init.headers.Authorization) return response(401, errorBody(401, 'unauthorized', 'missing token'));

    const parts = u.pathname.split('/').filter(Boolean); // ['v1', ...]
    const [, resource, id, sub] = parts;

    if (method === 'POST' && resource === 'search') {
      const filter = body.filter || {};
      const wantTrash = Boolean(filter.in_trash);
      let items;
      if (filter.property === 'object' && filter.value === 'data_source') {
        items = [...ws.dataSources.values()].map(({ database_parent, ...ds }) => ds);
      } else if (filter.property === 'object' && filter.value === 'page') {
        items = [...ws.pages.values()].filter((p) => Boolean(p.in_trash) === wantTrash).map(publicPage);
      } else {
        items = [...[...ws.pages.values()].filter((p) => Boolean(p.in_trash) === wantTrash).map(publicPage), ...[...ws.dataSources.values()].map(({ database_parent, ...ds }) => ds)];
      }
      if (body.query) items = items.filter((it) => JSON.stringify(it.title || it.properties).includes(body.query));
      items.sort((a, b) => (a.last_edited_time < b.last_edited_time ? 1 : -1));
      return response(200, { object: 'list', type: 'page_or_data_source', page_or_data_source: {}, ...paginate(items, body) });
    }

    if (method === 'POST' && resource === 'data_sources' && sub === 'query') {
      const ds = ws.dataSources.get(id);
      if (!ds) return response(404, errorBody(404, 'object_not_found', `data source ${id}`));
      const rows = [...ws.pages.values()].filter((p) => p.parent.type === 'data_source_id' && p.parent.data_source_id === id && (body.is_archived ? true : !p.in_trash)).map(publicPage);
      rows.sort((a, b) => (a.created_time < b.created_time ? -1 : 1));
      return response(200, { object: 'list', type: 'page_or_data_source', page_or_data_source: {}, request_status: { type: 'complete' }, ...paginate(rows, body) });
    }

    if (method === 'GET' && resource === 'data_sources' && id && !sub) {
      const ds = ws.dataSources.get(id);
      if (!ds) return response(404, errorBody(404, 'object_not_found', `data source ${id}`));
      const { database_parent, ...pub } = ds;
      return response(200, pub);
    }

    if (method === 'GET' && resource === 'databases' && id && !sub) {
      const db = ws.databases.get(id);
      if (!db) return response(404, errorBody(404, 'object_not_found', `database ${id}`));
      return response(200, db);
    }

    if (resource === 'pages' && id && sub === 'markdown') {
      const p = ws.pages.get(id);
      if (!p) return response(404, errorBody(404, 'object_not_found', `page ${id}`));
      if (method === 'GET') return response(200, { object: 'page_markdown', id, markdown: p._markdown, truncated: p._truncated, unknown_block_ids: p._unknown });
      if (method === 'PATCH') {
        if (body.type !== 'replace_content') return response(400, errorBody(400, 'validation_error', `mock: 지원하지 않는 type ${body.type}`));
        const allow = Boolean(body.replace_content && body.replace_content.allow_deleting_content);
        if (hasChildPages(id) && !allow) return response(400, errorBody(400, 'validation_error', 'Operation would delete child pages or databases. Set allow_deleting_content to true.'));
        p._markdown = body.replace_content.new_str;
        p.last_edited_time = '2026-09-09T12:00:00.000Z';
        writes.push({ op: 'replace_content', id, length: p._markdown.length });
        return response(200, { object: 'page_markdown', id, markdown: p._markdown, truncated: false, unknown_block_ids: [] });
      }
    }

    if (method === 'GET' && resource === 'pages' && id && !sub) {
      const p = ws.pages.get(id);
      if (!p) return response(404, errorBody(404, 'object_not_found', `Could not find page with ID: ${id}`));
      return response(200, publicPage(p));
    }

    if (method === 'PATCH' && resource === 'pages' && id && !sub) {
      const p = ws.pages.get(id);
      if (!p) return response(404, errorBody(404, 'object_not_found', `page ${id}`));
      if (typeof body.in_trash === 'boolean') { p.in_trash = body.in_trash; p.is_archived = body.in_trash; }
      if (body.properties && body.properties.title) p.properties.title = { id: 'title', type: 'title', title: rt(body.properties.title.title ? body.properties.title.title[0].text.content : String(body.properties.title)) };
      writes.push({ op: 'update_page', id, body });
      return response(200, publicPage(p));
    }

    if (method === 'POST' && resource === 'pages' && !id && body.parent && body.parent.data_source_id) {
      // data source 행 생성 (register-legacy). 쓰기 형태 속성 → 읽기 형태로 변환
      const dsId = body.parent.data_source_id;
      const ds = ws.dataSources.get(dsId);
      if (!ds) return response(404, errorBody(404, 'object_not_found', `data source ${dsId}`));
      createdCount++;
      const newId = fill(ws.meta.idScheme.createdByPublish, { NN: String(createdCount).padStart(2, '0') });
      const compact = {};
      let title = '';
      for (const [name, val] of Object.entries(body.properties || {})) {
        const schemaType = ws.meta.propertySchema[name];
        if (!schemaType) return response(400, errorBody(400, 'validation_error', `${name} is not a property that exists`));
        if (schemaType === 'title') title = (val.title || []).map((t) => t.text.content).join('');
        else if (schemaType === 'select') compact[name] = val.select ? val.select.name : null;
        else if (schemaType === 'url') compact[name] = val.url;
        else if (schemaType === 'rich_text') compact[name] = (val.rich_text || []).map((t) => t.text.content).join('');
        else if (schemaType === 'multi_select') compact[name] = (val.multi_select || []).map((o) => o.name);
        else if (schemaType === 'checkbox') compact[name] = Boolean(val.checkbox);
        else if (schemaType === 'date') compact[name] = val.date ? val.date.start : null;
        else if (schemaType === 'relation') compact[name] = (val.relation || []).map((r) => r.id);
        else if (schemaType === 'people') compact[name] = (val.people || []).map((u) => u.name || u.id);
      }
      const page = {
        object: 'page', id: newId, parent: { type: 'data_source_id', data_source_id: dsId, database_id: ds.parent.database_id },
        created_time: '2026-09-09T12:00:00.000Z', last_edited_time: '2026-09-09T12:00:00.000Z', in_trash: false, is_archived: false, is_locked: false,
        url: pageUrl(newId), public_url: null, icon: null, cover: null, properties: expandProps(compact, ws.meta.propertySchema, title),
        _markdown: body.markdown || '', _truncated: false, _unknown: [],
      };
      ws.pages.set(newId, page);
      writes.push({ op: 'create_row', id: newId, dataSource: dsId, title, props: compact });
      return response(200, publicPage(page));
    }

    if (method === 'POST' && resource === 'pages' && !id) {
      const parent = body.parent || {};
      if (!parent.page_id || !ws.pages.has(parent.page_id)) return response(404, errorBody(404, 'object_not_found', `parent ${parent.page_id}`));
      if (body.children && body.markdown) return response(400, errorBody(400, 'validation_error', 'children and markdown are mutually exclusive'));
      createdCount++;
      const newId = fill(ws.meta.idScheme.createdByPublish, { NN: String(createdCount).padStart(2, '0') });
      let title = '';
      const t = body.properties && body.properties.title;
      if (Array.isArray(t)) title = t.map((x) => x.text.content).join('');
      else if (t && Array.isArray(t.title)) title = t.title.map((x) => x.text.content).join('');
      else if (body.markdown) { const m = /^#\s+(.+)$/m.exec(body.markdown); if (m) title = m[1]; }
      const page = {
        object: 'page', id: newId, parent: { type: 'page_id', page_id: parent.page_id }, created_time: '2026-09-09T12:00:00.000Z', last_edited_time: '2026-09-09T12:00:00.000Z',
        in_trash: false, is_archived: false, is_locked: false, url: pageUrl(newId), public_url: null, icon: body.icon || null, cover: null,
        properties: { title: { id: 'title', type: 'title', title: rt(title) } },
        _markdown: body.markdown || '', _truncated: false, _unknown: [],
      };
      ws.pages.set(newId, page);
      writes.push({ op: 'create_page', id: newId, parent: parent.page_id, title, length: page._markdown.length });
      return response(200, publicPage(page));
    }

    return response(404, errorBody(404, 'object_not_found', `mock: 알 수 없는 경로 ${method} ${u.pathname}`));
  }

  return { fetch: fetchImpl, calls, writes, workspace: ws, pageUrl };
}

module.exports = { loadWorkspace, createMockNotion, pageUrl, hex, FIXTURE_DIR };
