import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, encryptJson, decryptJson, mintToken, readToken, hmacSha256Hex, timingSafeEqual, sha256hex } from '../src/crypto.js';
import { validateManifest, buildRequest, formEncode } from '../src/manifest.js';
import { verifyStripeSignature } from '../src/stripe.js';
import { extractJson } from '../src/anthropic.js';
import { htmlToText } from '../src/htmltext.js';
import { parseOpenApi, looksLikeOpenApi } from '../src/openapi.js';
import { slugify, clampStr } from '../src/util.js';

const KEY = 'b'.repeat(64);

test('password hash roundtrip', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.ok(hash.startsWith('pbkdf2$210000$'));
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('credential encryption roundtrip', async () => {
  const packed = await encryptJson(KEY, { token: 'sk_live_123', extra: 'yes' });
  assert.ok(!packed.includes('sk_live_123'));
  const back = await decryptJson(KEY, packed);
  assert.deepEqual(back, { token: 'sk_live_123', extra: 'yes' });
  await assert.rejects(() => decryptJson('c'.repeat(64), packed));
});

test('hmac token mint/read + expiry', async () => {
  const t = await mintToken('secret', { t: 'a', v: 1 });
  assert.deepEqual(await readToken('secret', t), { t: 'a', v: 1 });
  assert.equal(await readToken('other', t), null);
  const expired = await mintToken('secret', { t: 'a', exp: Math.floor(Date.now() / 1000) - 10 });
  assert.equal(await readToken('secret', expired), null);
});

test('timingSafeEqual basics', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'ab'), false);
});

test('validateManifest normalizes, injects path params, drops DELETE + dupes', () => {
  const { manifest, warnings } = validateManifest({
    server: { name: 'Example', description: 'd', base_url: 'https://api.example.com/' },
    auth: { type: 'bearer' },
    tools: [
      { name: 'get_thing', description: 'get', input_schema: { type: 'object', properties: {} }, request: { method: 'GET', path: '/v1/things/{id}' } },
      { name: 'get_thing', description: 'dupe', input_schema: { type: 'object', properties: {} }, request: { method: 'GET', path: '/v1/things/{id}' } },
      { name: 'delete_thing', description: 'del', input_schema: { type: 'object', properties: {} }, request: { method: 'DELETE', path: '/v1/things/{id}' } },
      { name: 'BadName!', description: 'x', request: { method: 'GET', path: '/x' } },
    ],
  });
  assert.equal(manifest.server.base_url, 'https://api.example.com');
  assert.equal(manifest.tools.length, 1);
  assert.equal(manifest.tools[0].input_schema.properties.id.type, 'string');
  assert.deepEqual(manifest.tools[0].input_schema.required, ['id']);
  assert.equal(warnings.length, 3);
  assert.deepEqual(manifest.auth.fields, [{ key: 'token', label: 'API token' }]);
});

test('validateManifest keeps DELETE when allowed', () => {
  const { manifest } = validateManifest({
    server: { name: 'x', base_url: 'https://a.example' },
    auth: { type: 'none' },
    tools: [{ name: 'delete_thing', description: 'd', request: { method: 'DELETE', path: '/t/{id}' } }],
  }, { allowDelete: true });
  assert.equal(manifest.tools[0].request.method, 'DELETE');
});

const MANIFEST = validateManifest({
  server: { name: 'ex', base_url: 'https://api.example.com' },
  auth: { type: 'bearer' },
  tools: [
    {
      name: 'list_things',
      description: 'list',
      input_schema: { type: 'object', properties: { limit: { type: 'number' }, q: { type: 'string' } } },
      request: { method: 'GET', path: '/v1/things', query: { limit: '$limit', expand: 'details' } },
    },
    {
      name: 'get_thing',
      description: 'get',
      input_schema: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/things/{id}' },
    },
    {
      name: 'create_thing',
      description: 'create',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, tags: { type: 'array' } } },
      request: { method: 'POST', path: '/v1/things', body: { thing: { name: '$name' }, meta: '$$rest' } },
    },
    {
      name: 'form_thing',
      description: 'form',
      input_schema: { type: 'object', properties: { amount: { type: 'number' } } },
      request: { method: 'POST', path: '/v1/form', content_type: 'form', body: null },
    },
  ],
}).manifest;

test('buildRequest: GET query mapping + literals + leftover args', () => {
  const t = MANIFEST.tools.find((x) => x.name === 'list_things');
  const r = buildRequest(MANIFEST, t, { limit: 5, q: 'abc', stray: 'yes' });
  const u = new URL(r.url);
  assert.equal(u.pathname, '/v1/things');
  assert.equal(u.searchParams.get('limit'), '5');
  assert.equal(u.searchParams.get('expand'), 'details');
  assert.equal(u.searchParams.get('q'), 'abc');
  assert.equal(u.searchParams.get('stray'), 'yes');
});

test('buildRequest: path params required + encoded', () => {
  const t = MANIFEST.tools.find((x) => x.name === 'get_thing');
  const r = buildRequest(MANIFEST, t, { id: 'a/b c' });
  assert.equal(new URL(r.url).pathname, '/v1/things/a%2Fb%20c');
  assert.throws(() => buildRequest(MANIFEST, t, {}), /Missing required path parameter "id"/);
});

test('buildRequest: POST body template with $$rest', () => {
  const t = MANIFEST.tools.find((x) => x.name === 'create_thing');
  const r = buildRequest(MANIFEST, t, { name: 'widget', tags: ['a'], extra: 1 });
  assert.equal(r.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(r.body), { thing: { name: 'widget' }, meta: { tags: ['a'], extra: 1 } });
});

test('buildRequest: form encoding', () => {
  const t = MANIFEST.tools.find((x) => x.name === 'form_thing');
  const r = buildRequest(MANIFEST, t, { amount: 9, nested: { a: 'b' } });
  assert.equal(r.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(r.body.includes('amount=9'));
  assert.ok(r.body.includes(encodeURIComponent('nested[a]') + '=b'));
});

test('formEncode arrays stripe-style', () => {
  assert.equal(
    formEncode({ line_items: [{ price: 'p1', quantity: 2 }] }),
    encodeURIComponent('line_items[0][price]') + '=p1&' + encodeURIComponent('line_items[0][quantity]') + '=2'
  );
});

test('stripe signature verify', async () => {
  const secret = 'whsec_testsecret';
  const payload = '{"id":"evt_1","type":"x"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacSha256Hex(secret, `${t}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret), true);
  assert.equal(await verifyStripeSignature(payload + ' ', `t=${t},v1=${sig}`, secret), false);
  assert.equal(await verifyStripeSignature(payload, `t=${t - 9999},v1=${sig}`, secret), false);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=deadbeef`, secret), false);
});

test('extractJson finds fenced and bare objects', () => {
  assert.deepEqual(extractJson('here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('noise {"b":{"c":2}} trailing'), { b: { c: 2 } });
  assert.equal(extractJson('no json here'), null);
});

test('htmlToText strips chrome, keeps code, extracts links', () => {
  const { text, links } = htmlToText(`
    <html><head><style>.x{}</style><script>evil()</script></head>
    <body><nav><a href="/skip">skip</a></nav>
    <h2>Auth</h2><p>Use a <code>Bearer</code> token.</p>
    <pre>GET /v1/things</pre>
    <a href="/docs/api">API reference</a>
    </body></html>`, 'https://ex.dev/start');
  assert.ok(text.includes('## Auth'));
  assert.ok(text.includes('GET /v1/things'));
  assert.ok(!text.includes('evil'));
  assert.ok(links.some((l) => l.url === 'https://ex.dev/docs/api' && l.label === 'API reference'));
});

test('openapi parse: servers, auth, params, body deref', () => {
  const spec = {
    openapi: '3.0.0',
    info: { title: 'Ex API', description: 'd' },
    servers: [{ url: 'https://api.ex.dev/v2' }],
    components: {
      securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
      schemas: { Thing: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'nm' } } } },
    },
    paths: {
      '/things/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { summary: 'Get thing' },
      },
      '/things': {
        post: { summary: 'Make thing', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } } },
      },
    },
  };
  const raw = JSON.stringify(spec);
  assert.equal(looksLikeOpenApi(raw), true);
  const parsed = parseOpenApi(raw, 'https://ex.dev/openapi.json');
  assert.equal(parsed.base_url, 'https://api.ex.dev/v2');
  assert.deepEqual(parsed.auth, { type: 'api_key_header', header: 'X-Api-Key', prefix: '' });
  const get = parsed.endpoints.find((e) => e.method === 'GET');
  assert.equal(get.params[0].name, 'id');
  const post = parsed.endpoints.find((e) => e.method === 'POST');
  assert.deepEqual(post.body[0], { name: 'name', type: 'string', required: true, description: 'nm' });
});

test('slugify + clampStr', () => {
  assert.equal(slugify('Stripe Billing!'), 'stripe-billing');
  assert.equal(slugify('x'), 'mcp-x');
  assert.ok(clampStr('a'.repeat(20), 10).includes('truncated'));
});

test('sha256hex stable', async () => {
  assert.equal((await sha256hex('abc')).slice(0, 8), 'ba7816bf');
});
