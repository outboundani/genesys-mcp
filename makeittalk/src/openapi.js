// OpenAPI / Swagger detection and extraction. Finding a machine-readable spec
// is the jackpot path: endpoints come straight from the source instead of
// prose. JSON specs only (YAML noted as a follow-up; most public APIs publish
// JSON at a well-known path).

export const WELL_KNOWN_SPEC_PATHS = [
  '/openapi.json', '/openapi.v1.json', '/swagger.json', '/api/openapi.json',
  '/api/swagger.json', '/v1/openapi.json', '/v2/api-docs', '/v3/api-docs',
  '/.well-known/openapi.json', '/api-docs/openapi.json', '/docs/openapi.json',
  '/spec/openapi.json', '/api.json',
];

export function looksLikeOpenApi(text) {
  if (!text) return false;
  const head = text.slice(0, 4000);
  return /"(openapi|swagger)"\s*:\s*"/.test(head) && /"paths"\s*:/.test(text);
}

export function parseOpenApi(rawText, sourceUrl) {
  let spec;
  try { spec = JSON.parse(rawText); } catch { return null; }
  if (!spec || typeof spec !== 'object' || !spec.paths) return null;

  const info = spec.info || {};
  const baseUrl = resolveBaseUrl(spec, sourceUrl);
  const auth = resolveAuth(spec);

  const endpoints = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    if (!ops || typeof ops !== 'object') continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = ops[method];
      if (!op || typeof op !== 'object') continue;
      const params = [...(ops.parameters || []), ...(op.parameters || [])]
        .filter((p) => p && p.name)
        .map((p) => ({
          name: p.name,
          in: p.in || 'query',
          required: Boolean(p.required),
          type: p.schema?.type || p.type || 'string',
          description: String(p.description || '').slice(0, 200),
        }));
      const bodyProps = extractBodyProps(op, spec);
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: String(op.summary || op.operationId || op.description || '').slice(0, 200),
        params,
        body: bodyProps,
        source_url: sourceUrl,
      });
      if (endpoints.length >= 500) break;
    }
    if (endpoints.length >= 500) break;
  }
  if (!endpoints.length) return null;

  return {
    title: String(info.title || 'API').slice(0, 100),
    description: String(info.description || '').slice(0, 1000),
    base_url: baseUrl,
    auth,
    endpoints,
    from_spec: true,
  };
}

function resolveBaseUrl(spec, sourceUrl) {
  try {
    if (Array.isArray(spec.servers) && spec.servers[0]?.url) {
      let u = spec.servers[0].url;
      // Substitute server variables with their defaults, e.g. {region}.
      for (const [name, v] of Object.entries(spec.servers[0].variables || {})) {
        u = u.replaceAll(`{${name}}`, v.default ?? '');
      }
      return new URL(u, sourceUrl).toString().replace(/\/+$/, '');
    }
    if (spec.host) {
      const scheme = (spec.schemes || ['https'])[0];
      return `${scheme}://${spec.host}${spec.basePath || ''}`.replace(/\/+$/, '');
    }
  } catch { /* fall through */ }
  const u = new URL(sourceUrl);
  return `${u.protocol}//${u.host}`;
}

function resolveAuth(spec) {
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
  for (const s of Object.values(schemes)) {
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'http' && s.scheme === 'bearer') return { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' };
    if (s.type === 'http' && s.scheme === 'basic') return { type: 'basic' };
    if (s.type === 'apiKey' && s.in === 'header') return { type: 'api_key_header', header: s.name || 'X-API-Key', prefix: '' };
    if (s.type === 'apiKey' && s.in === 'query') return { type: 'query_param', param: s.name || 'api_key' };
    if (s.type === 'oauth2') {
      const flow = s.flows?.clientCredentials || (s.flow === 'application' ? s : null);
      if (flow) {
        return {
          type: 'oauth2_client_credentials',
          token_url: flow.tokenUrl || '',
          scopes: Object.keys(flow.scopes || {}).slice(0, 10).join(' '),
        };
      }
      return { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' };
    }
  }
  return { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' };
}

function extractBodyProps(op, spec) {
  try {
    let schema = op.requestBody?.content?.['application/json']?.schema
      || op.requestBody?.content?.['application/x-www-form-urlencoded']?.schema
      || (op.parameters || []).find((p) => p.in === 'body')?.schema;
    if (schema?.$ref) schema = derefOnce(schema.$ref, spec);
    if (!schema?.properties) return [];
    return Object.entries(schema.properties).slice(0, 25).map(([name, p]) => ({
      name,
      type: p?.type || 'string',
      required: Array.isArray(schema.required) && schema.required.includes(name),
      description: String(p?.description || '').slice(0, 150),
    }));
  } catch { return []; }
}

function derefOnce(ref, spec) {
  if (!ref.startsWith('#/')) return null;
  let node = spec;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node;
}
