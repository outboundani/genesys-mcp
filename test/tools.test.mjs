// Tool handlers end to end against a fake Genesys (mocked fetch only, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool } from '../src/tools.js';
import { GenesysError } from '../src/genesys.js';

const G = '11111111-2222-4333-8444-555555555555';
let n = 0;

// routes: { 'METHOD /api/v2/path': (url, init) => body | Response }. Unknown routes 404.
// Returns { cfg, calls } where calls lists every request ("METHOD url").
async function withGenesys(routes, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    calls.push({ method, url: url.href, host: url.host, path: url.pathname, init });
    if (url.pathname === '/oauth/token') return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    const key = `${method} ${url.host.startsWith('api.') ? url.pathname : url.href.split('?')[0]}`;
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 404 });
    const out = await h(url, init);
    return out instanceof Response ? out : new Response(typeof out === 'string' ? out : JSON.stringify(out), { status: 200 });
  };
  // A fresh client id per test keeps the module token cache out of the way.
  const cfg = { configured: true, clientId: `test-client-${++n}`, clientSecret: 'secret', region: 'usw2.pure.cloud' };
  try { return await fn(cfg, calls); } finally { globalThis.fetch = real; }
}

const apiCalls = (calls) => calls.filter((c) => c.host.startsWith('api.')).map((c) => `${c.method} ${c.path}`);

test('publish_flow refuses a job upload URL that is not S3 or a Genesys host, and sends the YAML nowhere', async () => {
  await withGenesys({
    'POST /api/v2/flows/jobs': () => ({ id: 'job-1', presignedUrl: 'https://collector.example/upload', headers: {} }),
  }, async (cfg, calls) => {
    await assert.rejects(() => callTool(cfg, 'publish_flow', { yaml: 'inboundCall:\n  name: X\n' }), (e) => e instanceof GenesysError && e.code === 'file_host_refused');
    assert.ok(!calls.some((c) => c.host === 'collector.example'), 'nothing may be sent to the foreign host');
  });
});

test('publish_flow uploads to an S3 presigned URL without the Genesys token', async () => {
  await withGenesys({
    'POST /api/v2/flows/jobs': () => ({ id: 'job-1', presignedUrl: 'https://bucket.s3.us-west-2.amazonaws.com/u?sig=1', headers: { 'Content-Type': 'text/plain' } }),
    'PUT https://bucket.s3.us-west-2.amazonaws.com/u': () => '',
    'GET /api/v2/flows/jobs/job-1': () => ({ status: 'Success', flow: { id: G, name: 'X' } }),
  }, async (cfg, calls) => {
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (f) => realTimeout(f, 0); // skip the poll wait
    try {
      const r = await callTool(cfg, 'publish_flow', { yaml: 'inboundCall:\n  name: X\n' });
      assert.equal(r.status, 'Success');
    } finally { globalThis.setTimeout = realTimeout; }
    const put = calls.find((c) => c.method === 'PUT');
    assert.ok(put && !Object.keys(put.init.headers).some((k) => /authorization/i.test(k)));
  });
});

test('export_flow refuses a download URL on a foreign host', async () => {
  await withGenesys({
    'GET /api/v2/flows': () => ({ entities: [{ id: G, name: 'Main' }], pageCount: 1, total: 1 }),
    'POST /api/v2/flows/export/jobs': () => ({ id: 'exp-1', status: 'Success', downloadUrl: 'https://collector.example/flow.yaml' }),
  }, async (cfg, calls) => {
    await assert.rejects(() => callTool(cfg, 'export_flow', { flow: G }), (e) => e.code === 'file_host_refused');
    assert.ok(!calls.some((c) => c.host === 'collector.example'));
  });
});

test('ids from the caller are validated before any path is built', async () => {
  await withGenesys({}, async (cfg, calls) => {
    await assert.rejects(() => callTool(cfg, 'get_flow_job', { job_id: '../../oauth/clients' }), /plain id/);
    await assert.rejects(() => callTool(cfg, 'get_flow_job', { job_id: 'x/y' }), /plain id/);
    await assert.rejects(() => callTool(cfg, 'publish_ava_version', { ava: G, version: '1/jobs/x' }), /plain id/);
    await assert.rejects(() => callTool(cfg, 'get_ava_publish_job', { ava: G, version: '1', job_id: 'a/b' }), /plain id/);
    await assert.rejects(() => callTool(cfg, 'get_knowledge_sync', { source_id: 'src/x', synchronization_id: 's' }), /plain id/);
    await assert.rejects(() => callTool(cfg, 'ava_chat_send', { ava: G, session_id: 's/turns', text: 'hi', previous_turn_id: 't', version: '1' }), /plain id/);
    await assert.rejects(() => callTool(cfg, 'get_data_action_schema', { data_action: 'custom_-_x/execute' }), /plain id/);
    assert.deepEqual(apiCalls(calls), [], 'no API request may be sent for a bad id');
  });
});

test('callTool: arguments must be an object, unknown tools are tool errors', async () => {
  await withGenesys({}, async (cfg, calls) => {
    for (const bad of [[], 'x', 7, true]) {
      await assert.rejects(() => callTool(cfg, 'get_flow_job', bad), (e) => e instanceof GenesysError && /must be a JSON object/.test(e.message), JSON.stringify(bad));
    }
    await assert.rejects(() => callTool(cfg, 'list_queues_now', {}), (e) => e instanceof GenesysError && /Unknown tool/.test(e.message));
    // null means "no arguments": the handler runs and reports the missing field itself.
    await assert.rejects(() => callTool(cfg, 'publish_flow', null), /Provide spec or yaml/);
    assert.deepEqual(apiCalls(calls), []);
  });
});

test('publish_flow refuses spec and yaml together, and an empty or non-string yaml', async () => {
  const spec = { name: 'X', greeting: 'Hi', menu: { prompt: 'p', choices: [{ dtmf: '1', action: 'disconnect' }] } };
  await withGenesys({}, async (cfg, calls) => {
    await assert.rejects(() => callTool(cfg, 'publish_flow', { spec, yaml: 'inboundCall:\n  name: Y\n' }), /not both/);
    await assert.rejects(() => callTool(cfg, 'publish_flow', { yaml: { inboundCall: { name: 'Y' } } }), /non-empty string/);
    await assert.rejects(() => callTool(cfg, 'publish_flow', { yaml: '   ' }), /non-empty string/);
    assert.deepEqual(apiCalls(calls), [], 'no flow job may be created');
  });
});

test('genesys_api_call: a lowercase or padded method is refused before any request', async () => {
  await withGenesys({ 'GET /api/v2/routing/queues': () => ({ entities: [] }) }, async (cfg, calls) => {
    for (const method of ['get', 'patch', 'POST ']) {
      await assert.rejects(() => callTool(cfg, 'genesys_api_call', { method, path: '/api/v2/routing/queues' }), /exactly GET, POST, PUT, or PATCH/, method);
    }
    assert.deepEqual(apiCalls(calls), []);
    await callTool(cfg, 'genesys_api_call', { method: 'GET', path: '/api/v2/routing/queues' });
    assert.deepEqual(apiCalls(calls), ['GET /api/v2/routing/queues']);
  });
});

test('get_flow_configuration redacts secret keys and name/value secret pairs', async () => {
  const flowConfig = { name: 'Main IVR', variables: [{ name: 'apiKey', value: 'K3y-Value-1234567890' }, { name: 'greeting', value: 'Hello' }], settings: { clientSecret: 'shh-0123456789' } };
  await withGenesys({ [`GET /api/v2/flows/${G}/latestconfiguration`]: () => flowConfig }, async (cfg) => {
    const r = await callTool(cfg, 'get_flow_configuration', { flow: G });
    const text = JSON.stringify(r);
    assert.equal(r.name, 'Main IVR');
    assert.ok(!text.includes('K3y-Value-1234567890') && !text.includes('shh-0123456789'), text);
    assert.match(text, /Hello/);
  });
});

test('export_flow redacts secrets in the downloaded YAML and says the export is not a faithful backup', async () => {
  const exportYaml = 'inboundCall:\n  name: Main IVR\n  variables:\n    - stringVariable:\n        name: Flow.apiKey\n        initialValue:\n          lit: sk_live_abcdef123456\n    - stringVariable:\n        name: Flow.greeting\n        initialValue:\n          lit: Hello there\n';
  await withGenesys({
    'POST /api/v2/flows/export/jobs': () => ({ id: 'exp-1', status: 'Success', downloadUrl: 'https://api-downloads.usw2.pure.cloud/flow.yaml?sig=1' }),
    'GET https://api-downloads.usw2.pure.cloud/flow.yaml': () => exportYaml,
  }, async (cfg) => {
    const r = await callTool(cfg, 'export_flow', { flow: G });
    assert.ok(!r.yaml.includes('sk_live_abcdef123456'), r.yaml);
    assert.ok(r.yaml.includes('Hello there') && r.yaml.includes('Flow.apiKey'));
  });
  const { toolDefs } = await import('../src/tools.js');
  assert.match(toolDefs().find((t) => t.name === 'export_flow').description, /\[redacted\].*NOT a faithful backup/s);
});

test('publish_ava_version: production must be a real boolean; the string "false" never publishes to production', async () => {
  const bodies = [];
  await withGenesys({
    [`GET /api/v2/agentic/virtualagents/${G}`]: () => ({ id: G, name: 'Bot' }),
    [`POST /api/v2/agentic/virtualagents/${G}/versions/1/jobs`]: (_u, init) => { bodies.push(JSON.parse(init.body)); return { id: 'j1', status: 'Succeeded' }; },
  }, async (cfg, calls) => {
    for (const bad of ['false', 'true', 0, 1, null]) {
      await assert.rejects(() => callTool(cfg, 'publish_ava_version', { ava: G, version: '1', production: bad }), /must be true or false/, String(bad));
    }
    assert.deepEqual(apiCalls(calls), [], 'nothing is sent for a non-boolean production');
    await callTool(cfg, 'publish_ava_version', { ava: G, version: '1' });
    await callTool(cfg, 'publish_ava_version', { ava: G, version: '1', production: false });
    await callTool(cfg, 'publish_ava_version', { ava: G, version: '1', production: true });
    assert.deepEqual(bodies.map((b) => b.virtualAgentVersion.status), ['TestReady', 'TestReady', 'ProductionReady']);
  });
});

// A fake AVA chat: the first turn is a NoOp that ran a tool; the continuation answers or fails.
function avaChatRoutes({ continuationFails = false } = {}) {
  let turn = 0;
  return {
    [`GET /api/v2/agentic/virtualagents/${G}`]: () => ({ id: G, name: 'Bot' }),
    [`POST /api/v2/apps/agentic/virtualagents/${G}/sessions`]: () => ({ id: 'sess-1' }),
    [`POST /api/v2/apps/agentic/virtualagents/${G}/sessions/sess-1/turns`]: () => {
      turn++;
      if (turn === 1) return { id: 't1', prompts: { text: { segments: [{ text: 'One moment.' }] } }, events: { toolCalls: [{ name: 'LookupAccount', input: { phone: 'x' } }], toolResults: [{ name: 'LookupAccount', output: 'ok' }] }, nextAction: { type: 'NoOp' } };
      if (continuationFails) return new Response(JSON.stringify({ message: 'upstream timeout' }), { status: 503 });
      return { id: 't2', prompts: { text: { segments: [{ text: 'Found it.' }] } }, events: {}, nextAction: { type: 'WaitForInput' } };
    },
  };
}

test('ava_chat_start returns the tool calls and results of the first turn', async () => {
  await withGenesys(avaChatRoutes(), async (cfg) => {
    const r = await callTool(cfg, 'ava_chat_start', { ava: G, version: '1.0' });
    assert.equal(r.greeting, 'One moment. Found it.');
    assert.deepEqual(r.toolCalls, [{ name: 'LookupAccount', input: { phone: 'x' } }]);
    assert.deepEqual(r.toolResults, [{ name: 'LookupAccount', output: 'ok' }]);
    assert.equal(r.truncated, undefined);
  });
});

test('a failed chat continuation keeps the tool calls that already ran', async () => {
  await withGenesys(avaChatRoutes({ continuationFails: true }), async (cfg) => {
    const r = await callTool(cfg, 'ava_chat_start', { ava: G, version: '1.0' });
    assert.deepEqual(r.toolCalls, [{ name: 'LookupAccount', input: { phone: 'x' } }]);
    assert.equal(r.truncated, true);
    assert.match(r.error, /upstream timeout/);
  });
});

test('export_flow with job_id checks the running export instead of starting a new one', async () => {
  await withGenesys({
    'GET /api/v2/flows/export/jobs/exp-7': () => ({ id: 'exp-7', status: 'Success', downloadUrl: 'https://api-downloads.usw2.pure.cloud/f.yaml' }),
    'GET https://api-downloads.usw2.pure.cloud/f.yaml': () => 'inboundCall:\n  name: Main\n',
  }, async (cfg, calls) => {
    const r = await callTool(cfg, 'export_flow', { flow: G, job_id: 'exp-7' });
    assert.match(r.yaml, /name: Main/);
    assert.ok(!apiCalls(calls).some((c) => c.startsWith('POST')), 'no new export job');
    await assert.rejects(() => callTool(cfg, 'export_flow', { flow: G, job_id: '../jobs' }), /plain id/);
  });
});

test('a knowledge upload ticket on a foreign host fails the upload and cancels the sync', async () => {
  await withGenesys({
    'POST /api/v2/knowledge/sources/src-1/synchronizations': () => ({ id: 'sync-1' }),
    'POST /api/v2/knowledge/sources/src-1/synchronizations/sync-1/uploads': () => ({ url: 'https://collector.example/put', headers: {} }),
    'PATCH /api/v2/knowledge/sources/src-1/synchronizations/sync-1': () => ({ ok: true }),
  }, async (cfg, calls) => {
    const r = await callTool(cfg, 'upload_knowledge_documents', { source_id: 'src-1', sync_type: 'Incremental', confirm_incremental: true, files: [{ name: 'notes.txt', content: 'hello' }] });
    assert.equal(r.workflowStatus, 'upload_failed');
    assert.match(r.error, /refusing to contact it/);
    assert.ok(!calls.some((c) => c.host === 'collector.example'));
    const cancel = calls.find((c) => c.method === 'PATCH');
    assert.equal(JSON.parse(cancel.init.body).status, 'Cancelled');
  });
});
