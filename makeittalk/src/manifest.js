// The manifest is makeittalk's core artifact: a declarative description of a
// generated MCP server - its tools, the HTTP request each tool performs, and
// how the target API authenticates. One universal runtime (mcpserve.js)
// executes any manifest; the exporter turns one into a standalone Worker.
//
// Tool request templates use two placeholder forms:
//   "$argname"  - replaced by the tool-call argument of that name (any JSON type)
//   "$$rest"    - object position only; spreads all arguments not used elsewhere
// Path templates use {argname} segments, e.g. /v1/customers/{id}.

const NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const AUTH_TYPES = ['none', 'bearer', 'api_key_header', 'basic', 'query_param', 'oauth2_client_credentials'];

// Validates + normalizes a manifest produced by the engine (or edited by a
// user). Returns { manifest, warnings } or throws with a readable message.
export function validateManifest(input, { allowDelete = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Manifest must be an object.');
  const warnings = [];

  const server = input.server || {};
  const baseUrl = String(server.base_url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/.test(baseUrl)) throw new Error(`server.base_url must be an https URL (got "${baseUrl}").`);

  const auth = normalizeAuth(input.auth, warnings);

  const rawTools = Array.isArray(input.tools) ? input.tools : [];
  if (!rawTools.length) throw new Error('Manifest has no tools.');
  const seen = new Set();
  const tools = [];
  for (const t of rawTools) {
    try {
      const tool = normalizeTool(t);
      if (tool.request.method === 'DELETE' && !allowDelete) {
        warnings.push(`Dropped tool "${tool.name}": DELETE endpoints are excluded by default (enable "allow deletes" in project settings to keep them).`);
        continue;
      }
      if (seen.has(tool.name)) { warnings.push(`Dropped duplicate tool name "${tool.name}".`); continue; }
      seen.add(tool.name);
      tools.push(tool);
    } catch (e) {
      warnings.push(`Dropped invalid tool ${JSON.stringify(t?.name ?? '?')}: ${e.message}`);
    }
  }
  if (!tools.length) throw new Error('No valid tools survived validation.');
  if (tools.length > 40) {
    warnings.push(`Trimmed manifest from ${tools.length} to 40 tools.`);
    tools.length = 40;
  }

  return {
    manifest: {
      version: 1,
      server: {
        name: String(server.name || 'generated-mcp').slice(0, 64),
        description: String(server.description || '').slice(0, 2000),
        base_url: baseUrl,
      },
      auth,
      tools,
    },
    warnings,
  };
}

function normalizeAuth(a, warnings) {
  a = a && typeof a === 'object' ? a : {};
  let type = String(a.type || 'none');
  if (!AUTH_TYPES.includes(type)) {
    warnings.push(`Unknown auth type "${type}" - defaulting to bearer.`);
    type = 'bearer';
  }
  const fields = (Array.isArray(a.fields) ? a.fields : [])
    .filter((f) => f && typeof f.key === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(f.key))
    .map((f) => ({ key: f.key, label: String(f.label || f.key).slice(0, 80) }))
    .slice(0, 6);
  const defaults = {
    none: [],
    bearer: [{ key: 'token', label: 'API token' }],
    api_key_header: [{ key: 'api_key', label: 'API key' }],
    basic: [{ key: 'username', label: 'Username' }, { key: 'password', label: 'Password' }],
    query_param: [{ key: 'api_key', label: 'API key' }],
    oauth2_client_credentials: [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client secret' }],
  };
  return {
    type,
    header: String(a.header || (type === 'api_key_header' ? 'X-API-Key' : 'Authorization')).slice(0, 60),
    prefix: String(a.prefix ?? (type === 'bearer' ? 'Bearer ' : '')).slice(0, 30),
    param: String(a.param || 'api_key').slice(0, 60),
    token_url: String(a.token_url || '').slice(0, 300),
    scopes: String(a.scopes || '').slice(0, 300),
    fields: fields.length ? fields : defaults[type],
  };
}

function normalizeTool(t) {
  if (!t || typeof t !== 'object') throw new Error('not an object');
  const name = String(t.name || '');
  if (!NAME_RE.test(name)) throw new Error(`name must match ${NAME_RE}`);
  const req = t.request || {};
  const method = String(req.method || 'GET').toUpperCase();
  if (!METHODS.includes(method)) throw new Error(`bad method "${req.method}"`);
  const path = String(req.path || '');
  if (!path.startsWith('/')) throw new Error(`path must start with / (got "${path}")`);

  const schema = t.input_schema && typeof t.input_schema === 'object' && t.input_schema.type === 'object'
    ? t.input_schema
    : { type: 'object', properties: {}, additionalProperties: true };
  if (!schema.properties || typeof schema.properties !== 'object') schema.properties = {};
  // Every {segment} in the path must exist in the schema so the model knows to supply it.
  for (const seg of path.match(/\{([a-z0-9_]+)\}/gi) || []) {
    const key = seg.slice(1, -1);
    if (!schema.properties[key]) schema.properties[key] = { type: 'string', description: `Path parameter "${key}"` };
    schema.required = Array.from(new Set([...(schema.required || []), key]));
  }

  return {
    name,
    description: String(t.description || '').slice(0, 1500) || `${method} ${path}`,
    input_schema: schema,
    request: {
      method,
      path,
      query: plainStringMap(req.query),
      headers: plainStringMap(req.headers),
      body: req.body && typeof req.body === 'object' ? req.body : null,
      content_type: req.content_type === 'form' ? 'form' : 'json',
    },
    provenance: {
      url: String(t.provenance?.url || '').slice(0, 500),
      note: String(t.provenance?.note || '').slice(0, 300),
    },
  };
}

function plainStringMap(obj) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === 'string' && k.length <= 80 && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
        out[k] = String(v);
      }
    }
  }
  return out;
}

// ---------- request building ----------

// Builds { url, method, headers, body } for a tool call. Pure - auth is
// injected separately so this stays testable without secrets.
export function buildRequest(manifest, tool, args) {
  args = args && typeof args === 'object' ? args : {};
  const used = new Set();

  let path = tool.request.path.replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
    if (args[key] === undefined || args[key] === null || args[key] === '') {
      throw new Error(`Missing required path parameter "${key}".`);
    }
    used.add(key);
    return encodeURIComponent(String(args[key]));
  });

  const url = new URL(manifest.server.base_url + path);
  for (const [k, v] of Object.entries(tool.request.query || {})) {
    const resolved = resolvePlaceholder(v, args, used);
    if (resolved !== undefined && resolved !== null && resolved !== '') url.searchParams.set(k, String(resolved));
  }

  const headers = {};
  for (const [k, v] of Object.entries(tool.request.headers || {})) {
    const resolved = resolvePlaceholder(v, args, used);
    if (resolved !== undefined && resolved !== null && resolved !== '') headers[k] = String(resolved);
  }

  let body;
  const method = tool.request.method;
  if (method !== 'GET') {
    let payload;
    if (tool.request.body) {
      payload = substituteDeep(tool.request.body, args, used);
    } else {
      // No explicit template: remaining args become the body.
      payload = {};
      for (const [k, v] of Object.entries(args)) if (!used.has(k)) payload[k] = v;
    }
    if (payload !== undefined && payload !== null && !(typeof payload === 'object' && !Object.keys(payload).length)) {
      if (tool.request.content_type === 'form') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = formEncode(payload);
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(payload);
      }
    }
  } else {
    // GET: unused args become query params so "extra" model arguments still work.
    for (const [k, v] of Object.entries(args)) {
      if (!used.has(k) && !url.searchParams.has(k) && v !== undefined && v !== null && v !== '' && typeof v !== 'object') {
        url.searchParams.set(k, String(v));
      }
    }
  }

  return { url: url.toString(), method, headers, body };
}

function resolvePlaceholder(value, args, used) {
  if (typeof value === 'string' && value.startsWith('$') && !value.startsWith('$$')) {
    const key = value.slice(1);
    used.add(key);
    return args[key];
  }
  return value;
}

function substituteDeep(node, args, used) {
  if (typeof node === 'string') {
    if (node === '$$rest') {
      const rest = {};
      for (const [k, v] of Object.entries(args)) if (!used.has(k)) rest[k] = v;
      return rest;
    }
    return resolvePlaceholder(node, args, used);
  }
  if (Array.isArray(node)) {
    return node.map((n) => substituteDeep(n, args, used)).filter((n) => n !== undefined);
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const resolved = substituteDeep(v, args, used);
      if (resolved !== undefined) out[k] = resolved;
    }
    return out;
  }
  return node;
}

// application/x-www-form-urlencoded with Stripe-style bracket nesting for
// objects/arrays, which is what most form APIs expect.
export function formEncode(obj, prefix = '', pairs = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') formEncode(item, `${key}[${i}]`, pairs);
        else pairs.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      formEncode(v, key, pairs);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return pairs.join('&');
}

// ---------- auth injection ----------

// OAuth2 client-credentials tokens cached per project within an isolate.
const oauthTokenCache = new Map();

export async function applyAuth({ manifest, creds, projectId, url, headers }) {
  const auth = manifest.auth || { type: 'none' };
  creds = creds || {};
  switch (auth.type) {
    case 'none':
      return { url, headers };
    case 'bearer': {
      const token = firstCred(creds, ['token', 'api_key', 'key']);
      headers[auth.header || 'Authorization'] = `${auth.prefix ?? 'Bearer '}${token}`;
      return { url, headers };
    }
    case 'api_key_header': {
      const key = firstCred(creds, ['api_key', 'token', 'key']);
      headers[auth.header || 'X-API-Key'] = `${auth.prefix || ''}${key}`;
      return { url, headers };
    }
    case 'basic': {
      const user = creds.username ?? creds.client_id ?? firstCred(creds, ['username']);
      const pass = creds.password ?? creds.client_secret ?? '';
      headers['Authorization'] = `Basic ${btoa(`${user}:${pass}`)}`;
      return { url, headers };
    }
    case 'query_param': {
      const key = firstCred(creds, ['api_key', 'token', 'key']);
      const u = new URL(url);
      u.searchParams.set(auth.param || 'api_key', key);
      return { url: u.toString(), headers };
    }
    case 'oauth2_client_credentials': {
      const token = await oauthClientCredentialsToken({ auth, creds, projectId });
      headers['Authorization'] = `Bearer ${token}`;
      return { url, headers };
    }
    default:
      throw new Error(`Unsupported auth type "${auth.type}".`);
  }
}

function firstCred(creds, keys) {
  for (const k of keys) if (creds[k]) return creds[k];
  const any = Object.values(creds).find((v) => typeof v === 'string' && v);
  if (any) return any;
  throw new Error('No credentials are stored for this project - add them in the dashboard (Credentials tab).');
}

async function oauthClientCredentialsToken({ auth, creds, projectId }) {
  const cached = oauthTokenCache.get(projectId);
  if (cached && cached.exp > Date.now()) return cached.token;
  if (!auth.token_url) throw new Error('This API uses OAuth2 client credentials but no token_url is configured.');
  if (!creds.client_id || !creds.client_secret) throw new Error('OAuth2 needs client_id and client_secret credentials.');
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (auth.scopes) body.set('scope', auth.scopes);
  const res = await fetch(auth.token_url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${creds.client_id}:${creds.client_secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth2 token request failed (HTTP ${res.status}): ${data.error_description || data.error || 'no access_token returned'}`);
  }
  const exp = Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000;
  oauthTokenCache.set(projectId, { token: data.access_token, exp });
  return data.access_token;
}

export function invalidateOauthToken(projectId) {
  oauthTokenCache.delete(projectId);
}
