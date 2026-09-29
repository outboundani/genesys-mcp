// Pure safety rails for the raw API tool (genesys_api_call). No I/O here, so
// everything that decides "is this call allowed" is unit tested in
// test/rules.test.mjs.
//
// The guard runs on the path string BEFORE any URL is built, and new URL()
// would resolve dot segments, strip tabs/newlines, and turn backslashes into
// slashes. So step one refuses anything the URL parser or Genesys could read
// differently than we do; only then is the path matched against an
// ALLOWLIST. A blocklist cannot keep up with a 1,000+ endpoint API.
//
// Promises this module enforces for the raw tool:
//   - nothing dials: no live conversations, no campaign/sequence status other
//     than "off", no campaign rules/schedules/callbacks, no contact made callable
//   - nothing goes live without a human: flow and AVA publishing only through
//     the typed tools (publish_flow, publish_ava_version)
//   - no deletes, by any verb
//   - no credential, OAuth, or role/authorization writes

// ---------- path + query normalization ----------

const SEGMENT = /^[A-Za-z0-9._-]+$/;

function checkPath(raw) {
  if (typeof raw !== 'string' || !raw) return 'Refused: path is required.';
  if (!raw.startsWith('/api/v2/')) return 'Refused: path must start with /api/v2/.';
  if (/[%]/.test(raw)) return 'Refused: the path may not contain percent-encoding (%). Pass ids and names as plain text; query parameters go in `query`.';
  if (/[;\\#?]/.test(raw)) return 'Refused: the path may not contain ;, \\, #, or ? - pass query parameters in `query`.';
  if (/\s/.test(raw)) return 'Refused: the path may not contain whitespace or control characters.';
  const segments = raw.slice(1).split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return 'Refused: empty, "." and ".." path segments are not allowed.';
  if (segments.some((s) => !SEGMENT.test(s))) return 'Refused: path segments may only contain letters, digits, ".", "_", and "-".';
  return null;
}

function checkQuery(query) {
  if (query === undefined || query === null) return null;
  if (typeof query !== 'object' || Array.isArray(query)) return 'Refused: query must be an object of name/value pairs.';
  const keys = Object.keys(query);
  if (keys.some((k) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(k))) return 'Refused: query parameter names must be plain identifiers.';
  const lower = keys.map((k) => k.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Refused: duplicate query parameters (including case variants) are not allowed.';
  if (Object.values(query).some((v) => v !== null && v !== undefined && !['string', 'number', 'boolean'].includes(typeof v))) {
    return 'Refused: query values must be single scalars (string, number, or boolean).';
  }
  return null;
}

// {"campaignStatus":"off","CampaignStatus":"on"} is harmless to a
// case-sensitive binder and ignition to a case-insensitive one. Refuse the
// ambiguity outright.
const MAX_DEPTH = 12;
function hasCaseDuplicateKeys(v, depth = 0) {
  if (!v || typeof v !== 'object') return false;
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(v)) return v.some((x) => hasCaseDuplicateKeys(x, depth + 1));
  const keys = Object.keys(v).map((k) => k.toLowerCase());
  if (new Set(keys).size !== keys.length) return true;
  return Object.values(v).some((x) => hasCaseDuplicateKeys(x, depth + 1));
}

function tooDeep(v, depth = 0) {
  if (!v || typeof v !== 'object') return false;
  if (depth > MAX_DEPTH) return true;
  return Object.values(v).some((x) => tooDeep(x, depth + 1));
}

// Every value under a key matching `keyRe` (case-insensitive), at any depth,
// optionally skipping subtrees whose key matches `skipRe`.
function collect(v, keyRe, skipRe, out = [], depth = 0) {
  if (!v || typeof v !== 'object' || depth > MAX_DEPTH) return out;
  if (Array.isArray(v)) { for (const x of v) collect(x, keyRe, skipRe, out, depth + 1); return out; }
  for (const [k, x] of Object.entries(v)) {
    if (keyRe.test(k)) out.push(x);
    if (skipRe && skipRe.test(k)) continue;
    collect(x, keyRe, skipRe, out, depth + 1);
  }
  return out;
}

// Only the literal "off" (any case, surrounding whitespace ignored) is off.
// true, 1, "on", "ON", "stopping", objects, arrays: all refused.
export function isOff(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'off';
}

// ---------- the allowlist ----------

// Genesys ids: GUIDs, plus data action ids like custom_-_<guid> and contact
// ids. An {id} slot must never match a literal sibling route (PUT
// routingskills/bulk replaces the whole set; contacts/bulk, campaigns/progress
// and friends are different endpoints), so those words are excluded.
const RESERVED = 'bulk|search|query|actions|action|jobs|job|drafts|draft|export|import|progress|all|divisionviews|me|members|start|stop|schedule|schedules|callback|callbacks|publish|execute|test|sessions|turns|versions|contacts|phonenumbers|uploads|synchronizations|wrapupcodes';
const ID = `(?!(?:${RESERVED})$)[A-Za-z0-9][A-Za-z0-9_-]*`;
const GUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
const R = (s) => new RegExp(`^/api/v2/${s.replace(/\{guid\}/g, GUID).replace(/\{id\}/g, ID)}$`);

// Non-GET (method, path) pairs the raw tool may send: the resource families
// the typed tools build, and nothing else.
export const WRITE_FAMILIES = [
  ['routing/queues', [['POST', 'routing/queues'], ['PUT', 'routing/queues/{id}'], ['POST', 'routing/queues/{id}/wrapupcodes']]],
  ['routing/skills', [['POST', 'routing/skills']]],
  ['routing/wrapupcodes', [['POST', 'routing/wrapupcodes'], ['PUT', 'routing/wrapupcodes/{id}']]],
  ['users search + user routing skills', [['POST', 'users/search'], ['POST', 'users/{guid}/routingskills'], ['PUT', 'users/{guid}/routingskills/{guid}'], ['PATCH', 'users/{guid}/routingskills/bulk']]], // PUT bulk replaces the set (removes skills): not listed
  ['architect/schedules + schedulegroups', [['POST', 'architect/schedules'], ['PUT', 'architect/schedules/{id}'], ['POST', 'architect/schedulegroups'], ['PUT', 'architect/schedulegroups/{id}']]],
  ['flows (create, edit, checkout/checkin/unlock, export; publish only via publish_flow)', [['POST', 'flows'], ['PUT', 'flows/{id}'], ['POST', 'flows/actions/checkout'], ['POST', 'flows/actions/checkin'], ['POST', 'flows/actions/unlock'], ['POST', 'flows/export/jobs']]],
  ['outbound contactlists + contacts', [['POST', 'outbound/contactlists'], ['PUT', 'outbound/contactlists/{id}'], ['POST', 'outbound/contactlists/{id}/contacts'], ['PUT', 'outbound/contactlists/{id}/contacts/{id}']]],
  ['outbound attemptlimits', [['POST', 'outbound/attemptlimits'], ['PUT', 'outbound/attemptlimits/{id}']]],
  ['outbound callabletimesets', [['POST', 'outbound/callabletimesets'], ['PUT', 'outbound/callabletimesets/{id}']]],
  ['outbound dnclists (add numbers only)', [['POST', 'outbound/dnclists'], ['PUT', 'outbound/dnclists/{id}'], ['POST', 'outbound/dnclists/{id}/phonenumbers']]],
  ['outbound campaigns (always off)', [['POST', 'outbound/campaigns'], ['PUT', 'outbound/campaigns/{id}'], ['PATCH', 'outbound/campaigns/{id}']]],
  ['outbound sequences (always off)', [['POST', 'outbound/sequences'], ['PUT', 'outbound/sequences/{id}']]],
  ['agentic virtual agents + versions (publish only via publish_ava_version)', [['POST', 'agentic/virtualagents'], ['POST', 'agentic/virtualagents/{id}/versions']]],
  ['AVA test chat sessions', [['POST', 'apps/agentic/virtualagents/{id}/sessions'], ['POST', 'apps/agentic/virtualagents/{id}/sessions/{id}/turns']]],
  ['knowledge sources, synchronizations, settings', [['POST', 'knowledge/sources'], ['POST', 'knowledge/sources/{id}/synchronizations'], ['PATCH', 'knowledge/sources/{id}/synchronizations/{id}'], ['POST', 'knowledge/sources/{id}/synchronizations/{id}/uploads'], ['POST', 'knowledge/settings'], ['PATCH', 'knowledge/settings/{id}']]],
  ['integrations data action drafts', [['POST', 'integrations/actions/drafts'], ['PATCH', 'integrations/actions/{id}/draft'], ['POST', 'integrations/actions/{id}/draft/publish']]],
];

const WRITES = WRITE_FAMILIES.flatMap(([, pairs]) => pairs.map(([m, p]) => [m, R(p)]));

export const ALLOWED_WRITE_SUMMARY = WRITE_FAMILIES.map(([name]) => name).join('; ');

// ---------- explicit refusals (checked before the allowlist for precise messages) ----------

const LIVE = /^\/api\/v2\/conversations(\/|$)/i;
const CREDENTIAL_READS = /^\/api\/v2\/(oauth|tokens|integrations\/credentials|authorization\/(roles|subjects|permissions))(\/|$)/i;
const CREDENTIALS = /^\/api\/v2\/(oauth|authorization|tokens|integrations\/credentials)(\/|$)/i;
const AGENT_LIVE = /^\/api\/v2\/users\/[^/]+\/(presence|routingstatus|station)(\/|$)|^\/api\/v2\/(users\/[^/]+\/presences|apps\/[^/]+\/presences|stations)(\/|$)|^\/api\/v2\/presence\//i;
const FLOW_PUBLISH = /^\/api\/v2\/flows\/(jobs|actions\/(publish|deactivate|revert))(\/|$)/i;
const AVA_PUBLISH = /^\/api\/v2\/agentic\/virtualagents\/[^/]+\/versions\/[^/]+\/jobs(\/|$)/i;
const DATA_ACTION_RUN = /^\/api\/v2\/integrations\/actions\/[^/]+\/(execute|test|draft\/execute|draft\/test)(\/|$)/i;
const OUTBOUND_IGNITION = /^\/api\/v2\/outbound\/(campaignrules|schedules|messagingcampaigns|digitalrulesets|rulesets|previews|conversations)(\/|$)|^\/api\/v2\/outbound\/(campaigns|sequences)\/[^/]+\/(start|stop|on|callback|agentownedmappingpreview)(\/|$)|^\/api\/v2\/architect\/ivrs(\/|$)/i;
const DELETEISH = /(^|\/)[^/]*(delete|remove|purge|clear|wipe)[^/]*(\/|$)/i;

const CAMPAIGN_PATH = /^\/api\/v2\/outbound\/campaigns(\/[^/]+)?$/i;
const SEQUENCE_PATH = /^\/api\/v2\/outbound\/sequences(\/[^/]+)?$/i;
const CONTACT_PATH = /^\/api\/v2\/outbound\/contactlists\/[^/]+\/contacts(\/[^/]+)?$/i;

const IGNITION_MSG = 'Refused: this server never starts campaigns or sequences, and never dials. Campaign and sequence writes must set campaignStatus/status to "off"; a human presses go in Admin > Outbound > Campaign Management.';

export function refusalFor(method, path, body, query) {
  const m = String(method || '').toUpperCase();
  if (m === 'DELETE') return 'Refused: this server ships no deletes, and the raw tool refuses DELETE by design.';
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(m)) return `Refused: method ${m || '(none)'} is not allowed. Use GET, POST, PUT, or PATCH.`;

  // 1. Normalize: refuse anything that could be read two ways.
  const pathErr = checkPath(path);
  if (pathErr) return pathErr;
  const queryErr = checkQuery(query);
  if (queryErr) return queryErr;

  // Credential and role reads are refused too (matches ringcx-mcp): OAuth clients,
  // tokens, and role grants are not contact center config.
  if (m === 'GET' && CREDENTIAL_READS.test(path)) return 'Refused: OAuth clients, tokens, credentials, and authorization/role data are out of scope for the raw tool, reads included. View those in Admin > Integrations / Roles.';
  if (m === 'GET') return null; // reads stay broad once the path is clean; responses are redacted

  // 2. Body shape.
  if (body !== undefined && body !== null && typeof body !== 'object') return 'Refused: the body must be a JSON object or array.';
  if (tooDeep(body)) return `Refused: the body nests deeper than ${MAX_DEPTH} levels.`;
  if (hasCaseDuplicateKeys(body)) return 'Refused: the body repeats a field name with different casing.';

  // 3. Explicit refusals, most specific message first.
  if (LIVE.test(path)) return 'Refused: /api/v2/conversations is live interaction control (placing, transferring, disconnecting, recording calls and chats). This server never places or touches live calls; a human does that in Genesys Cloud.';
  if (CREDENTIALS.test(path)) return 'Refused: OAuth, token, credential, and authorization/role writes could mint or escalate access. Manage those in Admin > Integrations / Roles.';
  if (AGENT_LIVE.test(path)) return 'Refused: presence, routing status, and station writes put real agents on or off queue. A human does that.';
  if (FLOW_PUBLISH.test(path)) return 'Refused: flows go live only through the typed publish_flow tool (after the user approves the diagram). Deactivating or reverting a flow is a human decision in Architect.';
  if (AVA_PUBLISH.test(path)) return 'Refused: AVA versions publish only through publish_ava_version (TestReady by default; production needs the user\'s explicit yes).';
  if (DATA_ACTION_RUN.test(path)) return 'Refused: executing or testing a data action calls an external system with the integration\'s stored credentials. Run it from Admin > Integrations > Actions.';
  if (OUTBOUND_IGNITION.test(path)) return `${IGNITION_MSG} Campaign rules, schedules, callbacks, previews, messaging campaigns, rule sets, and IVR/DNIS routing are out of scope for the raw tool.`;
  if (DELETEISH.test(path)) return 'Refused: this server ships no deletes, including POST/PUT/PATCH "delete", "remove", "purge", and "clear" endpoints.';
  if (query && Object.keys(query).some((k) => /^(delete|remove|clearsystemdata)$/i.test(k) && query[k] !== false && String(query[k]).toLowerCase() !== 'false')) {
    return 'Refused: delete/remove/clearSystemData query flags are not allowed (they delete data or reset contacts so they dial again).';
  }

  // 4. Allowlist.
  if (!WRITES.some(([wm, re]) => wm === m && re.test(path))) {
    return `Refused: ${m} ${path} is not on the raw tool's write allowlist. Raw writes are limited to the families the typed tools build: ${ALLOWED_WRITE_SUMMARY}. GETs are allowed anywhere under /api/v2/.`;
  }

  // 5. Body rules for the allowed writes.
  const b = body ?? {};

  if (CAMPAIGN_PATH.test(path) || SEQUENCE_PATH.test(path)) {
    if (Array.isArray(b)) return 'Refused: campaign and sequence writes take a single JSON object body.';
    const topKey = CAMPAIGN_PATH.test(path) ? 'campaignStatus' : 'status';
    if (m !== 'PATCH' && !isOff(b[topKey])) return `${IGNITION_MSG} (${m} must carry ${topKey}: "off" explicitly.)`;
    const statuses = collect(b, /^(campaignstatus|status)$/i);
    if (statuses.some((s) => !isOff(s))) return IGNITION_MSG;
  }

  if (CONTACT_PATH.test(path)) {
    // Contact data columns (under "data") are the customer's own fields and
    // may be named anything; the dialing flags live outside it.
    const flags = collect(b, /^(callable|contactable)$/i, /^data$/i);
    const contacts = Array.isArray(b) ? b : [b];
    if (flags.some((f) => f !== false) || contacts.some((c) => !c || typeof c !== 'object' || c.callable !== false)) {
      return 'Refused: contacts written through the raw tool must land uncallable (callable: false, and no contactable: true). Making a contact dialable is a human decision; add_contacts is the typed path for staging callable contacts.';
    }
  }

  return null;
}

// ---------- response redaction ----------

// Credential-named fields some GETs return (OAuth client secrets, integration
// credentials, passwords). Numbers and booleans pass through, so AVA token
// COUNTS survive; paging cursors are not secrets either.
const SECRET_KEY = /passw|secret|token|api_?key|credential/i;
const NOT_SECRET = /^(next|prev|previous)?_?page_?token$|^(next|prev|previous)_?token$/i;

export function redactSecrets(value, depth = 0) {
  if (depth > 64) return '[truncated]';
  if (Array.isArray(value)) return value.map((x) => redactSecrets(x, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const secret = SECRET_KEY.test(k) && !NOT_SECRET.test(k) && v !== null && v !== '' && typeof v !== 'number' && typeof v !== 'boolean';
    out[k] = secret ? '[redacted]' : redactSecrets(v, depth + 1);
  }
  return out;
}
