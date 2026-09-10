import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, normalizeDefinition, preflightDefinition, validateTrajectory, scoreAttempt, scoreScenario, computeScorecard,
  scorecardMarkdown, critiqueMarkdown, buildTurnRequest, summarizeTurn, mergeTurn, projectEvalCalls, runScriptedAttempt,
  validateAvaBotFlowSpec, avaBotFlowToArchyYaml, avaBotFlowToMermaid, AvaWorkspace, MemoryKV,
} from '../src/ava.js';
import { AVA_SKILLS, AVA_SKILLS_VERSION } from '../src/ava-playbooks.js';
import { AVA_TOOLS, AVA_PROMPTS, AVA_WRITE_TOOLS } from '../src/ava-tools.js';
import { TOOLS, WRITE_TOOLS, TOOL_GROUPS, callTool } from '../src/tools.js';
import { validateFlowSpec, specToArchyYaml, specToMermaid } from '../src/flows.js';
import { GenesysError } from '../src/genesys.js';

// ---------- vendored playbooks ----------

test('all eight Genesys AVA skills are vendored with their metadata intact', () => {
  const expected = ['ava-dispatch', 'ava-design', 'ava-knowledge', 'ava-build', 'ava-test', 'ava-evaluate', 'ava-critique', 'ava-analysis'];
  for (const k of expected) {
    assert.ok(AVA_SKILLS[k]?.skill, `missing ${k}`);
    assert.match(AVA_SKILLS[k].skill, /author: Genesys Cloud Services, Inc\./);
    assert.match(AVA_SKILLS[k].skill, /license: MIT/);
  }
  assert.match(AVA_SKILLS_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(AVA_SKILLS['ava-design'].references['design-constraints']);
  assert.ok(AVA_SKILLS['ava-analysis'].references['cookbook']);
});

test('ava_playbook prepends the hosted adapter and serves references verbatim', async () => {
  const text = await callTool({ configured: false }, 'ava_playbook', { stage: 'build' });
  assert.ok(text.startsWith('> **Hosted adapter'));
  assert.ok(text.includes(AVA_SKILLS['ava-build'].skill));
  const ref = await callTool({ configured: false }, 'ava_playbook', { stage: 'build', reference: 'sage-api-schema' });
  assert.equal(ref, AVA_SKILLS['ava-build'].references['sage-api-schema']);
  await assert.rejects(() => callTool({ configured: false }, 'ava_playbook', { stage: 'build', reference: 'nope' }), GenesysError);
});

// ---------- registry ----------

test('AVA tools are registered, grouped, and write-flagged', () => {
  const names = new Set(TOOLS.map((t) => t.name));
  for (const t of AVA_TOOLS) assert.ok(names.has(t.name), `${t.name} not registered`);
  const group = TOOL_GROUPS.find((g) => g.name.includes('AVA'));
  assert.ok(group);
  assert.deepEqual(group.tools, AVA_TOOLS.map((t) => t.name));
  for (const w of AVA_WRITE_TOOLS) assert.ok(WRITE_TOOLS.has(w), `${w} should be a write tool`);
  assert.ok(!WRITE_TOOLS.has('ava_playbook'));
  assert.ok(!WRITE_TOOLS.has('list_avas'));
  assert.ok(AVA_PROMPTS.length >= 5);
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length, 'tool names must be unique');
});

// ---------- naming ----------

test('slugify matches the playbook algorithm', () => {
  assert.equal(slugify('Acme Order Assistant'), 'acme-order-assistant');
  assert.equal(slugify('Happy Path - Check Balance'), 'happy-path-check-balance');
  assert.equal(slugify('  ---  '), 'ava');
});

// ---------- definition normalization + pre-flight ----------

const designArtifact = {
  _meta: { slug: 'demo', agent_id: null },
  name: 'Demo',
  role: 'You help customers check order status.',
  instructions: [{ content: 'Greet warmly' }, 'Confirm the order number'],
  guardrails: [{ rule: 'Do not discuss competitor pricing', enabled: true }],
  events: { userExit: { message: 'Bye' }, escalation: { message: 'Transferring' }, guardrails: { message: 'Cannot help', violationThreshold: 2, violationThresholdCrossedMessage: 'Handing off' } },
  tools: [{
    name: 'lookup_order', type: 'DataAction', description: 'Looks up an order', targetId: 'custom_-_abc', targetName: 'Order Lookup',
    preInstructions: 'Ask for the order number first', outcomeInstructions: 'Tell the caller the status',
    inputs: [{ targetName: 'orderId', type: 'OrderId', source: 'User', required: true }],
    output: 'OrderResult',
  }],
  types: ['Messaging', { name: 'OrderId', type: 'string', direction: 'input' }, { name: 'OrderResult', type: 'object', direction: 'output', properties: [{ name: 'status', type: 'string' }] }],
  configuration: { comfortStatement: { enabled: true } },
};

test('normalizeDefinition converts the design-artifact shape to the public API shape', () => {
  const d = normalizeDefinition(designArtifact);
  assert.ok(!('_meta' in d) && !('name' in d));
  assert.deepEqual(d.instructions, ['Greet warmly', 'Confirm the order number']);
  assert.deepEqual(d.guardrails, { custom: [{ instruction: 'Do not discuss competitor pricing', enabled: true }] });
  assert.equal(d.events.length, 3);
  assert.deepEqual(d.events.find((e) => e.type === 'Guardrails'), { type: 'Guardrails', message: 'Cannot help', violationThreshold: 2, violationThresholdCrossedMessage: 'Handing off' });
  const tool = d.tools[0];
  assert.deepEqual(tool.target, { id: 'custom_-_abc', name: 'Order Lookup' });
  assert.ok(!('targetId' in tool));
  assert.deepEqual(tool.inputInstructions, ['Ask for the order number first']);
  assert.deepEqual(tool.outputInstructions, [{ type: 'Python', when: 'True', then: 'Tell the caller the status' }]);
  assert.equal(d.types.length, 2, 'channel strings are dropped');
  assert.deepEqual(d.settings, { comfortStatement: { enabled: true } });
  assert.ok(!('configuration' in d));
  // Idempotent.
  assert.deepEqual(normalizeDefinition(d), d);
});

test('normalizeDefinition keeps {rules} guardrails, lambda output instructions, and string instructions', () => {
  const d = normalizeDefinition({
    role: 'r', instructions: ['a'],
    guardrails: { rules: [{ rule: 'x', enabled: false }] },
    tools: [{ name: 't', type: 'KnowledgeSetting', description: 'd', target: { id: '1', name: 'n' }, outputInstructions: [{ when: 'lambda result: len(result) == 0', then: 'none' }, 'plain'] }],
  });
  assert.deepEqual(d.guardrails.custom, [{ instruction: 'x', enabled: false }]);
  assert.deepEqual(d.tools[0].outputInstructions, [
    { type: 'Python', when: 'lambda result: len(result) == 0', then: 'none' },
    { type: 'Python', when: 'True', then: 'plain' },
  ]);
});

test('preflight passes a correct definition and reports warnings only', () => {
  const pre = preflightDefinition(normalizeDefinition(designArtifact));
  assert.equal(pre.ok, true, pre.errors.join('; '));
});

test('preflight blocks the classic ToolOutput and Start Context mistakes (L5, T8, L11, L13, L14, T7, L15, N2)', () => {
  const bad = normalizeDefinition({
    role: 'r', instructions: ['a'], events: [{ type: 'UserExit', message: 'bye' }],
    tools: [
      { name: 'auth', type: 'DataAction', description: 'd', target: { id: 'custom_-_1', name: 'Auth' }, inputs: [{ targetName: 'code', type: 'string', source: 'User' }], output: 'AuthResult' },
      { name: 'acct', type: 'DataAction', description: 'd', target: { id: 'custom_-_2', name: 'Acct' }, inputs: [
        { targetName: 'token', type: 'string', source: 'ToolOutput', mapping: ['AuthResult', 'token'] },
        { targetName: 'cust', type: 'CustomerId', source: 'External', required: true },
      ], output: 'Missing' },
    ],
    types: [
      { name: 'AuthResult', type: 'object', properties: [{ name: 'token', type: 'string' }] },
      { name: 'Status', type: 'string', enum: ['Expiring Soon'] },
      { name: 'InputData', type: 'object', direction: 'agentInput', description: 'nope', properties: [{ name: 'customerId', type: 'string', required: true }] },
    ],
  });
  const pre = preflightDefinition(bad);
  assert.equal(pre.ok, false);
  const joined = pre.errors.join('\n');
  assert.match(joined, /input 'code' has type "string" with source User/);
  assert.match(joined, /input 'token' has type "string" with source ToolOutput/);
  assert.match(joined, /output type 'AuthResult' is missing direction: "output"/);
  assert.match(joined, /references output type 'Missing' which is not declared/);
  assert.match(joined, /External required input 'cust'.*fallbackToUser/);
  assert.match(joined, /type 'CustomerId' is not declared as a Start Context property/);
  assert.match(joined, /Enum type 'Status' has invalid value 'Expiring Soon'/);
  assert.match(joined, /reserved `description` field/);
  assert.match(joined, /'customerId' has required: true/);
  assert.match(joined, /references a bare primitive/);
  assert.match(joined, /property name 'customerId' is invalid/);
});

// ---------- Layer 1 + scoring ----------

test('validateTrajectory computes coverage, order, params, and violations deterministically', () => {
  const ref = [
    { tool: 'AuthenticateUser', params: { loginCode: '12345678' }, match: 'exact', order: 1 },
    { tool: 'GetAccountBalance', params: { accountId: '' }, match: 'presence', order: 2 },
    { tool: 'SendReceipt' },
  ];
  const actual = [{ name: 'GetAccountBalance', input: { accountId: 'A1' } }, { name: 'AuthenticateUser', input: { loginCode: '00000000' } }, { name: 'Extra', input: {} }];
  const r = validateTrajectory(ref, actual, [{ violated: true, type: 'Guardrails' }, { violated: false }]);
  assert.equal(r.coverage, 2 / 3);
  assert.deepEqual(r.matchedTools, ['AuthenticateUser', 'GetAccountBalance']);
  assert.deepEqual(r.missingTools, ['SendReceipt']);
  assert.deepEqual(r.unexpectedTools, ['Extra']);
  assert.equal(r.orderOk, false);
  assert.equal(r.paramMismatches.length, 1);
  assert.equal(r.paramMismatches[0].param, 'loginCode');
  assert.equal(r.guardrailViolations.length, 1);
  assert.equal(validateTrajectory([], [], []).coverage, 1);
});

test('scoreAttempt blends Layer 1 with Layer 2 per the rubric and guardrail violations cap the dimension', () => {
  const verdicts = [
    { dimension: 'goal', verdict: 'pass' }, { dimension: 'tool_use', verdict: 'pass' },
    { dimension: 'guardrail', verdict: 'pass' }, { dimension: 'tone_format', verdict: 'fail' },
  ];
  const clean = scoreAttempt({ coverage: 1, orderOk: true, guardrailViolations: [] }, verdicts);
  assert.deepEqual(clean.dimensionScores, { goal: 1, tool_use: 1, guardrail: 1, responseMatch: 1, tone_format: 0 });
  assert.equal(clean.pass, false, 'tone_format below threshold fails the attempt');
  assert.equal(clean.weightedScore, 0.95);
  const violated = scoreAttempt({ coverage: 0.5, orderOk: false, guardrailViolations: [{ violated: true }] }, verdicts);
  assert.equal(violated.dimensionScores.guardrail, 0);
  assert.equal(violated.dimensionScores.tool_use, 0.625);
  assert.equal(scoreScenario([{ pass: true }, { pass: false }], 0.5).verdict, 'pass');
  assert.equal(scoreScenario([{ pass: true }], 0.8, 2).successRate, 0.5);
});

test('computeScorecard classifies pass, fail, and infraError and renders Markdown', () => {
  const good = [{ dimension: 'goal', verdict: 'pass' }, { dimension: 'tool_use', verdict: 'pass' }, { dimension: 'guardrail', verdict: 'pass' }, { dimension: 'tone_format', verdict: 'pass' }];
  const sc = computeScorecard({
    runId: 'eval-run-2026-09-08-001', agentId: 'agt', version: '1.0',
    perScenario: [
      { testCaseId: 'happy', name: 'Happy', attempts: [{ attempt: 1, ended: 'goal', layer1: { coverage: 1, orderOk: true }, layer2: good }] },
      { testCaseId: 'broken', name: 'Broken', attempts: [{ attempt: 1, ended: 'goal', layer1: {}, layer2: [] }] },
      { testCaseId: 'weak', name: 'Weak', threshold: 1, attempts: [{ attempt: 1, ended: 'goal', layer1: {}, layer2: [{ dimension: 'goal', verdict: 'fail' }] }] },
    ],
  });
  assert.deepEqual(sc.summary, { total: 3, passed: 1, failed: 1, infraError: 1 });
  assert.equal(sc.perScenario[1].attempts[0].error, 'missing_layer2_verdicts');
  assert.equal(sc.metadata.rubricVersion, '1.0');
  const md = scorecardMarkdown(sc);
  assert.match(md, /# AVA Evaluation Scorecard/);
  assert.match(md, /Happy: PASS/);
  assert.match(md, /Broken: INFRA ERROR/);
  assert.match(md, /Weak: FAIL/);
});

test('critiqueMarkdown resolves the overall status from the findings', () => {
  const r = critiqueMarkdown({ target: 'agt', summary: { prose: 'Fine.', top_priorities: ['Narrow AuthResult'] }, errors: [], warnings: [{ category: 'Tools', finding: 'Wide output', evidence: 'AuthResult has 8 fields', fix: 'Return the token only', source: 'cookbook/09a' }], info: [] });
  assert.equal(r.overall, 'Needs work');
  assert.deepEqual(r.counts, { errors: 0, warnings: 1, info: 0, positives: 0 });
  assert.match(r.markdown, /\[Tools\] Wide output/);
  assert.equal(critiqueMarkdown({}).overall, 'Ready to publish');
});

// ---------- chat turns ----------

test('turn request shapes follow the preview session API', () => {
  assert.deepEqual(buildTurnRequest({ text: null, version: '1.0' }), { inputEvent: { type: 'NoOp', mode: 'Text' }, version: '1.0' });
  const r = buildTurnRequest({ text: 'hi', previousTurnId: 't1', version: '1.0' });
  assert.equal(r.inputEvent.type, 'UserInput');
  assert.equal(r.inputEvent.alternatives[0].transcript.text, 'hi');
  assert.deepEqual(r.previousTurn, { id: 't1' });
});

test('summarizeTurn and mergeTurn accumulate NoOp continuations', () => {
  const first = { id: 't1', prompts: { text: { segments: [{ text: 'One' }] } }, nextAction: { type: 'NoOp' }, events: { toolCalls: [{ name: 'A', input: {} }], toolResults: [], errors: [] } };
  const cont = { id: 't2', prompts: { text: { segments: [{ text: 'Two' }] } }, nextAction: { type: 'Exit' }, events: { toolCalls: [], toolResults: [{ name: 'A', output: 'ok' }], errors: [], guardrails: { violated: false } } };
  const merged = summarizeTurn(mergeTurn(first, cont));
  assert.equal(merged.turnId, 't2');
  assert.equal(merged.agentText, 'One Two');
  assert.equal(merged.toolCalls.length, 1);
  assert.equal(merged.toolResults.length, 1);
  assert.equal(merged.isTerminal, true);
});

test('projectEvalCalls follows sum(attempts x (max_turns + 2))', () => {
  assert.equal(projectEvalCalls([{ x_eval: { attempts: 2, max_turns: 5 } }, { x_eval: {} }]), 2 * 7 + 12);
});

test('runScriptedAttempt plays fixed_user turns, records fixed_agent matches, and stops at terminal', async () => {
  const replies = [
    { turnId: 'g', agentText: 'Hello! How can I help?', toolCalls: [], toolResults: [], guardrails: null, errors: [], nextAction: 'WaitForInput', isTerminal: false },
    { turnId: 'a1', agentText: 'Sure, what is your code?', toolCalls: [], toolResults: [], guardrails: null, errors: [], nextAction: 'WaitForInput', isTerminal: false },
    { turnId: 'a2', agentText: 'Your balance is $42.', toolCalls: [{ name: 'GetBalance', input: { code: '1234' } }], toolResults: [], guardrails: { violated: false }, errors: [], nextAction: 'Exit', isTerminal: true },
  ];
  let i = 0;
  const sent = [];
  const r = await runScriptedAttempt(
    { turns: [{ source: 'fixed_user', text: 'balance?' }, { source: 'fixed_agent', text: 'What is your code?' }, { source: 'fixed_user', text: '1234' }, { source: 'fixed_user', text: 'thanks' }], maxTurns: 10, referenceTrajectory: [{ tool: 'GetBalance', params: { code: '1234' }, match: 'exact', order: 1 }] },
    { startSession: async () => replies[i++], sendTurn: async (text, prev) => { sent.push([text, prev]); return replies[i++]; } },
  );
  assert.equal(r.ended, 'terminal');
  assert.deepEqual(sent, [['balance?', 'g'], ['1234', 'a1']]);
  assert.equal(r.responseMatch.length, 1);
  assert.equal(r.responseMatch[0].actual, 'Sure, what is your code?');
  assert.equal(r.layer1.coverage, 1);
  assert.equal(r.layer1.paramMismatches.length, 0);
  assert.equal(r.transcript.filter((t) => t.role === 'user').length, 2);
});

// ---------- bot flow composer + inbound wiring ----------

test('avaBotFlowToArchyYaml emits a virtual-agent-enabled bot flow calling the agent', () => {
  const spec = { name: 'Billing Agent Flow', ava: 'Billing Assistant', greeting: 'Hi there', inputs: { customer_id: { exp: 'Call.Ani' }, plan_name: 'Gold', region_code: { noValue: true } }, outputs: { resolution_code: 'Flow.resolution' } };
  assert.equal(validateAvaBotFlowSpec(spec).ok, true);
  const y = avaBotFlowToArchyYaml(spec);
  assert.match(y, /^botFlow:\n  name: 'Billing Agent Flow'/);
  assert.match(y, /virtualAgentEnabled: true/);
  assert.match(y, /settingsVirtualAgent:/);
  assert.match(y, /- callAgenticVirtualAgent:\n {14}name: 'Call Billing Assistant'\n {14}agenticVirtualAgent:\n {16}'Billing Assistant':\n {18}ver_latestPublished:/);
  assert.match(y, /customer_id:\n {24}exp: 'Call.Ani'/);
  assert.match(y, /plan_name:\n {24}lit: 'Gold'/);
  assert.match(y, /region_code:\n {24}noValue: true/);
  assert.match(y, /resolution_code:\n {24}var: Flow.resolution/);
  assert.match(y, /exitReason:\n {22}var: Flow.exitReason/);
  assert.match(y, /- exitBotFlow:/);
  assert.match(y, /name: Flow.resolution/);
  assert.match(avaBotFlowToMermaid(spec), /AVA: Billing Assistant/);
  assert.equal(validateAvaBotFlowSpec({ name: 'x' }).ok, false);
});

test('inbound call flows have no bot-flow choice (bot flow OR IVR, never chained through a paid TTS engine)', () => {
  const bad = validateFlowSpec({ name: 'Main IVR', greeting: 'Welcome', menu: { prompt: 'p', choices: [{ dtmf: 1, action: 'virtual_agent', bot_flow: 'x' }] } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /action must be one of/);
  const y = specToArchyYaml({ name: 'Main IVR', greeting: 'Welcome', menu: { prompt: 'p', choices: [{ dtmf: 1, action: 'transfer_to_queue', queue: 'Billing' }] } });
  assert.ok(!y.includes('callBotFlow') && !y.includes('textToSpeech'));
});

// ---------- workspace ----------

test('AvaWorkspace stores artifacts, enforces keys, and maintains the index', async () => {
  const ws = new AvaWorkspace(new MemoryKV());
  await ws.put('acme-orders', 'design', undefined, { name: 'Acme Orders', _meta: { slug: 'acme-orders', local_status: 'design-complete' } });
  await ws.put('acme-orders', 'agent', undefined, { agent_name: 'Acme Orders', version: '1.0', publish_status: 'TestReady', _meta: { agent_id: 'agt-1' } });
  await ws.put('acme-orders', 'test_case', 'happy-path', { name: 'Happy' });
  await ws.put('acme-orders', 'attempt', 'eval-run-2026-09-08-001/happy-path/attempt-1', { attempt: 1, ended: 'goal', layer1: {}, layer2: [{ dimension: 'goal', verdict: 'pass' }] });
  const idx = await ws.index();
  assert.equal(idx.avas.length, 1);
  assert.equal(idx.avas[0].agent_id, 'agt-1');
  assert.equal(idx.avas[0].local_status, 'test-ready');
  assert.equal((await ws.get('acme-orders', 'design')).name, 'Acme Orders');
  assert.equal(await ws.get('acme-orders', 'test_case', 'nope'), null);
  const all = await ws.list('acme-orders');
  assert.equal(all.length, 4);
  const attempts = await ws.list('acme-orders', 'attempt');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].id, 'eval-run-2026-09-08-001/happy-path/attempt-1');
  await assert.rejects(() => ws.put('Bad Slug', 'design', undefined, {}), GenesysError);
  await assert.rejects(() => ws.put('ok', 'test_case', undefined, {}), GenesysError);
  await assert.rejects(() => ws.put('ok', 'bogus', 'x', {}), GenesysError);
});

test('ava_scorecard tool scores persisted attempts through the registry', async () => {
  const cfg = { configured: false, kv: new MemoryKV() };
  const good = [{ dimension: 'goal', verdict: 'pass' }, { dimension: 'tool_use', verdict: 'pass' }, { dimension: 'guardrail', verdict: 'pass' }, { dimension: 'tone_format', verdict: 'pass' }];
  await callTool(cfg, 'ava_workspace_put', { slug: 'demo', kind: 'attempt', id: 'run-1/happy/attempt-1', data: { name: 'Happy', threshold: 0.8, attempt: 1, ended: 'goal', layer1: { coverage: 1, orderOk: true }, layer2: good } });
  await callTool(cfg, 'ava_workspace_put', { slug: 'demo', kind: 'attempt', id: 'run-1/happy/attempt-2', data: { name: 'Happy', threshold: 0.8, attempt: 2, ended: 'max_turns', layer1: {}, layer2: good } });
  const r = await callTool(cfg, 'ava_scorecard', { slug: 'demo', run_id: 'run-1', ava: 'agt', version: '1.0' });
  // Attempt 2 hit max_turns: scored (not an infra error) but recorded as not passed, so 1/2 < 0.8 fails the scenario.
  assert.deepEqual(r.summary, { total: 1, passed: 0, failed: 1, infraError: 0 });
  const [a1, a2] = r.scorecard.perScenario[0].attempts;
  assert.equal(a1.pass, true);
  assert.equal(a2.pass, false);
  assert.equal(a2.status, 'scored');
  assert.match(a2.note, /max_turns/);
  const stored = await callTool(cfg, 'ava_workspace_get', { slug: 'demo', kind: 'scorecard', id: 'run-1' });
  assert.equal(stored.found, true);
  await assert.rejects(() => callTool(cfg, 'ava_scorecard', { slug: 'demo', run_id: 'run-9', version: '1.0' }), GenesysError);
});

test('unjudged attempts score as a named infra error and ava_record_verdicts merges judgments in place', async () => {
  const cfg = { configured: false, kv: new MemoryKV() };
  const good = [{ dimension: 'goal', verdict: 'pass' }, { dimension: 'tool_use', verdict: 'pass' }, { dimension: 'guardrail', verdict: 'pass' }, { dimension: 'tone_format', verdict: 'pass' }];
  await callTool(cfg, 'ava_workspace_put', { slug: 'Demo Bot', kind: 'attempt', id: 'run-2/happy/attempt-1', data: { name: 'Happy', threshold: 0.8, attempt: 1, ended: 'goal', layer1: {}, layer2: null, responseMatch: [{ id: 'rm-1', dimension: 'responseMatch', verdict: 'pending' }], transcript: [{ role: 'user', text: 'hi' }], agentId: 'agt-9' } });
  const first = await callTool(cfg, 'ava_scorecard', { slug: 'demo-bot', run_id: 'run-2', version: '1.0' });
  assert.deepEqual(first.summary, { total: 1, passed: 0, failed: 0, infraError: 1 });
  assert.equal(first.scorecard.perScenario[0].attempts[0].error, 'layer2_not_judged');
  assert.equal(first.scorecard.agentId, 'agt-9', 'agent id comes from the stored attempt when not passed');
  assert.match(first.warning, /Unjudged attempts/);
  await assert.rejects(() => callTool(cfg, 'ava_record_verdicts', { slug: 'demo-bot', run_id: 'run-2', test_case_id: 'happy', attempt: 1, layer2: [{ dimension: 'goal', verdict: 'maybe' }] }), /pass, fail, or uncertain/);
  const rec = await callTool(cfg, 'ava_record_verdicts', { slug: 'Demo Bot', run_id: 'run-2', test_case_id: 'happy', attempt: 1, layer2: good });
  assert.match(rec.warning, /still pending/);
  const stillPending = await callTool(cfg, 'ava_scorecard', { slug: 'demo-bot', run_id: 'run-2', version: '1.0' });
  assert.equal(stillPending.scorecard.perScenario[0].attempts[0].error, 'response_match_not_judged');
  await callTool(cfg, 'ava_record_verdicts', { slug: 'demo-bot', run_id: 'run-2', test_case_id: 'happy', attempt: 1, layer2: good, responseMatch: [{ id: 'rm-1', dimension: 'responseMatch', verdict: 'pass' }] });
  const done = await callTool(cfg, 'ava_scorecard', { slug: 'demo-bot', run_id: 'run-2', version: '1.0' });
  assert.deepEqual(done.summary, { total: 1, passed: 1, failed: 0, infraError: 0 });
  const stored = await callTool(cfg, 'ava_workspace_get', { slug: 'demo-bot', kind: 'attempt', id: 'run-2/happy/attempt-1' });
  assert.equal(stored.data.transcript.length, 1, 'merge keeps the transcript');
  await assert.rejects(() => callTool(cfg, 'ava_record_verdicts', { slug: 'demo-bot', run_id: 'run-2', test_case_id: 'nope', attempt: 1, layer2: good }), /No stored attempt/);
});

test('runs that never produced a transcript are infra errors by their end reason, not "not judged"', () => {
  const sc = computeScorecard({ runId: 'r', agentId: 'a', version: '1', perScenario: [
    { testCaseId: 'x', name: 'x', attempts: [{ attempt: 1, ended: 'time_budget', layer1: {}, layer2: null }, { attempt: 2, ended: 'error', layer1: {}, layer2: [{ dimension: 'goal', verdict: 'pass' }] }] },
  ] });
  assert.deepEqual(sc.perScenario[0].attempts.map((t) => t.error), ['ended_time_budget', 'ended_error']);
});

test('record_verdicts validates key shapes and responseMatch verdicts, and maintains the run manifest', async () => {
  const cfg = { configured: false, kv: new MemoryKV() };
  await callTool(cfg, 'ava_workspace_put', { slug: 'demo', kind: 'attempt', id: 'run-3/happy/attempt-1', data: { name: 'Happy', attempt: 1, ended: 'goal', layer1: {}, layer2: null } });
  await assert.rejects(() => callTool(cfg, 'ava_record_verdicts', { slug: 'demo', run_id: 'run 3', test_case_id: 'happy', attempt: 1, layer2: [] }), /one path segment/);
  await assert.rejects(() => callTool(cfg, 'ava_record_verdicts', { slug: 'demo', run_id: 'run-3', test_case_id: 'happy', attempt: 1, layer2: [{ dimension: 'goal', verdict: 'pass' }], responseMatch: [{ verdict: 'match' }] }), /responseMatch verdicts must be/);
  const r = await callTool(cfg, 'ava_record_verdicts', { slug: 'demo', run_id: 'run-3', test_case_id: 'happy', attempt: 1, layer2: [{ dimension: 'goal', verdict: 'pass' }, { dimension: 'tool_use', verdict: 'pass' }, { dimension: 'guardrail', verdict: 'pass' }, { dimension: 'tone_format', verdict: 'pass' }] });
  assert.equal(r.key, 'ava:ws:demo:attempt:run-3/happy/attempt-1');
  const manifest = await callTool(cfg, 'ava_workspace_get', { slug: 'demo', kind: 'note', id: 'run-manifest/run-3' });
  assert.deepEqual(manifest.data.attempts, ['run-3/happy/attempt-1']);
  // The scorecard finds the attempt through the manifest even if the prefix listing lagged.
  const noList = { ...cfg, kv: Object.assign(Object.create(Object.getPrototypeOf(cfg.kv)), cfg.kv, { list: async () => ({ keys: [], list_complete: true }) }) };
  const sc = await callTool(noList, 'ava_scorecard', { slug: 'demo', run_id: 'run-3', version: '1.0' });
  assert.deepEqual(sc.summary, { total: 1, passed: 1, failed: 0, infraError: 0 });
  await assert.rejects(() => callTool(cfg, 'ava_scorecard', { slug: 'demo', run_id: 'bad/run', version: '1.0' }), /one path segment/);
});

test('workspace tools refuse to run without the KV binding instead of silently forgetting', async () => {
  await assert.rejects(() => callTool({ configured: false }, 'ava_workspace_put', { slug: 'x', kind: 'design', data: {} }), /CONFIG KV namespace/);
});

test('re-saving a design never wipes the index fields the build stage recorded', async () => {
  const ws = new AvaWorkspace(new MemoryKV());
  await ws.put('acme', 'agent', undefined, { agent_name: 'Acme', version: '2.0', publish_status: 'TestReady', _meta: { agent_id: 'agt-2' } });
  await ws.put('acme', 'design', undefined, { role: 'r', instructions: ['a'] });
  const entry = (await ws.index()).avas.find((a) => a.slug === 'acme');
  assert.equal(entry.agent_id, 'agt-2');
  assert.equal(entry.gc_version, '2.0');
  assert.equal(entry.name, 'Acme');
  assert.equal(entry.local_status, 'design-complete');
  await ws.merge('acme', 'design', undefined, { guardrails: [] });
  assert.deepEqual((await ws.get('acme', 'design')).instructions, ['a']);
});

test('a truncated agent turn ends the attempt with time_budget and tool results are kept for the judge', async () => {
  const base = { turnId: 'g', agentText: 'hi', toolCalls: [], toolResults: [], guardrails: null, errors: [], nextAction: 'WaitForInput', isTerminal: false };
  const withTools = { ...base, turnId: 'a1', agentText: 'Your balance is $42', toolCalls: [{ name: 'GetBalance', input: { id: '1' } }], toolResults: [{ name: 'GetBalance', output: { balance: 42 } }] };
  const cut = { ...base, turnId: 'a2', agentText: 'Let me check', truncated: true };
  let i = 0;
  const replies = [withTools, cut, base];
  const r = await runScriptedAttempt(
    { turns: [{ source: 'fixed_user', text: 'balance?' }, { source: 'fixed_user', text: 'and my history?' }, { source: 'fixed_user', text: 'thanks' }], maxTurns: 10, referenceTrajectory: [{ tool: 'GetBalance' }] },
    { startSession: async () => base, sendTurn: async () => replies[i++] },
  );
  assert.equal(r.ended, 'time_budget');
  assert.equal(r.transcript.filter((t) => t.role === 'user').length, 2, 'stops after the truncated turn');
  assert.deepEqual(r.toolResults, [{ name: 'GetBalance', output: { balance: 42 } }]);
  assert.ok(r.transcript.some((t) => t.role === 'tool' && /GetBalance/.test(t.text)));
  assert.ok(r.transcript.some((t) => t.role === 'system' && /truncated/.test(t.text)));
  // The script running out while the agent still waits is turns_exhausted, scored on its merits.
  const done = await runScriptedAttempt({ turns: [{ source: 'fixed_user', text: 'hi' }], maxTurns: 10 }, { startSession: async () => base, sendTurn: async () => base });
  assert.equal(done.ended, 'turns_exhausted');
  const sc = computeScorecard({ runId: 'r', agentId: 'a', version: '1', perScenario: [{ testCaseId: 'x', name: 'x', attempts: [{ attempt: 1, ended: 'turns_exhausted', layer1: {}, layer2: [{ dimension: 'goal', verdict: 'pass' }, { dimension: 'tool_use', verdict: 'pass' }, { dimension: 'guardrail', verdict: 'pass' }, { dimension: 'tone_format', verdict: 'pass' }] }] }] });
  assert.equal(sc.perScenario[0].attempts[0].pass, true);
});

test('misspelled or missing rubric dimensions never score as a pass', async () => {
  const sc = computeScorecard({ runId: 'r', agentId: 'a', version: '1', perScenario: [{ testCaseId: 'x', name: 'x', attempts: [
    { attempt: 1, ended: 'terminal', layer1: {}, layer2: [{ dimension: 'guardrails', verdict: 'fail' }, { dimension: 'goals', verdict: 'fail' }] },
  ] }] });
  assert.equal(sc.perScenario[0].attempts[0].status, 'infraError');
  assert.equal(sc.perScenario[0].attempts[0].error, 'unparseable_layer2_verdicts');
  const cfg = { configured: false, kv: new MemoryKV() };
  await callTool(cfg, 'ava_workspace_put', { slug: 'demo', kind: 'attempt', id: 'run-4/happy/attempt-1', data: { attempt: 1, ended: 'terminal', layer1: {}, layer2: null } });
  await assert.rejects(() => callTool(cfg, 'ava_record_verdicts', { slug: 'demo', run_id: 'run-4', test_case_id: 'happy', attempt: 1, layer2: [] }), /at least one judged rubric assertion/);
  await assert.rejects(() => callTool(cfg, 'ava_record_verdicts', { slug: 'demo', run_id: 'run-4', test_case_id: 'happy', attempt: 1, layer2: [{ dimension: 'guardrails', verdict: 'fail' }] }), /must carry dimension/);
});

test('a fixed_agent expectation after the agent\'s terminal goodbye is still recorded', async () => {
  const base = { turnId: 'g', agentText: 'hi', toolCalls: [], toolResults: [], guardrails: null, errors: [], nextAction: 'WaitForInput', isTerminal: false };
  const bye = { ...base, turnId: 'a1', agentText: 'Connecting you now. Goodbye!', nextAction: 'Exit', isTerminal: true };
  const r = await runScriptedAttempt(
    { turns: [{ source: 'fixed_user', text: 'connect me to a person' }, { source: 'fixed_agent', text: 'Connecting you now. Goodbye!' }], maxTurns: 10 },
    { startSession: async () => base, sendTurn: async () => bye },
  );
  assert.equal(r.ended, 'terminal');
  assert.equal(r.responseMatch.length, 1);
  assert.equal(r.responseMatch[0].actual, 'Connecting you now. Goodbye!');
});

test('bot flow spec rejects malformed context keys and variable names before they reach Archy', () => {
  const ok = validateAvaBotFlowSpec({ name: 'x', ava: 'y', inputs: { customer_id: 'a' }, outputs: { 'Marketname.nearest': 'Flow.market' } });
  assert.equal(ok.ok, true, ok.errors.join('; '));
  const bad = validateAvaBotFlowSpec({ name: 'x', ava: 'y', inputs: { 'Customer Id': 'a' }, outputs: { res: 'Flow.my var' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /inputs key "Customer Id"/);
  assert.match(bad.errors.join(), /outputs.res must name a flow variable/);
});

test('normalizeDefinition drops workspace bookkeeping and the scripted runner honors its time budget', async () => {
  const d = normalizeDefinition({ role: 'r', instructions: ['a'], _meta: { slug: 'x' }, _stored_at: 'now' });
  assert.ok(!('_stored_at' in d) && !('_meta' in d));
  const reply = { turnId: 'g', agentText: 'hi', toolCalls: [], toolResults: [], guardrails: null, errors: [], nextAction: 'WaitForInput', isTerminal: false };
  const r = await runScriptedAttempt(
    { turns: [{ source: 'fixed_user', text: 'a' }, { source: 'fixed_user', text: 'b' }], maxTurns: 10, deadline: Date.now() - 1 },
    { startSession: async () => reply, sendTurn: async () => reply },
  );
  assert.equal(r.ended, 'time_budget');
  assert.equal(r.transcript.filter((t) => t.role === 'user').length, 0);
});
