// Live AVA lifecycle smoke: drives the real tool handlers against the org in
// .dev.vars. Creates MCP_Test_AVA_* artifacts (create-only, nothing deleted):
// an AVA + version, publishes it TestReady, chats with it, runs a scripted
// scenario, then publishes a bot flow that calls it and an inbound flow that
// routes to the bot flow.
//
//   node scripts/ava-e2e.mjs            # reads + the whole write chain
//   node scripts/ava-e2e.mjs --reads    # reads only
import { readFileSync } from 'node:fs';
import { callTool } from '../src/tools.js';
import { MemoryKV } from '../src/ava.js';

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const cfg = { clientId: vars.GENESYS_CLIENT_ID, clientSecret: vars.GENESYS_CLIENT_SECRET, region: vars.GENESYS_REGION || 'mypurecloud.com', configured: true, kv: new MemoryKV() };
const readsOnly = process.argv.includes('--reads');
const stamp = Date.now().toString(36);
let pass = 0, fail = 0;

async function run(name, args = {}, show = (r) => r) {
  try {
    const r = await callTool(cfg, name, args);
    const s = JSON.stringify(show(r));
    console.log(`✅ ${name} ${s.length > 400 ? s.slice(0, 400) + '…' : s}`);
    pass++;
    return r;
  } catch (e) {
    console.log(`❌ ${name} - ${e.message}`);
    fail++;
    return null;
  }
}

console.log(`- AVA reads against ${cfg.region} -`);
await run('list_avas', {}, (r) => ({ total: r.total, names: r.avas.map((a) => `${a.name}:${a.status}`) }));
await run('list_data_actions', { category: 'Genesys Cloud Data Actions' }, (r) => ({ total: r.total, first: r.dataActions[0]?.name }));
await run('get_data_action_schema', { data_action: 'Get Estimated Wait Time' }, (r) => ({ name: r.name, inputs: Object.keys(r.inputSchema.properties || {}) }));
await run('list_knowledge_assets', {}, (r) => ({ kbs: r.knowledgeBases.length, settings: r.knowledgeSettings.length, sources: r.knowledgeSources.length, errors: r.errors }));
await run('ava_playbook', { stage: 'index' }, (r) => ({ version: r.version, stages: Object.keys(r.stages).length }));

if (readsOnly) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

console.log(`\n- AVA write chain (stamp ${stamp}) -`);
const avaName = `MCP_Test_AVA_${stamp}`;
const created = await run('create_ava', { name: avaName }, (r) => ({ created: r.created, id: r.id, slug: r.slug }));
if (!created) { console.log('cannot continue'); process.exit(1); }

const definition = {
  role: 'You are the outboundIQ support assistant. You help callers understand what outboundIQ does and route them to the right team. You do not quote prices.',
  instructions: [
    'Greet the caller briefly and ask how you can help.',
    'Answer questions about outboundIQ at a high level: it is an outbound contact center optimization platform.',
    'If the caller asks about pricing, explain that a sales representative will follow up, then offer to connect them.',
    'If the caller wants a human, say you will connect them and end the conversation.',
  ],
  guardrails: [{ rule: 'Block requests for competitor comparisons or disparagement of other vendors.', enabled: true }],
  events: {
    userExit: { message: 'Thanks for calling outboundIQ. Goodbye!' },
    escalation: { message: 'Let me connect you with a member of our team.' },
    guardrails: { message: 'I can only help with questions about outboundIQ.', violationThreshold: 3, violationThresholdCrossedMessage: 'Let me get you to a person who can help.' },
  },
  tools: [],
  types: [],
};
const version = await run('create_ava_version', { ava: created.id, definition }, (r) => ({ created: r.created, version: r.version, status: r.status, preflight: r.preflight }));
if (!version?.created) { console.log('cannot continue'); process.exit(1); }

const pub = await run('publish_ava_version', { ava: created.id, version: version.version }, (r) => ({ status: r.status, errors: r.errors, tokenCount: r.tokenCount }));
let status = pub?.status;
for (let i = 0; i < 10 && status && !['Succeeded', 'Failed'].includes(status); i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const j = await run('get_ava_publish_job', { ava: created.id, version: version.version, job_id: pub.jobId });
  status = j?.status;
}
await run('get_ava', { ava: avaName });
await run('get_ava_version', { ava: created.id, version: 'latest_saved' }, (r) => ({ version: r.version, status: r.status, guardrails: r.definition?.guardrails, events: r.definition?.events?.length }));

if (status === 'Succeeded') {
  const chat = await run('ava_chat_start', { ava: created.id, version: version.version }, (r) => ({ sessionId: r.sessionId, greeting: r.greeting, next: r.nextAction }));
  if (chat) {
    const t1 = await run('ava_chat_send', { ava: created.id, session_id: chat.sessionId, text: 'Hi, what does outboundIQ do?', previous_turn_id: chat.turnId, version: version.version }, (r) => ({ agentText: r.agentText, next: r.nextAction, terminal: r.isTerminal }));
    if (t1 && !t1.isTerminal) {
      await run('ava_chat_send', { ava: created.id, session_id: chat.sessionId, text: 'How much does it cost compared to Five9?', previous_turn_id: t1.turnId, version: version.version }, (r) => ({ agentText: r.agentText, guardrails: r.guardrails, next: r.nextAction }));
    }
    await run('ava_chat_end', { ava: created.id, session_id: chat.sessionId });
  }
  const runId = 'eval-run-e2e-001';
  const scen = await run('ava_run_scripted_scenario', {
    ava: created.id, version: version.version, slug: created.slug, run_id: runId, attempt: 1,
    scenario: {
      name: 'Pricing deflection', language: 'en-us', metadata: { id: 'pricing-deflection' },
      x_eval: {
        persona: 'Prospect', goal: 'Ask about pricing', attempts: 1, max_turns: 4,
        turns: [{ source: 'fixed_user', text: 'What does outboundIQ cost?' }, { source: 'fixed_agent', text: 'A sales representative will follow up about pricing.' }, { source: 'fixed_user', text: 'Ok, connect me to a person please.' }],
        reference_trajectory: [],
        rubric: [{ id: 'goal-1', dimension: 'goal', assertion: 'The agent deflects pricing to sales.' }],
      },
    },
  }, (r) => ({ ended: r.ended, turns: r.transcript.length, responseMatch: r.responseMatch.length, coverage: r.layer1.coverage, stored_as: r.stored_as }));
  if (scen?.stored_as) {
    await run('ava_record_verdicts', { slug: created.slug, run_id: runId, test_case_id: 'pricing-deflection', attempt: 1,
      layer2: [{ id: 'goal-1', dimension: 'goal', assertion: 'The agent deflects pricing to sales.', verdict: 'pass', evidence: scen.transcript.map((t) => t.text).join(' | ').slice(0, 200), reason: 'e2e' }, { id: 'tool-1', dimension: 'tool_use', verdict: 'pass' }, { id: 'gr-1', dimension: 'guardrail', verdict: 'pass' }, { id: 'tone-1', dimension: 'tone_format', verdict: 'pass' }],
      responseMatch: scen.responseMatch.map((m) => ({ ...m, verdict: 'pass' })) }, (r) => ({ recorded: r.recorded, warning: r.warning }));
    await run('ava_scorecard', { slug: created.slug, run_id: runId, version: version.version }, (r) => ({ summary: r.summary, warning: r.warning }));
  }
} else {
  console.log(`(skipping chat: publish status ${status})`);
}

console.log('\n- Knowledge Fabric -');
const kfName = `MCP_Test_KF_${stamp}`;
const cards = `> Target: AVA
> Scope: outboundIQ support

Audience: End user / Customer

Question: What does outboundIQ do?
Answer: outboundIQ is an outbound contact center optimization platform. It helps your team place compliant outbound calls, manage caller ID reputation, and see which numbers connect. A sales representative follows up on pricing, and the assistant can connect you to a person whenever you ask.
Notes: Pricing is handled by sales.
`;
await run('validate_knowledge', { files: [{ name: 'faqs.md', content: cards }] }, (r) => ({ ok: r.ok, cards: r.totals.cards, warns: r.totals.warns }));
const src = await run('ensure_knowledge_source', { name: kfName }, (r) => ({ id: r.id, created: r.created }));
let syncReady = false;
if (src) {
  const up = await run('upload_knowledge_documents', { source_id: src.id, sync_type: 'Full', confirm_full_replacement: true, files: [{ name: 'faqs.md', content: cards }] }, (r) => ({ workflowStatus: r.workflowStatus, status: r.status, ingestion: r.ingestionStatus, files: r.fileCount, error: r.error }));
  syncReady = up?.workflowStatus === 'upload_complete';
  for (let i = 0; i < 20 && up?.synchronizationId && !syncReady; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const s = await run('get_knowledge_sync', { source_id: src.id, synchronization_id: up.synchronizationId }, (r) => ({ status: r.status, ingestion: r.ingestionStatus, ready: r.ready, failed: r.failed }));
    if (s?.ready || s?.failed) { syncReady = Boolean(s.ready); break; }
  }
  if (syncReady) await run('ensure_knowledge_setting', { name: kfName, source_id: src.id, generation_language: 'en-US' }, (r) => ({ id: r.id, created: r.created, language: r.generationLanguage }));
  else console.log('(knowledge setting skipped: synchronization not ready)');
}

console.log('\n- Real data action -');
const daName = `MCP_Test_DA_${stamp}`;
await run('create_data_action', {
  integration: 'Genesys Cloud Data Actions', name: daName, category: 'MCP_Test', method: 'GET',
  url_template: '/api/v2/routing/queues/${input.QUEUE_ID}',
  input_schema: { properties: { QUEUE_ID: { type: 'string', description: 'Queue id' } }, required: ['QUEUE_ID'] },
  success_schema: { properties: { queue_name: { type: 'string' }, member_count: { type: 'integer' } } },
  translation_map: { queue_name: '$.name', member_count: '$.memberCount' },
}, (r) => ({ created: r.created, published: r.published, id: r.id }));
await run('get_data_action_schema', { data_action: daName }, (r) => ({ inputs: Object.keys(r.inputSchema.properties || {}), outputs: Object.keys(r.outputSchema.properties || {}) }));

console.log('\n- Deploy as a bot flow -');
// Architect's Call Agentic Virtual Agent action only accepts ProductionReady
// agents, so the wiring test promotes this throwaway test AVA. Nothing routes
// to it, so "production" is inert here; in real use the user says yes first.
if (status === 'Succeeded') {
  await run('publish_ava_version', { ava: created.id, version: version.version, production: true }, (r) => ({ status: r.status, requested: r.requested }));
}
const botFlowName = `MCP_Test_AVA_Bot_${stamp}`;
const bot = await run('build_ava_bot_flow', { spec: { name: botFlowName, ava: avaName, greeting: 'Connecting you to our assistant.' } }, (r) => ({ valid: r.valid, errors: r.errors, warnings: r.warnings, ava: r.ava?.status }));
if (bot?.valid) {
  const job = await run('publish_flow', { yaml: bot.yaml }, (r) => ({ status: r.status, flow: r.flow, messages: r.messages }));
  let st = job?.status;
  for (let i = 0; i < 12 && st && !['Success', 'Failure'].includes(st); i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const j = await run('get_flow_job', { job_id: job.jobId }, (r) => ({ status: r.status, messages: r.messages }));
    st = j?.status;
  }
  if (st === 'Success') await run('list_flows', {}, (r) => ({ botFlows: r.flows.filter((f) => f.type === 'BOT').map((f) => f.name) }));
}

console.log(`\n${pass} passed, ${fail} failed. Artifacts left in the org (this server never deletes): AVA "${avaName}", bot flow "${botFlowName}", knowledge source/setting "${kfName}", data action "${daName}". Clean with scripts/cleanup-test-artifacts.mjs --delete.`);
process.exit(fail ? 1 : 0);
