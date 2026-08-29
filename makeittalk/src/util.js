// Shared helpers: responses, escaping, ids, time.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function html(markup, status = 200, headers = {}) {
  return new Response(markup, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
  });
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const now = () => Math.floor(Date.now() / 1000);

// '2026-08' - the usage-metering bucket.
export const monthKey = () => new Date().toISOString().slice(0, 7);

export function id(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Human/URL-safe slug from a project name, e.g. "Stripe Billing" -> "stripe-billing".
export function slugify(name) {
  const s = String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s.length >= 2 ? s : `mcp-${s}`.replace(/-$/, '');
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function clampStr(s, max) {
  s = String(s ?? '');
  return s.length > max ? `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]` : s;
}

export async function readJson(request, maxBytes = 256 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body too large.');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'Body must be valid JSON.'); }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
