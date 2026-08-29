// Stripe over raw HTTPS (zero dependencies): Checkout for self-serve signup,
// the customer portal for management, and a signature-verified webhook that is
// the single source of truth for plan state.

import { hmacSha256Hex, timingSafeEqual } from './crypto.js';
import { json, now, HttpError, readJson } from './util.js';
import { planIdForPrice } from './plans.js';

const API = 'https://api.stripe.com/v1';

async function stripeRequest(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(500, 'Stripe is not configured on this Worker yet (STRIPE_SECRET_KEY).');
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? encodeForm(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(502, `Stripe error: ${data.error?.message || `HTTP ${res.status}`}`);
  }
  return data;
}

// Stripe's form encoding: nested keys use brackets (metadata[user_id]=...).
export function encodeForm(obj, prefix = '', pairs = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') encodeForm(item, `${key}[${i}]`, pairs);
        else pairs.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      encodeForm(v, key, pairs);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return pairs.join('&');
}

async function ensureCustomer(env, user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripeRequest(env, 'POST', '/customers', {
    email: user.email,
    name: user.name || undefined,
    metadata: { user_id: user.id },
  });
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(customer.id, user.id).run();
  return customer.id;
}

export async function handleCheckout(request, env, user) {
  const body = await readJson(request);
  const plan = body.plan === 'scale' ? 'scale' : 'pro';
  const price = plan === 'scale' ? env.STRIPE_PRICE_SCALE : env.STRIPE_PRICE_PRO;
  if (!price || price.startsWith('REPLACE')) throw new HttpError(500, `Stripe price for "${plan}" is not configured (STRIPE_PRICE_${plan.toUpperCase()}).`);
  const customer = await ensureCustomer(env, user);
  const session = await stripeRequest(env, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id, plan } },
    metadata: { user_id: user.id, plan },
    allow_promotion_codes: 'true',
    success_url: `${env.APP_ORIGIN}/app?upgraded=${plan}`,
    cancel_url: `${env.APP_ORIGIN}/pricing`,
  });
  return json({ url: session.url });
}

export async function handlePortal(request, env, user) {
  if (!user.stripe_customer_id) throw new HttpError(400, 'No billing profile yet - upgrade first.');
  const session = await stripeRequest(env, 'POST', '/billing_portal/sessions', {
    customer: user.stripe_customer_id,
    return_url: `${env.APP_ORIGIN}/app`,
  });
  return json({ url: session.url });
}

// Verifies the Stripe-Signature header: v1 = HMAC-SHA256(`${t}.${payload}`).
export async function verifyStripeSignature(payload, sigHeader, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(
    String(sigHeader || '').split(',').map((p) => p.split('=').map((s) => s.trim())).filter((p) => p.length === 2)
  );
  const t = parseInt(parts.t, 10);
  if (!Number.isFinite(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  // Header may carry several v1 signatures during secret rotation.
  const sigs = String(sigHeader).split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.split('=')[1]?.trim());
  return sigs.some((s) => s && timingSafeEqual(s, expected));
}

export async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'webhook not configured' }, 500);
  const payload = await request.text();
  const ok = await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'bad signature' }, 400);

  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: 'bad payload' }, 400); }

  // Idempotency: each Stripe event id is processed once.
  const dup = await env.DB.prepare('SELECT id FROM stripe_events WHERE id = ?').bind(event.id).first();
  if (dup) return json({ received: true, duplicate: true });
  await env.DB.prepare('INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)')
    .bind(event.id, event.type, now()).run();

  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = obj.client_reference_id || obj.metadata?.user_id;
      const plan = obj.metadata?.plan;
      if (userId && (plan === 'pro' || plan === 'scale')) {
        await env.DB.prepare(
          `UPDATE users SET plan = ?, plan_status = 'active', stripe_customer_id = COALESCE(stripe_customer_id, ?),
           stripe_subscription_id = COALESCE(?, stripe_subscription_id) WHERE id = ?`
        ).bind(plan, obj.customer || null, obj.subscription || null, userId).run();
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const userId = obj.metadata?.user_id;
      const priceId = obj.items?.data?.[0]?.price?.id;
      const plan = planIdForPrice(env, priceId);
      const target = userId
        ? await env.DB.prepare('SELECT id, plan FROM users WHERE id = ?').bind(userId).first()
        : await env.DB.prepare('SELECT id, plan FROM users WHERE stripe_customer_id = ?').bind(obj.customer).first();
      if (target && target.plan !== 'comp') {
        await env.DB.prepare('UPDATE users SET plan = COALESCE(?, plan), plan_status = ?, stripe_subscription_id = ? WHERE id = ?')
          .bind(plan, obj.status || 'active', obj.id, target.id).run();
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const target = obj.metadata?.user_id
        ? await env.DB.prepare('SELECT id, plan FROM users WHERE id = ?').bind(obj.metadata.user_id).first()
        : await env.DB.prepare('SELECT id, plan FROM users WHERE stripe_customer_id = ?').bind(obj.customer).first();
      if (target && target.plan !== 'comp') {
        await env.DB.prepare("UPDATE users SET plan = 'free', plan_status = 'canceled', stripe_subscription_id = NULL WHERE id = ?")
          .bind(target.id).run();
      }
      break;
    }
    case 'invoice.payment_failed': {
      const target = await env.DB.prepare('SELECT id, plan FROM users WHERE stripe_customer_id = ?').bind(obj.customer).first();
      if (target && target.plan !== 'comp') {
        await env.DB.prepare("UPDATE users SET plan_status = 'past_due' WHERE id = ?").bind(target.id).run();
      }
      break;
    }
    default:
      break; // acknowledged, unhandled
  }
  return json({ received: true });
}
