// makeittalk design system - pale green paper + ink black, Space Grotesk
// display, monospace accents. One accent, one radius system, both color
// modes defined up front. All pages share this shell.

import { esc } from '../util.js';

export const TOKENS = `
  :root{
    --paper:#e9f4ea; --paper2:#deeee1; --card:#f7fbf7; --ink:#0c120d;
    --muted:#46564a; --line:#c2dcc8; --accent:#1c6b3c; --accent-soft:#d3ecd9;
    --on-black:#dff3e2; --terminal:#0f1611; --terminal-ink:#a8d9b4;
    --ok:#1c6b3c; --warn:#8a6410; --err:#a03232;
    --r:14px; --r-sm:9px;
    --shadow:0 1px 2px rgba(12,18,13,.05),0 6px 24px rgba(12,18,13,.07);
    --font:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;
    --body:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
    --mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
    color-scheme:light;
  }
  @media (prefers-color-scheme:dark){
    :root{
      --paper:#0b120c; --paper2:#0e160f; --card:#131c14; --ink:#dff0e2;
      --muted:#9db3a2; --line:#24382a; --accent:#7fd49a; --accent-soft:#173622;
      --on-black:#0c120d; --terminal:#0f1611; --terminal-ink:#a8d9b4;
      --ok:#7fd49a; --warn:#d9b25c; --err:#e08b8b;
      --shadow:0 1px 2px rgba(0,0,0,.5),0 8px 28px rgba(0,0,0,.45);
      color-scheme:dark;
    }
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;font-family:var(--body);background:var(--paper);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased}
  h1,h2,h3,h4{font-family:var(--font);letter-spacing:-.025em;line-height:1.12;margin:0 0 .4em}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  code,pre,kbd{font-family:var(--mono)}
  code{background:var(--accent-soft);padding:.1em .38em;border-radius:6px;font-size:.88em}
  .btn{display:inline-flex;align-items:center;gap:.45em;padding:.62em 1.15em;border-radius:var(--r-sm);border:1.5px solid var(--ink);
       background:transparent;color:var(--ink);font-weight:600;font-size:.95rem;cursor:pointer;font-family:var(--font);
       transition:transform .12s ease,background .15s ease,color .15s ease;text-decoration:none}
  .btn:hover{background:var(--ink);color:var(--paper);text-decoration:none}
  .btn:active{transform:scale(.98)}
  .btn.black{background:var(--ink);color:var(--on-black);border-color:var(--ink)}
  .btn.black:hover{background:var(--accent);border-color:var(--accent);color:#fff}
  @media (prefers-color-scheme:dark){.btn.black:hover{color:#0c120d}}
  .btn.ghost{border-color:var(--line)}
  .btn.ghost:hover{background:var(--card);color:var(--ink);border-color:var(--ink)}
  .pill{display:inline-flex;align-items:center;gap:.4em;font-family:var(--mono);font-size:.78rem;font-weight:500;
        padding:.28em .75em;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted)}
  input,select,textarea{width:100%;padding:.62em .7em;border:1.5px solid var(--line);border-radius:var(--r-sm);
        font-size:.97rem;background:var(--card);color:var(--ink);font-family:var(--body)}
  input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
  label{display:block;font-size:.85rem;font-weight:600;margin:1rem 0 .3rem;font-family:var(--font)}
  ::selection{background:var(--accent);color:#fff}
`;

export function logoSvg(size = 26) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect x="2" y="3" width="28" height="22" rx="7" fill="currentColor"/>
  <path d="M9 25 L9 31 L16 25 Z" fill="currentColor"/>
  <rect x="9" y="11" width="3" height="6" rx="1.5" fill="var(--paper,#e9f4ea)"/>
  <rect x="14.5" y="8" width="3" height="12" rx="1.5" fill="var(--paper,#e9f4ea)"/>
  <rect x="20" y="12.5" width="3" height="3" rx="1.5" fill="var(--paper,#e9f4ea)"/>
</svg>`;
}

export function wordmark(size = 26) {
  return `<span style="display:inline-flex;align-items:center;gap:.5rem;color:var(--ink)">
    ${logoSvg(size)}
    <span style="font-family:var(--font);font-weight:700;font-size:${Math.round(size * 0.85)}px;letter-spacing:-.03em">makeittalk<span style="color:var(--accent)">.</span></span>
  </span>`;
}

export function page({ title, description = '', body, origin = 'https://makeittalk.dev', path = '/' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="${esc(origin + path)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(origin)}/og.png">
<meta property="og:url" content="${esc(origin + path)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>${TOKENS}</style>
</head>
<body>${body}</body>
</html>`;
}

export function siteNav(active = '') {
  const link = (href, label) =>
    `<a href="${href}" class="navlink${active === href ? ' on' : ''}">${label}</a>`;
  return `
  <style>
  .nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--paper) 88%,transparent);backdrop-filter:blur(10px);
       border-bottom:1px solid var(--line)}
  .nav-in{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:1.4rem;padding:.7rem 1.25rem;height:64px}
  .navlink{color:var(--muted);font-weight:500;font-size:.94rem}
  .navlink:hover,.navlink.on{color:var(--ink);text-decoration:none}
  .nav-spacer{flex:1}
  @media (max-width:640px){.navlink.hide-sm{display:none}}
  </style>
  <nav class="nav"><div class="nav-in">
    <a href="/" style="text-decoration:none" aria-label="makeittalk home">${wordmark(24)}</a>
    <span class="nav-spacer"></span>
    ${link('/#how', 'how it works')}
    ${link('/pricing', 'pricing')}
    ${link('/docs', 'docs')}
    <a class="navlink hide-sm" href="/login">sign in</a>
    <a class="btn black" href="/signup" style="padding:.5em .95em">start free</a>
  </div></nav>`;
}

export function siteFooter() {
  return `
  <style>
  .foot{border-top:1px solid var(--line);margin-top:0;padding:2.2rem 1.25rem;background:var(--paper2)}
  .foot-in{max-width:1120px;margin:0 auto;display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;color:var(--muted);font-size:.9rem}
  .foot a{color:var(--muted)} .foot a:hover{color:var(--ink)}
  </style>
  <footer class="foot"><div class="foot-in">
    <span>${wordmark(20)}</span>
    <span>built by hand. zero npm packages. <a href="https://github.com/ryanshatz" rel="noopener">github</a> ·
      a <a href="https://ryan-shatzkamer.com" rel="noopener">ryan shatzkamer</a> build</span>
    <span><a href="/terms">terms</a> · <a href="/privacy">privacy</a> · <a href="mailto:hello@makeittalk.dev">hello@makeittalk.dev</a></span>
  </div></footer>`;
}
