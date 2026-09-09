'use strict';
// Notion REST 클라이언트 (docs/TRD.md 6.6). fetch/sleep/now 를 주입할 수 있어 테스트는 네트워크·시간을 쓰지 않는다.

const BASE = 'https://api.notion.com';
const RETRY_STATUSES = new Set([429, 529, 502, 503, 504]);

class NotionError extends Error {
  constructor(status, code, message, path) {
    super(`Notion API ${status}${code ? ` ${code}` : ''} (${path}): ${message}`);
    this.name = 'NotionError';
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

function createClient(opts) {
  const {
    token,
    version = '2026-03-11',
    rps = 3,
    fetchImpl = globalThis.fetch,
    sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    maxRetries = 6,
    log = () => {},
  } = opts;
  if (!token) throw new Error('notion-client: token 이 필요하다');
  if (typeof fetchImpl !== 'function') throw new Error('notion-client: fetch 구현이 없다');

  const interval = Math.ceil(1000 / rps);
  let nextAllowedAt = 0;
  const stats = { requests: 0, retries: 0, byPath: {} };

  async function throttle() {
    const t = now();
    if (t < nextAllowedAt) await sleepImpl(nextAllowedAt - t);
    nextAllowedAt = Math.max(now(), nextAllowedAt) + interval;
  }

  function statKey(method, path) {
    return `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '{id}')}`;
  }

  async function request(method, path, { body, query } = {}) {
    let url = BASE + path;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null)).toString();
      if (qs) url += `?${qs}`;
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': version,
      'Content-Type': 'application/json',
    };
    let attempt = 0;
    for (;;) {
      await throttle();
      stats.requests++;
      const key = statKey(method, path);
      stats.byPath[key] = (stats.byPath[key] || 0) + 1;
      let res;
      try {
        res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (err) {
        if (attempt >= maxRetries) throw new NotionError(0, 'network', err.message, path);
        attempt++;
        stats.retries++;
        await sleepImpl(backoff(attempt));
        continue;
      }
      if (res.ok) {
        const text = await res.text();
        return text ? JSON.parse(text) : {};
      }
      let payload = {};
      try { payload = JSON.parse(await res.text()); } catch { /* 본문 없음 */ }
      if (RETRY_STATUSES.has(res.status) && attempt < maxRetries) {
        attempt++;
        stats.retries++;
        const retryAfter = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null);
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
        log(`재시도 ${attempt}/${maxRetries}: ${res.status} ${path} — ${Math.round(wait)}ms 대기`);
        await sleepImpl(wait);
        continue;
      }
      // 헤더(토큰)는 어떤 경로로도 메시지에 넣지 않는다
      throw new NotionError(res.status, payload.code, payload.message || res.statusText || '', path);
    }
  }

  function backoff(attempt) {
    const base = Math.min(30000, 500 * 2 ** attempt);
    return base + Math.floor(Math.random() * 250);
  }

  async function paginate(method, path, body = {}, { query } = {}) {
    const results = [];
    let cursor;
    let pages = 0;
    for (;;) {
      const res = method === 'GET'
        ? await request('GET', path, { query: { ...(query || {}), start_cursor: cursor, page_size: 100 } })
        : await request(method, path, { body: { ...body, start_cursor: cursor, page_size: 100 } });
      results.push(...(res.results || []));
      pages++;
      if (!res.has_more || !res.next_cursor) return { results, pages, requestStatus: res.request_status };
      cursor = res.next_cursor;
    }
  }

  return { request, paginate, stats: () => ({ ...stats, byPath: { ...stats.byPath } }), version };
}

module.exports = { createClient, NotionError };
