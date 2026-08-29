#!/usr/bin/env node
// One-shot go-live for makeittalk.dev. Run from this folder:
//
//   CLOUDFLARE_API_TOKEN=... ANTHROPIC_API_KEY=... STRIPE_SECRET_KEY=... node golive.mjs
//
// Optional env: RESEND_API_KEY (emails), SKIP_DOMAIN=1 (deploy to workers.dev
// only, attach makeittalk.dev later), APP_URL (defaults https://makeittalk.dev).
//
// What it does, in order, safely re-runnable:
//   1. D1: create (or find) the makeittalk database, patch wrangler.toml, run migrations
//   2. Secrets: generate ENCRYPTION_KEY once (prints it - save it), set API keys
//   3. Stripe: ensure pro/scale products + prices (lookup keys), the webhook
//      endpoint (captures its signing secret on creation), and a customer
//      portal configuration - then patch wrangler.toml with the ids
//   4. Domain routes: enable makeittalk.dev + www custom domains
//   5. wrangler deploy
//
// Cloudflare token needs: Account → Workers Scripts:Edit + D1:Edit,
// Zone (makeittalk.dev) → Workers Routes:Edit + DNS:Edit.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { PLANS } from './src/plans.js';

const APP_URL = (process.env.APP_URL || 'https://makeittalk.dev').replace(/\/$/, '');
const WEBHOOK_URL = `${APP_URL}/api/stripe/webhook`;
const TOML = 'wrangler.toml';

const die = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };
const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  ✓ ${msg}`);

for (const name of ['CLOUDFLARE_API_TOKEN', 'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY']) {
  if (!process.env[name]) die(`${name} is required. See the header of this script.`);
}
if (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  console.log('\n⚠ Stripe key is TEST mode - fine for a rehearsal, re-run with sk_live_ for real billing.');
}

function wrangler(args, { input, allowFail = false } = {}) {
  const res = spawnSync('npx', ['wrangler', ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  if (res.status !== 0 && !allowFail) {
    console.error(out);
    die(`wrangler ${args.join(' ')} failed`);
  }
  return { out, code: res.status };
}

async function stripe(method, path, form) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) die(`Stripe ${method} ${path}: ${data.error?.message || res.status}`);
  return data;
}

let toml = readFileSync(TOML, 'utf8');
const patchToml = (re, replacement, label) => {
  const next = toml.replace(re, replacement);
  if (next !== toml) { toml = next; writeFileSync(TOML, toml); ok(`wrangler.toml: ${label}`); }
};

// ---------- 1 · D1 ----------
step('D1 database');
let dbId = null;
const info = wrangler(['d1', 'info', 'makeittalk', '--json'], { allowFail: true });
const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
if (info.code === 0) {
  dbId = info.out.match(uuidRe)?.[0] || null;
  if (dbId) ok(`found existing database ${dbId}`);
}
if (!dbId) {
  const created = wrangler(['d1', 'create', 'makeittalk']);
  dbId = created.out.match(uuidRe)?.[0] || die('could not read the new database id from wrangler output');
  ok(`created database ${dbId}`);
}
patchToml(/database_id = "[^"]*"/, `database_id = "${dbId}"`, `database_id = ${dbId}`);
wrangler(['d1', 'migrations', 'apply', 'makeittalk', '--remote'], { input: 'y\n' });
ok('migrations applied');

// ---------- 2 · Secrets ----------
step('Worker secrets');
const secretList = wrangler(['secret', 'list'], { allowFail: true }).out;
const hasSecret = (name) => secretList.includes(`"${name}"`);
const putSecret = (name, value) => { wrangler(['secret', 'put', name], { input: `${value}\n` }); ok(name); };

if (!hasSecret('ENCRYPTION_KEY')) {
  const key = crypto.randomBytes(32).toString('hex');
  putSecret('ENCRYPTION_KEY', key);
  console.log('\n  ┌────────────────────────────────────────────────────────────┐');
  console.log('  │ SAVE THIS ENCRYPTION_KEY IN YOUR PASSWORD MANAGER NOW.     │');
  console.log('  │ It encrypts every customer credential; it is shown once.   │');
  console.log(`  │ ${key} │`);
  console.log('  └────────────────────────────────────────────────────────────┘\n');
} else {
  ok('ENCRYPTION_KEY already set (left untouched)');
}
putSecret('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY);
putSecret('STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY);
if (process.env.RESEND_API_KEY) putSecret('RESEND_API_KEY', process.env.RESEND_API_KEY);
else ok('RESEND_API_KEY not provided - signups auto-verify (add later for verification emails)');

// ---------- 3 · Stripe ----------
step('Stripe products + prices');
async function ensurePrice(lookupKey, productName, dollars) {
  const existing = await stripe('GET', `/prices?lookup_keys[]=${lookupKey}&limit=1`);
  if (existing.data.length) { ok(`${lookupKey} → ${existing.data[0].id} (existing)`); return existing.data[0].id; }
  const product = await stripe('POST', '/products', new URLSearchParams({ name: productName }).toString());
  const price = await stripe('POST', '/prices', new URLSearchParams({
    product: product.id,
    unit_amount: String(dollars * 100),
    currency: 'usd',
    'recurring[interval]': 'month',
    lookup_key: lookupKey,
  }).toString());
  ok(`${lookupKey} → ${price.id} (created)`);
  return price.id;
}
const proPrice = await ensurePrice('makeittalk_pro', 'makeittalk pro', PLANS.pro.price);
const scalePrice = await ensurePrice('makeittalk_scale', 'makeittalk scale', PLANS.scale.price);
patchToml(/STRIPE_PRICE_PRO = "[^"]*"/, `STRIPE_PRICE_PRO = "${proPrice}"`, 'pro price id');
patchToml(/STRIPE_PRICE_SCALE = "[^"]*"/, `STRIPE_PRICE_SCALE = "${scalePrice}"`, 'scale price id');

step('Stripe webhook');
const hooks = await stripe('GET', '/webhook_endpoints?limit=100');
const existingHook = hooks.data.find((h) => h.url === WEBHOOK_URL && h.status === 'enabled');
if (existingHook) {
  ok(`webhook exists (${existingHook.id}) - its signing secret is only shown at creation.`);
  if (!hasSecret('STRIPE_WEBHOOK_SECRET')) {
    console.log('  ⚠ STRIPE_WEBHOOK_SECRET is not set on the Worker. Roll the secret in the Stripe');
    console.log('    dashboard (Developers → Webhooks) and run: npx wrangler secret put STRIPE_WEBHOOK_SECRET');
  }
} else {
  const events = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed'];
  const params = new URLSearchParams({ url: WEBHOOK_URL, description: 'makeittalk plan sync' });
  events.forEach((e, i) => params.append(`enabled_events[${i}]`, e));
  const hook = await stripe('POST', '/webhook_endpoints', params.toString());
  putSecret('STRIPE_WEBHOOK_SECRET', hook.secret);
  ok(`webhook created (${hook.id})`);
}

step('Stripe customer portal');
const portals = await stripe('GET', '/billing_portal/configurations?limit=100&active=true');
let portal = portals.data.find((p) => p.metadata?.app === 'makeittalk');
if (!portal) {
  const params = new URLSearchParams({
    'business_profile[privacy_policy_url]': `${APP_URL}/privacy`,
    'business_profile[terms_of_service_url]': `${APP_URL}/terms`,
    default_return_url: `${APP_URL}/app`,
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'metadata[app]': 'makeittalk',
  });
  portal = await stripe('POST', '/billing_portal/configurations', params.toString());
  ok(`portal configuration created (${portal.id})`);
} else {
  ok(`portal configuration exists (${portal.id})`);
}
patchToml(/STRIPE_PORTAL_CONFIG = "[^"]*"/, `STRIPE_PORTAL_CONFIG = "${portal.id}"`, 'portal config id');

// ---------- 4 · Domain routes ----------
if (!process.env.SKIP_DOMAIN) {
  step('Custom domain routes');
  if (toml.includes('# routes = [')) {
    patchToml(
      /# routes = \[\n# {3}\{ pattern = "makeittalk\.dev", custom_domain = true \},\n# {3}\{ pattern = "www\.makeittalk\.dev", custom_domain = true \},\n# \]/,
      'routes = [\n  { pattern = "makeittalk.dev", custom_domain = true },\n  { pattern = "www.makeittalk.dev", custom_domain = true },\n]',
      'makeittalk.dev + www routes enabled'
    );
    if (toml.includes('# routes = [')) {
      console.log('  ⚠ could not auto-uncomment the routes block - enable it by hand in wrangler.toml');
    }
  } else if (toml.includes('routes = [')) {
    ok('routes already enabled');
  }
} else {
  step('Custom domain skipped (SKIP_DOMAIN=1) - deploying to workers.dev');
}

// ---------- 5 · Deploy ----------
step('Deploy');
const deploy = wrangler(['deploy']);
console.log(deploy.out.split('\n').filter((l) => /https:\/\/|Deployed|Uploaded/.test(l)).map((l) => `  ${l.trim()}`).join('\n'));

console.log(`
\x1b[1m✦ makeittalk is live.\x1b[0m

Next (2 minutes):
  1. ${APP_URL}/health should say {"ok":true,"configured":true}
  2. Sign up at ${APP_URL}/signup with ryan@getdylr.com → auto-admin, comp plan
  3. Commit the wrangler.toml changes this script made (price ids, db id, routes)
  4. Optional: Resend for verification emails (SETUP.md §7), then re-run with RESEND_API_KEY set
`);
