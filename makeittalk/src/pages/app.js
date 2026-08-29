// The dashboard: a single server-rendered page carrying a vanilla-JS SPA that
// talks to /api. Client code avoids template literals on purpose (it lives
// inside a server template literal). Same design tokens as the landing.

import { page, wordmark } from './theme.js';
import { PLANS } from '../plans.js';

export function appPage(origin) {
  const body = `
<style>
body{background:var(--paper)}
.top{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:1rem;padding:.6rem 1.1rem;height:60px;
     background:color-mix(in srgb,var(--paper) 90%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .sp{flex:1}
.top .who{font-size:.85rem;color:var(--muted)}
.planbadge{font-family:var(--mono);font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
     padding:.2em .6em;border-radius:999px;background:var(--accent-soft);color:var(--accent)}
.layout{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:calc(100dvh - 60px)}
@media (max-width:840px){.layout{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--line)}}
.side{border-right:1px solid var(--line);padding:1rem;background:var(--paper2)}
.side h4{font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 .6rem}
.pitem{display:block;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:var(--r-sm);
     padding:.55rem .7rem;cursor:pointer;color:var(--ink);font:inherit;margin-bottom:.25rem}
.pitem:hover{background:var(--card);border-color:var(--line)}
.pitem.on{background:var(--card);border-color:var(--ink)}
.pitem .nm{font-weight:600;font-size:.93rem;display:flex;justify-content:space-between;gap:.5rem;align-items:center}
.pitem .sl{font-family:var(--mono);font-size:.74rem;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.dot.ready{background:var(--ok)} .dot.generating{background:var(--warn);animation:pulse 1.2s ease infinite}
.dot.error{background:var(--err)} .dot.new{background:var(--line)}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.dot.generating{animation:none}}
.main{padding:1.4rem 1.6rem;max-width:980px}
.tabs{display:flex;gap:.2rem;border-bottom:1px solid var(--line);margin:1rem 0 1.2rem;flex-wrap:wrap}
.tab{background:transparent;border:0;border-bottom:2px solid transparent;padding:.5rem .8rem;cursor:pointer;font:inherit;
     font-weight:600;font-size:.9rem;color:var(--muted);font-family:var(--font)}
.tab:hover{color:var(--ink)} .tab.on{color:var(--ink);border-bottom-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.2rem 1.35rem;box-shadow:var(--shadow);margin-bottom:1rem}
.termlog{background:var(--terminal);color:var(--terminal-ink);border-radius:var(--r);padding:1rem 1.1rem;font-family:var(--mono);
     font-size:.82rem;line-height:1.7;max-height:430px;overflow-y:auto;border:1px solid #1e2c21}
.termlog .st{color:#5d7a64}
.termlog .ok{color:#7fd49a} .termlog .warn{color:#d9b25c} .termlog .error{color:#e08b8b}
.trow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.6rem;align-items:start;border-bottom:1px solid var(--line);padding:.8rem .2rem}
.trow:last-child{border-bottom:0}
.trow code.nm{font-weight:700;background:transparent;padding:0}
.trow .de{color:var(--muted);font-size:.88rem;margin:.2rem 0 0}
.trow .prov{font-size:.78rem;font-family:var(--mono)}
.badge{font-family:var(--mono);font-size:.68rem;font-weight:700;padding:.16em .55em;border-radius:999px;background:var(--accent-soft);color:var(--accent)}
.kv{font-family:var(--mono);font-size:.85rem;background:var(--paper);border:1px solid var(--line);border-radius:var(--r-sm);
    padding:.55em .8em;display:flex;justify-content:space-between;gap:.8rem;align-items:center;overflow-x:auto;margin:.4rem 0}
.copy{border:1px solid var(--line);background:var(--card);border-radius:6px;cursor:pointer;font-family:var(--mono);font-size:.72rem;padding:.25em .6em;flex:none}
.copy:hover{border-color:var(--accent);color:var(--accent)}
.mut{color:var(--muted)} .sm{font-size:.86rem}
.err{background:color-mix(in srgb,var(--err) 10%,transparent);border:1px solid var(--err);color:var(--err);border-radius:var(--r-sm);padding:.6rem .9rem;font-size:.9rem;margin:.6rem 0}
.notice{background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(--r-sm);padding:.7rem .9rem;font-size:.9rem;margin:.6rem 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
@media (max-width:760px){.grid2{grid-template-columns:1fr}}
.usage{font-family:var(--mono);font-size:.74rem;color:var(--muted)}
pre.result{background:var(--terminal);color:var(--terminal-ink);border-radius:var(--r-sm);padding:.8em 1em;font-size:.78rem;overflow:auto;max-height:340px}
dialog{border:1px solid var(--line);border-radius:var(--r);background:var(--card);color:var(--ink);max-width:520px;width:92vw;padding:1.4rem;box-shadow:var(--shadow)}
dialog::backdrop{background:rgba(12,18,13,.45)}
table.adm{width:100%;border-collapse:collapse;font-size:.87rem}
table.adm th{text-align:left;font-family:var(--mono);font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:.45rem .5rem;border-bottom:1px solid var(--line)}
table.adm td{padding:.5rem;border-bottom:1px solid var(--line)}
.statrow{display:flex;gap:1rem;flex-wrap:wrap}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:.9rem 1.2rem;min-width:130px}
.stat .n{font-family:var(--font);font-size:1.7rem;font-weight:700;letter-spacing:-.03em}
.stat .l{font-size:.78rem;color:var(--muted)}
</style>

<div class="top">
  <a href="/" style="text-decoration:none">${wordmark(22)}</a>
  <span class="sp"></span>
  <span class="usage" id="usage"></span>
  <span class="planbadge" id="plan"></span>
  <button class="btn ghost" id="billingBtn" style="padding:.4em .8em;font-size:.85rem">billing</button>
  <button class="btn ghost" id="adminBtn" style="padding:.4em .8em;font-size:.85rem;display:none">admin</button>
  <button class="btn ghost" id="outBtn" style="padding:.4em .8em;font-size:.85rem">sign out</button>
</div>
<div class="layout">
  <aside class="side">
    <button class="btn black" id="newBtn" style="width:100%;justify-content:center;margin-bottom:1rem">+ new MCP</button>
    <h4>your MCPs</h4>
    <div id="plist"><p class="mut sm">loading...</p></div>
  </aside>
  <main class="main" id="main"><p class="mut">loading...</p></main>
</div>
<dialog id="dlg"></dialog>

<script>
(() => {
'use strict';
var S = { me: null, projects: [], current: null, detail: null, tab: 'activity', lastEvent: 0, events: [], poll: null, view: 'project' };
var $ = function (id) { return document.getElementById(id); };
var escadd = document.createElement('div');
function esc(s) { escadd.textContent = s == null ? '' : String(s); return escadd.innerHTML; }

function api(path, opts) {
  opts = opts || {};
  return fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(function (res) {
    if (res.status === 401) { location.href = '/login'; throw new Error('signed out'); }
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('json') === -1) return res.text().then(function (t) { if (!res.ok) throw new Error(t.slice(0, 200)); return t; });
    return res.json().then(function (j) { if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status)); return j; });
  });
}

function toast(msg, isErr) {
  var d = document.createElement('div');
  d.className = isErr ? 'err' : 'notice';
  d.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:99;max-width:380px;box-shadow:var(--shadow)';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 5200);
}

function copyBtn(text) {
  return '<button class="copy" data-copy="' + esc(text) + '">copy</button>';
}
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-copy]');
  if (b) { navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () { b.textContent = 'copied'; setTimeout(function () { b.textContent = 'copy'; }, 1400); }); }
});

// ---------- boot ----------
function boot() {
  api('/api/me').then(function (me) {
    S.me = me;
    $('plan').textContent = me.plan;
    $('usage').textContent = me.usage.generations + '/' + me.limits.generations_per_month + ' gens · ' + me.usage.tool_calls + '/' + me.limits.tool_calls_per_month + ' calls';
    if (me.role === 'admin') $('adminBtn').style.display = '';
    if (!me.verified) toast('Verify your email to enable generation (check your inbox).');
    return loadProjects();
  }).catch(function (e) { console.error(e); });
}

function loadProjects() {
  return api('/api/projects').then(function (r) {
    S.projects = r.projects;
    renderList();
    if (S.view === 'project') {
      if (!S.current && S.projects.length) selectProject(S.projects[0].id);
      else if (!S.projects.length) renderEmpty();
      else if (S.current) { var still = S.projects.find(function (p) { return p.id === S.current; }); if (!still) { S.current = null; renderEmpty(); } }
    }
  });
}

function renderList() {
  $('plist').innerHTML = S.projects.length ? S.projects.map(function (p) {
    return '<button class="pitem' + (p.id === S.current ? ' on' : '') + '" data-p="' + p.id + '">' +
      '<span class="nm">' + esc(p.name) + '<span class="dot ' + esc(p.status) + '"></span></span>' +
      '<span class="sl">/mcp/' + esc(p.slug) + ' · ' + p.tool_count + ' tools</span></button>';
  }).join('') : '<p class="mut sm">no MCPs yet. make one talk.</p>';
  Array.prototype.forEach.call(document.querySelectorAll('.pitem'), function (el) {
    el.onclick = function () { S.view = 'project'; selectProject(el.getAttribute('data-p')); };
  });
}

function renderEmpty() {
  stopPoll();
  $('main').innerHTML =
    '<div class="card" style="text-align:center;padding:3rem 1.5rem">' +
    '<h2 style="margin-bottom:.3rem">make something talk</h2>' +
    '<p class="mut" style="max-width:26rem;margin:0 auto 1.2rem">paste a docs link, add a credential, and get a working MCP server your AI can call.</p>' +
    '<button class="btn black" id="emptyNew">+ new MCP</button></div>';
  $('emptyNew').onclick = function () { $('newBtn').click(); };
}

// ---------- new project ----------
$('newBtn').onclick = function () {
  var dlg = $('dlg');
  dlg.innerHTML =
    '<h3>new MCP</h3>' +
    '<label>name</label><input id="npName" placeholder="stripe, my crm, the dialer..." maxlength="60">' +
    '<label>docs link</label><input id="npUrl" placeholder="https://docs.example.com/api">' +
    '<p class="mut sm" style="margin:.4rem 0 0">or <a href="#" id="npPasteToggle">paste raw documentation</a> instead</p>' +
    '<div id="npPasteWrap" style="display:none"><label>pasted docs</label><textarea id="npText" rows="6" placeholder="paste the API reference text here"></textarea></div>' +
    '<label>what should it be good at? <span class="mut" style="font-weight:400">(optional)</span></label>' +
    '<input id="npGoal" placeholder="reading and creating invoices, mostly">' +
    '<div style="display:flex;gap:.6rem;margin-top:1.2rem;justify-content:flex-end">' +
    '<button class="btn ghost" id="npCancel">cancel</button>' +
    '<button class="btn black" id="npGo">create + generate</button></div>';
  dlg.showModal();
  $('npPasteToggle').onclick = function (e) { e.preventDefault(); var w = $('npPasteWrap'); w.style.display = w.style.display === 'none' ? '' : 'none'; };
  $('npCancel').onclick = function () { dlg.close(); };
  $('npGo').onclick = function () {
    var name = $('npName').value.trim();
    var body = { name: name, source_url: $('npUrl').value.trim(), source_text: $('npText') ? $('npText').value : '', goal: $('npGoal').value.trim() };
    $('npGo').disabled = true; $('npGo').textContent = 'creating...';
    api('/api/projects', { method: 'POST', body: body }).then(function (r) {
      dlg.innerHTML =
        '<h3>save your MCP key</h3>' +
        '<p class="mut sm">This key is shown once. MCP clients present it to use your server; you can rotate it later.</p>' +
        '<div class="kv"><span>' + esc(r.mcp_key) + '</span>' + copyBtn(r.mcp_key) + '</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:1rem"><button class="btn black" id="npDone">saved it, start generating</button></div>';
      $('npDone').onclick = function () {
        dlg.close();
        api('/api/projects/' + r.id + '/generate', { method: 'POST', body: {} }).catch(function (e) { toast(e.message, true); });
        loadProjects().then(function () { selectProject(r.id); });
      };
    }).catch(function (e) { toast(e.message, true); $('npGo').disabled = false; $('npGo').textContent = 'create + generate'; });
  };
};

// ---------- project detail ----------
function selectProject(id) {
  S.current = id; S.tab = 'activity'; S.lastEvent = 0; S.events = [];
  stopPoll();
  renderList();
  api('/api/projects/' + id).then(function (r) {
    S.detail = r.project;
    renderProject();
    pollEvents(true);
  }).catch(function (e) { toast(e.message, true); });
}

function refreshDetail() {
  return api('/api/projects/' + S.current).then(function (r) { S.detail = r.project; renderProject(); });
}

function stopPoll() { if (S.poll) { clearTimeout(S.poll); S.poll = null; } }

function pollEvents(first) {
  if (!S.current) return;
  api('/api/projects/' + S.current + '/events?after=' + S.lastEvent).then(function (r) {
    if (r.events.length) {
      S.events = S.events.concat(r.events);
      S.lastEvent = r.events[r.events.length - 1].id;
      renderLog();
    }
    var was = S.detail && S.detail.status;
    if (S.detail) { S.detail.status = r.status; S.detail.error = r.error; }
    if (was !== r.status) { refreshDetail(); loadProjects(); }
    if (r.status === 'generating') S.poll = setTimeout(pollEvents, 1600);
  }).catch(function () { S.poll = setTimeout(pollEvents, 4000); });
}

function tabBtn(id, label) {
  return '<button class="tab' + (S.tab === id ? ' on' : '') + '" data-tab="' + id + '">' + label + '</button>';
}

function renderProject() {
  var p = S.detail;
  if (!p) return;
  var html =
    '<div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">' +
    '<h2 style="margin:0">' + esc(p.name) + '</h2>' +
    '<span class="pill">/mcp/' + esc(p.slug) + '</span>' +
    '<span class="dot ' + esc(p.status) + '" title="' + esc(p.status) + '"></span><span class="mut sm">' + esc(p.status) + '</span></div>';
  if (p.source_url) html += '<p class="mut sm" style="margin:.3rem 0 0">source: <a href="' + esc(p.source_url) + '" target="_blank" rel="noopener">' + esc(p.source_url) + '</a></p>';
  if (p.error) html += '<div class="err">' + esc(p.error) + '</div>';
  html += '<div class="tabs">' + tabBtn('activity', 'activity') + tabBtn('tools', 'tools (' + (p.manifest ? p.manifest.tools.length : 0) + ')') +
    tabBtn('connect', 'connect') + tabBtn('credentials', 'credentials') + tabBtn('settings', 'settings') + '</div>' +
    '<div id="tabbody"></div>';
  $('main').innerHTML = html;
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (el) {
    el.onclick = function () { S.tab = el.getAttribute('data-tab'); renderProject(); };
  });
  var t = S.tab;
  if (t === 'activity') renderActivity();
  else if (t === 'tools') renderTools();
  else if (t === 'connect') renderConnect();
  else if (t === 'credentials') renderCreds();
  else renderSettings();
}

function renderActivity() {
  var p = S.detail;
  var controls = '';
  if (p.status !== 'generating') {
    controls = '<div style="margin-bottom:.8rem;display:flex;gap:.6rem;flex-wrap:wrap">' +
      '<button class="btn black" id="genBtn">' + (p.status === 'ready' ? 'regenerate' : 'generate') + '</button>' +
      (p.status === 'ready' ? '<span class="mut sm" style="align-self:center">regenerating rebuilds the toolset from the docs again</span>' : '') + '</div>';
  }
  $('tabbody').innerHTML = controls + '<div class="termlog" id="log"></div>';
  var g = $('genBtn');
  if (g) g.onclick = function () {
    g.disabled = true;
    api('/api/projects/' + p.id + '/generate', { method: 'POST', body: {} }).then(function () {
      S.detail.status = 'generating'; renderProject(); loadProjects(); pollEvents();
    }).catch(function (e) { toast(e.message, true); g.disabled = false; });
  };
  renderLog();
}

function renderLog() {
  var el = $('log');
  if (!el) return;
  el.innerHTML = S.events.length ? S.events.map(function (ev) {
    var d = new Date(ev.ts * 1000);
    var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    return '<div class="' + esc(ev.level) + '"><span class="st">' + hh + ' ' + esc(ev.stage) + '</span> · ' + esc(ev.message) + '</div>';
  }).join('') : '<span class="st">no activity yet. hit generate.</span>';
  el.scrollTop = el.scrollHeight;
}

function renderTools() {
  var p = S.detail;
  if (!p.manifest) { $('tabbody').innerHTML = '<div class="card mut">no toolset yet. generate first.</div>'; return; }
  var rows = p.manifest.tools.map(function (t, i) {
    return '<div class="trow"><div>' +
      '<code class="nm">' + esc(t.name) + '</code> <span class="badge">' + esc(t.request.method) + ' ' + esc(t.request.path) + '</span>' +
      '<p class="de">' + esc(t.description.split('\\n')[0]) + '</p>' +
      (t.provenance && t.provenance.url ? '<p class="prov">learned from <a href="' + esc(t.provenance.url) + '" target="_blank" rel="noopener">' + esc(t.provenance.url) + '</a></p>' : '') +
      '<div id="try-' + i + '"></div></div>' +
      '<button class="btn ghost" style="padding:.35em .8em;font-size:.82rem" data-try="' + i + '">try</button></div>';
  }).join('');
  $('tabbody').innerHTML =
    '<div class="card"><p class="mut sm" style="margin:0 0 .4rem">' + esc(p.manifest.server.description || '') + '</p>' + rows +
    '<div class="trow"><div><code class="nm">api_call</code> <span class="badge">ANY</span><p class="de">escape hatch: call any documented endpoint directly' + (p.allow_delete ? '' : ' (DELETE refused)') + '.</p></div></div></div>';
  Array.prototype.forEach.call(document.querySelectorAll('[data-try]'), function (btn) {
    btn.onclick = function () { openTry(parseInt(btn.getAttribute('data-try'), 10)); };
  });
}

function openTry(i) {
  var t = S.detail.manifest.tools[i];
  var host = $('try-' + i);
  if (host.innerHTML) { host.innerHTML = ''; return; }
  var props = (t.input_schema && t.input_schema.properties) || {};
  var req = (t.input_schema && t.input_schema.required) || [];
  var fields = Object.keys(props).slice(0, 8).map(function (k) {
    var d = props[k] || {};
    return '<label style="margin-top:.5rem">' + esc(k) + (req.indexOf(k) !== -1 ? ' *' : '') + '</label>' +
      '<input data-arg="' + esc(k) + '" placeholder="' + esc((d.description || d.type || '').slice(0, 70)) + '">';
  }).join('');
  host.innerHTML = '<div style="border:1px dashed var(--line);border-radius:var(--r-sm);padding: .4rem .9rem .9rem;margin-top:.6rem">' +
    (fields || '<p class="mut sm">no arguments</p>') +
    '<button class="btn black" style="margin-top:.7rem;padding:.4em .9em;font-size:.85rem" data-run="' + i + '">run it</button>' +
    '<div data-out="' + i + '"></div></div>';
  host.querySelector('[data-run]').onclick = function () {
    var args = {};
    Array.prototype.forEach.call(host.querySelectorAll('[data-arg]'), function (inp) {
      var v = inp.value.trim();
      if (!v) return;
      var key = inp.getAttribute('data-arg');
      var type = (props[key] && props[key].type) || 'string';
      if (type === 'number' || type === 'integer') { var n = Number(v); args[key] = isNaN(n) ? v : n; }
      else if (type === 'boolean') args[key] = v === 'true';
      else if (type === 'object' || type === 'array') { try { args[key] = JSON.parse(v); } catch (e) { args[key] = v; } }
      else args[key] = v;
    });
    var out = host.querySelector('[data-out]');
    out.innerHTML = '<p class="mut sm">calling the API...</p>';
    api('/api/projects/' + S.detail.id + '/try', { method: 'POST', body: { tool: t.name, arguments: args } })
      .then(function (r) { out.innerHTML = '<pre class="result">' + esc(r.result) + '</pre>'; })
      .catch(function (e) { out.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
  };
}

function renderConnect() {
  var p = S.detail;
  var url = '${origin}/mcp/' + p.slug;
  $('tabbody').innerHTML =
    '<div class="card"><h3>endpoint</h3>' +
    '<div class="kv"><span>' + esc(url) + '</span>' + copyBtn(url) + '</div>' +
    '<p class="mut sm">key: <code>' + esc(p.mcp_key_hint || 'none yet') + '</code> (shown once at creation · rotate in settings)</p></div>' +
    '<div class="grid2">' +
    '<div class="card"><h3>claude.ai + claude desktop</h3><p class="mut sm">Settings → Connectors → add custom connector → paste the endpoint URL. When the authorize screen appears, paste your MCP key.</p></div>' +
    '<div class="card"><h3>claude code</h3><div class="kv"><span>claude mcp add --transport http ' + esc(p.slug) + ' ' + esc(url) + '</span>' + copyBtn('claude mcp add --transport http ' + p.slug + ' ' + url) + '</div><p class="mut sm">authenticate with the MCP key when prompted, or pass it as a Bearer header.</p></div>' +
    '<div class="card"><h3>chatgpt</h3><p class="mut sm">Settings → Connectors → Advanced → Developer mode → add the MCP server URL, auth with the key.</p></div>' +
    '<div class="card"><h3>anything else</h3><p class="mut sm">standard streamable HTTP MCP with OAuth 2.1, or send <code>Authorization: Bearer &lt;key&gt;</code>.</p></div>' +
    '</div>' +
    '<div class="card"><h3>first thing to say</h3><p class="mut sm" style="margin:0">"list the tools you have from ' + esc(p.name) + ' and check the connection."</p></div>';
}

function renderCreds() {
  var p = S.detail;
  var fields = (p.cred_fields && p.cred_fields.length) ? p.cred_fields : [{ key: 'token', label: 'API token' }];
  $('tabbody').innerHTML =
    '<div class="card"><h3>credentials</h3>' +
    (p.has_creds ? '<div class="notice">credentials are stored (encrypted). saving again replaces them.</div>' : '<p class="mut sm">the generated tools authenticate with these. encrypted at rest, never shown again, never sent to the design AI.</p>') +
    fields.map(function (f) { return '<label>' + esc(f.label) + '</label><input type="password" data-cred="' + esc(f.key) + '" autocomplete="off">'; }).join('') +
    '<div style="display:flex;gap:.6rem;margin-top:1.1rem">' +
    '<button class="btn black" id="credSave">save credentials</button>' +
    (p.has_creds ? '<button class="btn ghost" id="credWipe">wipe</button>' : '') + '</div></div>';
  $('credSave').onclick = function () {
    var values = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-cred]'), function (inp) {
      if (inp.value) values[inp.getAttribute('data-cred')] = inp.value;
    });
    api('/api/projects/' + p.id + '/credentials', { method: 'PUT', body: { values: values } })
      .then(function () { toast('credentials stored (encrypted).'); refreshDetail(); })
      .catch(function (e) { toast(e.message, true); });
  };
  var w = $('credWipe');
  if (w) w.onclick = function () {
    api('/api/projects/' + p.id + '/credentials', { method: 'DELETE' })
      .then(function () { toast('credentials wiped.'); refreshDetail(); }).catch(function (e) { toast(e.message, true); });
  };
}

function renderSettings() {
  var p = S.detail;
  $('tabbody').innerHTML =
    '<div class="card"><h3>project</h3>' +
    '<label>name</label><input id="setName" value="' + esc(p.name) + '" maxlength="60">' +
    '<label>goal</label><input id="setGoal" value="' + esc(p.goal || '') + '" maxlength="200">' +
    '<label style="display:flex;align-items:center;gap:.5rem;margin-top:1rem"><input type="checkbox" id="setDel" style="width:auto"' + (p.allow_delete ? ' checked' : '') + '> allow DELETE endpoints (regenerate to include them)</label>' +
    '<button class="btn black" id="setSave" style="margin-top:1rem">save</button></div>' +
    '<div class="card"><h3>MCP key</h3><p class="mut sm">current: <code>' + esc(p.mcp_key_hint || '') + '</code>. rotating invalidates the old key and all OAuth tokens.</p>' +
    '<button class="btn ghost" id="rotBtn">rotate key</button></div>' +
    '<div class="card"><h3>own it</h3><p class="mut sm">download this server as a standalone zero-dependency Cloudflare Worker (pro).</p>' +
    '<a class="btn ghost" href="/api/projects/' + p.id + '/export">export worker.js</a></div>' +
    '<div class="card" style="border-color:var(--err)"><h3 style="color:var(--err)">danger</h3>' +
    '<button class="btn ghost" id="delBtn" style="border-color:var(--err);color:var(--err)">delete this project</button></div>';
  $('setSave').onclick = function () {
    api('/api/projects/' + p.id, { method: 'PATCH', body: { name: $('setName').value, goal: $('setGoal').value, allow_delete: $('setDel').checked } })
      .then(function () { toast('saved.'); refreshDetail(); loadProjects(); }).catch(function (e) { toast(e.message, true); });
  };
  $('rotBtn').onclick = function () {
    api('/api/projects/' + p.id + '/rotate-key', { method: 'POST', body: {} }).then(function (r) {
      var dlg = $('dlg');
      dlg.innerHTML = '<h3>new MCP key</h3><p class="mut sm">shown once. reconnect your clients.</p>' +
        '<div class="kv"><span>' + esc(r.mcp_key) + '</span>' + copyBtn(r.mcp_key) + '</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:1rem"><button class="btn black" id="rotDone">done</button></div>';
      dlg.showModal();
      $('rotDone').onclick = function () { dlg.close(); };
      refreshDetail();
    }).catch(function (e) { toast(e.message, true); });
  };
  $('delBtn').onclick = function () {
    if (!confirm('Delete "' + p.name + '" and its MCP endpoint? This cannot be undone.')) return;
    api('/api/projects/' + p.id, { method: 'DELETE' }).then(function () {
      S.current = null; S.detail = null;
      loadProjects();
      toast('project deleted.');
    }).catch(function (e) { toast(e.message, true); });
  };
}

// ---------- billing / admin / signout ----------
$('billingBtn').onclick = function () {
  var me = S.me || {};
  if (me.plan === 'pro' || me.plan === 'scale') {
    api('/api/billing/portal', { method: 'POST', body: {} }).then(function (r) { location.href = r.url; }).catch(function (e) { toast(e.message, true); });
  } else {
    var dlg = $('dlg');
    dlg.innerHTML = '<h3>upgrade</h3><p class="mut sm">pick a plan; you will land on Stripe checkout.</p>' +
      '<div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap">' +
      '<button class="btn black" data-plan="pro">pro · $${PLANS.pro.price}/mo</button>' +
      '<button class="btn ghost" data-plan="scale">scale · $${PLANS.scale.price}/mo</button>' +
      '<button class="btn ghost" id="upNope">not now</button></div>';
    dlg.showModal();
    $('upNope').onclick = function () { dlg.close(); };
    Array.prototype.forEach.call(dlg.querySelectorAll('[data-plan]'), function (b) {
      b.onclick = function () {
        api('/api/billing/checkout', { method: 'POST', body: { plan: b.getAttribute('data-plan') } })
          .then(function (r) { location.href = r.url; }).catch(function (e) { toast(e.message, true); });
      };
    });
  }
};
$('outBtn').onclick = function () {
  api('/api/auth/logout', { method: 'POST', body: {} }).then(function () { location.href = '/'; });
};
$('adminBtn').onclick = function () {
  S.view = 'admin';
  stopPoll();
  Promise.all([api('/api/admin/overview'), api('/api/admin/users'), api('/api/admin/projects')]).then(function (rs) {
    var o = rs[0], users = rs[1].users, projects = rs[2].projects;
    $('main').innerHTML =
      '<h2>admin</h2>' +
      '<div class="statrow" style="margin:1rem 0">' +
      stat(o.users, 'users') + stat(o.projects, 'projects') + stat(o.ready_mcps, 'live MCPs') +
      stat(o.generations_this_month, 'gens · ' + o.month) + stat(o.tool_calls_this_month, 'tool calls') + stat('$' + o.mrr_estimate, 'MRR est.') + '</div>' +
      '<div class="card"><h3>users</h3><div style="overflow-x:auto"><table class="adm"><tr><th>email</th><th>plan</th><th>status</th><th>role</th><th>projects</th><th>gens</th><th>calls</th><th></th></tr>' +
      users.map(function (u) {
        return '<tr><td>' + esc(u.email) + '</td><td>' +
          '<select data-uplan="' + u.id + '" style="width:auto;padding:.2em .4em">' +
          ['free', 'pro', 'scale', 'comp'].map(function (pl) { return '<option' + (u.plan === pl ? ' selected' : '') + '>' + pl + '</option>'; }).join('') +
          '</select></td><td>' + esc(u.plan_status || '') + '</td><td>' + esc(u.role) + '</td><td>' + u.projects + '</td><td>' + u.generations + '</td><td>' + u.tool_calls + '</td>' +
          '<td><button class="copy" data-usave="' + u.id + '">save</button></td></tr>';
      }).join('') + '</table></div></div>' +
      '<div class="card"><h3>projects</h3><div style="overflow-x:auto"><table class="adm"><tr><th>name</th><th>slug</th><th>status</th><th>owner</th></tr>' +
      projects.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.slug) + '</td><td>' + esc(p.status) + '</td><td>' + esc(p.owner) + '</td></tr>'; }).join('') +
      '</table></div></div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-usave]'), function (b) {
      b.onclick = function () {
        var uid = b.getAttribute('data-usave');
        var sel = document.querySelector('[data-uplan="' + uid + '"]');
        api('/api/admin/users/' + uid, { method: 'PATCH', body: { plan: sel.value } })
          .then(function () { toast('updated.'); }).catch(function (e) { toast(e.message, true); });
      };
    });
  }).catch(function (e) { toast(e.message, true); });
};
function stat(n, l) { return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }

boot();
})();
</script>`;

  return page({
    title: 'dashboard · makeittalk',
    description: 'Your generated MCP servers.',
    body,
    origin,
    path: '/app',
  });
}
