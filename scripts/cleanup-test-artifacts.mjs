// Maintainer script: remove the MCP_Test_* artifacts the smoke and e2e scripts
// leave behind in a SANDBOX org. This is deliberately NOT a server tool - the
// MCP server never deletes anything - and it only touches objects whose name
// starts with MCP_Test_. Reads .dev.vars for credentials.
//
//   node scripts/cleanup-test-artifacts.mjs                 # dry run: list what would go
//   node scripts/cleanup-test-artifacts.mjs --delete        # actually delete
//   node scripts/cleanup-test-artifacts.mjs --delete --kv   # also purge mcp-test-* slugs from the deployed Worker's KV (Wrangler auth)
import { readFileSync } from 'node:fs';
import { GenesysClient } from '../src/genesys.js';

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const gc = new GenesysClient({ clientId: vars.GENESYS_CLIENT_ID, clientSecret: vars.GENESYS_CLIENT_SECRET, region: vars.GENESYS_REGION || 'mypurecloud.com' });
const doDelete = process.argv.includes('--delete');
const isTest = (name) => /^MCP_Test_/.test(name || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function del(label, fn) {
  if (!doDelete) { console.log(`would delete ${label}`); return; }
  try { await fn(); console.log(`deleted ${label}`); } catch (e) { console.log(`FAILED ${label}: ${e.message}`); }
}

// Flows first (bot flows reference AVAs), then AVAs, knowledge settings before sources, then mock actions.
const flows = (await gc.listAll('/api/v2/flows', { name: 'MCP_Test_*' }, { max: 200 })).entities.filter((f) => isTest(f.name));
for (const f of flows) await del(`flow ${f.name}`, () => gc.api('DELETE', '/api/v2/flows', { query: { id: f.id } }));

const avas = (await gc.listAll('/api/v2/agentic/virtualagents', { nameContains: 'MCP_Test_' }, { max: 200 })).entities.filter((a) => isTest(a.name));
for (const a of avas) await del(`AVA ${a.name}`, () => gc.api('DELETE', `/api/v2/agentic/virtualagents/${a.id}/jobs`));

const settings = (await gc.listAll('/api/v2/knowledge/settings', {}, { max: 200 })).entities.filter((s) => isTest(s.name));
for (const s of settings) await del(`knowledge setting ${s.name}`, () => gc.api('DELETE', `/api/v2/knowledge/settings/${s.id}`));

const sources = (await gc.listAll('/api/v2/knowledge/sources', {}, { max: 200 })).entities.filter((s) => isTest(s.name));
for (const s of sources) await del(`knowledge source ${s.name}`, () => gc.api('DELETE', `/api/v2/knowledge/sources/${s.id}`));

const actions = (await gc.listAll('/api/v2/integrations/actions', {}, { max: 500 })).entities.filter((a) => isTest(a.name));
for (const a of actions) await del(`data action ${a.name}`, () => gc.api('DELETE', `/api/v2/integrations/actions/${a.id}`));

// Outbound + routing leftovers from the older smoke (sequence -> campaigns -> lists -> rest).
const seqs = (await gc.listAll('/api/v2/outbound/sequences', {}, { max: 200 })).entities.filter((s) => isTest(s.name));
for (const s of seqs) await del(`sequence ${s.name}`, () => gc.api('DELETE', `/api/v2/outbound/sequences/${s.id}`));
const campaigns = (await gc.listAll('/api/v2/outbound/campaigns', {}, { max: 200 })).entities.filter((c) => isTest(c.name));
for (const c of campaigns) await del(`campaign ${c.name}`, () => gc.api('DELETE', `/api/v2/outbound/campaigns/${c.id}`));
if (doDelete && campaigns.length) await sleep(3000);
for (const [path, label] of [['/api/v2/outbound/contactlists', 'contact list'], ['/api/v2/outbound/dnclists', 'dnc list'], ['/api/v2/outbound/attemptlimits', 'attempt limits'], ['/api/v2/outbound/callabletimesets', 'callable time set'], ['/api/v2/routing/queues', 'queue'], ['/api/v2/routing/skills', 'skill'], ['/api/v2/routing/wrapupcodes', 'wrap-up code'], ['/api/v2/architect/schedulegroups', 'schedule group'], ['/api/v2/architect/schedules', 'schedule']]) {
  const items = (await gc.listAll(path, {}, { max: 300 })).entities.filter((x) => isTest(x.name));
  for (const x of items) await del(`${label} ${x.name}`, () => gc.api('DELETE', `${path}/${x.id}`));
}

// Workspace leftovers in the DEPLOYED Worker's KV (slugs starting with
// mcp-test-): needs Wrangler auth. Pass --kv to include this step.
if (process.argv.includes('--kv')) {
  const { execSync } = await import('node:child_process');
  const wr = (args) => execSync(`npx wrangler ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Wrangler 4 targets its LOCAL dev store for kv key commands unless --remote is passed.
  // It prints JSON on stdout; take the JSON value in case a banner precedes it.
  const jsonOut = (text) => JSON.parse(text.slice(text.search(/[[{]/)));
  // The binding has no id in wrangler.toml (auto-provisioned), so resolve the namespace by title.
  const namespaces = jsonOut(wr('kv namespace list'));
  const ns = namespaces.find((n) => /genesys-mcp/i.test(n.title) && /CONFIG/i.test(n.title)) || namespaces.find((n) => /genesys-mcp/i.test(n.title));
  if (!ns) { console.log('no genesys-mcp KV namespace found for this account; skipping --kv'); }
  const nsArg = ns ? `--namespace-id ${ns.id}` : '';
  const keys = ns ? jsonOut(wr(`kv key list ${nsArg} --remote --prefix "ava:ws:mcp-test-"`)) : [];
  for (const k of keys) await del(`KV ${k.name}`, () => wr(`kv key delete ${nsArg} --remote "${k.name}"`));
  let index = null;
  if (ns) { try { index = jsonOut(wr(`kv key get ${nsArg} --remote "ava:index" --text`)); } catch { /* no index yet */ } }
  if (index?.avas?.some((a) => /^mcp-test-/.test(a.slug))) {
    const kept = { ...index, avas: index.avas.filter((a) => !/^mcp-test-/.test(a.slug)) };
    // Write through a temp file: shell quoting of JSON differs between cmd.exe and sh.
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmp = join(tmpdir(), `ava-index-${Date.now()}.json`);
    writeFileSync(tmp, JSON.stringify(kept));
    await del('KV ava:index entries for mcp-test-* slugs', () => wr(`kv key put ${nsArg} --remote "ava:index" --path "${tmp}"`));
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

console.log(doDelete ? 'done' : 'dry run only; pass --delete to remove these');
