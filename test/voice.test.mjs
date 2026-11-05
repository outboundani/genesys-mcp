import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFlowSpec, specToArchyYaml, specToMermaid, handoffOutput } from '../src/flows.js';
import { VOICE_TOOLS, ELEVENLABS_BASE_URIS } from '../src/voice-tools.js';
import { TOOLS, WRITE_TOOLS, TOOL_GROUPS } from '../src/tools.js';

const voiceSpec = {
  name: 'Front Desk Voice Agent',
  voice_agent: {
    connector: 'ElevenLabs',
    agent_id: 'agent_01abc',
    name: 'outboundIQ Front Desk',
    outputs: ['transfer_to', 'caller_name', 'reason', 'summary'],
    handoff: { queue: 'outboundIQ Support' },
  },
};

test('voice_agent spec validates without a greeting or menu', () => {
  assert.deepEqual(validateFlowSpec(voiceSpec), { ok: true, errors: [] });
});

test('voice_agent validation catches the common mistakes', () => {
  const v = validateFlowSpec({
    name: 'x',
    menu: { prompt: 'p', choices: [] },
    hours: { schedule_group: 'g', closed_message: 'c' },
    voice_agent: { agent_id: 'has spaces', outputs: ['ok', '9bad', 'ok'], handoff: { when: 'nope' }, fallback: 'maybe', pass_caller_number: 'yes', inputs: { 'bad-name': 1 } },
  });
  assert.equal(v.ok, false);
  const all = v.errors.join(' | ');
  for (const re of [/OR menu/, /hours are not supported/, /connector/, /plain id/, /"9bad"/, /duplicate "ok"/, /handoff\.queue/, /handoff\.when "nope"/, /fallback must be/, /pass_caller_number/, /"bad-name"/, /inputs\.bad-name must be a string/]) {
    assert.match(all, re);
  }
});

test('handoff without outputs is rejected; handoff output defaults to transfer_to', () => {
  const v = validateFlowSpec({ name: 'x', voice_agent: { connector: 'E', agent_id: 'a', handoff: { queue: 'Q' } } });
  assert.match(v.errors.join(' '), /at least one output/);
  assert.equal(handoffOutput({ outputs: ['reason', 'transfer_to'] }), 'transfer_to');
  assert.equal(handoffOutput({ outputs: ['wants_human'] }), 'wants_human');
  assert.equal(handoffOutput({ outputs: ['a', 'b'], handoff: { when: 'b' } }), 'b');
});

test('voice_agent YAML matches the Architect export shape', () => {
  const y = specToArchyYaml(voiceSpec);
  assert.match(y, /startUpRef: "\/inboundCall\/tasks\/task\[voiceAgent\]"/);
  assert.match(y, /exp: 'AudioPlaybackOptions\(ToAudioBlank\(100\), false\)'/); // silent greeting, no warning
  assert.match(y, /- callAudioConnector:\n {14}name: 'outboundIQ Front Desk'/);
  assert.match(y, /sessionVariables:\n {16}- sessionVariable:\n {20}name:\n {22}lit: 'caller_number'\n {20}value:\n {22}exp: ToString\(Call\.Ani\)/);
  assert.match(y, /- outputSessionVariable:\n {20}name:\n {22}lit: 'transfer_to'\n {20}variable: Flow\.ai_transfer_to/);
  assert.match(y, /integration:\n {16}'ElevenLabs':\n {18}connectorId:\n {20}lit: 'agent_01abc'/);
  assert.match(y, /lit: 'AI caller name'/);
  assert.match(y, /IsSet\(Flow\.ai_transfer_to\) and Flow\.ai_transfer_to != "" and Flow\.ai_transfer_to != "false"/);
  assert.match(y, /targetTaskRef: "\/inboundCall\/tasks\/task\[handoff\]"/);
  assert.match(y, /failureOutputs:\n {20}errorType:\n {22}var: Task\.voiceAgentErrorType/);
  assert.match(y, /- transferToAcd:[\s\S]*name: 'outboundIQ Support'/);
  assert.doesNotMatch(y, /menus:/);
  // Flow variables are declared once per output.
  assert.equal((y.match(/- stringVariable:/g) || []).length, 4);
});

test('voice_agent without handoff disconnects on failure and keeps the success path non-empty', () => {
  const y = specToArchyYaml({ name: 'x', greeting: 'Hi there', voice_agent: { connector: 'E', agent_id: 'a', pass_caller_number: false } });
  assert.match(y, /tts: 'Hi there'/);
  assert.doesNotMatch(y, /sessionVariables:/);
  assert.match(y, /- disconnect:\n {28}name: Voice agent finished/);
  assert.doesNotMatch(y, /task\[handoff\]/);
});

test('voice_agent inputs pass literal session variables', () => {
  const y = specToArchyYaml({ name: 'x', voice_agent: { connector: 'E', agent_id: 'a', inputs: { brand: "Joe's Plumbing" } } });
  assert.match(y, /lit: 'brand'\n {20}value:\n {22}lit: 'Joe''s Plumbing'/);
});

test('voice_agent Mermaid shows the agent, saved outputs, decision and queue', () => {
  const m = specToMermaid(voiceSpec);
  assert.match(m, /🎙️ outboundIQ Front Desk/);
  assert.match(m, /Saved for the agent: transfer_to, caller_name, reason, summary/);
  assert.match(m, /dec -->\|yes\| q/);
  assert.match(m, /va -.->\|agent unavailable\| q/);
});

test('voice tools are registered, grouped, and create_voice_connector is a write', () => {
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes('list_voice_connectors'));
  assert.ok(names.includes('create_voice_connector'));
  assert.ok(WRITE_TOOLS.has('create_voice_connector'));
  assert.ok(!WRITE_TOOLS.has('list_voice_connectors'));
  assert.ok(TOOL_GROUPS.some((g) => g.tools.includes('create_voice_connector')));
  assert.match(ELEVENLABS_BASE_URIS.global, /^wss:\/\/api\.elevenlabs\.io\/v1\/convai\/conversation\/genesys$/);
});

// A tiny fake Genesys client for the connector tool.
function fakeGc(existing = []) {
  const calls = [];
  const gc = {
    calls,
    listAll: async () => ({ entities: existing }),
    get: async (p) => {
      calls.push(['GET', p]);
      if (p.endsWith('/config/current')) return { version: 1, properties: {}, credentials: {} };
      return { reportedState: { code: 'ACTIVE', effective: 'Active' } };
    },
    post: async (p, b) => { calls.push(['POST', p, b]); return p.endsWith('/credentials') ? { id: 'cred-1' } : { id: 'int-1' }; },
    put: async (p, b) => { calls.push(['PUT', p, b]); return {}; },
    patch: async (p, b) => { calls.push(['PATCH', p, b]); return {}; },
  };
  return gc;
}
const connectorTool = VOICE_TOOLS.find((t) => t.name === 'create_voice_connector');

test('create_voice_connector refuses without the server secret and never asks for the key', async () => {
  await assert.rejects(() => connectorTool.handler(fakeGc(), {}, { elevenLabsKey: '' }), /ELEVENLABS_API_KEY/);
});

test('create_voice_connector writes the key into a Genesys credential and never returns it', async () => {
  const gc = fakeGc();
  const out = await connectorTool.handler(gc, {}, { elevenLabsKey: 'sk_test_value_123' });
  assert.equal(out.created, true);
  assert.equal(out.name, 'ElevenLabs');
  assert.equal(out.baseUri, ELEVENLABS_BASE_URIS.global);
  assert.doesNotMatch(JSON.stringify(out), /sk_test_value_123/);
  const cred = gc.calls.find((c) => c[0] === 'POST' && c[1] === '/api/v2/integrations/credentials');
  assert.deepEqual(cred[2].type, { name: 'audioHook' });
  assert.equal(cred[2].credentialFields.apiKey, 'sk_test_value_123');
  const cfg = gc.calls.find((c) => c[0] === 'PUT');
  assert.deepEqual(cfg[2].credentials, { audioHook: { id: 'cred-1' } });
  assert.equal(cfg[2].properties.baseUri, ELEVENLABS_BASE_URIS.global);
  assert.ok(gc.calls.some((c) => c[0] === 'PATCH' && c[2].intendedState === 'ENABLED'));
});

test('create_voice_connector reuses an existing connector by name without touching it', async () => {
  const gc = fakeGc([{ id: 'x1', name: 'ElevenLabs', integrationType: { id: 'audio-connector' }, intendedState: 'ENABLED', reportedState: { code: 'ACTIVE', effective: 'Active' } }]);
  const out = await connectorTool.handler(gc, {}, { elevenLabsKey: 'sk_x' });
  assert.equal(out.reused, true);
  assert.ok(!gc.calls.some((c) => ['POST', 'PUT', 'PATCH'].includes(c[0])));
});
