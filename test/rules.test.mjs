import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusalFor, redactSecrets, isOff, WRITE_FAMILIES } from '../src/rules.js';
import { TOOLS } from '../src/tools.js';
import { GenesysClient, GenesysError } from '../src/genesys.js';

const refused = (m, p, b, q, re) => {
  const r = refusalFor(m, p, b, q);
  assert.ok(r, `expected refusal: ${m} ${p} ${JSON.stringify(b ?? {})} ${JSON.stringify(q ?? {})}`);
  if (re) assert.match(r, re);
};
const allowed = (m, p, b, q) => assert.equal(refusalFor(m, p, b, q), null, `expected allowed: ${m} ${p} ${JSON.stringify(b ?? {})}`);

const G = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const G2 = '9a8b7c6d-5e4f-4321-9abc-def012345678';
const OFF_CAMPAIGN = { name: 'MCP_Test_Wave1', campaignStatus: 'off', dialingMode: 'preview' };

test('isOff: only the literal "off" (any case, trimmed) counts', () => {
  for (const v of ['off', 'OFF', 'Off', ' off ', '\toff\n']) assert.ok(isOff(v), JSON.stringify(v));
  for (const v of ['on', 'ON', ' On ', 'stopping', 'complete', 'forced_off', 'off\u0000', 'o ff', '', true, false, 1, 0, null, undefined, ['off'], { v: 'off' }]) {
    assert.ok(!isOff(v), JSON.stringify(v));
  }
});

test('DELETE and unknown methods are refused', () => {
  refused('DELETE', `/api/v2/routing/queues/${G}`, undefined, undefined, /no deletes/);
  refused('HEAD', '/api/v2/routing/queues');
  refused('OPTIONS', '/api/v2/routing/queues');
  refused('', '/api/v2/routing/queues');
});

test('path normalization: traversal, encoding, and smuggling are refused before anything else', () => {
  // dot-segment traversal that new URL() would resolve into /outbound/...
  refused('GET', '/api/v2/x/../outbound/campaigns');
  refused('POST', '/api/v2/routing/queues/../../conversations/calls', { phoneNumber: '+13175550100' });
  refused('PUT', `/api/v2/routing/queues/${G}/../../../outbound/campaigns/${G}`, { campaignStatus: 'on' });
  refused('GET', '/api/v2/./users');
  refused('GET', '/api/v2//users');
  refused('GET', '/api/v2/users/');
  // percent-encoding: %2F slashes, %6F ("o"), %2e dots
  refused('PATCH', `/api/v2/%6Futbound/campaigns/${G}`, { campaignStatus: 'on' }, undefined, /percent/);
  refused('POST', '/api/v2/routing/queues%2F..%2F..%2Fconversations%2Fcalls', {});
  refused('GET', '/api/v2/%2e%2e/users');
  refused('POST', '/api/v2/conversations/call%73', {});
  // matrix params, fragments, query in path, backslashes
  refused('POST', '/api/v2/routing/queues;x=1', { name: 'q' });
  refused('GET', '/api/v2/users#frag');
  refused('POST', '/api/v2/routing/queues?delete=true', {});
  refused('GET', '/api/v2/users\\..\\oauth');
  // whitespace/control characters that the URL parser strips
  refused('GET', '/api/v2/x/.\t./users');
  refused('POST', '/api/v2/routing/queues/.\n./../conversations/calls', {});
  refused('GET', '/api/v2/users ');
  // non-ASCII lookalikes
  refused('GET', '/api/v2/users/．．/oauth');
  // must be under /api/v2/
  refused('GET', '/oauth/token');
  refused('GET', 'api/v2/users');
  refused('GET', '/api/v1/users');
  refused('GET', '/API/v2/users');
  refused('GET', undefined);
});

test('query validation: identifiers only, no duplicates or case variants, scalars only', () => {
  refused('GET', '/api/v2/users', undefined, { 'page Size': 1 });
  refused('GET', '/api/v2/users', undefined, { 'a[b]': 1 });
  refused('GET', '/api/v2/users', undefined, { pageSize: 1, pagesize: 2 });
  refused('GET', '/api/v2/users', undefined, { id: [1, 2] });
  refused('GET', '/api/v2/users', undefined, { filter: { a: 1 } });
  refused('GET', '/api/v2/users', undefined, ['pageSize']);
  allowed('GET', '/api/v2/users', undefined, { pageSize: 25, expand: 'skills', active: true });
  refused('POST', `/api/v2/outbound/contactlists/${G}/contacts`, [{ data: {}, callable: false }], { clearSystemData: true }, /clearSystemData/);
  refused('POST', `/api/v2/routing/queues/${G}/wrapupcodes`, [], { delete: 'true' });
});

test('GETs stay broad once the path is clean', () => {
  for (const p of ['/api/v2/routing/queues', `/api/v2/outbound/campaigns/${G}`, '/api/v2/conversations', `/api/v2/conversations/calls/${G}`,
    '/api/v2/authorization/divisions', '/api/v2/analytics/conversations/details/jobs',
    `/api/v2/integrations/actions/custom_-_${G}/schemas/inputschema.json`, '/api/v2/users/me']) allowed('GET', p);
});

test('conversations: every write is refused (placing calls, live interaction control)', () => {
  refused('POST', '/api/v2/conversations/calls', { phoneNumber: '+13175550100', callFromQueueId: G }, undefined, /live interaction/);
  refused('POST', '/api/v2/conversations/calls', { callerId: '+13175550101', phoneNumber: '+13175550100' });
  refused('PATCH', `/api/v2/conversations/calls/${G}/participants/${G2}`, { state: 'disconnected' });
  refused('POST', `/api/v2/conversations/${G}/participants/${G2}/replace`, { address: '+13175550100' });
  refused('POST', '/api/v2/conversations/messages/agentless', { toAddress: '+13175550100' });
  refused('POST', '/api/v2/conversations/emails', {});
  refused('POST', '/api/v2/conversations/callbacks', { callbackNumbers: ['+13175550100'] });
  refused('PUT', `/api/v2/conversations/${G}/recordingstate`, {});
  refused('POST', '/api/v2/Conversations/calls', {});
});

test('credential, OAuth, and authorization writes are refused', () => {
  refused('POST', '/api/v2/oauth/clients', { name: 'x', authorizedGrantType: 'CLIENT-CREDENTIALS' }, undefined, /mint or escalate/);
  refused('POST', `/api/v2/oauth/clients/${G}/secret`, {});
  refused('PUT', `/api/v2/authorization/roles/${G}`, { permissionPolicies: [] });
  refused('POST', '/api/v2/authorization/roles', {});
  refused('PUT', `/api/v2/authorization/subjects/${G}/bulkreplace`, {});
  refused('POST', `/api/v2/authorization/subjects/${G}/divisions/${G2}/roles/${G}`, {});
  refused('POST', '/api/v2/integrations/credentials', { type: 'basicAuth', credentialFields: { password: 'x' } });
  refused('POST', '/api/v2/tokens/me', {});
});

test('agents are never put on queue by the raw tool', () => {
  refused('PUT', `/api/v2/users/${G}/routingstatus`, { status: 'IDLE' });
  refused('PATCH', `/api/v2/users/${G}/presences/purecloud`, { presenceDefinition: { id: G2 } });
  refused('PUT', `/api/v2/users/${G}/station/associatedstation/${G2}`, {});
});

test('publishing goes only through the typed tools', () => {
  refused('POST', '/api/v2/flows/jobs', {}, undefined, /publish_flow/);
  refused('POST', '/api/v2/flows/actions/publish', {}, { flow: G });
  refused('POST', '/api/v2/flows/actions/deactivate', {}, { flow: G });
  refused('POST', '/api/v2/flows/actions/revert', {}, { flow: G });
  refused('POST', `/api/v2/agentic/virtualagents/${G}/versions/1.0/jobs`, { virtualAgentVersion: { status: 'ProductionReady' } }, undefined, /publish_ava_version/);
  refused('POST', `/api/v2/agentic/virtualagents/${G}/versions/1.0/jobs`, { virtualAgentVersion: { status: 'TestReady' } });
  refused('POST', `/api/v2/integrations/actions/custom_-_${G}/execute`, {}, undefined, /external system/);
  refused('POST', `/api/v2/integrations/actions/custom_-_${G}/test`, {});
  refused('POST', `/api/v2/integrations/actions/custom_-_${G}/draft/test`, {});
});

test('outbound ignition paths are refused', () => {
  refused('POST', `/api/v2/outbound/campaigns/${G}/start`, {}, undefined, /never starts campaigns/);
  refused('POST', `/api/v2/outbound/campaigns/${G}/callback/schedule`, { phoneColumn: 'phone', callbackNumbers: ['+13175550100'] });
  refused('POST', '/api/v2/outbound/campaignrules', { campaignRuleActions: [{ action: 'turnOnCampaign' }] });
  refused('PUT', `/api/v2/outbound/campaignrules/${G}`, { enabled: true });
  refused('PUT', `/api/v2/outbound/schedules/campaigns/${G}`, { intervals: [] });
  refused('PUT', `/api/v2/outbound/schedules/sequences/${G}`, { intervals: [] });
  refused('POST', '/api/v2/outbound/messagingcampaigns', { campaignStatus: 'off' });
  refused('POST', '/api/v2/outbound/rulesets', {});
  refused('POST', `/api/v2/outbound/conversations/${G}/dnc`, {});
  refused('POST', '/api/v2/architect/ivrs', { dnis: ['+13175550100'] });
});

test('campaign and sequence writes: status must be "off" (deep, case-insensitive key, trimmed value)', () => {
  // the existing ignition shapes
  refused('PATCH', `/api/v2/outbound/campaigns/${G}`, { campaignStatus: 'on' }, undefined, /never starts campaigns/);
  refused('PUT', `/api/v2/outbound/sequences/${G}`, { name: 'x', status: 'on' });
  // case / format coercion of the value
  for (const v of ['ON', ' on', 'On ', 'on\n', true, 1, 'true', 'stopping', 'complete', ['on'], { value: 'on' }, null]) {
    refused('PATCH', `/api/v2/outbound/campaigns/${G}`, { campaignStatus: v });
    refused('PUT', `/api/v2/outbound/campaigns/${G}`, { ...OFF_CAMPAIGN, campaignStatus: v });
    refused('POST', '/api/v2/outbound/sequences', { name: 's', campaigns: [], status: v });
  }
  // case variants of the key
  refused('PATCH', `/api/v2/outbound/campaigns/${G}`, { CAMPAIGNSTATUS: 'on' });
  refused('PATCH', `/api/v2/outbound/campaigns/${G}`, { Status: 'on' });
  refused('PUT', `/api/v2/outbound/sequences/${G}`, { name: 's', STATUS: 'on' });
  // case-duplicate keys: off to a case-sensitive binder, on to an insensitive one
  refused('PUT', `/api/v2/outbound/campaigns/${G}`, { ...OFF_CAMPAIGN, CampaignStatus: 'on' }, undefined, /different casing/);
  // nested status anywhere in the body
  refused('PUT', `/api/v2/outbound/campaigns/${G}`, { ...OFF_CAMPAIGN, extra: { deep: [{ status: 'on' }] } });
  refused('POST', '/api/v2/outbound/sequences', { name: 's', status: 'off', campaigns: [{ id: G, campaignStatus: 'on' }] });
  // POST/PUT must carry off explicitly (an omitted status is not "off")
  refused('POST', '/api/v2/outbound/campaigns', { name: 'x', dialingMode: 'preview' });
  refused('PUT', `/api/v2/outbound/sequences/${G}`, { name: 's', campaigns: [] });
  // array bodies cannot hide a status from the top-level check
  refused('PUT', `/api/v2/outbound/campaigns/${G}`, [OFF_CAMPAIGN]);
  // allowed: off, in any case, with whitespace
  allowed('POST', '/api/v2/outbound/campaigns', OFF_CAMPAIGN);
  allowed('PUT', `/api/v2/outbound/campaigns/${G}`, { ...OFF_CAMPAIGN, campaignStatus: ' OFF ' });
  allowed('PATCH', `/api/v2/outbound/campaigns/${G}`, { campaignStatus: 'off' });
  allowed('PATCH', `/api/v2/outbound/campaigns/xyz`, { name: 'renamed' });
  allowed('POST', '/api/v2/outbound/sequences', { name: 'MCP_Test_Cadence', campaigns: [{ id: G }], status: 'Off' });
});

test('contacts written raw must land uncallable', () => {
  const list = `/api/v2/outbound/contactlists/${G}/contacts`;
  refused('POST', list, [{ data: { phone: '3175550100' } }], undefined, /uncallable/);
  refused('POST', list, [{ data: { phone: '3175550100' }, callable: true }]);
  refused('POST', list, [{ data: { phone: '3175550100' }, callable: 'false' }]);
  refused('POST', list, [{ data: { phone: '3175550100' }, callable: false, contactableStatus: { Voice: { contactable: true } } }]);
  refused('POST', list, [{ data: {}, callable: false }, { data: {} }]);
  refused('PUT', `${list}/abc123`, { data: { phone: '3175550100' }, callable: true });
  refused('PUT', `${list}/abc123`, { data: { phone: '3175550100' }, Callable: false, callable: true });
  allowed('POST', list, [{ data: { phone: '3175550100', callable: 'yes' }, callable: false }]);
  allowed('PUT', `${list}/abc123`, { data: { first_name: 'Ada' }, callable: false });
  refused('POST', `${list}/bulk/remove`, [G]);
  refused('POST', `/api/v2/outbound/contactlists/${G}/clear`, {});
});

test('delete-style endpoints are refused by any verb', () => {
  refused('POST', `/api/v2/outbound/contactlists/${G}/contacts/bulk/remove`, [], undefined, /no deletes/);
  refused('PATCH', `/api/v2/outbound/dnclists/${G}/phonenumbers`, { action: 'Remove', phoneNumbers: ['3175550100'] });
  refused('PUT', `/api/v2/users/${G}/routingskills/bulk`, []);
  refused('POST', '/api/v2/routing/queues/bulkdelete', {});
  // {id} slots never match literal sibling routes
  refused('PUT', `/api/v2/outbound/contactlists/${G}/contacts/bulk`, [{ callable: false }]);
  refused('PUT', '/api/v2/outbound/campaigns/progress', OFF_CAMPAIGN);
  refused('PUT', `/api/v2/users/me/routingskills/${G}`, { proficiency: 5 });
  refused('PUT', '/api/v2/flows/actions', {});
});

test('the write allowlist refuses everything outside the typed families', () => {
  refused('POST', '/api/v2/users', { name: 'x', email: 'x@example.com' }, undefined, /allowlist/);
  refused('PATCH', `/api/v2/users/${G}`, { title: 'x' });
  refused('POST', `/api/v2/routing/queues/${G}/members`, [{ id: G2 }]);
  refused('POST', '/api/v2/telephony/providers/edges/phones', {});
  refused('POST', '/api/v2/architect/datatables', {});
  refused('POST', '/api/v2/integrations', { integrationType: { id: 'x' } });
  refused('POST', '/api/v2/outbound/callanalysisresponsesets', {});
  refused('POST', '/api/v2/analytics/conversations/details/query', {});
  refused('POST', '/api/v2/webhooks', {});
  refused('POST', '/api/v2/routing/sms/phonenumbers', {});
  refused('PUT', `/api/v2/routing/skills/${G}`, {});
  refused('POST', '/api/v2/flows/datatables', {});
});

test('the allowlist still permits the build writes the typed tools do', () => {
  allowed('POST', '/api/v2/routing/queues', { name: 'MCP_Test_Queue' });
  allowed('PUT', `/api/v2/routing/queues/${G}`, { name: 'MCP_Test_Queue', description: 'x' });
  allowed('POST', `/api/v2/routing/queues/${G}/wrapupcodes`, [{ id: G2 }]);
  allowed('POST', '/api/v2/routing/skills', { name: 'MCP_Test_Skill' });
  allowed('POST', '/api/v2/routing/wrapupcodes', { name: 'MCP_Test_Resolved' });
  allowed('POST', '/api/v2/users/search', { query: [{ fields: ['email'], value: 'x', type: 'CONTAINS' }] });
  allowed('POST', `/api/v2/users/${G}/routingskills`, { id: G2, proficiency: 3 });
  allowed('PATCH', `/api/v2/users/${G}/routingskills/bulk`, [{ id: G2, proficiency: 4 }]);
  allowed('POST', '/api/v2/architect/schedules', { name: 'MCP_Test_Hours' });
  allowed('POST', '/api/v2/architect/schedulegroups', { name: 'MCP_Test_Group' });
  allowed('POST', '/api/v2/flows/actions/unlock', undefined, { flow: G });
  allowed('POST', '/api/v2/flows/export/jobs', { flows: [{ id: G }] });
  allowed('POST', '/api/v2/outbound/contactlists', { name: 'MCP_Test_List', columnNames: ['phone'], phoneColumns: [{ columnName: 'phone', type: 'cell' }] });
  allowed('POST', '/api/v2/outbound/attemptlimits', { name: 'MCP_Test_Limits', maxAttemptsPerContact: 3 });
  allowed('POST', '/api/v2/outbound/callabletimesets', { name: 'MCP_Test_Window', callableTimes: [] });
  allowed('POST', '/api/v2/outbound/dnclists', { name: 'MCP_Test_DNC', dncSourceType: 'rds' });
  allowed('POST', `/api/v2/outbound/dnclists/${G}/phonenumbers`, ['3175550100']);
  allowed('POST', '/api/v2/agentic/virtualagents', { name: 'MCP_Test_AVA' });
  allowed('POST', `/api/v2/agentic/virtualagents/${G}/versions`, { definition: {} });
  allowed('POST', `/api/v2/apps/agentic/virtualagents/${G}/sessions`, {});
  allowed('POST', `/api/v2/apps/agentic/virtualagents/${G}/sessions/${G2}/turns`, { text: 'hi' });
  allowed('POST', '/api/v2/knowledge/sources', { name: 'x', type: 'FileUpload' });
  allowed('PATCH', `/api/v2/knowledge/sources/${G}/synchronizations/${G2}`, { status: 'Completed' });
  allowed('PATCH', `/api/v2/knowledge/settings/${G}`, { name: 'x' });
  allowed('POST', '/api/v2/integrations/actions/drafts', { name: 'x' });
  allowed('POST', `/api/v2/integrations/actions/custom_-_${G}/draft/publish`, { version: 1 });
  assert.ok(WRITE_FAMILIES.length > 10);
});

test('non-object bodies and absurd nesting are refused', () => {
  refused('POST', '/api/v2/routing/queues', '{"name":"x"}');
  refused('POST', '/api/v2/routing/queues', 42);
  let deep = { status: 'on' };
  for (let i = 0; i < 20; i++) deep = { n: deep };
  refused('POST', '/api/v2/routing/queues', deep);
});

test('redactSecrets scrubs credential-named fields at any depth, keeps counts and paging cursors', () => {
  const r = redactSecrets({
    id: G, name: 'client', secret: 's3cr3t', clientSecret: 'cs', CLIENT_SECRET: 'cs2', accessToken: 'at', apiKey: 'k', api_key: 'k2',
    password: 'p', credentials: { basicAuth: { id: G2, password: 'p2' } }, tokenCount: 1234, nextPageToken: 'cursor',
    entities: [{ name: 'a', sipPassword: 'x', token: 'y', passwordRequired: true }],
  });
  for (const k of ['secret', 'clientSecret', 'CLIENT_SECRET', 'accessToken', 'apiKey', 'api_key', 'password', 'credentials']) assert.equal(r[k], '[redacted]', k);
  assert.equal(r.entities[0].sipPassword, '[redacted]');
  assert.equal(r.entities[0].token, '[redacted]');
  assert.equal(r.entities[0].passwordRequired, true);
  assert.equal(r.entities[0].name, 'a');
  assert.equal(r.tokenCount, 1234);
  assert.equal(r.nextPageToken, 'cursor');
  assert.equal(r.id, G);
  assert.deepEqual(redactSecrets([{ token: '' }, null, 'x']), [{ token: '' }, null, 'x']);
});

test('genesys_api_call handler: refuses before calling the API, redacts what comes back', async () => {
  const power = TOOLS.find((t) => t.name === 'genesys_api_call');
  const calls = [];
  const gc = { api: async (m, p) => { calls.push(`${m} ${p}`); return { id: G, secret: 'shh', tokenCount: 3 }; } };
  await assert.rejects(() => power.handler(gc, { method: 'POST', path: '/api/v2/conversations/calls', body: { phoneNumber: '+13175550100' } }), (e) => e instanceof GenesysError && e.status === 403);
  await assert.rejects(() => power.handler(gc, { method: 'GET', path: '/api/v2/x/../oauth/clients' }), /segments/);
  await assert.rejects(() => power.handler(gc, { method: 'PATCH', path: `/api/v2/outbound/campaigns/${G}`, body: { campaignStatus: 'ON ' } }), /never starts campaigns/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await power.handler(gc, { method: 'GET', path: '/api/v2/integrations/actions' }), { id: G, secret: '[redacted]', tokenCount: 3 });
  assert.deepEqual(calls, ['GET /api/v2/integrations/actions']);
  await assert.rejects(() => power.handler(gc, { method: 'GET', path: '/api/v2/oauth/clients' }), /out of scope/);
});

test('client refuses to send when URL parsing rewrites the path (defense in depth)', async () => {
  const gc = new GenesysClient({ clientId: 'x', clientSecret: 'y', region: 'usw2' });
  gc.token = async () => { throw new Error('network must not be reached'); };
  await assert.rejects(() => gc.api('GET', '/api/v2/x/../users'), /rewritten/);
  await assert.rejects(() => gc.api('GET', '/api/v2/users\\..\\oauth'), /rewritten/);
  await assert.rejects(() => gc.api('GET', '/api/v2/x/.\t./users'), /rewritten/);
  await assert.rejects(() => gc.api('GET', '/api/v2/us ers'), /rewritten/);
});

test('credential and role reads are refused (GET included), ordinary reads stay open', () => {
  for (const p of ['/api/v2/oauth/clients', '/api/v2/authorization/roles', '/api/v2/authorization/subjects/me', '/api/v2/tokens/me', '/api/v2/integrations/credentials']) {
    assert.match(refusalFor('GET', p) || '', /Refused/, p);
  }
  assert.equal(refusalFor('GET', '/api/v2/routing/queues'), null);
  assert.equal(refusalFor('GET', '/api/v2/integrations/actions'), null);
  assert.equal(refusalFor('GET', '/api/v2/authorization/divisions'), null);
});
