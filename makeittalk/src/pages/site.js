// Secondary site pages: pricing, docs, terms, privacy, 404.

import { page, siteNav, siteFooter } from './theme.js';
import { PLANS } from '../plans.js';

const SITE_CSS = `
<style>
.wrap{max-width:880px;margin:0 auto;padding:2.6rem 1.25rem 4rem}
.wrap h1{font-size:clamp(1.9rem,4.5vw,2.7rem)}
.wrap h2{font-size:1.3rem;margin-top:2.2rem}
.wrap p, .wrap li{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.2rem 1.4rem;box-shadow:var(--shadow);margin:1rem 0}
.kv{font-family:var(--mono);font-size:.85rem;background:var(--paper2);border:1px solid var(--line);border-radius:var(--r-sm);padding:.55em .8em;overflow-x:auto;margin:.5rem 0}
.small{font-size:.85rem}
</style>`;

export function pricingPage(origin) {
  const row = (p, planKey) => `
  <div class="card" style="display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap">
    <div>
      <h2 style="margin:0">${p.label} ${p.price ? `· $${p.price}/mo` : '· $0'}</h2>
      <p class="small" style="margin:.3rem 0 0">${p.projects} project${p.projects === 1 ? '' : 's'} ·
      ${p.generations_per_month} generations/mo · ${p.tool_calls_per_month.toLocaleString()} tool calls/mo${p.export ? ' · worker export' : ''}</p>
    </div>
    <a class="btn ${planKey === 'pro' ? 'black' : 'ghost'}" href="/signup${planKey === 'free' ? '' : `?plan=${planKey}`}">start ${planKey === 'free' ? 'free' : `with ${planKey}`}</a>
  </div>`;
  return page({
    title: 'pricing · makeittalk',
    description: 'Start free. Pro $29/mo, scale $99/mo. Hosted MCP servers generated from any API docs.',
    origin,
    path: '/pricing',
    body: `${siteNav('/pricing')}${SITE_CSS}
<div class="wrap">
  <h1>pricing</h1>
  <p>Every plan gets the same engine, hosted endpoints with OAuth, encrypted credentials, and the api_call escape hatch. Paid plans add room and the right to take your server home.</p>
  ${row(PLANS.free, 'free')}
  ${row(PLANS.pro, 'pro')}
  ${row(PLANS.scale, 'scale')}
  <p class="small">Generations are full engine runs (reading docs + designing tools). Tool calls are what your AI makes through hosted endpoints. Exported Workers run in your own Cloudflare account and never count against limits. Cancel anytime from the billing portal.</p>
</div>${siteFooter()}`,
  });
}

export function docsPage(origin) {
  return page({
    title: 'docs · makeittalk',
    description: 'How to generate an MCP from a docs link and connect it to Claude, ChatGPT, or any MCP client.',
    origin,
    path: '/docs',
    body: `${siteNav('/docs')}${SITE_CSS}
<div class="wrap">
  <h1>docs</h1>
  <p>The whole product in five minutes.</p>

  <h2>1 · create a project</h2>
  <p>Dashboard → new MCP. Give it a name and a documentation link. The engine loves an OpenAPI spec but reads human docs fine. Optionally say what the MCP should be good at ("mostly reporting", "manage contacts and deals") to weight the toolset.</p>

  <h2>2 · watch the generation</h2>
  <p>The activity log shows every step live: which pages it read, which spec it found, which auth scheme the API uses, and every tool it designs with the endpoint it maps to. A run takes a few minutes on a big API.</p>

  <h2>3 · add credentials</h2>
  <p>The credentials tab asks for exactly what the API needs (an API key, a token, a client id and secret). They are encrypted with AES-256-GCM, used only at call time, never shown again, and never included in any AI prompt. The MCP can only do what that credential allows, so scope it the way you would scope any integration.</p>

  <h2>4 · connect your AI</h2>
  <div class="card">
    <p style="margin:0 0 .4rem"><strong>claude.ai / Claude Desktop</strong> · Settings → Connectors → add custom connector → paste your endpoint URL. Authorize with your MCP key when asked.</p>
    <div class="kv">https://makeittalk.dev/mcp/&lt;your-slug&gt;</div>
    <p style="margin:.8rem 0 .4rem"><strong>Claude Code</strong></p>
    <div class="kv">claude mcp add --transport http &lt;name&gt; https://makeittalk.dev/mcp/&lt;your-slug&gt;</div>
    <p style="margin:.8rem 0 0"><strong>ChatGPT</strong> · Settings → Connectors → Advanced → Developer mode → add the URL. <strong>Anything else</strong> · standard streamable HTTP MCP; OAuth 2.1 or <code>Authorization: Bearer &lt;key&gt;</code>.</p>
  </div>

  <h2>5 · use it</h2>
  <p>Start with: <em>"list the tools you have and try the safest read."</em> Every generated server also ships an <code>api_call</code> tool for endpoints that didn't earn a dedicated tool. DELETE is refused unless you enable it per project.</p>

  <h2>owning your server</h2>
  <p>Pro and scale can export any project as a single-file, zero-dependency Cloudflare Worker: your account, your secrets, no makeittalk in the path. The export includes deploy instructions in the file header.</p>

  <h2>limits and fair use</h2>
  <p>Generations and tool calls meter by calendar month per plan (see <a href="/pricing">pricing</a>). The engine reads public documentation only and identifies itself politely as makeittalk-docs-reader.</p>
</div>${siteFooter()}`,
  });
}

export function termsPage(origin) {
  return page({
    title: 'terms · makeittalk',
    description: 'Terms of service.',
    origin,
    path: '/terms',
    body: `${siteNav()}${SITE_CSS}
<div class="wrap">
  <h1>terms of service</h1>
  <p class="small">Effective August 2026 · makeittalk.dev is operated by Ryan Shatzkamer ("we").</p>
  <h2>the service</h2>
  <p>makeittalk generates and hosts MCP servers from API documentation you point it at. You get an endpoint, a key, and optionally exported source code.</p>
  <h2>your side of the deal</h2>
  <p>Only connect APIs you are authorized to use, with credentials you are entitled to. You are responsible for what your AI does through your MCP, the same as if you called the API yourself. No abuse, no unlawful use, no hammering third-party APIs against their terms.</p>
  <h2>credentials</h2>
  <p>You supply API credentials; we store them encrypted and use them solely to execute your tool calls. Rotate or wipe them anytime. Scope them minimally; we act only within what they allow.</p>
  <h2>generated output</h2>
  <p>Generated manifests and exported code are yours. The engine reads documentation and can make mistakes; review tools before pointing an autonomous agent at production. The service is provided as is, without warranties, and our liability is capped at what you paid us in the last 12 months.</p>
  <h2>billing</h2>
  <p>Paid plans bill monthly through Stripe and can be canceled anytime from the billing portal, effective at period end. We may change plan limits with notice.</p>
  <h2>termination</h2>
  <p>You can delete projects and your account anytime. We can suspend accounts that break these terms. Questions: hello@makeittalk.dev.</p>
</div>${siteFooter()}`,
  });
}

export function privacyPage(origin) {
  return page({
    title: 'privacy · makeittalk',
    description: 'Privacy policy.',
    origin,
    path: '/privacy',
    body: `${siteNav()}${SITE_CSS}
<div class="wrap">
  <h1>privacy</h1>
  <p class="small">Effective August 2026.</p>
  <h2>what we store</h2>
  <p>Your email, name, a salted password hash, your projects (docs URLs, generated manifests, activity logs), usage counts, and API credentials encrypted with AES-256-GCM. Billing runs on Stripe; we store customer and subscription ids, never card numbers.</p>
  <h2>what we send where</h2>
  <p>Documentation text goes to Anthropic's Claude API to design your tools. Your API credentials never go to any AI model; they are decrypted only to execute tool calls against the API you configured. Transactional email goes through Resend when enabled.</p>
  <h2>what we don't do</h2>
  <p>No selling data, no ad tracking, no third-party analytics scripts on the app.</p>
  <h2>deletion</h2>
  <p>Deleting a project destroys its manifest, logs, and encrypted credentials. Deleting your account (email hello@makeittalk.dev) removes everything else.</p>
</div>${siteFooter()}`,
  });
}

export function notFoundPage(origin) {
  return page({
    title: 'not found · makeittalk',
    description: 'That page does not exist.',
    origin,
    path: '/404',
    body: `${siteNav()}${SITE_CSS}
<div class="wrap" style="text-align:center;padding-top:5rem">
  <h1>404, nothing talks here</h1>
  <p>that page doesn't exist. the MCPs are over in the <a href="/app">dashboard</a>.</p>
</div>${siteFooter()}`,
  });
}
