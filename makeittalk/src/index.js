// makeittalk - paste a link, get an MCP.
// Single Cloudflare Worker: marketing site, app + API, Stripe billing, the
// generation engine, and every generated MCP endpoint. Zero dependencies.

import { json, html, HttpError } from './util.js';
import { currentUser, requireUser, requireAdmin, checkCsrf, handleSignup, handleLogin, handleLogout, handleVerify, handleRequestReset, handleReset } from './auth.js';
import { handleApi } from './api.js';
import { handleAdminApi } from './admin.js';
import { handleCheckout, handlePortal, handleWebhook } from './stripe.js';
import { handleMcp } from './mcpserve.js';
import { handleMcpOAuth } from './mcpoauth.js';
import { landingPage } from './pages/landing.js';
import { appPage } from './pages/app.js';
import { loginPage, signupPage, forgotPage, resetPage, verifyResultPage } from './pages/authpages.js';
import { pricingPage, docsPage, termsPage, privacyPage, notFoundPage } from './pages/site.js';

const MCP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const isMcpSurface = path.startsWith('/mcp/') || path.startsWith('/.well-known/');

    let res;
    try {
      res = await route(request, env, ctx, url, path);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.log('unhandled', path, e.stack || e.message);
      res = json({ error: e instanceof HttpError ? e.message : 'Something broke on our side. Try again.' }, status);
    }
    if (isMcpSurface) {
      res = new Response(res.body, res);
      for (const [k, v] of Object.entries(MCP_CORS)) res.headers.set(k, v);
    }
    return res;
  },
};

async function route(request, env, ctx, url, path) {
  const origin = /^https?:\/\//.test(env.APP_ORIGIN || '') ? env.APP_ORIGIN.replace(/\/$/, '') : url.origin;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  // ---------- MCP surface (key/OAuth auth, permissive CORS) ----------
  const oauthRes = await handleMcpOAuth(request, env, url);
  if (oauthRes) return oauthRes;
  const mcpMatch = path.match(/^\/mcp\/([a-z0-9-]+)$/);
  if (mcpMatch) return handleMcp(request, env, ctx, mcpMatch[1]);

  // ---------- Stripe webhook (signature auth, no cookies) ----------
  if (path === '/api/stripe/webhook' && request.method === 'POST') return handleWebhook(request, env);

  // ---------- public pages ----------
  if (request.method === 'GET') {
    switch (path) {
      case '/': return html(landingPage(origin));
      case '/pricing': return html(pricingPage(origin));
      case '/docs': return html(docsPage(origin));
      case '/terms': return html(termsPage(origin));
      case '/privacy': return html(privacyPage(origin));
      case '/login': return html(loginPage(origin));
      case '/signup': return html(signupPage(origin));
      case '/forgot': return html(forgotPage(origin));
      case '/reset': return html(resetPage(origin, url.searchParams.get('token') || ''));
      case '/app': return html(appPage(origin));
      case '/health': return json({ ok: true, service: 'makeittalk', configured: Boolean(env.ANTHROPIC_API_KEY && env.ENCRYPTION_KEY) });
      case '/verify': {
        const ok = await handleVerify(request, env, url);
        return html(verifyResultPage(origin, Boolean(ok)));
      }
      default: break;
    }
  }

  // ---------- app API (cookie auth + origin CSRF) ----------
  if (path.startsWith('/api/')) {
    if (request.method !== 'GET') checkCsrf(request, env);

    if (path === '/api/auth/signup' && request.method === 'POST') return handleSignup(request, env, ctx);
    if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/logout' && request.method === 'POST') return handleLogout(request, env);
    if (path === '/api/auth/request-reset' && request.method === 'POST') return handleRequestReset(request, env, ctx);
    if (path === '/api/auth/reset' && request.method === 'POST') return handleReset(request, env);

    const user = await currentUser(request, env);

    if (path === '/api/billing/checkout' && request.method === 'POST') return handleCheckout(request, env, requireUser(user));
    if (path === '/api/billing/portal' && request.method === 'POST') return handlePortal(request, env, requireUser(user));

    if (path.startsWith('/api/admin/')) {
      requireAdmin(user);
      return handleAdminApi(request, env, path);
    }

    return handleApi(request, env, ctx, requireUser(user), path);
  }

  if (request.method === 'GET') return html(notFoundPage(origin), 404);
  return json({ error: 'Not found' }, 404);
}
