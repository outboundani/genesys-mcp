// Smoke the DEPLOYED server over MCP (streamable HTTP), so the real Workers
// KV binding, auth, and JSON-RPC plumbing are exercised, not the in-memory
// stand-ins the unit tests and local e2e use. Runs the persisted evaluate
// chain end to end: create AVA -> version -> publish TestReady ->
// ava_run_scripted_scenario (persists) -> ava_record_verdicts -> ava_scorecard
// -> workspace reads. Leaves MCP_Test_* artifacts (clean with
// scripts/cleanup-test-artifacts.mjs --delete).
//
//   node scripts/live-mcp-smoke.mjs [https://your-worker.workers.dev]
// Reads the access key from .mcp-auth-token.local (or MCP_AUTH_TOKEN env).
import { readFileSync, existsSync } from 'node:fs';

const url = (process.argv[2] || 'https://genesys-mcp.ryan-shatzkamer.workers.dev').replace(/\/+$/, '') + '/mcp';
const tokenFile = new URL('../.mcp-auth-token.local', import.meta.url);
const token = (process.env.MCP_AUTH_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : '')).trim();
if (!token) { console.error('No access key: set MCP_AUTH_TOKEN or create .mcp-auth-token.local'); process.exit(1); }

let nextId = 1;
let pass = 0, fail = 0;
async function rpc(method, params) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function call(name, args = {}, show = (r) => r) {
  try {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r.content?.[0]?.text || '';
    if (r.isError) throw new Error(text);
    let data; try { data = JSON.parse(text); } catch { data = text; }
    const s = JSON.stringify(show(data));
    console.log(`✅ ${name} ${s.length > 300 ? s.slice(0, 300) + '…' : s}`);
    pass++;
    return data;
  } catch (e) {
    console.log(`❌ ${name} - ${String(e.message).slice(0, 400)}`);
    fail++;
    return null;
  }
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live-mcp-smoke', version: '1' } });
console.log(`server ${init.serverInfo.name} v${init.serverInfo.version}, capabilities ${Object.keys(init.capabilities).join('+')}`);
const tools = await rpc('tools/list');
console.log(`${tools.tools.length} tools; prompts: ${(await rpc('prompts/list')).prompts.map((p) => p.name).join(', ')}`);

const stamp = Date.now().toString(36);
const name = `MCP_Test_AVA_live_${stamp}`;
await call('check_connection', {}, (r) => ({ org: r.org }));
const created = await call('create_ava', { name }, (r) => ({ id: r.id, slug: r.slug }));
if (!created) process.exit(1);
const ver = await call('create_ava_version', { ava: created.id, definition: {
  role: 'You are the outboundIQ support assistant. You explain what outboundIQ does and route callers to the right team. You never quote prices.',
  instructions: ['Greet the caller briefly.', 'Answer questions about outboundIQ at a high level.', 'If asked about pricing, say a sales representative will follow up.', 'If the caller wants a person, say you will connect them and end the conversation.'],
  events: { userExit: { message: 'Thanks for calling outboundIQ. Goodbye!' }, escalation: { message: 'Let me connect you with our team.' }, guardrails: { message: 'I can only help with outboundIQ questions.', violationThreshold: 3, violationThresholdCrossedMessage: 'Let me get you to a person.' } },
} }, (r) => ({ version: r.version, preflight: r.preflight }));
const pub = ver && await call('publish_ava_version', { ava: created.id, version: ver.version }, (r) => ({ status: r.status, jobId: r.jobId }));
let status = pub?.status;
for (let i = 0; i < 10 && status && !['Succeeded', 'Failed'].includes(status); i++) {
  await new Promise((r) => setTimeout(r, 4000));
  status = (await call('get_ava_publish_job', { ava: created.id, version: ver.version, job_id: pub.jobId }))?.status;
}
if (status !== 'Succeeded') { console.log(`publish status ${status}; stopping`); process.exit(1); }

const runId = `eval-run-live-${stamp}`;
const scen = await call('ava_run_scripted_scenario', {
  ava: created.id, version: ver.version, slug: created.slug, run_id: runId, attempt: 1,
  scenario: { name: 'Pricing deflection', language: 'en-us', metadata: { id: 'pricing-deflection' }, x_eval: {
    max_turns: 4, turns: [{ source: 'fixed_user', text: 'What does outboundIQ cost?' }, { source: 'fixed_agent', text: 'A sales representative will follow up about pricing.' }, { source: 'fixed_user', text: 'Please connect me to a person.' }],
    rubric: [{ id: 'goal-1', dimension: 'goal', assertion: 'The agent deflects pricing to sales.' }],
  } },
}, (r) => ({ ended: r.ended, stored_as: r.stored_as, store_error: r.store_error, turns: r.transcript?.length }));
if (scen?.stored_as) {
  await call('ava_record_verdicts', { slug: created.slug, run_id: runId, test_case_id: 'pricing-deflection', attempt: 1,
    layer2: [{ id: 'goal-1', dimension: 'goal', verdict: 'pass', evidence: 'e2e', reason: 'e2e' }, { id: 't', dimension: 'tool_use', verdict: 'pass' }, { id: 'g', dimension: 'guardrail', verdict: 'pass' }, { id: 'f', dimension: 'tone_format', verdict: 'pass' }],
    responseMatch: (scen.responseMatch || []).map((m) => ({ ...m, verdict: 'pass' })) }, (r) => ({ recorded: r.recorded, key: r.key }));
  await call('ava_scorecard', { slug: created.slug, run_id: runId, version: ver.version }, (r) => ({ summary: r.summary, warning: r.warning, agentId: r.scorecard?.agentId }));
  await call('ava_workspace_list', { slug: created.slug }, (r) => ({ artifacts: r.artifacts.map((a) => `${a.kind}:${a.id || ''}`) }));
  await call('ava_workspace_list', {}, (r) => ({ indexed: r.index.avas.map((a) => `${a.slug}:${a.local_status}`) }));
  await call('ava_workspace_get', { slug: created.slug, kind: 'scorecard', id: runId }, (r) => ({ found: r.found, passed: r.data?.summary?.passed }));
}
console.log(`\n${pass} passed, ${fail} failed. Artifact left: AVA "${name}" (workspace slug ${created.slug}); clean with scripts/cleanup-test-artifacts.mjs --delete.`);
process.exit(fail ? 1 : 0);
