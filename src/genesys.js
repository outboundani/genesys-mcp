// Genesys Cloud Platform API client - zero-dependency, region-aware, with
// module-level token caching (client-credentials tokens live ~24h, so one
// login serves many Worker requests within an isolate's lifetime).

export class GenesysError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'GenesysError';
    this.status = status;
    this.code = code;
  }
}

// Region = the domain suffix shared by login.<region> and api.<region>.
// The 18 core regions from Genesys' "AWS regions for Genesys Cloud deployment"
// table. The client secret is sent to login.<region>, so only these exact
// domains are accepted: a typo or a hostile value can never point the server
// (and the secret) at a host Genesys does not own.
export const REGIONS = [
  'mypurecloud.com',        // Americas (US East, Virginia)
  'use2.us-gov-pure.cloud', // US East 2 (Ohio), FedRAMP
  'usw2.pure.cloud',        // Americas (US West, Oregon)
  'cac1.pure.cloud',        // Americas (Canada)
  'sae1.pure.cloud',        // Americas (Sao Paulo)
  'mxc1.pure.cloud',        // Mexico (Central)
  'mypurecloud.de',         // EMEA (Frankfurt)
  'mypurecloud.ie',         // EMEA (Dublin)
  'euw2.pure.cloud',        // EMEA (London)
  'euc2.pure.cloud',        // EMEA (Zurich)
  'edee1.eusc-pure.cloud',  // European Sovereign Region (Brandenburg)
  'mec1.pure.cloud',        // EMEA (UAE)
  'aps1.pure.cloud',        // Asia Pacific (Mumbai)
  'mypurecloud.jp',         // Asia Pacific (Tokyo)
  'apne2.pure.cloud',       // Asia Pacific (Seoul)
  'apne3.pure.cloud',       // Asia Pacific (Osaka)
  'apse1.pure.cloud',       // Asia Pacific (Singapore)
  'mypurecloud.com.au',     // Asia Pacific (Sydney)
];

// Shorthand ("usw2") only for the *.pure.cloud regions, whose first label is
// unique. "mypurecloud" is ambiguous and FedRAMP / Sovereign need the full domain.
const SHORTHAND = new Map(REGIONS.filter((d) => d.endsWith('.pure.cloud')).map((d) => [d.split('.')[0], d]));

export function normalizeRegion(region) {
  const r = String(region || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^(login|api|apps)\./, '').replace(/\/?(#.*)?$/, '');
  if (!r) return 'mypurecloud.com';
  if (REGIONS.includes(r)) return r;
  if (SHORTHAND.has(r)) return SHORTHAND.get(r);
  throw new GenesysError(`Unknown Genesys Cloud region "${String(region).slice(0, 60)}". Use the domain from your login address, one of: ${REGIONS.join(', ')}.`, 400, 'unknown_region');
}

// clientId|region → { token, exp (ms epoch) }
const tokenCache = new Map();

export class GenesysClient {
  constructor({ clientId, clientSecret, region }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.region = normalizeRegion(region);
    this.loginUrl = `https://login.${this.region}`;
    this.apiUrl = `https://api.${this.region}`;
  }

  async token() {
    const key = `${this.clientId}|${this.region}`;
    const cached = tokenCache.get(key);
    if (cached && cached.exp > Date.now()) return cached.token;

    const res = await fetch(`${this.loginUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const body = await res.text();
      let detail = body.slice(0, 200);
      try { detail = JSON.parse(body).description || JSON.parse(body).error || detail; } catch { /* keep raw */ }
      throw new GenesysError(
        `Genesys login failed (HTTP ${res.status}) at ${this.loginUrl}: ${detail}. ` +
        `Check the OAuth client id/secret (Client Credentials grant, with a role assigned) and the region.`,
        res.status
      );
    }
    const data = await res.json();
    // Refresh 5 minutes early.
    const exp = Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000;
    tokenCache.set(key, { token: data.access_token, exp });
    return data.access_token;
  }

  invalidateToken() {
    tokenCache.delete(`${this.clientId}|${this.region}`);
  }

  // Core request helper. `path` must start with /api/. Retries once on 401
  // (stale cached token) and once on 429 (honoring small Retry-After values).
  async api(method, path, { body, query, _retried } = {}) {
    if (!path.startsWith('/api/')) throw new GenesysError(`API path must start with /api/ (got ${path})`, 400);
    const url = new URL(this.apiUrl + path);
    // Defense in depth: if the URL parser rewrote the path (dot segments,
    // backslashes, stripped control characters), refuse rather than send a
    // request to a path nobody validated.
    if (url.pathname !== path || url.host !== new URL(this.apiUrl).host) {
      throw new GenesysError(`API path was rewritten by URL parsing (${path} -> ${url.pathname}); refusing to send.`, 400);
    }
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && !_retried) {
      this.invalidateToken();
      return this.api(method, path, { body, query, _retried: true });
    }
    if (res.status === 429 && !_retried) {
      const wait = Math.min(Number(res.headers.get('Retry-After') || 3), 15);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.api(method, path, { body, query, _retried: true });
    }
    if (res.status === 204) return { ok: true };
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : { ok: true }; } catch { data = { raw: text.slice(0, 500) }; }
    if (!res.ok) {
      const msg = data.message || data.description || data.error || `HTTP ${res.status}`;
      throw new GenesysError(`${method} ${path} failed: ${msg}`, res.status, data.code);
    }
    return data;
  }

  get(path, query) { return this.api('GET', path, { query }); }
  post(path, body, query) { return this.api('POST', path, { body, query }); }
  put(path, body, query) { return this.api('PUT', path, { body, query }); }
  patch(path, body, query) { return this.api('PATCH', path, { body, query }); }

  // Collect paged list results ({entities, pageCount, pageNumber, total}).
  // Caps at `max` entities so a huge org can't blow up a tool response.
  async listAll(path, query = {}, { max = 500 } = {}) {
    const out = [];
    let pageNumber = 1;
    let total = null;
    for (;;) {
      const page = await this.get(path, { pageSize: Math.min(100, max), ...query, pageNumber });
      total = page.total ?? total;
      out.push(...(page.entities || []));
      if (out.length >= max || !page.pageCount || pageNumber >= page.pageCount) break;
      pageNumber++;
    }
    return { entities: out.slice(0, max), total: total ?? out.length, truncated: total != null && total > Math.min(out.length, max) };
  }
}
