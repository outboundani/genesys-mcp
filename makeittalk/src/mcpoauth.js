// Per-project OAuth 2.1 for MCP clients (claude.ai custom connectors, Claude
// Desktop, ChatGPT). Same stateless design proven in genesys-mcp: client ids,
// auth codes, and tokens are HMAC-signed blobs - no storage. The signing
// secret is derived from the platform ENCRYPTION_KEY plus the project's MCP
// key hash, so rotating a project key invalidates all of its tokens.
//
// Every project lives on one origin, so discovery metadata is path-scoped
// (RFC 9728 / RFC 8414 path-insertion form):
//   /.well-known/oauth-protected-resource/mcp/<slug>
//   /.well-known/oauth-authorization-server/mcp/<slug>
// and the endpoints themselves sit under /mcp/<slug>/{register,authorize,token}.

import { mintToken, readToken, sha256b64url, sha256hex, timingSafeEqual } from './crypto.js';
import { json, esc, html } from './util.js';

const ACCESS_TTL = 30 * 24 * 3600;
const REFRESH_TTL = 180 * 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);

function projectSecret(env, project) {
  return `${env.ENCRYPTION_KEY || 'dev'}::${project.mcp_key_hash}`;
}

export async function checkMcpAuth(request, env, project) {
  if (!project.mcp_key_hash) return false;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  const presented = header.slice(7).trim();
  // Raw project key works directly...
  if (timingSafeEqual(await sha256hex(presented), project.mcp_key_hash)) return true;
  // ...or an OAuth access token minted below.
  const payload = await readToken(projectSecret(env, project), presented);
  return payload?.t === 'a';
}

export function unauthorizedMcp(request, slug) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/${slug}"`,
    },
  });
}

// Routes OAuth-related paths; returns null when the path isn't ours.
export async function handleMcpOAuth(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const origin = url.origin;

  let m = path.match(/^\/\.well-known\/oauth-protected-resource\/mcp\/([a-z0-9-]+)$/);
  if (m) {
    return json({
      resource: `${origin}/mcp/${m[1]}`,
      authorization_servers: [`${origin}/mcp/${m[1]}`],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    });
  }

  m = path.match(/^\/\.well-known\/oauth-authorization-server(\/mcp\/([a-z0-9-]+))?$/);
  if (m && m[2]) {
    const base = `${origin}/mcp/${m[2]}`;
    return json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    });
  }

  m = path.match(/^\/mcp\/([a-z0-9-]+)\/(register|authorize|token)$/);
  if (!m) return null;
  const [, slug, endpoint] = m;
  const project = await env.DB.prepare('SELECT * FROM projects WHERE slug = ?').bind(slug).first();
  if (!project || !project.mcp_key_hash) return json({ error: 'unknown_mcp' }, 404);
  const secret = projectSecret(env, project);

  if (endpoint === 'register' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_client_metadata' }, 400); }
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
    if (!redirectUris.length) return json({ error: 'invalid_redirect_uri' }, 400);
    const clientId = await mintToken(secret, { t: 'client', r: redirectUris });
    return json({
      client_id: clientId,
      redirect_uris: redirectUris,
      client_name: body.client_name || 'MCP client',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }, 201);
  }

  if (endpoint === 'authorize' && request.method === 'GET') {
    const q = url.searchParams;
    const client = await readToken(secret, q.get('client_id'));
    const redirectUri = q.get('redirect_uri') || '';
    if (client?.t !== 'client' || !client.r.includes(redirectUri)) {
      return authPage(slug, { error: 'Unknown client or redirect URI. Re-add the connector so it re-registers.' });
    }
    if (q.get('response_type') !== 'code' || !q.get('code_challenge') || q.get('code_challenge_method') !== 'S256') {
      return authPage(slug, { error: 'This server requires response_type=code with S256 PKCE.' });
    }
    return authPage(slug, {
      clientId: q.get('client_id'),
      redirectUri,
      state: q.get('state') || '',
      codeChallenge: q.get('code_challenge'),
    });
  }

  if (endpoint === 'authorize' && request.method === 'POST') {
    const form = await request.formData();
    const key = String(form.get('access_key') || '');
    const clientId = String(form.get('client_id') || '');
    const redirectUri = String(form.get('redirect_uri') || '');
    const state = String(form.get('state') || '');
    const codeChallenge = String(form.get('code_challenge') || '');
    const client = await readToken(secret, clientId);
    if (client?.t !== 'client' || !client.r.includes(redirectUri) || !codeChallenge) {
      return authPage(slug, { error: 'Invalid authorization request. Re-add the connector and try again.' });
    }
    if (!timingSafeEqual(await sha256hex(key), project.mcp_key_hash)) {
      return authPage(slug, { clientId, redirectUri, state, codeChallenge, error: 'Wrong MCP key - copy it from your makeittalk dashboard (Connect tab).' });
    }
    const code = await mintToken(secret, { t: 'code', ru: redirectUri, cc: codeChallenge, exp: now() + 600 });
    const sep = redirectUri.includes('?') ? '&' : '?';
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectUri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}` },
    });
  }

  if (endpoint === 'token' && request.method === 'POST') {
    const form = await request.formData();
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = await readToken(secret, form.get('code'));
      if (code?.t !== 'code') return json({ error: 'invalid_grant' }, 400);
      const redirectUri = form.get('redirect_uri');
      if (redirectUri && redirectUri !== code.ru) return json({ error: 'invalid_grant' }, 400);
      const verifier = form.get('code_verifier') || '';
      if (!verifier || (await sha256b64url(verifier)) !== code.cc) {
        return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
      }
      return json(await issueTokens(secret));
    }
    if (grantType === 'refresh_token') {
      const refresh = await readToken(secret, form.get('refresh_token'));
      if (refresh?.t !== 'r') return json({ error: 'invalid_grant' }, 400);
      return json(await issueTokens(secret));
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  return null;
}

async function issueTokens(secret) {
  return {
    access_token: await mintToken(secret, { t: 'a', exp: now() + ACCESS_TTL }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: await mintToken(secret, { t: 'r', exp: now() + REFRESH_TTL }),
    scope: 'mcp',
  };
}

function authPage(slug, { clientId, redirectUri, state, codeChallenge, error }) {
  const form = clientId ? `
  <form method="POST" action="/mcp/${esc(slug)}/authorize">
    <input type="hidden" name="client_id" value="${esc(clientId)}">
    <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">
    <input type="hidden" name="state" value="${esc(state)}">
    <input type="hidden" name="code_challenge" value="${esc(codeChallenge)}">
    <label for="access_key">MCP key for ${esc(slug)}</label>
    <input type="password" id="access_key" name="access_key" autofocus autocomplete="current-password" placeholder="mit_...">
    <button type="submit">Authorize</button>
  </form>` : '';
  return html(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize · ${esc(slug)} · makeittalk</title>
<style>
  :root{color-scheme:light}
  body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:430px;margin:14vh auto;padding:0 1.25rem;line-height:1.55;background:#eaf5ec;color:#0c120d}
  h1{font-size:1.3rem;letter-spacing:-.02em}
  .err{background:#fbe5e5;color:#8f1d1d;border-radius:10px;padding:.6rem .8rem;margin:1rem 0;font-size:.92rem}
  label{display:block;font-size:.85rem;font-weight:600;margin:1.2rem 0 .3rem}
  input[type=password]{width:100%;box-sizing:border-box;padding:.65rem .7rem;border:1px solid #b9d6bf;border-radius:10px;font-size:1rem;background:#fff}
  button{margin-top:1rem;width:100%;padding:.7rem;border:0;border-radius:10px;background:#0c120d;color:#dff3e2;font-size:1rem;font-weight:600;cursor:pointer}
  button:hover{background:#1c5b33}
  p{color:#44523f;font-size:.92rem}
</style></head><body>
<h1>🗣️ ${esc(slug)}</h1>
<p>An AI client wants to use this MCP server (generated on makeittalk.dev). Paste the project's MCP key to authorize it.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
${form}
</body></html>`, error && !clientId ? 400 : 200);
}
