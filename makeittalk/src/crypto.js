// All cryptography in one place: password hashing (PBKDF2-SHA256), credential
// encryption at rest (AES-256-GCM), token hashing, HMAC-signed stateless
// tokens, and constant-time comparison. WebCrypto only - zero dependencies.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  const ab = enc.encode(a); const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function sha256hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- passwords ----------

const PBKDF2_ITER = 210000;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter < 1000 || iter > 5_000_000) return false;
  const salt = b64urlToBytes(parts[2]);
  const hash = await pbkdf2(password, salt, iter);
  return timingSafeEqual(b64url(hash), parts[3]);
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

// ---------- credential encryption at rest ----------

async function aesKey(hexKey) {
  const raw = new Uint8Array((hexKey.match(/.{2}/g) || []).map((h) => parseInt(h, 16)));
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJson(hexKey, obj) {
  const key = await aesKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ iv: b64url(iv), data: b64url(ct) });
}

export async function decryptJson(hexKey, packed) {
  if (!packed) return null;
  const { iv, data } = JSON.parse(packed);
  const key = await aesKey(hexKey);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBytes(iv) }, key, b64urlToBytes(data));
  return JSON.parse(dec.decode(pt));
}

// ---------- HMAC-signed stateless tokens (OAuth blobs, email links) ----------

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function mintToken(secret, payload) {
  const data = b64url(enc.encode(JSON.stringify(payload)));
  return `${data}.${await hmacSign(secret, data)}`;
}

export async function readToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig || !timingSafeEqual(await hmacSign(secret, data), sig)) return null;
  try {
    const payload = JSON.parse(dec.decode(b64urlToBytes(data)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export async function sha256b64url(s) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

// Stripe webhook signatures: HMAC-SHA256 hex over `${t}.${payload}`.
export async function hmacSha256Hex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
