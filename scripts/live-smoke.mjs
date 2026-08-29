// Live smoke test: drives the real MCP tool handlers against the Genesys org
// configured in .dev.vars. READ tools only by default; pass --writes to also
// exercise create tools (they create MCP_Test_* artifacts).
//
//   node scripts/live-smoke.mjs
//   node scripts/live-smoke.mjs --writes
import { readFileSync } from 'node:fs';
import { callTool } from '../src/tools.js';

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const cfg = {
  clientId: vars.GENESYS_CLIENT_ID,
  clientSecret: vars.GENESYS_CLIENT_SECRET,
  region: vars.GENESYS_REGION || 'mypurecloud.com',
  configured: true,
};
if (!cfg.clientId || !cfg.clientSecret) {
  console.error('Missing GENESYS_CLIENT_ID / GENESYS_CLIENT_SECRET in .dev.vars');
  process.exit(1);
}

const runWrites = process.argv.includes('--writes');
let pass = 0, fail = 0;

async function run(name, args = {}, show = (r) => r) {
  try {
    const r = await callTool(cfg, name, args);
    const summary = JSON.stringify(show(r));
    console.log(`✅ ${name} ${summary.length > 220 ? summary.slice(0, 220) + '…' : summary}`);
    pass++;
    return r;
  } catch (e) {
    console.log(`❌ ${name} - ${e.message}`);
    fail++;
    return null;
  }
}

console.log(`- read tools against region ${cfg.region} -`);
await run('check_connection');
await run('list_queues', {}, (r) => ({ total: r.total, first: r.queues[0]?.name }));
await run('list_users', {}, (r) => ({ total: r.total, first: r.users[0]?.name }));
await run('list_users', { search: 'ryan@outboundani.com' }, (r) => r.users.map((u) => u.email));
await run('get_user', { user: 'ryan@outboundani.com' }, (r) => ({ name: r.name, skills: r.skills }));
await run('list_skills', {}, (r) => ({ total: r.total }));
await run('list_wrapup_codes', {}, (r) => ({ total: r.total, names: r.wrapupCodes.map((w) => w.name) }));
await run('list_flows', {}, (r) => ({ total: r.total, types: [...new Set(r.flows.map((f) => f.type))] }));
await run('list_divisions', {}, (r) => ({ total: r.total, names: r.divisions.map((d) => d.name) }));
await run('list_prompts', {}, (r) => ({ total: r.total }));
await run('list_did_pools', {}, (r) => ({ total: r.total }));
await run('list_contact_lists', {}, (r) => ({ total: r.total, first: r.contactLists[0]?.name, size: r.contactLists[0]?.size }));
await run('list_campaigns', {}, (r) => ({ total: r.total, statuses: r.campaigns.map((c) => c.campaignStatus) }));
await run('list_outbound_assets', {}, (r) => ({ sequences: r.sequences.length, attemptLimits: r.attemptLimits.length, sites: r.sites.map((s) => s.name), scripts: r.publishedScripts.map((s) => s.name) }));
await run('genesys_api_call', { method: 'GET', path: '/api/v2/telephony/providers/edges/dids', query: { pageSize: 3 } }, (r) => ({ total: r.total }));

const flows = await run('list_queues', { name_filter: '*' }, (r) => ({ total: r.total }));

if (runWrites) {
  console.log('- write tools (MCP_Test_* artifacts) -');
  const stamp = Date.now().toString(36);
  await run('create_skill', { name: `MCP_Test_Skill_${stamp}` });
  await run('create_wrapup_code', { name: `MCP_Test_Wrapup_${stamp}` });
  const q = await run('create_queue', { name: `MCP_Test_Queue_${stamp}`, description: 'genesys-mcp smoke test - safe to delete' });

  console.log('- outbound write chain (MCP_Test_* artifacts, campaigns stay OFF) -');
  await run('create_attempt_limits', {
    name: `MCP_Test_AttemptLimits_${stamp}`,
    max_attempts_per_contact: 3,
    time_zone: 'America/New_York',
    recalls: { no_answer: { attempts: 2, minutes_between: 240 }, busy: { attempts: 1, minutes_between: 30 } },
  }, (r) => ({ id: r.id, recalls: Object.keys(r.recallEntries || {}) }));
  await run('create_callable_time_set', {
    name: `MCP_Test_Hours_${stamp}`,
    windows: [{ days: ['MO', 'TU', 'WE', 'TH', 'FR'], start_time: '09:00', end_time: '19:00', time_zone: 'America/New_York' }],
  }, (r) => ({ id: r.id }));
  await run('create_dnc_list', { name: `MCP_Test_DNC_${stamp}`, numbers: ['5555550199'] }, (r) => ({ id: r.id, numbersAdded: r.numbersAdded, err: r.numbersError }));
  // time_zone_column (not zip_column): campaign callable time sets require
  // per-contact zone columns, and zip-based automatic mapping conflicts.
  const list = await run('create_contact_list', {
    name: `MCP_Test_List_${stamp}`,
    columns: ['first_name', 'phone', 'time_zone'],
    phone_columns: [{ column: 'phone', type: 'cell' }],
    time_zone_column: 'time_zone',
    attempt_limits: `MCP_Test_AttemptLimits_${stamp}`,
  }, (r) => ({ id: r.id, phoneColumns: r.phoneColumns }));
  if (list) {
    await run('add_contacts', {
      contact_list: list.id,
      contacts: [
        { first_name: 'Testy', phone: '5555550100', time_zone: 'America/New_York' },
        { first_name: 'Smokey', phone: '5555550101', time_zone: 'America/Los_Angeles' },
      ],
    });
    const c1 = await run('create_campaign', {
      name: `MCP_Test_Campaign1_${stamp}`,
      contact_list: list.id,
      queue: q ? q.id : `MCP_Test_Queue_${stamp}`,
      caller_name: 'MCP Smoke',
      caller_number: '5555550100',
      callable_time_set: `MCP_Test_Hours_${stamp}`,
      dnc_lists: [`MCP_Test_DNC_${stamp}`],
    }, (r) => ({ id: r.id, status: r.campaignStatus, script: r.script }));
    const c2 = await run('create_campaign', {
      name: `MCP_Test_Campaign2_${stamp}`,
      contact_list: list.id,
      queue: q ? q.id : `MCP_Test_Queue_${stamp}`,
      caller_name: 'MCP Smoke',
      caller_number: '5555550100',
      callable_time_set: `MCP_Test_Hours_${stamp}`,
    }, (r) => ({ id: r.id, status: r.campaignStatus }));
    if (c1 && c2) {
      const seq = await run('create_campaign_sequence', { name: `MCP_Test_Cadence_${stamp}`, campaigns: [c1.id, c2.id] }, (r) => ({ id: r.id, status: r.status, order: r.order }));
      if (seq) await run('render_cadence', { sequence: seq.id }, (r) => ({ mermaidLines: r.mermaid.split('\n').length }));
    }
    await run('get_contact_list', { contact_list: list.id }, (r) => ({ size: r.size, attemptLimits: r.attemptLimits?.name }));
  }
  console.log('NOTE: artifacts left in place - clean up via the UI or genesys_api_call once verified.');
}

console.log(`\n${pass} passed, ${fail} failed${runWrites ? ' (writes exercised)' : ''}`);
process.exit(fail ? 1 : 0);
