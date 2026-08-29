// End-to-end: signup -> project -> generation (Claude mocked) -> credentials
// -> MCP protocol -> OAuth flow -> quotas/CSRF -> Stripe webhook -> admin.

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv, makeClient, makeCtx, mockFetch, claudeToolResponse, jsonRes } from './helpers.mjs';
import { hmacSha256Hex } from '../src/crypto.js';

const PASTED_DOCS = `
## Example API
Authenticate with a bearer token in the Authorization header.
Base URL: https://api.example.com

GET /v1/things - list things. Query params: limit (number).
GET /v1/things/{id} - fetch one thing by id.
POST /v1/things - create a thing. Body: name (string, required).
DELETE /v1/things/{id} - remove a thing.
`.repeat(2);

const API_MAP = {
  title: 'Example API',
  description: 'Things as a service',
  base_url: 'https://api.example.com',
  auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
  endpoints: [
    { method: 'GET', path: '/v1/things', summary: 'List things', params: [{ name: 'limit', in: 'query' }], source_url: 'pasted-docs' },
    { method: 'GET', path: '/v1/things/{id}', summary: 'Get a thing', params: [{ name: 'id', in: 'path', required: true }], source_url: 'pasted-docs' },
    { method: 'POST', path: '/v1/things', summary: 'Create a thing', params: [{ name: 'name', in: 'body', required: true }], source_url: 'pasted-docs' },
  ],
};

const DESIGN = {
  server: { name: 'example-mcp', description: 'Things as a service, over MCP.', base_url: 'https://api.example.com' },
  auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
  cred_fields: [{ key: 'token', label: 'Example API token' }],
  tools: [
    {
      name: 'list_things',
      description: 'List things. Use limit to cap the page size.',
      input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'max items' } } },
      request: { method: 'GET', path: '/v1/things', query: { limit: '$limit' } },
      provenance: { url: 'https://docs.example.com/list', note: 'documented under Things' },
    },
    {
      name: 'create_thing',
      description: 'Create a thing with a name.',
      input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      request: { method: 'POST', path: '/v1/things', body: { name: '$name' } },
      provenance: { url: 'https://docs.example.com/create', note: 'create section' },
    },
    {
      name: 'delete_thing',
      description: 'Remove a thing.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      request: { method: 'DELETE', path: '/v1/things/{id}' },
      provenance: { url: 'https://docs.example.com/delete', note: 'delete section' },
    },
  ],
};

test('full platform flow', async (t) => {
  const env = makeEnv();
  const client = makeClient(worker, env);
  const targetCalls = [];

  const fm = mockFetch({
    'api.anthropic.com': async ({ body }) => {
      const req = JSON.parse(body);
      const toolName = req.tools?.[0]?.name;
      assert.equal(req.model, 'claude-opus-5');
      assert.ok(!JSON.stringify(req).includes('sekret-token'), 'credentials must never reach Claude');
      if (toolName === 'report_api_map') return claudeToolResponse('report_api_map', API_MAP);
      if (toolName === 'report_mcp_design') return claudeToolResponse('report_mcp_design', DESIGN);
      return jsonRes({ error: { message: `unexpected tool ${toolName}` } }, 400);
    },
    'api.example.com': async ({ url, init }) => {
      targetCalls.push({ url, headers: Object.fromEntries(new Headers(init.headers)), method: init.method, body: init.body });
      if (init.method === 'GET') return jsonRes({ things: [{ id: 't1', name: 'widget' }] });
      if (init.method === 'POST') return jsonRes({ id: 't2', ok: true }, 201);
      return jsonRes({ deleted: true });
    },
  });
  t.after(() => fm.restore());

  // landing + health
  const landing = await client.request('GET', '/');
  assert.equal(landing.status, 200);
  assert.ok(landing.text.includes('paste a link'));
  assert.ok(!landing.text.includes('—'), 'no em-dashes on the landing page');

  // signup (auto-verified: no RESEND key)
  const su = await client.request('POST', '/api/auth/signup', {
    body: { email: 'user@test.dev', password: 'longenoughpw', name: 'Test' },
    headers: { Origin: 'https://mit.test' },
  });
  assert.equal(su.status, 201, JSON.stringify(su.data));
  assert.equal(su.data.verified, true);

  const me = await client.request('GET', '/api/me');
  assert.equal(me.data.plan, 'free');

  // CSRF: foreign origin refused
  const evil = await client.request('POST', '/api/projects', {
    body: { name: 'evil' }, headers: { Origin: 'https://evil.example' },
  });
  assert.equal(evil.status, 403);

  // create project from pasted docs
  const created = await client.request('POST', '/api/projects', {
    body: { name: 'Example', source_text: PASTED_DOCS, goal: 'manage things' },
    headers: { Origin: 'https://mit.test' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { id: pid, slug, mcp_key } = created.data;
  assert.equal(slug, 'example');
  assert.ok(mcp_key.startsWith('mit_'));

  // free plan: second project refused
  const second = await client.request('POST', '/api/projects', {
    body: { name: 'Two', source_text: PASTED_DOCS }, headers: { Origin: 'https://mit.test' },
  });
  assert.equal(second.status, 402);

  // generate (engine runs in waitUntil)
  const gen = await client.request('POST', '/api/projects/' + pid + '/generate', { body: {}, headers: { Origin: 'https://mit.test' } });
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  await gen.ctx.flush();

  const detail = await client.request('GET', '/api/projects/' + pid);
  assert.equal(detail.data.project.status, 'ready', JSON.stringify(detail.data.project.error));
  const manifest = detail.data.project.manifest;
  assert.equal(manifest.tools.length, 2, 'DELETE tool must be dropped by default');
  assert.deepEqual(manifest.tools.map((x) => x.name), ['list_things', 'create_thing']);
  assert.equal(detail.data.project.cred_fields[0].key, 'token');

  // events log recorded the pipeline
  const events = await client.request('GET', '/api/projects/' + pid + '/events?after=0');
  const stages = events.data.events.map((e) => e.stage);
  assert.ok(stages.includes('map') && stages.includes('design') && stages.includes('ready'));
  assert.ok(events.data.events.some((e) => e.level === 'warn' && /delete_thing/.test(e.message)));

  // store credentials (encrypted)
  const cr = await client.request('PUT', '/api/projects/' + pid + '/credentials', {
    body: { values: { token: 'sekret-token' } }, headers: { Origin: 'https://mit.test' },
  });
  assert.equal(cr.status, 200);
  const rawCreds = await env.DB.prepare('SELECT creds_enc FROM projects WHERE id = ?').bind(pid).first();
  assert.ok(!rawCreds.creds_enc.includes('sekret-token'), 'credentials encrypted at rest');

  // ---------- MCP protocol ----------
  const mcp = (body, key = mcp_key) => client.request('POST', '/mcp/' + slug, {
    body, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });

  const noAuth = await client.request('POST', '/mcp/' + slug, { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(noAuth.status, 401);
  assert.ok(noAuth.res.headers.get('WWW-Authenticate').includes('/.well-known/oauth-protected-resource/mcp/' + slug));

  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.data.result.serverInfo.name, 'example-mcp');

  const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = list.data.result.tools.map((x) => x.name);
  assert.deepEqual(names, ['list_things', 'create_thing', 'api_call']);

  const call = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_things', arguments: { limit: 3 } } });
  assert.equal(call.data.result.isError, false, JSON.stringify(call.data));
  assert.ok(call.data.result.content[0].text.includes('widget'));
  const lastTarget = targetCalls[targetCalls.length - 1];
  assert.equal(lastTarget.headers.authorization, 'Bearer sekret-token', 'bearer creds injected');
  assert.ok(lastTarget.url.includes('limit=3'));

  const del = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'api_call', arguments: { method: 'DELETE', path: '/v1/things/t1' } } });
  assert.equal(del.data.result.isError, true);
  assert.ok(del.data.result.content[0].text.includes('DELETE is refused'));

  const post = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_thing', arguments: { name: 'newt' } } });
  assert.equal(post.data.result.isError, false);
  assert.deepEqual(JSON.parse(targetCalls[targetCalls.length - 1].body), { name: 'newt' });

  // ---------- OAuth 2.1 flow ----------
  const meta = await client.request('GET', '/.well-known/oauth-protected-resource/mcp/' + slug);
  assert.equal(meta.data.resource, 'https://mit.test/mcp/' + slug);
  const asMeta = await client.request('GET', '/.well-known/oauth-authorization-server/mcp/' + slug);
  assert.equal(asMeta.data.token_endpoint, 'https://mit.test/mcp/' + slug + '/token');

  const reg = await client.request('POST', '/mcp/' + slug + '/register', {
    body: { redirect_uris: ['https://client.example/cb'], client_name: 'TestClient' },
  });
  assert.equal(reg.status, 201);

  const verifier = 'v'.repeat(48);
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  ).toString('base64url');
  const form = new URLSearchParams({
    access_key: mcp_key, client_id: reg.data.client_id,
    redirect_uri: 'https://client.example/cb', state: 'st1', code_challenge: challenge,
  });
  const authz = await client.request('POST', '/mcp/' + slug + '/authorize', {
    rawBody: form.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(authz.status, 302);
  const loc = new URL(authz.res.headers.get('Location'));
  const code = loc.searchParams.get('code');
  assert.ok(code && loc.searchParams.get('state') === 'st1');

  const tok = await client.request('POST', '/mcp/' + slug + '/token', {
    rawBody: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'https://client.example/cb', code_verifier: verifier }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.ok(tok.data.access_token, JSON.stringify(tok.data));
  const viaOauth = await mcp({ jsonrpc: '2.0', id: 6, method: 'ping' }, tok.data.access_token);
  assert.deepEqual(viaOauth.data.result, {});

  // key rotation invalidates old key + oauth tokens
  const rot = await client.request('POST', '/api/projects/' + pid + '/rotate-key', { body: {}, headers: { Origin: 'https://mit.test' } });
  const newKey = rot.data.mcp_key;
  assert.equal((await mcp({ jsonrpc: '2.0', id: 7, method: 'ping' })).status, 401);
  assert.equal((await mcp({ jsonrpc: '2.0', id: 8, method: 'ping' }, tok.data.access_token)).status, 401);
  assert.equal((await mcp({ jsonrpc: '2.0', id: 9, method: 'ping' }, newKey)).status, 200);

  // ---------- Stripe webhook drives plan state ----------
  const sign = async (payload) => {
    const ts = Math.floor(Date.now() / 1000);
    return `t=${ts},v1=${await hmacSha256Hex(env.STRIPE_WEBHOOK_SECRET, `${ts}.${payload}`)}`;
  };
  const meId = me.data.id;
  const evt1 = JSON.stringify({
    id: 'evt_1', type: 'checkout.session.completed',
    data: { object: { client_reference_id: meId, customer: 'cus_1', subscription: 'sub_1', metadata: { user_id: meId, plan: 'pro' } } },
  });
  const wh1 = await client.request('POST', '/api/stripe/webhook', {
    rawBody: evt1, headers: { 'Stripe-Signature': await sign(evt1), 'Content-Type': 'application/json' },
  });
  assert.equal(wh1.status, 200, JSON.stringify(wh1.data));
  assert.equal((await client.request('GET', '/api/me')).data.plan, 'pro');

  // duplicate event ignored; bad signature refused
  const dup = await client.request('POST', '/api/stripe/webhook', {
    rawBody: evt1, headers: { 'Stripe-Signature': await sign(evt1), 'Content-Type': 'application/json' },
  });
  assert.equal(dup.data.duplicate, true);
  const bad = await client.request('POST', '/api/stripe/webhook', {
    rawBody: evt1, headers: { 'Stripe-Signature': 't=1,v1=bad', 'Content-Type': 'application/json' },
  });
  assert.equal(bad.status, 400);

  const evt2 = JSON.stringify({
    id: 'evt_2', type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_1', metadata: { user_id: meId } } },
  });
  await client.request('POST', '/api/stripe/webhook', {
    rawBody: evt2, headers: { 'Stripe-Signature': await sign(evt2), 'Content-Type': 'application/json' },
  });
  const meAfter = await client.request('GET', '/api/me');
  assert.equal(meAfter.data.plan, 'free');

  // ---------- admin ----------
  const adminClient = makeClient(worker, env);
  const asu = await adminClient.request('POST', '/api/auth/signup', {
    body: { email: 'ryan@getdylr.com', password: 'adminpassword' }, headers: { Origin: 'https://mit.test' },
  });
  assert.equal(asu.status, 201);
  const overview = await adminClient.request('GET', '/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.users, 2);
  assert.equal(overview.data.ready_mcps, 1);

  // non-admin refused
  const denied = await client.request('GET', '/api/admin/overview');
  assert.equal(denied.status, 403);

  // export gated by plan (user is back on free)
  const exp = await client.request('GET', '/api/projects/' + pid + '/export');
  assert.equal(exp.status, 402);
  // comp the user via admin, then export works and is valid JS
  const compRes = await adminClient.request('PATCH', '/api/admin/users/' + meId, {
    body: { plan: 'comp' }, headers: { Origin: 'https://mit.test' },
  });
  assert.equal(compRes.status, 200);
  const exp2 = await client.request('GET', '/api/projects/' + pid + '/export');
  assert.equal(exp2.status, 200);
  assert.ok(exp2.text.includes('const MANIFEST ='));
  new Function(exp2.text.replace(/^export default/m, 'const worker ='));

  // wrong password + rate limiting sanity
  const badLogin = await client.request('POST', '/api/auth/login', {
    body: { email: 'user@test.dev', password: 'wrongwrongwrong' }, headers: { Origin: 'https://mit.test' },
  });
  assert.equal(badLogin.status, 401);
});
