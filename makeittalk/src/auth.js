// Accounts: signup/login with PBKDF2 passwords, DB-backed sessions (the
// cookie holds a random token; the DB stores only its SHA-256), login rate
// limiting, and origin-checked CSRF for the cookie-authenticated API.

import { hashPassword, verifyPassword, randomToken, sha256hex, mintToken, readToken } from './crypto.js';
import { json, id, now, isValidEmail, HttpError, readJson } from './util.js';
import { sendEmail } from './email.js';

const SESSION_TTL = 30 * 24 * 3600;
export const COOKIE = 'mit_session';

export function sessionCookie(token, maxAge = SESSION_TTL) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function currentUser(request, env) {
  const cookies = request.headers.get('Cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (!m) return null;
  const sid = await sha256hex(m[1]);
  const row = await env.DB.prepare(
    `SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(sid, now()).first();
  return row || null;
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, 'Sign in first.');
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (user.role !== 'admin') throw new HttpError(403, 'Admin only.');
  return user;
}

// Reject browser-originated state changes from foreign origins. Non-browser
// clients (no Origin header) pass - they cannot ride ambient cookies.
export function checkCsrf(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  const self = new URL(request.url).origin;
  const configured = (env.APP_ORIGIN || '').replace(/\/$/, '');
  if (origin !== self && origin !== configured) {
    throw new HttpError(403, 'Cross-origin request refused.');
  }
}

async function rateLimit(env, key, max, windowSec) {
  const t = now();
  const row = await env.DB.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || row.reset_at <= t) {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`
    ).bind(key, t + windowSec).run();
    return;
  }
  if (row.count >= max) {
    throw new HttpError(429, `Too many attempts - try again in ${Math.ceil((row.reset_at - t) / 60)} minute(s).`);
  }
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function isAdminEmail(env, email) {
  return (env.ADMIN_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean).includes(email.toLowerCase());
}

async function startSession(env, userId) {
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256hex(token), userId, now(), now() + SESSION_TTL).run();
  return token;
}

export async function handleSignup(request, env, ctx) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 80);
  if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.');
  if (password.length > 200) throw new HttpError(400, 'Password too long.');
  await rateLimit(env, `signup:${clientIp(request)}`, 10, 3600);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) throw new HttpError(409, 'An account with that email already exists - sign in instead.');

  const admin = isAdminEmail(env, email);
  const userId = id('u');
  const verified = env.RESEND_API_KEY && !admin ? null : now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, plan, verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(userId, email, name, await hashPassword(password), admin ? 'admin' : 'user', admin ? 'comp' : 'free', verified, now()).run();

  if (!verified) {
    const token = await mintToken(env.ENCRYPTION_KEY, { t: 'verify', u: userId, exp: now() + 48 * 3600 });
    const link = `${env.APP_ORIGIN}/verify?token=${encodeURIComponent(token)}`;
    ctx.waitUntil(sendEmail(env, {
      to: email,
      subject: 'verify your makeittalk account',
      text: `Welcome to makeittalk.\n\nVerify your email to start generating MCP servers:\n${link}\n\nThe link is valid for 48 hours. If you did not sign up, ignore this.`,
    }));
  }

  const token = await startSession(env, userId);
  return json(
    { ok: true, verified: Boolean(verified), note: verified ? 'Account created.' : 'Account created - check your inbox for the verification link.' },
    201,
    { 'Set-Cookie': sessionCookie(token) },
  );
}

export async function handleLogin(request, env) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  await rateLimit(env, `login:${email}:${clientIp(request)}`, 10, 900);

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  // Burn comparable time when the user doesn't exist so timing doesn't leak.
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, 'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') && false;
  if (!ok) throw new HttpError(401, 'Wrong email or password.');

  const token = await startSession(env, user.id);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
}

export async function handleLogout(request, env) {
  const cookies = request.headers.get('Cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256hex(m[1])).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('gone', 0) });
}

export async function handleVerify(request, env, url) {
  const payload = await readToken(env.ENCRYPTION_KEY, url.searchParams.get('token') || '');
  if (payload?.t !== 'verify') return null; // caller renders a friendly error page
  await env.DB.prepare('UPDATE users SET verified_at = ? WHERE id = ? AND verified_at IS NULL')
    .bind(now(), payload.u).run();
  return true;
}

export async function handleRequestReset(request, env, ctx) {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  await rateLimit(env, `reset:${clientIp(request)}`, 6, 3600);
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();
  // Always answer the same way - no account enumeration.
  if (user && env.RESEND_API_KEY) {
    const token = await mintToken(env.ENCRYPTION_KEY, { t: 'reset', u: user.id, exp: now() + 3600 });
    const link = `${env.APP_ORIGIN}/reset?token=${encodeURIComponent(token)}`;
    ctx.waitUntil(sendEmail(env, {
      to: user.email,
      subject: 'reset your makeittalk password',
      text: `Reset your makeittalk password (link valid 1 hour):\n${link}\n\nIf you did not ask for this, ignore it.`,
    }));
  }
  return json({ ok: true, note: 'If that email has an account, a reset link is on its way.' });
}

export async function handleReset(request, env) {
  const body = await readJson(request);
  const payload = await readToken(env.ENCRYPTION_KEY, String(body.token || ''));
  if (payload?.t !== 'reset') throw new HttpError(400, 'That reset link is invalid or expired.');
  const password = String(body.password || '');
  if (password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.');
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(password), payload.u).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(payload.u).run();
  return json({ ok: true, note: 'Password updated - sign in with the new one.' });
}
