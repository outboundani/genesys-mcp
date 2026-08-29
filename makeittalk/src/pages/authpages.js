// Sign in / sign up / verify / reset pages - one shared minimal card layout.

import { page, wordmark } from './theme.js';
import { esc } from '../util.js';

function authShell(origin, path, title, inner) {
  return page({
    title: `${title} · makeittalk`,
    description: 'makeittalk - paste a link, get an MCP.',
    origin,
    path,
    body: `
<style>
.auth{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
.authcard{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);
          padding:2rem;box-shadow:var(--shadow)}
.authcard h1{font-size:1.45rem;margin:.9rem 0 .2rem}
.authcard .mut{color:var(--muted);font-size:.92rem}
.authcard .btn{width:100%;justify-content:center;margin-top:1.2rem}
.out{display:none;border-radius:var(--r-sm);padding:.7rem .9rem;font-size:.9rem;margin-top:1rem;white-space:pre-wrap;word-break:break-word}
.out.ok{display:block;background:var(--accent-soft);border:1px solid var(--accent)}
.out.err{display:block;background:color-mix(in srgb,var(--err) 10%,transparent);border:1px solid var(--err);color:var(--err)}
.swap{font-size:.9rem;margin-top:1.2rem;color:var(--muted)}
</style>
<div class="auth"><div class="authcard">
  <a href="/" style="text-decoration:none">${wordmark(22)}</a>
  ${inner}
</div></div>`,
  });
}

const formScript = (endpoint, redirect) => `
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = document.getElementById('out');
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; out.className = 'out';
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch('${endpoint}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await res.json();
    if (!res.ok) { out.className = 'out err'; out.textContent = j.error || 'Something went wrong.'; btn.disabled = false; return; }
    ${redirect
      ? `location.href = '${redirect}';`
      : `out.className = 'out ok'; out.textContent = j.note || 'Done.'; btn.disabled = false;`}
  } catch (err) { out.className = 'out err'; out.textContent = String(err); btn.disabled = false; }
});
</script>`;

export function loginPage(origin) {
  return authShell(origin, '/login', 'sign in', `
  <h1>welcome back</h1>
  <p class="mut">sign in to your MCPs.</p>
  <form id="f">
    <label>email</label><input name="email" type="email" required autocomplete="email">
    <label>password</label><input name="password" type="password" required autocomplete="current-password">
    <button class="btn black" type="submit">sign in</button>
  </form>
  <div class="out" id="out"></div>
  <p class="swap">new here? <a href="/signup">start free</a> · <a href="/forgot">forgot password</a></p>
  ${formScript('/api/auth/login', '/app')}`);
}

export function signupPage(origin) {
  return authShell(origin, '/signup', 'start free', `
  <h1>start free</h1>
  <p class="mut">one MCP project, on the house. no card.</p>
  <form id="f">
    <label>name</label><input name="name" autocomplete="name" placeholder="optional">
    <label>email</label><input name="email" type="email" required autocomplete="email">
    <label>password</label><input name="password" type="password" required minlength="10" autocomplete="new-password" placeholder="10+ characters">
    <button class="btn black" type="submit">create account</button>
  </form>
  <div class="out" id="out"></div>
  <p class="swap">already in? <a href="/login">sign in</a> · by signing up you accept the <a href="/terms">terms</a></p>
  ${formScript('/api/auth/signup', '/app')}`);
}

export function forgotPage(origin) {
  return authShell(origin, '/forgot', 'reset password', `
  <h1>reset password</h1>
  <p class="mut">we will email you a reset link.</p>
  <form id="f">
    <label>email</label><input name="email" type="email" required autocomplete="email">
    <button class="btn black" type="submit">send reset link</button>
  </form>
  <div class="out" id="out"></div>
  <p class="swap"><a href="/login">back to sign in</a></p>
  ${formScript('/api/auth/request-reset', '')}`);
}

export function resetPage(origin, token) {
  return authShell(origin, '/reset', 'choose a new password', `
  <h1>new password</h1>
  <form id="f">
    <input type="hidden" name="token" value="${esc(token)}">
    <label>new password</label><input name="password" type="password" required minlength="10" autocomplete="new-password">
    <button class="btn black" type="submit">update password</button>
  </form>
  <div class="out" id="out"></div>
  <p class="swap"><a href="/login">back to sign in</a></p>
  ${formScript('/api/auth/reset', '')}`);
}

export function verifyResultPage(origin, ok) {
  return authShell(origin, '/verify', ok ? 'verified' : 'verification failed', ok ? `
  <h1>you're verified ✓</h1>
  <p class="mut">your account can generate MCPs now.</p>
  <a class="btn black" href="/app">open the dashboard</a>` : `
  <h1>that link didn't work</h1>
  <p class="mut">it may be expired. sign in and we can send a fresh one, or email hello@makeittalk.dev.</p>
  <a class="btn black" href="/login">sign in</a>`);
}
