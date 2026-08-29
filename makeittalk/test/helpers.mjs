// Test scaffolding: a D1-compatible adapter over node:sqlite, an env factory,
// and a fetch dispatcher for mocking the outside world.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(here, '..', 'migrations', '0001_init.sql'), 'utf8'));
  return {
    prepare(sql) {
      return {
        _args: [],
        bind(...args) { this._args = args.map((a) => (a === undefined ? null : a)); return this; },
        async first() { return db.prepare(sql).get(...this._args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...this._args) }; },
        async run() { return db.prepare(sql).run(...this._args); },
      };
    },
    _raw: db,
  };
}

export function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    ENCRYPTION_KEY: 'a'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test',
    APP_ORIGIN: 'https://mit.test',
    ADMIN_EMAILS: 'ryan@getdylr.com',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: 'whsec_testsecret',
    STRIPE_PRICE_PRO: 'price_pro_test',
    STRIPE_PRICE_SCALE: 'price_scale_test',
    ...overrides,
  };
}

export function makeCtx() {
  const tasks = [];
  return {
    waitUntil(p) { tasks.push(Promise.resolve(p).catch((e) => { throw e; })); },
    async flush() { await Promise.all(tasks.splice(0)); },
  };
}

// Routes outbound fetch() by hostname. Register handlers, run, restore.
export function mockFetch(handlers) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    calls.push({ url, init });
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (u.hostname === prefix || url.startsWith(prefix)) {
        return handler({ url, u, init, body: init.body });
      }
    }
    return new Response(JSON.stringify({ error: `unmocked fetch: ${url}` }), { status: 599 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

export const jsonRes = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export function claudeToolResponse(name, input) {
  return jsonRes({
    id: 'msg_test',
    model: 'claude-opus-5',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'tu_1', name, input }],
    usage: { input_tokens: 1200, output_tokens: 400 },
  });
}

// Drives the worker's fetch handler with cookie continuity.
export function makeClient(worker, env) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(method, pathname, { body, headers = {}, rawBody } = {}) {
      const h = new Headers(headers);
      if (cookie && !h.has('Cookie')) h.set('Cookie', cookie);
      if (body !== undefined && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
      const ctx = makeCtx();
      const res = await worker.fetch(new Request(`https://mit.test${pathname}`, {
        method,
        headers: h,
        body: rawBody !== undefined ? rawBody : (body !== undefined ? JSON.stringify(body) : undefined),
      }), env, ctx);
      const setCookie = res.headers.get('Set-Cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      let data = null;
      const text = await res.text();
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, text, res, ctx };
    },
  };
}
