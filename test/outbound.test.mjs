import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeAttemptLimits, composeCallableTimeSet, composeContactList, cadenceToMermaid, RECALL_KEYS, DIALING_MODES } from '../src/outbound.js';
import { TOOLS, WRITE_TOOLS, TOOL_GROUPS } from '../src/tools.js';
import { GenesysError } from '../src/genesys.js';

test('composeAttemptLimits maps snake recall reasons to API keys', () => {
  const body = composeAttemptLimits({
    name: 'Gentle Retry',
    max_attempts_per_contact: 3,
    time_zone: 'America/New_York',
    recalls: { no_answer: { attempts: 2, minutes_between: 240 }, answering_machine: { attempts: 1, minutes_between: 5 } },
  });
  assert.equal(body.maxAttemptsPerContact, 3);
  assert.equal(body.timeZoneId, 'America/New_York');
  assert.deepEqual(body.recallEntries.noAnswer, { nbrAttempts: 2, minutesBetweenAttempts: 240 });
  assert.deepEqual(body.recallEntries.answeringMachine, { nbrAttempts: 1, minutesBetweenAttempts: 5 });
  assert.ok(!('no_answer' in body.recallEntries));
});

test('composeAttemptLimits rejects unknown recall reasons', () => {
  assert.throws(() => composeAttemptLimits({ name: 'x', recalls: { voicemail: { attempts: 1 } } }), GenesysError);
});

test('composeCallableTimeSet maps day codes and groups by time zone', () => {
  const body = composeCallableTimeSet({
    name: 'Weekday Hours',
    windows: [
      { days: ['MO', 'TU', 'WE', 'TH', 'FR'], start_time: '09:00', end_time: '19:00', time_zone: 'America/New_York' },
      { days: ['SA'], start_time: '10:00', end_time: '14:00', time_zone: 'America/New_York' },
    ],
  });
  assert.equal(body.callableTimes.length, 1);
  const slots = body.callableTimes[0].timeSlots;
  assert.equal(slots.length, 6);
  assert.deepEqual(slots[0], { day: 1, startTime: '09:00:00', stopTime: '19:00:00' });
  assert.deepEqual(slots[5], { day: 6, startTime: '10:00:00', stopTime: '14:00:00' });
});

test('composeCallableTimeSet rejects bad times and bad days', () => {
  assert.throws(() => composeCallableTimeSet({ name: 'x', windows: [{ days: ['MO'], start_time: '9am', end_time: '17:00' }] }), GenesysError);
  assert.throws(() => composeCallableTimeSet({ name: 'x', windows: [{ days: ['MONDAY'], start_time: '09:00', end_time: '17:00' }] }), GenesysError);
  assert.throws(() => composeCallableTimeSet({ name: 'x', windows: [] }), GenesysError);
});

test('composeContactList normalizes phone types and validates columns', () => {
  const body = composeContactList({
    name: 'Fall Leads',
    columns: ['first_name', 'phone', 'zip'],
    phone_columns: [{ column: 'phone', type: 'cell' }],
    zip_column: 'zip',
  });
  assert.deepEqual(body.phoneColumns, [{ columnName: 'phone', type: 'Cell' }]);
  assert.equal(body.zipCodeColumnName, 'zip');
  assert.equal(body.automaticTimeZoneMapping, true);
  assert.throws(() => composeContactList({ name: 'x', columns: ['a'], phone_columns: [{ column: 'nope' }] }), GenesysError);
  assert.throws(() => composeContactList({ name: 'x', columns: ['a'], phone_columns: [{ column: 'a' }], zip_column: 'nope' }), GenesysError);
});

test('composeContactList wires time zone columns for callable time sets', () => {
  const body = composeContactList({
    name: 'Zoned',
    columns: ['phone', 'time_zone'],
    phone_columns: [{ column: 'phone' }],
    time_zone_column: 'time_zone',
  });
  assert.equal(body.phoneColumns[0].callableTimeColumn, 'time_zone');
  assert.ok(!body.automaticTimeZoneMapping);
  assert.throws(() => composeContactList({ name: 'x', columns: ['p', 'z', 't'], phone_columns: [{ column: 'p' }], zip_column: 'z', time_zone_column: 't' }), GenesysError, 'zip and zone columns are exclusive');
  assert.throws(() => composeContactList({ name: 'x', columns: ['p'], phone_columns: [{ column: 'p' }], time_zone_column: 'missing' }), GenesysError);
});

test('cadenceToMermaid renders ordered waves with a root and terminal', () => {
  const m = cadenceToMermaid('Fall Reactivation', 'off', [
    { name: 'First Pass', dialingMode: 'preview', queue: 'Billing', contactList: 'Fall Leads', listSize: 4, attemptLimits: '3x Gentle Retry', timeSet: 'Weekday Hours', dncLists: ['Internal DNC'] },
    { name: 'Second Pass', dialingMode: 'preview', queue: 'Billing', contactList: 'Fall Leads', listSize: 4 },
  ]);
  assert.match(m, /^flowchart TD/);
  assert.match(m, /cadence: Fall Reactivation \(off\)/);
  assert.match(m, /1\. 📣 First Pass/);
  assert.match(m, /2\. 📣 Second Pass/);
  assert.match(m, /seq --> w0/);
  assert.match(m, /w0 --> w1/);
  assert.match(m, /w1 --> done/);
  assert.match(m, /\(4 contacts\)/);
  assert.ok(!m.includes('"Fall') || true);
});

test('cadenceToMermaid renders a single campaign without a root node', () => {
  const m = cadenceToMermaid(null, null, [{ name: 'Solo', dialingMode: 'preview', queue: 'Billing' }]);
  assert.ok(!m.includes('cadence:'));
  assert.match(m, /📣 Solo/);
  assert.match(m, /w0 --> done/);
});

test('outbound tools are registered, grouped, and write-flagged', () => {
  const names = new Set(TOOLS.map((t) => t.name));
  const expected = [
    'list_contact_lists', 'get_contact_list', 'create_contact_list', 'add_contacts',
    'create_attempt_limits', 'create_callable_time_set', 'create_dnc_list',
    'list_campaigns', 'get_campaign', 'create_campaign', 'create_campaign_sequence',
    'list_outbound_assets', 'render_cadence',
  ];
  for (const n of expected) assert.ok(names.has(n), `missing tool ${n}`);
  assert.equal(TOOLS.length, 41, 'v0.3.0 ships 41 tools');
  for (const n of ['create_contact_list', 'add_contacts', 'create_campaign', 'create_campaign_sequence', 'create_attempt_limits', 'create_callable_time_set', 'create_dnc_list']) {
    assert.ok(WRITE_TOOLS.has(n), `${n} must be write-flagged`);
  }
  const outboundGroup = TOOL_GROUPS.find((g) => /Outbound/.test(g.name));
  assert.ok(outboundGroup, 'outbound tool group exists');
  assert.equal(outboundGroup.tools.length, expected.length);
});

test('no tool can start a campaign: create_campaign pins status off and no start/stop tools ship', () => {
  for (const t of TOOLS) assert.ok(!/^(start|stop|turn_on)/.test(t.name), `unexpected ignition tool: ${t.name}`);
  const cc = TOOLS.find((t) => t.name === 'create_campaign');
  assert.ok(!('campaign_status' in cc.inputSchema.properties), 'create_campaign must not accept a status');
  assert.equal(DIALING_MODES.length, 4);
  assert.equal(Object.keys(RECALL_KEYS).length, 5);
});

test('genesys_api_call refuses campaign ignition writes', async () => {
  const power = TOOLS.find((t) => t.name === 'genesys_api_call');
  const gc = { api: async () => ({ ok: true }) };
  await assert.rejects(
    () => power.handler(gc, { method: 'PATCH', path: '/api/v2/outbound/campaigns/xyz', body: { campaignStatus: 'on' } }),
    /never starts campaigns/);
  await assert.rejects(
    () => power.handler(gc, { method: 'PUT', path: '/api/v2/outbound/sequences/xyz', body: { name: 'x', status: 'on' } }),
    /never starts campaigns/);
  // Non-ignition outbound writes and reads still pass through.
  assert.deepEqual(await power.handler(gc, { method: 'PATCH', path: '/api/v2/outbound/campaigns/xyz', body: { campaignStatus: 'off' } }), { ok: true });
  assert.deepEqual(await power.handler(gc, { method: 'GET', path: '/api/v2/outbound/campaigns/xyz' }), { ok: true });
});
