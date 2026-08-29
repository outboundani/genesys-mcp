// The generation engine: link in, MCP out. Runs inside ctx.waitUntil after
// POST /api/projects/:id/generate returns, writing progress events to D1 that
// the dashboard polls. Stages:
//
//   read    - fetch the source URL (or take pasted text)
//   spec    - hunt for a machine-readable OpenAPI spec (the jackpot path)
//   crawl   - otherwise, Claude picks the API-reference pages worth reading
//   map     - distill everything into an API map (auth, base URL, endpoints)
//   design  - Claude designs the MCP toolset from the map + the user's goal
//   ready   - validate, save the manifest, flip status
//
// Credentials never enter any prompt: Claude sees documentation text only.

import { claudeJson, extractJson, DEFAULT_MODEL } from './anthropic.js';
import { fetchPage } from './htmltext.js';
import { WELL_KNOWN_SPEC_PATHS, looksLikeOpenApi, parseOpenApi } from './openapi.js';
import { validateManifest } from './manifest.js';
import { clampStr, now } from './util.js';

const MAX_DOC_PAGES = 10;
const PAGE_CHAR_BUDGET = 15000;

export async function emit(env, projectId, stage, level, message, meta = null) {
  await env.DB.prepare(
    'INSERT INTO events (project_id, ts, stage, level, message, meta) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(projectId, now(), stage, level, message, meta ? JSON.stringify(meta).slice(0, 4000) : '').run();
}

export async function runGeneration(env, projectId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
  if (!project) return;
  const model = project.model || DEFAULT_MODEL;

  try {
    let apiMap;
    if (project.source_text && !project.source_url) {
      await emit(env, projectId, 'read', 'info', `Reading ${project.source_text.length.toLocaleString()} characters of pasted documentation`);
      apiMap = await mapFromPages(env, projectId, model, [{ url: 'pasted-docs', text: project.source_text.slice(0, 120000) }], project);
    } else {
      apiMap = await mapFromUrl(env, projectId, model, project);
    }

    await env.DB.prepare('UPDATE projects SET api_map = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(apiMap).slice(0, 400000), now(), projectId).run();
    await emit(env, projectId, 'map', 'ok',
      `API mapped: ${apiMap.endpoints.length} endpoints, auth type "${apiMap.auth?.type}", base ${apiMap.base_url}`);

    const manifest = await designTools(env, projectId, model, project, apiMap);

    await env.DB.prepare(
      "UPDATE projects SET manifest = ?, status = 'ready', error = '', updated_at = ? WHERE id = ?"
    ).bind(JSON.stringify(manifest), now(), projectId).run();
    await emit(env, projectId, 'ready', 'ok',
      `MCP server ready: ${manifest.tools.length} tools + api_call escape hatch. Connect it from the Connect tab.`);
  } catch (e) {
    await env.DB.prepare("UPDATE projects SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
      .bind(String(e.message).slice(0, 1000), now(), projectId).run();
    await emit(env, projectId, 'error', 'error', `Generation failed: ${e.message}`);
  }
}

async function mapFromUrl(env, projectId, model, project) {
  const startUrl = normalizeUrl(project.source_url);
  await emit(env, projectId, 'read', 'info', `Fetching ${startUrl}`);
  let entry;
  try {
    entry = await fetchPage(startUrl);
  } catch (e) {
    throw new Error(`Could not fetch ${startUrl}: ${e.message}`);
  }
  if (entry.status >= 400) throw new Error(`${startUrl} answered HTTP ${entry.status} - is the link public?`);
  await emit(env, projectId, 'read', 'ok', `Read ${entry.url} (${entry.text.length.toLocaleString()} chars, ${entry.links.length} links)`);

  // Jackpot check 1: the URL itself is a spec.
  if (entry.raw && looksLikeOpenApi(entry.raw)) {
    const parsed = parseOpenApi(entry.raw, entry.url);
    if (parsed) {
      await emit(env, projectId, 'spec', 'ok', `That link IS an OpenAPI spec: "${parsed.title}" with ${parsed.endpoints.length} endpoints`, { url: entry.url });
      return finishSpecMap(parsed);
    }
  }

  // Jackpot check 2: well-known spec paths + spec-looking links on the page.
  await emit(env, projectId, 'spec', 'info', 'Hunting for a machine-readable OpenAPI spec');
  const origin = new URL(entry.url).origin;
  const candidates = [
    ...WELL_KNOWN_SPEC_PATHS.map((p) => origin + p),
    ...entry.links.filter((l) => /openapi|swagger|\.json/i.test(l.url)).map((l) => l.url).slice(0, 6),
  ];
  const specMap = await huntSpec(env, projectId, dedupe(candidates).slice(0, 18));
  if (specMap) return finishSpecMap(specMap);
  await emit(env, projectId, 'spec', 'info', 'No spec found - reading the docs like a human instead');

  // Crawl: Claude picks which linked pages document the API.
  const pages = [{ url: entry.url, text: entry.text.slice(0, PAGE_CHAR_BUDGET) }];
  if (entry.links.length) {
    const picked = await pickDocLinks(env, model, entry, project.goal);
    if (picked.length) {
      await emit(env, projectId, 'crawl', 'info', `Reading ${picked.length} documentation pages Claude flagged as API reference`, { urls: picked });
      const fetched = await Promise.all(picked.slice(0, MAX_DOC_PAGES - 1).map(async (u) => {
        try {
          const p = await fetchPage(u);
          if (p.status < 400 && p.text.length > 300) {
            if (p.raw && looksLikeOpenApi(p.raw)) {
              const parsed = parseOpenApi(p.raw, p.url);
              if (parsed) return { spec: parsed };
            }
            return { url: p.url, text: p.text.slice(0, PAGE_CHAR_BUDGET) };
          }
        } catch { /* skip unreachable page */ }
        return null;
      }));
      const late = fetched.find((f) => f?.spec);
      if (late) {
        await emit(env, projectId, 'spec', 'ok', `Found an OpenAPI spec while crawling: ${late.spec.endpoints.length} endpoints`);
        return finishSpecMap(late.spec);
      }
      for (const f of fetched) if (f) pages.push(f);
      for (const f of fetched) {
        if (f) await emit(env, projectId, 'crawl', 'ok', `Read ${f.url} (${f.text.length.toLocaleString()} chars)`);
      }
    }
  }

  return mapFromPages(env, projectId, model, pages, project);
}

function finishSpecMap(parsed) {
  return {
    title: parsed.title,
    description: parsed.description,
    base_url: parsed.base_url,
    auth: parsed.auth,
    endpoints: parsed.endpoints,
    from_spec: true,
  };
}

async function huntSpec(env, projectId, urls) {
  for (const url of urls) {
    try {
      const p = await fetchPage(url, { timeoutMs: 8000 });
      if (p.status < 400 && p.raw && looksLikeOpenApi(p.raw)) {
        const parsed = parseOpenApi(p.raw, p.url);
        if (parsed) {
          await emit(env, projectId, 'spec', 'ok', `Found OpenAPI spec at ${p.url}: "${parsed.title}" with ${parsed.endpoints.length} endpoints`, { url: p.url });
          return parsed;
        }
      }
    } catch { /* try next */ }
  }
  return null;
}

async function pickDocLinks(env, model, entry, goal) {
  const linkList = entry.links.slice(0, 250).map((l) => `${l.url} | ${l.label}`).join('\n');
  try {
    const { data } = await claudeJson(env, {
      model,
      system: 'You triage documentation sites for an MCP generator. You pick the pages most likely to contain concrete API reference material: endpoints, HTTP methods, parameters, authentication.',
      prompt: `Page: ${entry.url}\n\nPage text (excerpt):\n${clampStr(entry.text, 6000)}\n\nLinks found on the page (url | label):\n${clampStr(linkList, 20000)}\n\n${goal ? `The user wants an MCP focused on: ${goal}\n\n` : ''}Pick up to 8 links that most likely document the HTTP API itself (authentication guide + endpoint reference beat marketing pages). Same site or official docs subdomains only.`,
      toolName: 'pick_links',
      toolDescription: 'Report the documentation links worth fetching.',
      schema: {
        type: 'object',
        properties: { urls: { type: 'array', items: { type: 'string' }, maxItems: 8 } },
        required: ['urls'],
      },
      max_tokens: 2000,
    });
    const base = new URL(entry.url);
    return dedupe((data.urls || [])
      .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
      .filter((u) => sameSite(new URL(u), base)))
      .slice(0, 8);
  } catch {
    // Heuristic fallback: obvious reference-ish links.
    return dedupe(entry.links
      .filter((l) => /(api|reference|endpoint|auth|docs|rest)/i.test(l.url + ' ' + l.label))
      .map((l) => l.url))
      .slice(0, 6);
  }
}

function sameSite(a, b) {
  const root = (h) => h.split('.').slice(-2).join('.');
  return root(a.hostname) === root(b.hostname);
}

const MAP_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    base_url: { type: 'string', description: 'https base URL every endpoint path is relative to' },
    auth: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['none', 'bearer', 'api_key_header', 'basic', 'query_param', 'oauth2_client_credentials'] },
        header: { type: 'string' },
        prefix: { type: 'string' },
        param: { type: 'string' },
        token_url: { type: 'string' },
        scopes: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['type'],
    },
    endpoints: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          method: { type: 'string' },
          path: { type: 'string' },
          summary: { type: 'string' },
          params: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                in: { type: 'string', enum: ['path', 'query', 'body', 'header'] },
                required: { type: 'boolean' },
                type: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['name', 'in'],
            },
          },
          source_url: { type: 'string' },
        },
        required: ['method', 'path', 'summary'],
      },
    },
  },
  required: ['title', 'base_url', 'auth', 'endpoints'],
};

async function mapFromPages(env, projectId, model, pages, project) {
  await emit(env, projectId, 'map', 'info', `Distilling ${pages.length} page(s) into an API map with Claude`);
  const docBundle = pages.map((p) => `===== SOURCE: ${p.url} =====\n${p.text}`).join('\n\n');
  const { data, usage } = await claudeJson(env, {
    model,
    system: 'You reverse-engineer HTTP APIs from their documentation with total fidelity. You never invent endpoints: every endpoint you report must be visibly documented in the provided text, and you carry the exact paths, methods, and parameter names through unchanged.',
    prompt: `Documentation:\n\n${clampStr(docBundle, 160000)}\n\n${project.goal ? `The user cares most about: ${project.goal}\n\n` : ''}Build the API map. Include the authentication scheme exactly as documented (which header, what prefix, where keys come from - put anything notable in auth.notes). List every concrete documented endpoint (up to 120) with its parameters and, for each, the source_url of the page it came from.`,
    toolName: 'report_api_map',
    toolDescription: 'Report the distilled API map.',
    schema: MAP_SCHEMA,
    max_tokens: 32000,
  });
  if (!Array.isArray(data.endpoints) || !data.endpoints.length) {
    throw new Error('Claude could not find any documented HTTP endpoints at that source. Try linking directly to the API reference section.');
  }
  await emit(env, projectId, 'map', 'info',
    `Claude read ${(usage?.input_tokens || 0).toLocaleString()} tokens of docs and reported ${data.endpoints.length} endpoints`);
  data.from_spec = false;
  return data;
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    server: {
      type: 'object',
      properties: { name: { type: 'string' }, description: { type: 'string' }, base_url: { type: 'string' } },
      required: ['name', 'description', 'base_url'],
    },
    auth: MAP_SCHEMA.properties.auth,
    tools: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'snake_case verb_noun, e.g. list_customers' },
          description: { type: 'string' },
          input_schema: { type: 'object', description: 'JSON Schema object for the tool arguments' },
          request: {
            type: 'object',
            properties: {
              method: { type: 'string' },
              path: { type: 'string', description: 'May contain {param} segments' },
              query: { type: 'object', description: 'Map of query param -> "$argname" or literal' },
              headers: { type: 'object' },
              body: { type: ['object', 'null'], description: 'JSON body template with "$argname" placeholders; the value "$$rest" inserts all not-yet-used args as an object; null to auto-map leftover args' },
              content_type: { type: 'string', enum: ['json', 'form'] },
            },
            required: ['method', 'path'],
          },
          provenance: {
            type: 'object',
            properties: { url: { type: 'string' }, note: { type: 'string' } },
          },
        },
        required: ['name', 'description', 'input_schema', 'request'],
      },
    },
    cred_fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, label: { type: 'string' } },
        required: ['key', 'label'],
      },
      description: 'Credential inputs the owner must supply, e.g. [{"key":"api_key","label":"Secret API key"}]',
    },
  },
  required: ['server', 'auth', 'tools'],
};

async function designTools(env, projectId, model, project, apiMap) {
  await emit(env, projectId, 'design', 'info', 'Designing the MCP toolset (names, schemas, request mappings)');
  const endpointDigest = apiMap.endpoints.slice(0, 200).map((e) =>
    `${e.method} ${e.path} - ${e.summary}${e.params?.length ? ` [params: ${e.params.map((p) => `${p.name}(${p.in}${p.required ? ',req' : ''})`).join(', ')}]` : ''}${e.body?.length ? ` [body: ${e.body.map((b) => b.name).join(', ')}]` : ''}${e.source_url ? ` <${e.source_url}>` : ''}`
  ).join('\n');

  const { data } = await claudeJson(env, {
    model,
    system: `You design MCP servers the way genesys-mcp and five9-mcp were designed: a curated toolbox an AI operator can actually wield, not a 1:1 dump of every endpoint. Rules:
- 8 to 25 tools. Pick the endpoints a user would genuinely reach for; a generic api_call escape hatch exists for the rest.
- Tool names are snake_case verb_noun (list_x, get_x, create_x, update_x, search_x).
- Descriptions are written for the AI that will call them: what it does, when to use it, gotchas. First sentence stands alone.
- input_schema is honest JSON Schema: required only what the API requires, describe every property, use enums where documented.
- request.path uses {param} for path params (they auto-bind to same-named args). request.query maps query params to "$argname". request.body is a JSON template with "$argname" placeholders, or null to auto-map leftover args. Use content_type "form" only when the API documents form encoding.
- Prefer safe reads plus high-value creates/updates. Skip DELETE endpoints entirely.
- provenance.url: the docs page that documents that endpoint. provenance.note: one line on where/how you found it.
- Never invent endpoints, params, or auth details not present in the API map.`,
    prompt: `API map for "${apiMap.title}":\nBase URL: ${apiMap.base_url}\nAuth: ${JSON.stringify(apiMap.auth)}\nDescription: ${clampStr(apiMap.description || '', 800)}\n\nEndpoints:\n${clampStr(endpointDigest, 60000)}\n\n${project.goal ? `The user's stated goal for this MCP: ${project.goal}\nWeight tool selection toward that goal.\n\n` : ''}Design the MCP server "${project.slug}". Also report cred_fields: the exact credential inputs the owner must paste for auth type "${apiMap.auth?.type}" (match the API's own vocabulary, e.g. "Secret key", "Personal access token").`,
    toolName: 'report_mcp_design',
    toolDescription: 'Report the complete MCP server design.',
    schema: DESIGN_SCHEMA,
    max_tokens: 48000,
  });

  data.auth = data.auth || apiMap.auth;
  data.auth.fields = data.cred_fields?.length ? data.cred_fields : data.auth.fields;
  if (!data.server.base_url) data.server.base_url = apiMap.base_url;

  const { manifest, warnings } = validateManifest(data, { allowDelete: Boolean(project.allow_delete) });
  for (const w of warnings) await emit(env, projectId, 'design', 'warn', w);

  for (const t of manifest.tools) {
    await emit(env, projectId, 'design', 'ok', `Tool: ${t.name} -> ${t.request.method} ${t.request.path}`, {
      tool: t.name, provenance: t.provenance,
    });
  }
  await env.DB.prepare('UPDATE projects SET cred_fields = ? WHERE id = ?')
    .bind(JSON.stringify(manifest.auth.fields || []), projectId).run();
  return manifest;
}

function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const parsed = new URL(u);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) URLs are supported.');
  // Basic SSRF hygiene: refuse obvious internal targets.
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/i.test(parsed.hostname) || !parsed.hostname.includes('.')) {
    throw new Error('That host looks private/internal - makeittalk only reads public documentation.');
  }
  return parsed.toString();
}

const dedupe = (arr) => Array.from(new Set(arr));
