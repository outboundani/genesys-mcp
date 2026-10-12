import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegion, GenesysClient, GenesysError, REGIONS, pathId, isFileHostAllowed } from '../src/genesys.js';
import { TOOLS, toolDefs, callTool, WRITE_TOOLS, TOOL_GROUPS } from '../src/tools.js';

test('normalizeRegion accepts full domains, shorthands, and host prefixes', () => {
  assert.equal(normalizeRegion('usw2.pure.cloud'), 'usw2.pure.cloud');
  assert.equal(normalizeRegion('usw2'), 'usw2.pure.cloud');
  assert.equal(normalizeRegion('login.usw2.pure.cloud'), 'usw2.pure.cloud');
  assert.equal(normalizeRegion('https://api.mypurecloud.ie/'), 'mypurecloud.ie');
  assert.equal(normalizeRegion('mypurecloud.com'), 'mypurecloud.com');
  assert.equal(normalizeRegion(''), 'mypurecloud.com');
  assert.equal(normalizeRegion(undefined), 'mypurecloud.com');
});

test('client derives login and api hosts from region', () => {
  const gc = new GenesysClient({ clientId: 'x', clientSecret: 'y', region: 'usw2' });
  assert.equal(gc.loginUrl, 'https://login.usw2.pure.cloud');
  assert.equal(gc.apiUrl, 'https://api.usw2.pure.cloud');
});

test('api() rejects non-/api/ paths without touching the network', async () => {
  const gc = new GenesysClient({ clientId: 'x', clientSecret: 'y', region: 'usw2' });
  await assert.rejects(() => gc.api('GET', '/oauth/token'), GenesysError);
  await assert.rejects(() => gc.api('GET', 'api/v2/users'), GenesysError);
});

test('tool definitions are well-formed and unique', () => {
  const defs = toolDefs();
  const names = defs.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'tool names must be unique');
  for (const t of defs) {
    assert.ok(t.name && t.description, `${t.name}: needs name+description`);
    assert.equal(t.inputSchema.type, 'object', `${t.name}: schema must be object`);
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name}: schema must close additionalProperties`);
  }
});

test('UI metadata references real tools', () => {
  const names = new Set(TOOLS.map((t) => t.name));
  for (const w of WRITE_TOOLS) assert.ok(names.has(w), `WRITE_TOOLS references unknown tool ${w}`);
  for (const g of TOOL_GROUPS) for (const t of g.tools) assert.ok(names.has(t), `group ${g.name} references unknown tool ${t}`);
});

test('no delete tools ship, and genesys_api_call schema refuses DELETE', () => {
  for (const t of TOOLS) assert.ok(!/delete/i.test(t.name), `unexpected delete tool: ${t.name}`);
  const power = TOOLS.find((t) => t.name === 'genesys_api_call');
  assert.deepEqual(power.inputSchema.properties.method.enum, ['GET', 'POST', 'PUT', 'PATCH']);
});

test('callTool: about works unconfigured; API tools demand config', async () => {
  const about = await callTool({ configured: false }, 'about');
  assert.match(about, /outboundIQ/);
  await assert.rejects(() => callTool({ configured: false }, 'list_queues'), /not connected/);
  await assert.rejects(() => callTool({ configured: true, clientId: 'x', clientSecret: 'y', region: 'zz-bogus' }, 'nope_tool'), /Unknown tool/);
});

test('listAll paginates and respects the cap', async () => {
  const gc = new GenesysClient({ clientId: 'x', clientSecret: 'y', region: 'usw2' });
  gc.token = async () => 'fake';
  const realFetch = globalThis.fetch;
  const pages = {
    1: { entities: [{ id: 'a' }, { id: 'b' }], pageCount: 2, total: 3 },
    2: { entities: [{ id: 'c' }], pageCount: 2, total: 3 },
  };
  globalThis.fetch = async (url) => {
    const n = Number(new URL(url).searchParams.get('pageNumber'));
    return new Response(JSON.stringify(pages[n]), { status: 200 });
  };
  try {
    const all = await gc.listAll('/api/v2/things');
    assert.deepEqual(all.entities.map((e) => e.id), ['a', 'b', 'c']);
    assert.equal(all.total, 3);
    assert.equal(all.truncated, false);
    const capped = await gc.listAll('/api/v2/things', {}, { max: 2 });
    assert.deepEqual(capped.entities.map((e) => e.id), ['a', 'b']);
    assert.equal(capped.truncated, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('REGIONS list looks sane', () => {
  assert.ok(REGIONS.includes('mypurecloud.com'));
  assert.ok(REGIONS.includes('usw2.pure.cloud'));
  assert.ok(REGIONS.every((r) => !r.startsWith('login.') && !r.startsWith('api.')));
});

test('regions: the 18 official domains, and unknown regions are refused before any request', () => {
  assert.equal(REGIONS.length, 18);
  for (const d of ['use2.us-gov-pure.cloud', 'mxc1.pure.cloud', 'apse1.pure.cloud', 'edee1.eusc-pure.cloud']) {
    assert.equal(normalizeRegion(d), d);
    assert.equal(normalizeRegion(`https://login.${d}/#/authenticate`), d);
  }
  assert.ok(!REGIONS.includes('use2.pure.cloud'), 'use2.pure.cloud is not a Genesys region');
  assert.equal(normalizeRegion('apse1'), 'apse1.pure.cloud');
  // The client secret goes to login.<region>: a value outside the table must never become a host.
  for (const bad of ['evil.example', 'use2.pure.cloud', 'mypurecloud', 'use2', 'mypurecloud.com.evil.example', 'usw2.pure.cloud/x', 'zz-bogus']) {
    assert.throws(() => normalizeRegion(bad), (e) => e instanceof GenesysError && /Unknown Genesys Cloud region/.test(e.message), bad);
    assert.throws(() => new GenesysClient({ clientId: 'x', clientSecret: 'y', region: bad }), /Unknown Genesys Cloud region/, bad);
  }
});

// Swap globalThis.fetch for one test, always restoring it.
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('token cache is keyed on the secret too: a wrong secret never reuses a token minted with the right one', async () => {
  const logins = [];
  const fake = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/oauth/token')) {
      logins.push(init.headers.Authorization);
      const good = init.headers.Authorization === `Basic ${btoa('cache-client:right')}`;
      return good
        ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
    }
    return new Response(JSON.stringify({ name: 'Org' }), { status: 200 });
  };
  await withFetch(fake, async () => {
    const right = new GenesysClient({ clientId: 'cache-client', clientSecret: 'right', region: 'usw2' });
    assert.equal((await right.get('/api/v2/organizations/me')).name, 'Org');
    const wrong = new GenesysClient({ clientId: 'cache-client', clientSecret: 'wrong', region: 'usw2' });
    await assert.rejects(() => wrong.get('/api/v2/organizations/me'), /login failed/);
    assert.equal(logins.length, 2, 'the wrong secret must do its own login');
  });
});

test('every Genesys request carries a timeout signal, and a timeout becomes a clear tool error', async () => {
  const signals = [];
  const fake = async (url, init) => {
    signals.push(init.signal);
    if (String(url).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    throw new DOMException('The operation timed out.', 'TimeoutError');
  };
  await withFetch(fake, async () => {
    const gc = new GenesysClient({ clientId: 'timeout-client', clientSecret: 's', region: 'usw2' });
    await assert.rejects(() => gc.get('/api/v2/routing/queues'), (e) => e instanceof GenesysError && e.code === 'timeout' && /timed out/.test(e.message));
  });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((s) => s instanceof AbortSignal), 'login and API calls both need a signal');
});

test('a login answer without an access token is an error, not "Bearer undefined"', async () => {
  const fake = async () => new Response(JSON.stringify({ token_type: 'bearer' }), { status: 200 });
  await withFetch(fake, async () => {
    const gc = new GenesysClient({ clientId: 'no-token-client', clientSecret: 's', region: 'usw2' });
    await assert.rejects(() => gc.get('/api/v2/routing/queues'), /no access token/);
  });
});

test('pathId accepts plain ids and refuses anything that could change the endpoint', () => {
  for (const ok of ['9f1c2d3e-0000-4000-8000-000000000001', 'custom_-_9f1c2d3e-0000-4000-8000-000000000001', '3', 'job.1']) assert.equal(pathId('id', ok), ok);
  assert.equal(pathId('version', 3), '3');
  for (const bad of ['', '.', '..', 'a/b', 'x/publish', '../oauth', 'a?b', 'a#b', 'a b', 'a%2Fb', null, undefined, {}, ['a'], 'x'.repeat(129)]) {
    assert.throws(() => pathId('id', bad), (e) => e instanceof GenesysError && e.status === 400, String(bad));
  }
});

test('file hosts: Amazon S3 or a Genesys host of the org region only', () => {
  for (const h of ['bucket.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com', 'bucket.s3.amazonaws.com', 'b.s3-fips.us-east-2.amazonaws.com', 'api-downloads.usw2.pure.cloud', 'fileupload.usw2.pure.cloud']) {
    assert.ok(isFileHostAllowed('usw2.pure.cloud', h), h);
  }
  for (const h of ['evil.example', 'api-downloads.mypurecloud.com', 'usw2.pure.cloud.evil.example', 'x.amazonaws.com.evil.example', 'ec2-1-2-3-4.compute-1.amazonaws.com', 'bucket.s3.us-west-2.amazonaws.com.', '']) {
    assert.ok(!isFileHostAllowed('usw2.pure.cloud', h), h);
  }
});

test('external(): never sends the Genesys token, refuses other hosts, plain HTTP and credential headers', async () => {
  const sent = [];
  const fake = async (url, init) => { sent.push({ url: String(url), init }); return new Response('ok', { status: 200 }); };
  await withFetch(fake, async () => {
    const gc = new GenesysClient({ clientId: 'ext-client', clientSecret: 's', region: 'usw2' });
    gc.token = async () => { throw new Error('the Genesys token must never be needed for a file URL'); };
    const ok = await gc.external('https://bucket.s3.us-west-2.amazonaws.com/u?X-Amz-Signature=abc', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(ok.status, 200);
    assert.equal(sent.length, 1);
    assert.ok(!Object.keys(sent[0].init.headers).some((k) => /authorization/i.test(k)));
    assert.ok(sent[0].init.signal instanceof AbortSignal);
    await assert.rejects(() => gc.external('https://attacker.example/upload', { method: 'PUT', body: 'yaml' }), (e) => e.code === 'file_host_refused');
    await assert.rejects(() => gc.external('http://bucket.s3.us-west-2.amazonaws.com/u'), /plain HTTPS/);
    await assert.rejects(() => gc.external('https://user:pw@bucket.s3.us-west-2.amazonaws.com/u'), /plain HTTPS/);
    await assert.rejects(() => gc.external('https://bucket.s3.us-west-2.amazonaws.com/u', { headers: { Authorization: 'Bearer x' } }), /forbidden header/);
    await assert.rejects(() => gc.external('not a url'), /malformed/);
    assert.equal(sent.length, 1, 'nothing else may be sent');
  });
});
