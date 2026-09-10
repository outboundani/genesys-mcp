// Agentic Virtual Agent (AVA) tool group: the full AVA lifecycle - design,
// knowledge, build, test, evaluate, critique - hosted in this Worker so it
// works from Claude Desktop (or any MCP client) with one URL.
//
// The playbooks are Genesys' own AVA skills (purecloudlabs/genesys-ava-skills,
// MIT), vendored verbatim in ava-playbooks.js and served by ava_playbook. The
// deterministic parts of their harness (definition checks, trajectory
// validation, scoring) are ported in ava.js. Where their IDE workflow wrote to
// a local .ava-lifecycle/ folder, these tools use the ava_workspace_* trio.
//
// Publishing defaults to TestReady. ProductionReady (live traffic) requires
// production: true AND an explicit user yes - same rule as the outbound group:
// the AI builds it, a human presses go.

import { GenesysError } from './genesys.js';
import { AVA_SKILLS, AVA_SKILLS_VERSION, AVA_SKILLS_RELEASE, AVA_SKILLS_SOURCE } from './ava-playbooks.js';
import {
  slugify, normalizeDefinition, preflightDefinition, validateTrajectory, computeScorecard, scorecardMarkdown,
  critiqueMarkdown, buildTurnRequest, summarizeTurn, mergeTurn, projectEvalCalls, runScriptedAttempt,
  validateAvaBotFlowSpec, avaBotFlowToArchyYaml, avaBotFlowToMermaid, AvaWorkspace, WORKSPACE_KINDS,
  DEFAULT_SUCCESS_THRESHOLD, RUBRIC_DIMENSIONS,
} from './ava.js';
import {
  validateKnowledgeFiles, ensureFileUploadSource, uploadKnowledgeDocuments, getSynchronization, synchronizationState,
  ensureKnowledgeSetting, MIME_TYPES,
} from './ava-knowledge.js';
// Pull knowledge files either inline ({ name, content }) or from the workspace
// (kind "knowledge", every file or the named ones).
async function collectKnowledgeFiles(ctx, a) {
  const files = [];
  for (const f of a.files || []) files.push({ name: f.name, content: f.content });
  if (a.slug) {
    const ws = workspace(ctx);
    const slug = slugOf(a.slug);
    const entries = await ws.list(slug, 'knowledge');
    for (const e of entries) {
      if (a.file_names?.length && !a.file_names.includes(e.id)) continue;
      const data = await ws.get(slug, 'knowledge', e.id);
      if (data) files.push({ name: e.id, content: data.content ?? data.value ?? '' });
    }
  }
  if (!files.length) throw new GenesysError('No knowledge files: pass files: [{ name, content }] or a slug whose workspace holds kind "knowledge" entries.', 400);
  return files;
}


const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVA_BASE = '/api/v2/agentic/virtualagents';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- resolution ----------

async function resolveAva(gc, ref) {
  if (GUID_RE.test(ref)) return gc.get(`${AVA_BASE}/${ref}`);
  const page = await gc.get(AVA_BASE, { nameContains: ref, pageSize: 50 });
  const entities = page.entities || [];
  const exact = entities.filter((e) => e.name?.toLowerCase() === String(ref).toLowerCase());
  const matches = exact.length ? exact : entities;
  if (!matches.length) throw new GenesysError(`No agentic virtual agent found matching "${ref}"`, 404);
  if (matches.length > 1) throw new GenesysError(`Ambiguous AVA "${ref}" - matches: ${matches.map((m) => m.name).join(', ')}. Use the exact name or id.`, 409);
  return matches[0];
}

async function resolveDataAction(gc, ref) {
  if (/^(custom|static)_-_/.test(ref)) return { id: ref };
  const page = await gc.get('/api/v2/integrations/actions', { name: ref, pageSize: 50 });
  const entities = page.entities || [];
  const exact = entities.filter((e) => e.name?.toLowerCase() === String(ref).toLowerCase());
  const matches = exact.length ? exact : entities;
  if (!matches.length) throw new GenesysError(`No data action found matching "${ref}"`, 404);
  if (matches.length > 1) throw new GenesysError(`Ambiguous data action "${ref}" - matches: ${matches.map((m) => `${m.name} (${m.id})`).join(', ')}. Use the exact name or id.`, 409);
  return matches[0];
}

async function resolveIntegration(gc, ref) {
  if (GUID_RE.test(ref)) return { id: ref };
  const { entities } = await gc.listAll('/api/v2/integrations', {}, { max: 500 });
  const exact = entities.filter((e) => e.name?.toLowerCase() === String(ref).toLowerCase());
  const matches = exact.length ? exact : entities.filter((e) => e.name?.toLowerCase().includes(String(ref).toLowerCase()));
  if (!matches.length) throw new GenesysError(`No integration found matching "${ref}"`, 404);
  if (matches.length > 1) throw new GenesysError(`Ambiguous integration "${ref}" - matches: ${matches.map((m) => m.name).join(', ')}.`, 409);
  return matches[0];
}

const versionOf = (v) => (v && typeof v === 'object' ? v.version : v) || null;

const slimAva = (a) => ({
  id: a.id, name: a.name, status: a.status,
  latestSavedVersion: versionOf(a.latestSavedVersion), latestProductionReadyVersion: versionOf(a.latestProductionReadyVersion),
  dateModified: a.dateModified,
});

function workspace(ctx) {
  if (!ctx?.kv) throw new GenesysError('The AVA workspace needs the CONFIG KV namespace bound to this Worker (the [[kv_namespaces]] block in wrangler.toml); nothing can be saved without it.', 503);
  return new AvaWorkspace(ctx.kv);
}

// Models routinely pass the AVA's display name as the slug; normalize it.
const slugOf = (s) => slugify(s);

// run_id and test_case_id are path segments inside attempt ids; keep them to
// one segment so the scorecard can split ids back apart unambiguously.
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
function segment(label, value) {
  const v = String(value ?? '').trim();
  if (!SEGMENT_RE.test(v)) throw new GenesysError(`${label} must be one path segment: letters, digits, dot, dash, underscore (got "${value}"). Example: eval-run-2026-09-08-001.`, 400);
  return v;
}

const attemptId = (runId, testCaseId, attempt) => `${runId}/${testCaseId}/attempt-${Math.max(1, Math.floor(attempt || 1))}`;
const manifestId = (runId) => `run-manifest/${runId}`;

// Persist an attempt and add it to the run's manifest, so the scorecard can
// find every attempt by direct key reads as well as by prefix listing (KV
// list is eventually consistent; get after put from the same edge is not).
// The manifest update is a read-modify-write; two attempts persisted in the
// same instant could drop an entry, which the prefix listing then covers.
async function persistAttempt(ws, { slug, runId, testCaseId, attempt, record }) {
  const id = attemptId(runId, testCaseId, attempt);
  await ws.put(slug, 'attempt', id, record);
  const manifest = (await ws.get(slug, 'note', manifestId(runId))) || { run_id: runId, attempts: [] };
  if (!manifest.attempts.includes(id)) manifest.attempts.push(id);
  await ws.put(slug, 'note', manifestId(runId), manifest);
  return id;
}

const VERDICTS = new Set(['pass', 'fail', 'uncertain']);
function assertVerdicts(list, label, dimensions) {
  const bad = (list || []).filter((v) => !VERDICTS.has(v?.verdict));
  if (bad.length) throw new GenesysError(`${label} verdicts must be pass, fail, or uncertain (got ${bad.map((v) => JSON.stringify(v?.verdict)).join(', ')}).`, 400);
  const badDim = (list || []).filter((v) => !dimensions.includes(v?.dimension));
  if (badDim.length) throw new GenesysError(`${label} entries must carry dimension ${dimensions.map((d) => `"${d}"`).join(' | ')} (got ${badDim.map((v) => JSON.stringify(v?.dimension)).join(', ')}); a misspelled dimension would otherwise be dropped and score as a pass.`, 400);
}

// Drain NoOp continuations with a deadline so a slow agent turn cannot run a
// tool call past the MCP client's timeout; a cut-off turn is marked truncated.
async function sendTurnDraining(gc, agentId, sessionId, { text, previousTurnId, version, deadline = Infinity }) {
  let turn = await gc.post(`${sessionsBase(agentId)}/${sessionId}/turns`, buildTurnRequest({ text, previousTurnId, version }));
  let noops = 0;
  let truncated = false;
  while (turn?.nextAction?.type === 'NoOp' && noops < MAX_NOOPS) {
    if (Date.now() > deadline) { truncated = true; break; }
    noops++;
    const cont = await gc.post(`${sessionsBase(agentId)}/${sessionId}/turns`, buildTurnRequest({ text: null, previousTurnId: turn.id, version }));
    turn = mergeTurn(turn, cont);
  }
  return { ...summarizeTurn(turn), ...(truncated ? { truncated: true } : {}) };
}

// ---------- chat (preview sessions against a published version) ----------

const sessionsBase = (agentId) => `/api/v2/apps/agentic/virtualagents/${agentId}/sessions`;
const MAX_NOOPS = 50;

async function startSession(gc, agentId, { version, language, startContext, deadline }) {
  const session = await gc.post(sessionsBase(agentId), {
    version: String(version),
    channel: { name: 'Messaging', inputModes: ['Text'], outputModes: ['Text'], userAgent: { name: 'GenesysWebWidget' } },
    inputData: startContext || {},
    language: language || 'en-us',
  });
  const greeting = await sendTurnDraining(gc, agentId, session.id, { text: null, version, deadline });
  return { sessionId: session.id, ...greeting };
}

// ---------- playbook adapter ----------

const PLAYBOOK_STAGES = ['dispatch', 'design', 'knowledge', 'build', 'test', 'evaluate', 'critique', 'analysis'];

const ADAPTER_NOTE = `> **Hosted adapter (read first).** This playbook is Genesys' own AVA skill, served verbatim
> by genesys-mcp. It was written for a coding IDE with a local \`.ava-lifecycle/\` folder and
> sub-agents. In this server, translate as follows and otherwise follow the playbook exactly:
>
> | Playbook says | Do this here |
> | --- | --- |
> | read/write \`.ava-lifecycle/index.json\` | \`ava_workspace_list\` (no args) lists every AVA session |
> | \`.ava-lifecycle/<slug>/design-artifact.json\` | \`ava_workspace_get/put(slug, "design")\` |
> | \`.ava-lifecycle/<slug>/sage-agent.json\` | \`ava_workspace_get/put(slug, "agent")\` |
> | \`.ava-lifecycle/<slug>/test-cases/<id>.json\` | \`ava_workspace_put(slug, "test_case", id, ...)\` |
> | \`.ava-lifecycle/<slug>/test-sets/<id>.json\` | \`ava_workspace_put(slug, "test_set", id, ...)\` |
> | \`.ava-lifecycle/<slug>/eval-runs/<run>/<case>/attempt-N.json\` | \`ava_run_scripted_scenario\` persists the attempt itself when given slug/run_id; add your judgments with \`ava_record_verdicts\`; for actor-driven attempts use \`ava_workspace_put(slug, "attempt", "<run>/<case>/attempt-N", ...)\` |
> | delete \`.ava-lifecycle/<slug>/\` ("start fresh") | nothing is deleted here; start a new slug (e.g. append -v2) |
> | "check AVA_HABITAT / OAuth credentials in MCP config" | run \`check_connection\`; credentials live in the server's /setup page or Wrangler secrets |
> | \`fetch_all=true\` | list tools already return every match (capped, with a truncated flag) |
> | \`.ava-lifecycle/<slug>/knowledge/*.md\`, \`knowledge-sources.md\` | \`ava_workspace_put(slug, "knowledge", "<file>", {content})\` / kind \`knowledge_sources\` |
> | \`list_resources(resource_type="ava")\` | \`list_avas\` |
> | \`list_resources(resource_type="data_action")\`, \`get_data_action_schema\` | \`list_data_actions\`, \`get_data_action_schema\` |
> | \`list_resources(knowledge_base / knowledge_setting / knowledge_source)\` | \`list_knowledge_assets\` |
> | \`get_ava\`, \`create_ava\` | same names here |
> | \`get_latest_saved_version\` / \`get_latest_published_version\` | \`get_ava_version(ava, "latest_saved" \\| "latest_published")\` |
> | \`create_version\` | \`create_ava_version\` (normalizes the artifact and runs the pre-flight checks for you) |
> | \`publish_version(test_only=true)\` | \`publish_ava_version\` (TestReady by default; production needs \`production: true\` + the user's explicit yes) |
> | \`cicero_start_session\` / \`cicero_send_message\` / \`cicero_end_session\` | \`ava_chat_start\` / \`ava_chat_send\` / \`ava_chat_end\` |
> | \`validate_trajectory\` | \`ava_validate_trajectory\` |
> | \`generate_scorecard(eval_run_dir)\` | \`ava_scorecard(slug, run_id, ava, version)\` |
> | \`generate_critique_report(report, output_dir)\` | \`ava_critique_report(slug, report)\` (returns Markdown; no files) |
> | launch the \`ava-scenario-runner\` sub-agent | \`ava_run_scripted_scenario(slug, run_id, attempt)\` when every turn is \`fixed_user\`/\`fixed_agent\` (it persists the attempt; you add verdicts with \`ava_record_verdicts\`); for actor-driven scenarios run the loop yourself with the chat tools and persist each attempt with \`ava_workspace_put\` |
> | launch \`ava-critique\` / \`ava-design-assist\` sub-agents | do that analysis inline (load the \`analysis\` playbook and its references) |
> | \`create_mock_data_action\` / \`replace_mock_responses\` | NOT available: this server only works with real integrations. Use existing data actions (\`list_data_actions\`, \`get_data_action_schema\`) or create a real one with \`create_data_action\`; write scenarios against real behavior |
> | \`validate_knowledge(paths)\` | \`validate_knowledge\` with inline files or the workspace slug (kind "knowledge") |
> | \`ensure_knowledge_source\` / \`ensure_knowledge_setting\` | same names here |
> | \`upload_knowledge_documents(file_paths, source_context, ...)\` | \`upload_knowledge_documents(source_id, sync_type, confirm_*, files | slug)\`; no source_context argument (the source id is enough); text formats (.md .txt .csv .html); poll \`get_knowledge_sync\` if it returns upload_in_progress |
> | knowledge-upload-result.json / \`upload_result_path\` on \`ensure_knowledge_setting\` | not used here; \`ensure_knowledge_setting(name, source_id, generation_language)\` only. Keep the upload response with \`ava_workspace_put(slug, "note", "knowledge-upload-result", ...)\` if you want it on record |
> | "Task tool", "native file tools", "IDE" | this chat session and the workspace tools |
>
> Reference files named in the playbook are available via \`ava_playbook(stage, reference)\`.

`;

// ---------- the tools ----------

export const AVA_TOOLS = [
  {
    name: 'ava_playbook',
    description: `Load a stage of the Genesys Cloud AVA (agentic virtual agent) lifecycle playbook: Genesys' own AVA skills (${AVA_SKILLS_SOURCE}, MIT, v${AVA_SKILLS_VERSION}), vendored verbatim. ALWAYS load "dispatch" first when the user wants to create, update, test, evaluate, or review an AVA, then follow its routing: design <-> knowledge -> build -> test -> evaluate -> critique. Pass reference to load one of a stage's reference files (e.g. design + "design-constraints", analysis + "cookbook"); pass stage "index" to list everything.`,
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: [...PLAYBOOK_STAGES, 'index'], description: 'Lifecycle stage (or "index")' },
        reference: { type: 'string', description: 'Optional reference file name within the stage (without .md), e.g. "design-constraints"' },
      },
      required: ['stage'],
      additionalProperties: false,
    },
    genesys: false,
    handler: (_gc, a) => {
      if (a.stage === 'index') {
        return {
          source: AVA_SKILLS_SOURCE, release: AVA_SKILLS_RELEASE, version: AVA_SKILLS_VERSION,
          stages: Object.fromEntries(Object.entries(AVA_SKILLS).map(([k, v]) => [k.replace(/^ava-/, ''), { references: Object.keys(v.references).filter((r) => v.references[r].trim()) }])),
          lifecycle: 'dispatch -> design <-> knowledge -> build -> test -> evaluate -> critique (analysis is the cookbook used by critique and design)',
        };
      }
      const skill = AVA_SKILLS[`ava-${a.stage}`];
      if (!skill) throw new GenesysError(`Unknown stage "${a.stage}"`, 404);
      if (a.reference) {
        const ref = skill.references[a.reference.replace(/\.md$/, '')];
        if (!ref) throw new GenesysError(`No reference "${a.reference}" in stage ${a.stage}. Available: ${Object.keys(skill.references).filter((k) => skill.references[k].trim()).join(', ') || '(none)'}`, 404);
        if (!ref.trim()) throw new GenesysError(`Reference "${a.reference}" is empty in the vendored Genesys release (${AVA_SKILLS_RELEASE}); nothing to load.`, 404);
        return ref;
      }
      return ADAPTER_NOTE + skill.skill;
    },
  },

  // ----- AVA entities & versions -----
  {
    name: 'list_avas',
    description: 'List agentic virtual agents (AVAs) in the org: name, id, status (Draft/Published), latest saved and production-ready versions. Filter by name substring; the playbooks say never bulk-list without a filter unless the user asks to browse everything.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name substring (case-insensitive)' },
        status: { type: 'string', enum: ['Draft', 'Published'] },
      },
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const r = await gc.listAll(AVA_BASE, { ...(a.name ? { nameContains: a.name } : {}), ...(a.status ? { status: a.status } : {}) }, { max: 200 });
      return { total: r.total, truncated: r.truncated, avas: r.entities.map(slimAva) };
    },
  },
  {
    name: 'get_ava',
    description: 'Get an AVA by name or id: status and its latest saved / production-ready version numbers. Use get_ava_version to read a version\'s definition.',
    inputSchema: {
      type: 'object',
      properties: { ava: { type: 'string', description: 'AVA name or id' } },
      required: ['ava'],
      additionalProperties: false,
    },
    handler: async (gc, a) => slimAva(await resolveAva(gc, a.ava)),
  },
  {
    name: 'create_ava',
    description: 'Create a new agentic virtual agent entity (name only; the behavior comes from create_ava_version). Idempotent: if an AVA with this exact name exists it is returned instead of duplicated.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'AVA display name (3-100 chars, domain-specific)' } },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const name = String(a.name || '').trim();
      if (name.length < 3 || name.length > 100) throw new GenesysError('name must be 3-100 characters', 400);
      const page = await gc.get(AVA_BASE, { nameContains: name, pageSize: 50 });
      const existing = (page.entities || []).find((e) => e.name?.toLowerCase() === name.toLowerCase());
      if (existing) return { created: false, existing: true, ...slimAva(existing), slug: slugify(name) };
      const created = await gc.post(AVA_BASE, { name });
      return { created: true, ...slimAva(created), slug: slugify(name), next: 'create_ava_version with the definition, then publish_ava_version (TestReady).' };
    },
  },
  {
    name: 'get_ava_version',
    description: 'Get an AVA version with its editable definition (role, instructions, guardrails, tools, types, events, settings). version: "latest_saved" (default; any status), "latest_published" (ProductionReady only), or a number like "1.0".',
    inputSchema: {
      type: 'object',
      properties: {
        ava: { type: 'string', description: 'AVA name or id' },
        version: { type: 'string', description: 'latest_saved | latest_published | "1.0"' },
      },
      required: ['ava'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const ava = await resolveAva(gc, a.ava);
      const which = a.version || 'latest_saved';
      let version = which;
      if (which === 'latest_saved') version = versionOf(ava.latestSavedVersion);
      else if (which === 'latest_published') version = versionOf(ava.latestProductionReadyVersion);
      if (!version) return { ava: slimAva(ava), version: null, note: which === 'latest_published' ? 'No ProductionReady version yet; try latest_saved.' : 'This AVA has no saved versions yet; run create_ava_version.' };
      const v = await gc.get(`${AVA_BASE}/${ava.id}/versions/${version}`);
      return { agentId: ava.id, name: ava.name, version: v.version, status: v.status, dateModified: v.dateModified, definition: v.definition };
    },
  },
  {
    name: 'create_ava_version',
    description: 'Create a new version of an AVA from a definition (role, instructions[], guardrails, tools[], types[], events[], settings). Accepts the design-artifact shape too: it normalizes instructions objects, guardrail arrays, event objects, targetId/targetName, pre/outcomeInstructions, then runs the build playbook\'s pre-flight checks (ToolOutput mapping types, output directions, Start Context naming, External inputs, enum identifiers) and refuses to send a payload that would fail deterministically. Genesys validates the rest server-side; errors are relayed verbatim. After this, publish_ava_version.',
    inputSchema: {
      type: 'object',
      properties: {
        ava: { type: 'string', description: 'AVA name or id' },
        definition: { type: 'object', description: 'The VersionDefinition (see the build playbook and its sage-api-schema reference)', additionalProperties: true },
        skip_preflight: { type: 'boolean', description: 'Send even if pre-flight finds blocking issues (default false)' },
      },
      required: ['ava', 'definition'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const ava = await resolveAva(gc, a.ava);
      const definition = normalizeDefinition(a.definition);
      const pre = preflightDefinition(definition);
      if (!pre.ok && !a.skip_preflight) {
        return { created: false, preflight: pre, note: 'Fix the blocking issues in the design artifact and retry (or skip_preflight: true to let Genesys judge).' };
      }
      const v = await gc.post(`${AVA_BASE}/${ava.id}/versions`, { definition });
      return {
        created: true, agentId: ava.id, name: ava.name, version: v.version, status: v.status,
        preflight: { warnings: pre.warnings, ...(pre.ok ? {} : { errors_overridden: pre.errors }) },
        next: `publish_ava_version(ava, "${v.version}") publishes it as TestReady for chat testing and evaluation.`,
      };
    },
  },
  {
    name: 'publish_ava_version',
    description: 'Publish an AVA version. Default is TestReady: usable for chat sessions, testing, and evaluation, and does NOT route live traffic. production: true publishes ProductionReady, which locks the version contract and routes real conversations to it - only do that after the evaluate and critique stages pass AND the user explicitly says yes to production. Polls the publish job up to ~30s; if still running, poll with get_ava_publish_job.',
    inputSchema: {
      type: 'object',
      properties: {
        ava: { type: 'string', description: 'AVA name or id' },
        version: { type: 'string', description: 'Version number, e.g. "1.0"' },
        production: { type: 'boolean', description: 'true = ProductionReady (live traffic). Default false = TestReady.' },
      },
      required: ['ava', 'version'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const ava = await resolveAva(gc, a.ava);
      const status = a.production ? 'ProductionReady' : 'TestReady';
      const base = `${AVA_BASE}/${ava.id}/versions/${a.version}/jobs`;
      const job = await gc.post(base, { virtualAgentVersion: { status } });
      let state = job;
      // ~30s of polling keeps the call well inside the MCP client timeout.
      for (let i = 0; i < 10 && !['Succeeded', 'Failed'].includes(state.status); i++) {
        await sleep(3000);
        state = await gc.get(`${base}/${job.id}`);
      }
      return {
        agentId: ava.id, name: ava.name, version: a.version, requested: status, jobId: job.id, status: state.status,
        errors: state.errors?.length ? state.errors : undefined,
        tokenCount: state.tokenCount,
        note: state.status === 'Succeeded' ? `Published as ${status}.${status === 'TestReady' ? ' Start a chat with ava_chat_start to try it.' : ' Live traffic now routes to this version.'}`
          : state.status === 'Failed' ? 'Publish failed; the errors above are Genesys\' validation report (details[].fieldName points at the field). Fix the definition and create a new version.'
            : 'Job still running; call get_ava_publish_job with this jobId.',
      };
    },
  },
  {
    name: 'get_ava_publish_job',
    description: 'Check an AVA version publish job (from publish_ava_version). Terminal statuses: Succeeded, Failed.',
    inputSchema: {
      type: 'object',
      properties: { ava: { type: 'string' }, version: { type: 'string' }, job_id: { type: 'string' } },
      required: ['ava', 'version', 'job_id'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const ava = await resolveAva(gc, a.ava);
      const s = await gc.get(`${AVA_BASE}/${ava.id}/versions/${a.version}/jobs/${a.job_id}`);
      return { jobId: a.job_id, status: s.status, errors: s.errors?.length ? s.errors : undefined, tokenCount: s.tokenCount };
    },
  },

  // ----- tools the AVA can call -----
  {
    name: 'list_data_actions',
    description: 'List data actions (the integrations an AVA can call as DataAction tools): id (custom_-_<uuid> form, use it verbatim as the tool target), name, category, integration. Filter by name substring or category.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, category: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const r = await gc.listAll('/api/v2/integrations/actions', { ...(a.name ? { name: a.name } : {}), ...(a.category ? { category: a.category } : {}) }, { max: 200 });
      return { total: r.total, truncated: r.truncated, dataActions: r.entities.map((d) => ({ id: d.id, name: d.name, category: d.category, integrationId: d.integrationId, secure: d.secure })) };
    },
  },
  {
    name: 'get_data_action_schema',
    description: 'Fetch a data action\'s input and success (output) JSON schemas, to build the AVA tool\'s inputs and output type from real field names instead of guessing. Accepts the action name or its full id.',
    inputSchema: {
      type: 'object',
      properties: { data_action: { type: 'string', description: 'Name or full id (custom_-_<uuid>)' } },
      required: ['data_action'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const { id } = await resolveDataAction(gc, a.data_action);
      const [meta, inputSchema, outputSchema] = await Promise.all([
        gc.get(`/api/v2/integrations/actions/${id}`),
        gc.get(`/api/v2/integrations/actions/${id}/schemas/inputschema.json`),
        gc.get(`/api/v2/integrations/actions/${id}/schemas/successschema.json`),
      ]);
      return { dataActionId: id, name: meta.name, category: meta.category, integrationId: meta.integrationId, inputSchema, outputSchema };
    },
  },
  {
    name: 'create_data_action',
    description: 'Create AND publish a data action on an existing integration (Web Services Data Actions or Genesys Cloud Data Actions), so an AVA can call it as a DataAction tool. Provide the HTTP request (method, URL template with ${input.field} placeholders, optional headers and Velocity request template), the input JSON schema, the success JSON schema, and the translation map (output field -> JSONPath into the response). Publishes the draft immediately. The integration itself must already exist and be active for the action to execute at runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        integration: { type: 'string', description: 'Integration name or id' },
        name: { type: 'string' },
        category: { type: 'string', description: 'Grouping label (default: the integration name)' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'Outbound HTTP method (default GET)' },
        url_template: { type: 'string', description: 'Request URL; may use ${input.field} placeholders' },
        headers: { type: 'object', description: 'Request headers', additionalProperties: { type: 'string' } },
        request_template: { type: 'string', description: 'Velocity body template (for POST/PUT/PATCH)' },
        input_schema: { type: 'object', description: 'JSON schema of the inputs ({ type: object, properties, required })', additionalProperties: true },
        success_schema: { type: 'object', description: 'JSON schema of the outputs returned to the caller', additionalProperties: true },
        translation_map: { type: 'object', description: 'output field -> JSONPath into the raw response, e.g. { balance: "$.account.balance" }', additionalProperties: { type: 'string' } },
        translation_map_defaults: { type: 'object', additionalProperties: { type: 'string' } },
        success_template: { type: 'string', description: 'Velocity template shaping the final output (default: pass the translated fields through)' },
        timeout_seconds: { type: 'number' },
        secure: { type: 'boolean' },
      },
      required: ['integration', 'name', 'url_template', 'input_schema', 'success_schema'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const integ = await resolveIntegration(gc, a.integration);
      const schema = (s, title) => ({ $schema: 'http://json-schema.org/draft-04/schema#', title, type: 'object', additionalProperties: true, ...s });
      const body = {
        name: a.name,
        category: a.category || integ.name || 'Custom',
        integrationId: integ.id,
        secure: Boolean(a.secure),
        contract: {
          input: { inputSchema: schema(a.input_schema, `${a.name} Input`) },
          output: { successSchema: schema(a.success_schema, `${a.name} Output`) },
        },
        config: {
          ...(a.timeout_seconds ? { timeoutSeconds: a.timeout_seconds } : {}),
          request: {
            requestUrlTemplate: a.url_template,
            requestType: a.method || 'GET',
            headers: a.headers || {},
            ...(a.request_template ? { requestTemplate: a.request_template } : {}),
          },
          response: {
            translationMap: a.translation_map || {},
            translationMapDefaults: a.translation_map_defaults || {},
            successTemplate: a.success_template || '${rawResult}',
          },
        },
      };
      const draft = await gc.post('/api/v2/integrations/actions/drafts', body);
      const published = await gc.post(`/api/v2/integrations/actions/${draft.id}/draft/publish`, { version: draft.version ?? 1 });
      return { created: true, published: true, id: published.id || draft.id, name: published.name || draft.name, category: published.category, integration: integ.name || integ.id, note: 'Reference it in an AVA tool as target: { id, name }.' };
    },
  },
  {
    name: 'list_knowledge_assets',
    description: 'List the knowledge an AVA can search: knowledge bases, knowledge settings (Knowledge Fabric configurations, attach as a KnowledgeSetting tool), and knowledge sources. Read-only discovery for the design and knowledge playbooks.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Optional name filter (substring, client-side)' } },
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const q = (a.name || '').toLowerCase();
      const pick = (list, f) => (list || []).filter((e) => !q || (e.name || '').toLowerCase().includes(q)).map(f);
      const safe = async (p, query) => { try { return await gc.get(p, query); } catch (e) { return { error: e.message, entities: [] }; } };
      const [kbs, settings, sources] = await Promise.all([
        safe('/api/v2/knowledge/knowledgebases', { pageSize: 100 }),
        safe('/api/v2/knowledge/settings', { pageSize: 100 }),
        safe('/api/v2/knowledge/sources', { pageSize: 100 }),
      ]);
      return {
        knowledgeBases: pick(kbs.entities, (k) => ({ id: k.id, name: k.name, coreLanguage: k.coreLanguage, published: k.published })),
        knowledgeSettings: pick(settings.entities, (s) => ({ id: s.id, name: s.name, sources: (s.sources || []).map((x) => x.id), answerGeneration: s.generationSetting?.answerGeneration })),
        knowledgeSources: pick(sources.entities, (s) => ({ id: s.id, name: s.name, type: s.type })),
        errors: [kbs.error, settings.error, sources.error].filter(Boolean),
      };
    },
  },

  // ----- chat with a published version -----
  {
    name: 'ava_chat_start',
    description: 'Start a text chat session with a published (TestReady or ProductionReady) AVA version and return its greeting and the first turn id. Use for manual testing or the evaluate stage\'s actor loop. Each session is token-billed by Genesys.',
    inputSchema: {
      type: 'object',
      properties: {
        ava: { type: 'string', description: 'AVA name or id' },
        version: { type: 'string', description: 'Published version, e.g. "1.0"' },
        language: { type: 'string', description: 'BCP-47 code (default en-us)' },
        start_context: { type: 'object', description: 'Start context values (InputData properties)', additionalProperties: true },
      },
      required: ['ava', 'version'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const ava = await resolveAva(gc, a.ava);
      const r = await startSession(gc, ava.id, { version: a.version, language: a.language, startContext: a.start_context });
      return { agentId: ava.id, sessionId: r.sessionId, greeting: r.agentText, turnId: r.turnId, nextAction: r.nextAction, isTerminal: r.isTerminal, note: 'Call ava_chat_send with ava = this agentId (skips a name lookup per turn), session_id, previous_turn_id = turnId, and version.' };
    },
  },
  {
    name: 'ava_chat_send',
    description: 'Send a user message to an AVA chat session; returns the agent\'s reply, tool calls and results, guardrail events, and whether the conversation ended. Chain turns by passing the previous turn id.',
    inputSchema: {
      type: 'object',
      properties: {
        ava: { type: 'string' },
        session_id: { type: 'string' },
        text: { type: 'string' },
        previous_turn_id: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['ava', 'session_id', 'text', 'previous_turn_id', 'version'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const deadline = Date.now() + 40000;
      const ava = await resolveAva(gc, a.ava);
      const r = await sendTurnDraining(gc, ava.id, a.session_id, { text: a.text, previousTurnId: a.previous_turn_id, version: a.version, deadline });
      return r.truncated ? { ...r, note: 'The agent was still working when the time budget ran out; send an empty follow-up or ask it to continue.' } : r;
    },
  },
  {
    name: 'ava_chat_end',
    description: 'Mark an AVA chat session finished. Genesys has no explicit end call for preview sessions and this server never sends DELETE, so the session simply expires; this records the end locally.',
    inputSchema: {
      type: 'object',
      properties: { ava: { type: 'string' }, session_id: { type: 'string' } },
      required: ['ava', 'session_id'],
      additionalProperties: false,
    },
    genesys: false,
    handler: (_gc, a) => ({ sessionId: a.session_id, status: 'ended', note: 'Preview sessions expire on their own; nothing was deleted.' }),
  },

  // ----- evaluation -----
  {
    name: 'ava_run_scripted_scenario',
    description: 'Run ONE attempt of an evaluation scenario whose turns are all fixed_user / fixed_agent (no LLM actor) against a published AVA version, server-side: opens a session, plays the scripted user turns, collects the transcript (agent, tool, and system lines), tool calls with their results, and guardrail events, and runs Layer 1 trajectory validation. ended is one of terminal (agent ended the conversation), turns_exhausted (script finished, agent still waiting; judge whether the goal was met), max_turns (not passed), error, time_budget (cut off; treat as infra). When slug + run_id are given the attempt is persisted (layer2 unjudged) and you only need to add your Layer 2 verdicts with ava_record_verdicts. Call once per attempt (attempt: 1, 2, ...). Runs inside a ~30s budget, so keep scripts to a few turns. Scenarios with actor turns must be driven turn by turn with ava_chat_start/ava_chat_send instead.',
    inputSchema: {
      type: 'object',
      properties: {
        ava: { type: 'string', description: 'AVA name or id' },
        version: { type: 'string' },
        scenario: { type: 'object', description: 'The scenario object (name, language, metadata.id, x_eval { turns, start_context, reference_trajectory, max_turns, success_threshold, rubric })', additionalProperties: true },
        attempt: { type: 'number', description: 'Attempt number to run and record (default 1)' },
        slug: { type: 'string', description: 'Lifecycle slug; with run_id, persists the attempt to the workspace' },
        run_id: { type: 'string', description: 'Evaluation run id, e.g. eval-run-2026-09-08-001' },
      },
      required: ['ava', 'version', 'scenario'],
      additionalProperties: false,
    },
    handler: async (gc, a, ctx) => {
      // The clock starts before any network call so the whole tool call stays
      // inside the MCP client's timeout, and everything that can reject (KV
      // binding, key shapes) is checked BEFORE tokens are spent on the run.
      const deadline = Date.now() + 30000;
      const x = a.scenario?.x_eval || a.scenario || {};
      const turns = x.turns?.length ? x.turns : [];
      if (!turns.length || turns.some((t) => !['fixed_user', 'fixed_agent'].includes(t.source))) {
        throw new GenesysError('This scenario has actor (LLM-driven) turns or no turns; run it with ava_chat_start / ava_chat_send and judge it yourself.', 400);
      }
      const attempt = Math.max(1, Math.floor(a.attempt ?? 1));
      const language = a.scenario.language || x.language || 'en-us';
      const testCaseId = segment('test_case_id (scenario.metadata.id)', a.scenario.metadata?.id || slugify(a.scenario.name || 'scenario'));
      let ws = null, slug = null, runId = null;
      if (a.slug || a.run_id) {
        if (!a.slug || !a.run_id) throw new GenesysError('Pass BOTH slug and run_id to persist the attempt (or neither).', 400);
        ws = workspace(ctx);
        slug = slugOf(a.slug);
        runId = segment('run_id', a.run_id);
        AvaWorkspace.check(slug, 'attempt', attemptId(runId, testCaseId, attempt));
      }
      const ava = await resolveAva(gc, a.ava);
      let sessionId;
      const result = await runScriptedAttempt(
        { turns, maxTurns: x.max_turns ?? 10, referenceTrajectory: x.reference_trajectory || [], deadline },
        {
          startSession: async () => { const s = await startSession(gc, ava.id, { version: a.version, language, startContext: x.start_context, deadline }); sessionId = s.sessionId; return s; },
          sendTurn: (text, prev) => sendTurnDraining(gc, ava.id, sessionId, { text, previousTurnId: prev, version: a.version, deadline }),
        },
      );
      const threshold = x.success_threshold ?? DEFAULT_SUCCESS_THRESHOLD;
      const record = {
        test_case_id: testCaseId, name: a.scenario.name, threshold, attempt, ended: result.ended, sessionId,
        layer1: result.layer1, layer2: null, responseMatch: result.responseMatch, transcript: result.transcript, tool_calls: result.toolCalls,
        tool_results: result.toolResults, guardrail_events: result.guardrailEvents, agentId: ava.id, version: a.version,
      };
      let stored = null, storeError;
      if (ws) {
        // Never lose a paid-for run: a storage failure is reported, not thrown.
        try { stored = await persistAttempt(ws, { slug, runId, testCaseId, attempt, record }); } catch (e) { storeError = e.message; }
      }
      return {
        ...record, rubric: x.rubric || [], stored_as: stored, ...(storeError ? { store_error: storeError } : {}),
        next: stored
          ? `Judge each rubric assertion (pass/fail/uncertain + evidence) and set each responseMatch verdict, then ava_record_verdicts(slug "${slug}", run_id "${runId}", test_case_id "${testCaseId}", attempt ${attempt}, layer2, responseMatch). Run the next attempt with attempt: ${attempt + 1} if the scenario asks for more.`
          : `Judge the rubric, then persist with ava_workspace_put(slug, "attempt", "<run_id>/${testCaseId}/attempt-${attempt}", { ...this record, layer2, responseMatch })${storeError ? ' (automatic persistence failed, see store_error)' : ''}.`,
      };
    },
  },
  {
    name: 'ava_record_verdicts',
    description: 'Attach your Layer 2 judgments to a persisted evaluation attempt: layer2 = one entry per rubric assertion { id, dimension (goal|tool_use|guardrail|tone_format), assertion, verdict (pass|fail|uncertain), evidence, reason }, and responseMatch verdicts for fixed_agent turns. Merges into the stored attempt so you never resend the transcript. Then ava_scorecard once every attempt is judged.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' }, run_id: { type: 'string' }, test_case_id: { type: 'string' }, attempt: { type: 'number' },
        layer2: { type: 'array', items: { type: 'object', additionalProperties: true } },
        responseMatch: { type: 'array', items: { type: 'object', additionalProperties: true } },
        ended: { type: 'string', description: 'Override the recorded end reason (e.g. goal) if your judgment differs' },
      },
      required: ['slug', 'run_id', 'test_case_id', 'attempt', 'layer2'],
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => {
      const ws = workspace(ctx);
      const slug = slugOf(a.slug);
      const runId = segment('run_id', a.run_id);
      const id = attemptId(runId, segment('test_case_id', a.test_case_id), a.attempt);
      const current = await ws.get(slug, 'attempt', id);
      if (!current) throw new GenesysError(`No stored attempt "${id}" under slug ${slug}. If it was stored moments ago, wait up to 60 seconds and retry (storage propagates); otherwise run ava_run_scripted_scenario with slug + run_id, or persist the attempt with ava_workspace_put. Do not re-run a scenario just to retry this.`, 404);
      if (!Array.isArray(a.layer2) || !a.layer2.length) throw new GenesysError('layer2 must contain at least one judged rubric assertion (one per rubric entry: goal, tool_use, guardrail, tone_format).', 400);
      assertVerdicts(a.layer2, 'layer2', RUBRIC_DIMENSIONS);
      if (a.responseMatch) assertVerdicts(a.responseMatch, 'responseMatch', ['responseMatch', 'response_match']);
      const patch = { layer2: a.layer2, ...(a.responseMatch ? { responseMatch: a.responseMatch } : {}), ...(a.ended ? { ended: a.ended } : {}) };
      const pending = (patch.responseMatch || current.responseMatch || []).filter((v) => v?.verdict === 'pending').length;
      const saved = await ws.merge(slug, 'attempt', id, patch);
      // Keep the run manifest complete for attempts that were stored by hand.
      const manifest = (await ws.get(slug, 'note', manifestId(runId))) || { run_id: runId, attempts: [] };
      if (!manifest.attempts.includes(id)) { manifest.attempts.push(id); await ws.put(slug, 'note', manifestId(runId), manifest); }
      return { recorded: true, id, key: saved.key, layer2: a.layer2.length, ...(pending ? { warning: `${pending} responseMatch entr${pending === 1 ? 'y is' : 'ies are'} still pending; pass responseMatch with verdicts or the attempt scores as unjudged.` } : {}) };
    },
  },
  {
    name: 'ava_validate_trajectory',
    description: 'Layer 1 deterministic check of an evaluation attempt: compares actual tool calls against the scenario\'s reference trajectory (coverage, missing/unexpected tools, order, param mismatches) and lists guardrail violations. Pure code, no judgment.',
    inputSchema: {
      type: 'object',
      properties: {
        reference: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '[{ tool, params, match: exact|presence, order }]' },
        actual_tool_calls: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '[{ name, input }]' },
        guardrail_events: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      required: ['reference'],
      additionalProperties: false,
    },
    genesys: false,
    handler: (_gc, a) => validateTrajectory(a.reference || [], a.actual_tool_calls || [], a.guardrail_events || []),
  },
  {
    name: 'ava_estimate_eval',
    description: 'Dry-run projection for the evaluate stage: reads a test set and its scenarios from the workspace and returns the projected number of chat calls (sum of attempts x (max_turns + 2)), so the user can confirm before spending tokens.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' }, test_set_id: { type: 'string' } },
      required: ['slug', 'test_set_id'],
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => {
      const ws = workspace(ctx);
      const slug = slugOf(a.slug);
      const set = await ws.get(slug, 'test_set', a.test_set_id);
      if (!set) throw new GenesysError(`No test set "${a.test_set_id}" for slug ${slug}`, 404);
      const ids = (set.test_cases || []).map((t) => (typeof t === 'string' ? t : t.test_case_id));
      const scenarios = [];
      const missing = [];
      for (const id of ids) {
        const s = await ws.get(slug, 'test_case', id);
        if (s) scenarios.push(s); else missing.push(id);
      }
      return { testSetId: a.test_set_id, scenarios: scenarios.length, missing, projectedCalls: projectEvalCalls(scenarios), note: 'Ask the user to confirm before running.' };
    },
  },
  {
    name: 'ava_scorecard',
    description: 'Score an evaluation run once, after every attempt is persisted: reads attempts from the workspace (kind "attempt", ids "<run_id>/<test_case_id>/attempt-N"), blends Layer 1 metrics with the Layer 2 verdicts using the versioned rubric (goal .35, tool_use .25, guardrail .25, responseMatch .10, tone_format .05; pass threshold .6 per dimension), computes each scenario\'s success rate vs threshold, stores the scorecard (kind "scorecard", id run_id), and returns it with a Markdown summary. Alternatively pass per_scenario inline.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        run_id: { type: 'string' },
        ava: { type: 'string', description: 'AVA name or id (for the report header)' },
        version: { type: 'string' },
        per_scenario: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Optional inline [{ testCaseId, name, threshold, attempts: [{ attempt, ended, layer1, layer2, responseMatch }] }]' },
      },
      required: ['slug', 'run_id', 'version'],
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => {
      const ws = workspace(ctx);
      const slug = slugOf(a.slug);
      const runId = segment('run_id', a.run_id);
      let perScenario = a.per_scenario;
      let agentId = a.ava;
      if (!perScenario) {
        // Union of the run manifest (direct keys, read-your-writes) and a prefix
        // listing (catches attempts stored by hand without a manifest entry).
        const ids = new Set(((await ws.get(slug, 'note', manifestId(runId)))?.attempts) || []);
        for (const e of await ws.list(slug, 'attempt')) if (e.id?.startsWith(`${runId}/`)) ids.add(e.id);
        const byCase = new Map();
        for (const id of [...ids].sort()) {
          const caseId = id.slice(runId.length + 1).split('/')[0];
          const data = await ws.get(slug, 'attempt', id);
          if (!data) continue;
          agentId ??= data.agentId;
          if (!byCase.has(caseId)) byCase.set(caseId, { testCaseId: caseId, name: data.name || caseId, threshold: data.threshold, attempts: [] });
          byCase.get(caseId).attempts.push({ attempt: data.attempt, ended: data.ended, layer1: data.layer1 || {}, layer2: data.layer2, responseMatch: data.responseMatch ?? data.response_match ?? [] });
        }
        perScenario = [...byCase.values()].map((s) => ({ ...s, attempts: s.attempts.sort((x, y) => (x.attempt ?? 0) - (y.attempt ?? 0)) }));
        if (!perScenario.length) throw new GenesysError(`No attempts found for run "${runId}" under slug ${slug}. If they were stored moments ago, wait up to 60 seconds and retry; otherwise run ava_run_scripted_scenario with slug + run_id (or persist attempts with ava_workspace_put) first.`, 404);
      }
      if (!agentId) agentId = (await ws.index()).avas.find((x) => x.slug === slug)?.agent_id || slug;
      const scorecard = computeScorecard({ runId, agentId, version: a.version, perScenario });
      const markdown = scorecardMarkdown(scorecard);
      await ws.put(slug, 'scorecard', runId, { ...scorecard, markdown });
      const unjudged = scorecard.perScenario.flatMap((s) => s.attempts.filter((t) => /not_judged/.test(t.error || '')).map((t) => `${s.testCaseId}#${t.attempt}`));
      return { summary: scorecard.summary, markdown, scorecard, ...(unjudged.length ? { warning: `Unjudged attempts scored as infraError: ${unjudged.join(', ')}. Record verdicts with ava_record_verdicts and rerun.` } : {}) };
    },
  },
  {
    name: 'ava_critique_report',
    description: 'Render a critique/analysis report (from the critique and analysis playbooks) as Markdown and store it in the workspace (kind "critique"). Report shape: { target, summary: { prose, top_priorities[] }, errors[], warnings[], info[], positives[] } where each finding is { category, finding, evidence, fix, source }.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        report: { type: 'object', additionalProperties: true },
      },
      required: ['slug', 'report'],
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => {
      const { markdown, overall, counts } = critiqueMarkdown(a.report || {});
      const id = new Date().toISOString().replace(/[:.]/g, '-');
      await workspace(ctx).put(slugOf(a.slug), 'critique', id, { ...a.report, overall, counts, markdown });
      return { id, overall, counts, markdown };
    },
  },

  // ----- lifecycle workspace -----
  {
    name: 'ava_workspace_put',
    description: `Save an AVA lifecycle artifact (replaces the IDE's .ava-lifecycle/ folder). kinds: ${WORKSPACE_KINDS.join(', ')}. design and agent are one per slug (no id); others need an id (test case slug, test set slug, "<run_id>/<test_case_id>/attempt-N", knowledge file name). merge: true shallow-merges into the existing artifact instead of replacing it. Saving a design or agent record also updates the session index. The slug is normalized to kebab-case.`,
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Lifecycle slug (kebab-case of the AVA name)' },
        kind: { type: 'string', enum: WORKSPACE_KINDS },
        id: { type: 'string' },
        data: { type: 'object', additionalProperties: true },
        merge: { type: 'boolean', description: 'Merge into the existing artifact (default false = replace)' },
      },
      required: ['slug', 'kind', 'data'],
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => {
      const ws = workspace(ctx);
      const slug = slugOf(a.slug);
      const r = a.merge ? await ws.merge(slug, a.kind, a.id, a.data) : await ws.put(slug, a.kind, a.id, a.data);
      return { saved: true, slug, ...r };
    },
  },
  {
    name: 'ava_workspace_get',
    description: 'Load an AVA lifecycle artifact by slug, kind, and (for non-singleton kinds) id. Returns found: false when nothing is stored.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' }, kind: { type: 'string', enum: WORKSPACE_KINDS }, id: { type: 'string' } },
      required: ['slug', 'kind'],
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => {
      const data = await workspace(ctx).get(slugOf(a.slug), a.kind, a.id);
      return { found: data != null, data };
    },
  },
  {
    name: 'ava_workspace_list',
    description: 'List AVA lifecycle sessions (no args: the index of every AVA worked on here, with agent_id, version, status) or the artifacts stored for one slug, optionally one kind.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' }, kind: { type: 'string', enum: WORKSPACE_KINDS } },
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => {
      const ws = workspace(ctx);
      if (!a.slug) return { index: await ws.index() };
      const slug = slugOf(a.slug);
      return { slug, artifacts: await ws.list(slug, a.kind) };
    },
  },

  // ----- Knowledge Fabric (what the AVA answers from) -----
  {
    name: 'validate_knowledge',
    description: 'Validate Knowledge Fabric Markdown cards offline before upload (the knowledge playbook\'s rules): card templates and required labels, the mandatory "Audience: End user / Customer" line, chunk size (~100-300 words), vague wording, hidden cross-references, synthetic-content rules, and the file-level "Target: AVA / Scope:" note. Pass files inline or a workspace slug (kind "knowledge"). strict (default) blocks upload on FAIL findings.',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'], additionalProperties: false } },
        slug: { type: 'string' },
        file_names: { type: 'array', items: { type: 'string' } },
        strict: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    genesys: false,
    handler: async (_gc, a, ctx) => validateKnowledgeFiles(await collectKnowledgeFiles(ctx, a), { strict: a.strict !== false }),
  },
  {
    name: 'ensure_knowledge_source',
    description: 'Reuse or create a FileUpload Knowledge Source with an exact, case-sensitive name (confirm the name with the user first; source capacity per org is limited, so prefer reuse). Returns the source id for upload_knowledge_documents.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    handler: async (gc, a) => ensureFileUploadSource(gc, a.name),
  },
  {
    name: 'upload_knowledge_documents',
    description: `Upload text files (${Object.keys(MIME_TYPES).join(', ')}) into a FileUpload Knowledge Source: starts a synchronization, uploads each file, marks it complete, and waits (bounded) for ingestion. Markdown is strictly validated first. sync_type Full REPLACES every file in the source with this set (needs confirm_full_replacement: true); Incremental adds/updates (needs confirm_incremental: true). Confirm the file list and sync type with the user before calling. If it returns upload_in_progress, poll get_knowledge_sync until Completed/Complete, then ensure_knowledge_setting.`,
    inputSchema: {
      type: 'object',
      properties: {
        source_id: { type: 'string' },
        sync_type: { type: 'string', enum: ['Incremental', 'Full'] },
        confirm_full_replacement: { type: 'boolean' },
        confirm_incremental: { type: 'boolean' },
        files: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'], additionalProperties: false } },
        slug: { type: 'string', description: 'Workspace slug: uploads its kind "knowledge" entries (or file_names)' },
        file_names: { type: 'array', items: { type: 'string' } },
      },
      required: ['source_id', 'sync_type'],
      additionalProperties: false,
    },
    handler: async (gc, a, ctx) => {
      if (a.sync_type === 'Full' && !a.confirm_full_replacement) throw new GenesysError('Full synchronization requires confirm_full_replacement: true. Full sync replaces ALL existing files in the Knowledge Source with only the files in this upload.', 400);
      if (a.sync_type === 'Incremental' && !a.confirm_incremental) throw new GenesysError('Incremental synchronization requires confirm_incremental: true.', 400);
      const files = await collectKnowledgeFiles(ctx, a);
      // ~20s of readiness polling keeps the call inside the MCP client timeout;
      // the response tells the model to keep polling with get_knowledge_sync.
      return uploadKnowledgeDocuments(gc, { sourceId: a.source_id, files, syncType: a.sync_type, waitMs: 20000 });
    },
  },
  {
    name: 'get_knowledge_sync',
    description: 'Check a Knowledge Source synchronization (from upload_knowledge_documents): status and ingestionStatus. Ready when status is Completed and ingestionStatus is Complete.',
    inputSchema: { type: 'object', properties: { source_id: { type: 'string' }, synchronization_id: { type: 'string' } }, required: ['source_id', 'synchronization_id'], additionalProperties: false },
    handler: async (gc, a) => {
      const s = await getSynchronization(gc, a.source_id, a.synchronization_id);
      const st = synchronizationState(s);
      return { synchronizationId: s.id, type: s.type, status: s.status, ingestionStatus: s.ingestionStatus, ready: st.done && st.ok, failed: st.done && !st.ok, reason: st.reason, statistics: s.statistics, error: s.error };
    },
  },
  {
    name: 'ensure_knowledge_setting',
    description: 'Reuse or create a Knowledge Configuration (setting) bound exclusively to one FileUpload source, with answer generation and stateful search enabled and the given generation language (BCP-47, e.g. en-US). An existing setting is reused only when compatible (language may be patched). Attach the result to the AVA as a KnowledgeSetting tool: target { id, name }.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, source_id: { type: 'string' }, generation_language: { type: 'string' } },
      required: ['name', 'source_id', 'generation_language'],
      additionalProperties: false,
    },
    handler: async (gc, a) => ensureKnowledgeSetting(gc, { name: a.name, sourceId: a.source_id, generationLanguage: a.generation_language }),
  },

  // ----- deploying the AVA as an Architect bot flow -----
  {
    name: 'build_ava_bot_flow',
    description: 'Compose (without publishing) the Architect BOT FLOW that runs a published AVA (the Call Agentic Virtual Agent action): validates the spec, checks the AVA exists and is ProductionReady, and returns Archy YAML plus a Mermaid diagram. Spec: { name, ava (published AVA name), description?, division?, language?, greeting? (spoken before the agent), inputs?: { start_context_prop: "literal" | { exp } | { noValue } }, outputs?: { end_context_prop: "Flow.varName" }, failure_message?, timeout_message?, escalation_message? }. Show the diagram, get ONE approval, then publish_flow with the yaml. This is the AVA\'s deployable form: it appears in Architect as a bot flow, and Genesys admins attach it to channels from there (Architect only lets an inbound CALL flow invoke a bot flow when a paid non-legacy TTS engine is installed, so this server does not wire bot flows into IVRs; test the agent with ava_chat_start/ava_chat_send instead).',
    inputSchema: {
      type: 'object',
      properties: { spec: { type: 'object', additionalProperties: true } },
      required: ['spec'],
      additionalProperties: false,
    },
    handler: async (gc, a) => {
      const v = validateAvaBotFlowSpec(a.spec);
      if (!v.ok) return { valid: false, errors: v.errors };
      let avaInfo = null;
      const warnings = [];
      try {
        const ava = await resolveAva(gc, a.spec.ava || a.spec.ava_name);
        avaInfo = slimAva(ava);
        if (!avaInfo.latestProductionReadyVersion && !avaInfo.latestSavedVersion) warnings.push('The AVA has no versions yet; Architect only lists published agents.');
        else if (!avaInfo.latestProductionReadyVersion) warnings.push('The AVA has no ProductionReady version; Architect\'s Call Agentic Virtual Agent action runs the latest PUBLISHED version. If publishing the flow fails on the agent reference, publish the AVA version with production: true (the user must approve) and retry.');
        const spec = { ...a.spec, ava: ava.name };
        return { valid: true, ava: avaInfo, warnings: warnings.length ? warnings : undefined, yaml: avaBotFlowToArchyYaml(spec), mermaid: avaBotFlowToMermaid(spec), note: 'Render the mermaid for the user and confirm before publish_flow({ yaml }).' };
      } catch (e) {
        if (e instanceof GenesysError && e.status === 404) return { valid: false, errors: [e.message] };
        throw e;
      }
    },
  },
];

// WRITE = writes to the Genesys Cloud org (or spends its tokens). Workspace
// tools (ava_workspace_put, ava_record_verdicts, ava_scorecard,
// ava_critique_report) only touch this server's own KV and are not flagged.
export const AVA_WRITE_TOOLS = ['create_ava', 'create_ava_version', 'publish_ava_version', 'create_data_action', 'ensure_knowledge_source', 'upload_knowledge_documents', 'ensure_knowledge_setting', 'ava_chat_start', 'ava_chat_send', 'ava_run_scripted_scenario'];

export const AVA_TOOL_GROUP = {
  name: 'Agentic Virtual Agents (AVA)',
  icon: '🧠',
  tools: AVA_TOOLS.map((t) => t.name),
};

// MCP prompts: one per lifecycle stage, surfaced in clients that list prompts
// (Claude Desktop's + menu), so a human can start a stage deliberately.
export const AVA_PROMPTS = [
  { name: 'ava_lifecycle', description: 'Create or update an agentic virtual agent end to end (design, knowledge, build, test, evaluate, critique)', stage: 'dispatch', text: 'I want to work on an agentic virtual agent (AVA) in Genesys Cloud. Load ava_playbook("dispatch") and follow the lifecycle from there. Use the hosted adapter table in the playbook for tools and workspace. Publish as TestReady; only publish to production if I explicitly say so.' },
  { name: 'ava_design', description: 'Design a new AVA (one field at a time, no fabrication)', stage: 'design', text: 'Load ava_playbook("design") and design an agentic virtual agent with me one field at a time, following its interaction protocol. Save the artifact with ava_workspace_put(slug, "design").' },
  { name: 'ava_build', description: 'Build and publish (TestReady) an AVA from its design artifact', stage: 'build', text: 'Load ava_playbook("build") and build the AVA from its design artifact in the workspace: create_ava, create_ava_version, publish_ava_version (TestReady), then save the agent record.' },
  { name: 'ava_test', description: 'Author turn-based evaluation scenarios for a published AVA', stage: 'test', text: 'Load ava_playbook("test") and author evaluation scenarios and a test set for my published AVA, saving them with ava_workspace_put.' },
  { name: 'ava_evaluate', description: 'Run the evaluation scenarios and produce a scorecard', stage: 'evaluate', text: 'Load ava_playbook("evaluate"). Estimate the run with ava_estimate_eval, confirm with me, drive each scenario (ava_run_scripted_scenario or the chat tools), judge the rubric, persist attempts, then ava_scorecard.' },
  { name: 'ava_critique', description: 'Review an AVA definition against Genesys best practices', stage: 'critique', text: 'Load ava_playbook("critique") and ava_playbook("analysis") (with its quick-guide and cookbook references) and critique my AVA. Render the report with ava_critique_report.' },
];
