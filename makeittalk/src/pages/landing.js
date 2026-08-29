// The landing page. Design read: SaaS landing for developers and CX builders,
// lowercase hand-built voice, pale green paper + ink black, monospace accents.
// Dials: variance 7 / motion 6 / density 4. Motion is reveal + one scripted
// terminal loop (the product's actual core loop, told truthfully), all
// transform/opacity, collapsed under prefers-reduced-motion.

import { page, siteNav, siteFooter, logoSvg } from './theme.js';
import { PLANS } from '../plans.js';

export function landingPage(origin) {
  const body = `
${siteNav()}
<script>document.documentElement.classList.add('js')</script>
<style>
main{overflow-x:clip}
.wrap{max-width:1120px;margin:0 auto;padding:0 1.25rem}
.eyebrow{font-family:var(--mono);font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:600}
section{padding:4.6rem 0}
/* reveal styles apply only when JS is running - no-JS visitors see everything */
.js .reveal{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}
.js .reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){
  .js .reveal{opacity:1;transform:none;transition:none}
  html{scroll-behavior:auto}
}

/* hero */
.hero{padding:3.4rem 0 3.6rem}
.hero-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:2.6rem;align-items:center}
@media (max-width:880px){.hero-grid{grid-template-columns:1fr}}
.hero h1{font-size:clamp(2.5rem,6vw,4.1rem);margin:.1em 0 .25em}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero .sub{font-size:1.13rem;color:var(--muted);max-width:34rem;margin:0 0 1.4rem}
.hero .ctas{display:flex;gap:.7rem;flex-wrap:wrap}
.works{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:2.1rem;align-items:center}
.works .lbl{font-size:.83rem;color:var(--muted)}

/* terminal */
.term{background:var(--terminal);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden;border:1px solid #1e2c21}
.term-bar{display:flex;align-items:center;gap:.45rem;padding:.6rem .9rem;border-bottom:1px solid #1e2c21}
.term-bar i{width:10px;height:10px;border-radius:50%;background:#28382c;display:inline-block}
.term-bar span{font-family:var(--mono);font-size:.75rem;color:#5d7a64;margin-left:.4rem}
.term-body{padding:1rem 1.1rem 1.2rem;font-family:var(--mono);font-size:.83rem;line-height:1.75;color:var(--terminal-ink);min-height:305px}
.term-body .dim{color:#5d7a64}
.term-body .ok{color:#7fd49a}
.term-body .chip{display:inline-block;border:1px solid #2c4433;border-radius:6px;padding:.05em .5em;margin:.12em .25em .12em 0;color:#a8d9b4}
.term-body .caret{display:inline-block;width:.55em;height:1.05em;background:#7fd49a;vertical-align:-.18em;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.term-body .caret{animation:none}}

/* problem */
.problem{background:var(--paper2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.problem-in{max-width:46rem;margin:0 auto;text-align:left}
.problem h2{font-size:clamp(1.7rem,3.4vw,2.4rem)}
.problem p{color:var(--muted);font-size:1.06rem}

/* bento: how it works, 3 cells */
.bento{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);grid-template-rows:auto auto;gap:1rem;margin-top:2rem}
@media (max-width:880px){.bento{grid-template-columns:1fr}}
.cell{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.4rem 1.5rem;box-shadow:var(--shadow)}
.cell.tall{grid-row:span 2}
@media (max-width:880px){.cell.tall{grid-row:auto}}
.cell h3{font-size:1.2rem;display:flex;align-items:center;gap:.55rem}
.cell h3 .v{font-family:var(--mono);font-size:.75rem;background:var(--ink);color:var(--on-black);border-radius:6px;padding:.15em .55em;letter-spacing:.04em}
.cell p{color:var(--muted);font-size:.95rem;margin:.4rem 0 1rem}
.mockfield{border:1.5px dashed var(--line);border-radius:var(--r-sm);padding:.6em .8em;font-family:var(--mono);font-size:.85rem;color:var(--muted);background:var(--paper)}
.mocklog{font-family:var(--mono);font-size:.8rem;line-height:1.7;background:var(--terminal);color:var(--terminal-ink);border-radius:var(--r-sm);padding:.8em 1em}
.mocklog .dim{color:#5d7a64}
.keyline{display:flex;align-items:center;gap:.55rem;font-family:var(--mono);font-size:.82rem;background:var(--paper);border:1px solid var(--line);border-radius:var(--r-sm);padding:.55em .8em;overflow-x:auto}

/* anatomy split */
.anatomy{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:2.6rem;align-items:start}
@media (max-width:880px){.anatomy{grid-template-columns:1fr}}
.anatomy .lead{color:var(--muted);font-size:1.05rem}
.toolcard{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden}
.toolcard .tc-head{padding:1rem 1.2rem;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.toolcard .tc-head code{font-size:1rem;background:transparent;padding:0;font-weight:700}
.badge{font-family:var(--mono);font-size:.7rem;font-weight:700;letter-spacing:.05em;padding:.18em .6em;border-radius:999px}
.badge.get{color:var(--ok);background:var(--accent-soft)}
.badge.post{color:#fff;background:var(--accent)}
.tc-row{padding:.85rem 1.2rem;border-bottom:1px solid var(--line);font-size:.9rem}
.tc-row:last-child{border-bottom:0}
.tc-row .k{font-family:var(--mono);font-size:.72rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:.25rem}
.tc-row pre{margin:0;background:var(--paper);border:1px solid var(--line);border-radius:var(--r-sm);padding:.6em .8em;font-size:.8rem;overflow-x:auto}

/* dna */
.dna-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1.8rem}
@media (max-width:760px){.dna-grid{grid-template-columns:1fr}}
.dna-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.4rem 1.5rem;box-shadow:var(--shadow);transition:transform .15s ease}
.dna-card:hover{transform:translateY(-3px)}
.dna-card h3{font-family:var(--mono);font-size:1.05rem;letter-spacing:0}
.dna-card p{color:var(--muted);font-size:.93rem}
.dna-card .facts{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.8rem}

/* security */
.sec-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);margin-top:1.8rem;
          display:grid;grid-template-columns:1fr 1fr;gap:0}
@media (max-width:760px){.sec-card{grid-template-columns:1fr}}
.sec-item{padding:1.3rem 1.5rem;border-bottom:1px solid var(--line)}
.sec-item:nth-child(odd){border-right:1px solid var(--line)}
@media (max-width:760px){.sec-item:nth-child(odd){border-right:0}}
.sec-item:nth-last-child(-n+2){border-bottom:0}
@media (max-width:760px){.sec-item:nth-last-child(2){border-bottom:1px solid var(--line)}}
.sec-item h3{font-size:1.02rem}
.sec-item p{color:var(--muted);font-size:.92rem;margin:.3rem 0 0}

/* pricing */
.price-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-top:2rem;align-items:stretch}
@media (max-width:880px){.price-grid{grid-template-columns:1fr}}
.price{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.6rem;display:flex;flex-direction:column;box-shadow:var(--shadow)}
.price.hot{background:var(--ink);color:var(--on-black);border-color:var(--ink);transform:scale(1.02)}
.price.hot .mut,.price.hot li{color:color-mix(in srgb,var(--on-black) 75%,transparent)}
.price h3{font-size:1.1rem}
.price .amt{font-family:var(--font);font-size:2.5rem;font-weight:700;letter-spacing:-.04em;margin:.2rem 0 .1rem}
.price .amt small{font-size:1rem;font-weight:500;color:inherit;opacity:.65}
.price .mut{color:var(--muted);font-size:.9rem}
.price ul{list-style:none;margin:1rem 0 1.4rem;padding:0;font-size:.93rem;flex:1}
.price li{padding:.32rem 0;color:var(--muted)}
.price li::before{content:'+ ';font-family:var(--mono);color:var(--accent)}
.price.hot li::before{color:var(--accent)}
.price .btn{justify-content:center}
.price.hot .btn{background:var(--paper);color:var(--ink);border-color:var(--paper)}
.price.hot .btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}

/* faq */
.faq{max-width:46rem;margin:1.6rem auto 0}
.faq details{border-bottom:1px solid var(--line);padding:.9rem .2rem}
.faq summary{cursor:pointer;font-weight:600;font-family:var(--font);font-size:1.02rem;list-style:none;display:flex;justify-content:space-between;align-items:center}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-family:var(--mono);color:var(--accent);font-size:1.2rem;transition:transform .2s ease}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq p{color:var(--muted);font-size:.95rem;margin:.6rem 0 .2rem}

/* final band */
.band{background:var(--ink);color:var(--on-black);text-align:center;padding:4.6rem 1.25rem;border-top:1px solid var(--line)}
.band h2{font-size:clamp(1.9rem,4.5vw,3rem);color:inherit}
.band p{opacity:.75;max-width:32rem;margin:.4rem auto 1.5rem}
.band .btn{background:var(--paper);color:var(--ink);border-color:var(--paper)}
.band .btn:hover{background:var(--accent);border-color:var(--accent);color:#fff}
</style>

<main>
<!-- hero -->
<header class="hero wrap">
  <div class="hero-grid">
    <div>
      <h1>paste a link.<br>get an <em>MCP.</em></h1>
      <p class="sub">makeittalk reads the docs, maps the API, and builds a working MCP server your AI can call. minutes, not sprints.</p>
      <div class="ctas">
        <a class="btn black" href="/signup">start free</a>
        <a class="btn ghost" href="/docs">read the docs</a>
      </div>
      <div class="works">
        <span class="lbl">works with</span>
        <span class="pill">claude</span><span class="pill">claude code</span><span class="pill">chatgpt</span><span class="pill">cursor</span><span class="pill">any MCP client</span>
      </div>
    </div>
    <div class="term" aria-label="demo of an MCP being generated">
      <div class="term-bar"><i></i><i></i><i></i><span>makeittalk · generation log</span></div>
      <div class="term-body" id="demo"><noscript>
$ makeittalk new https://docs.stripe.com<br>
reading docs.stripe.com... found the API reference<br>
auth: bearer (secret key) · base: https://api.stripe.com<br>
mapped 214 endpoints from 6 pages<br>
designing the toolset with claude...<br>
+ list_customers &nbsp;+ create_payment_link &nbsp;+ search_charges<br>
18 tools ready · endpoint live at /mcp/stripe<br>
      </noscript></div>
    </div>
  </div>
</header>

<!-- problem -->
<section class="problem">
  <div class="wrap problem-in reveal">
    <span class="eyebrow">the gap</span>
    <h2>your AI can do everything, except call your software</h2>
    <p>Every platform you run has an API. Almost none of them speak MCP yet. So the assistant that could manage your CRM, your dialer, your billing, your anything, sits outside the glass looking in.</p>
    <p>Writing an MCP server by hand means reading every docs page, mapping auth, shaping schemas, hosting the thing. That is a build. makeittalk turns it into a paste.</p>
  </div>
</section>

<!-- how it works -->
<section class="wrap" id="how">
  <div class="reveal">
    <span class="eyebrow">how it works</span>
    <h2>three moves, no terminal</h2>
  </div>
  <div class="bento">
    <div class="cell tall reveal">
      <h3><span class="v">paste</span> drop in a docs link</h3>
      <p>A documentation URL is enough. An OpenAPI spec is the jackpot. Pasted docs work too. Tell it what you want the MCP to be good at, or let it decide.</p>
      <div class="mockfield">https://developer.example.com/docs</div>
      <p style="margin-top:1rem">Then add the credentials the API expects. They are encrypted at rest and never leave your project, and they are never shown to the AI that designs your tools.</p>
      <div class="mockfield">api key · ••••••••••••••••</div>
    </div>
    <div class="cell reveal">
      <h3><span class="v">watch</span> the engine read for you</h3>
      <p>It hunts for a machine spec, crawls the reference pages Claude flags as real, and logs every find live: which endpoint, which page, which auth scheme.</p>
      <div class="mocklog"><span class="dim">spec</span> found openapi.json · 214 endpoints<br><span class="dim">map</span> auth: bearer · base: api.example.com<br><span class="dim">design</span> tool: list_orders -> GET /v1/orders</div>
    </div>
    <div class="cell reveal">
      <h3><span class="v">connect</span> one URL, one key</h3>
      <p>Your MCP goes live at its own endpoint with OAuth built in. Add it to Claude as a connector, or to any client with a bearer key. Export the whole server as a standalone Worker whenever you want out.</p>
      <div class="keyline">https://makeittalk.dev/mcp/your-api &nbsp;<span style="color:var(--accent)">mit_••••••••</span></div>
    </div>
  </div>
</section>

<!-- anatomy -->
<section class="problem">
  <div class="wrap anatomy">
    <div class="reveal">
      <span class="eyebrow">what you get</span>
      <h2>tools with receipts</h2>
      <p class="lead">Every generated tool shows its work: the HTTP call it makes, the schema your AI sees, and the docs page it was learned from. Nothing is a black box, and a generic api_call escape hatch covers the long tail.</p>
      <p class="lead">Deletes are excluded by default. The AI builds and reads; destructive verbs stay behind a switch you control.</p>
    </div>
    <div class="toolcard reveal">
      <div class="tc-head"><code>create_payment_link</code><span class="badge post">POST</span><span class="pill">/v1/payment_links</span></div>
      <div class="tc-row"><span class="k">description</span>Create a shareable payment link for a price. Use list_prices first to find the price id.</div>
      <div class="tc-row"><span class="k">input schema</span><pre>{ "line_items": [{ "price": "price_...", "quantity": 1 }] }</pre></div>
      <div class="tc-row"><span class="k">learned from</span><a href="#" onclick="return false">docs.stripe.com/api/payment-link/create</a></div>
    </div>
  </div>
</section>

<!-- dna -->
<section class="wrap">
  <div class="reveal">
    <span class="eyebrow">the lineage</span>
    <h2>born from real builds, not a demo reel</h2>
    <p style="color:var(--muted);max-width:44rem">The engine productizes how genesys-mcp and five9-mcp were actually made: read the platform docs, design a curated toolbox an AI can wield, publish it as a zero-dependency Worker. Both are open source. Go read them.</p>
  </div>
  <div class="dna-grid">
    <a class="dna-card reveal" href="https://github.com/ryanshatz/genesys-mcp" rel="noopener" style="text-decoration:none;color:inherit">
      <h3>genesys-mcp</h3>
      <p>Builds queues, skills, Architect call flows, and full outbound cadences in Genesys Cloud from plain English. Flows are diagrammed in chat before they publish.</p>
      <div class="facts"><span class="pill">41 tools</span><span class="pill">zero deps</span><span class="pill">cloudflare workers</span></div>
    </a>
    <a class="dna-card reveal" href="https://github.com/ryanshatz/five9-mcp" rel="noopener" style="text-decoration:none;color:inherit">
      <h3>five9-mcp</h3>
      <p>The whole Five9 domain over MCP: campaigns, users, skills, lists, dispositions, IVR, real-time stats. Includes a hand-rolled XML parser for the SOAP API.</p>
      <div class="facts"><span class="pill">full domain</span><span class="pill">zero deps</span><span class="pill">oauth 2.1</span></div>
    </a>
  </div>
</section>

<!-- security -->
<section class="problem">
  <div class="wrap">
    <div class="reveal">
      <span class="eyebrow">security model</span>
      <h2>your keys, your rules</h2>
    </div>
    <div class="sec-card reveal">
      <div class="sec-item"><h3>credentials encrypted at rest</h3><p>AES-256-GCM, decrypted only at call time, never echoed back to you or anyone else. Wipe them with one click.</p></div>
      <div class="sec-item"><h3>the design AI never sees secrets</h3><p>Claude reads documentation text to design your tools. Credentials take a separate path that no prompt touches.</p></div>
      <div class="sec-item"><h3>scoped exactly like the key you paste</h3><p>Your MCP can only do what the API credential you supply allows. Scope the key, and the server is scoped.</p></div>
      <div class="sec-item"><h3>no deletes by default</h3><p>DELETE endpoints are dropped at generation and refused by api_call unless you flip the switch per project.</p></div>
    </div>
  </div>
</section>

<!-- pricing -->
<section class="wrap" id="pricing">
  <div class="reveal">
    <span class="eyebrow">pricing</span>
    <h2>start free, pay when it earns its keep</h2>
  </div>
  <div class="price-grid">
    <div class="price reveal">
      <h3>free</h3>
      <div class="amt">$0</div>
      <p class="mut">kick the tires</p>
      <ul><li>1 MCP project</li><li>${PLANS.free.generations_per_month} generations a month</li><li>${PLANS.free.tool_calls_per_month} tool calls a month</li><li>hosted endpoint + OAuth</li></ul>
      <a class="btn ghost" href="/signup">start free</a>
    </div>
    <div class="price hot reveal">
      <h3>pro</h3>
      <div class="amt">$${PLANS.pro.price}<small>/mo</small></div>
      <p class="mut">for the builder</p>
      <ul><li>${PLANS.pro.projects} MCP projects</li><li>${PLANS.pro.generations_per_month} generations a month</li><li>${PLANS.pro.tool_calls_per_month.toLocaleString()} tool calls a month</li><li>export any server as your own Worker</li></ul>
      <a class="btn" href="/signup?plan=pro">start with pro</a>
    </div>
    <div class="price reveal">
      <h3>scale</h3>
      <div class="amt">$${PLANS.scale.price}<small>/mo</small></div>
      <p class="mut">for the operator</p>
      <ul><li>${PLANS.scale.projects} MCP projects</li><li>${PLANS.scale.generations_per_month} generations a month</li><li>${PLANS.scale.tool_calls_per_month.toLocaleString()} tool calls a month</li><li>priority support from a human</li></ul>
      <a class="btn ghost" href="/signup?plan=scale">start with scale</a>
    </div>
  </div>
</section>

<!-- faq -->
<section class="problem">
  <div class="wrap reveal">
    <span class="eyebrow" style="display:block;text-align:center">questions</span>
    <h2 style="text-align:center">the fine print, in plain words</h2>
    <div class="faq">
      <details><summary>what exactly is an MCP server?</summary><p>MCP (Model Context Protocol) is the open standard AIs use to call external tools. An MCP server wraps an API in tools an assistant like Claude or ChatGPT can discover and invoke. makeittalk writes and hosts that wrapper for you.</p></details>
      <details><summary>what do I need to bring?</summary><p>A link to the API's documentation and a credential for it (an API key, a token, or an OAuth client). That is the whole shopping list.</p></details>
      <details><summary>what if there is no OpenAPI spec?</summary><p>The engine reads the human documentation instead: it crawls the reference pages, extracts endpoints with their parameters, and records the page each tool was learned from so you can audit it.</p></details>
      <details><summary>can my AI break things with this?</summary><p>It can only do what your credential allows, deletes are off by default, and every tool shows the exact HTTP call it makes. You can also just generate read-heavy toolsets by saying so in the project goal.</p></details>
      <details><summary>can I take my server and leave?</summary><p>Yes. Pro and scale plans export any project as a single-file Cloudflare Worker with zero dependencies. Deploy it in your own account and makeittalk is out of the loop.</p></details>
      <details><summary>is my API credential safe here?</summary><p>Credentials are encrypted at rest with AES-256-GCM, decrypted only when a tool call executes, never included in any AI prompt, and never displayed again after you save them.</p></details>
    </div>
  </div>
</section>

<!-- final band -->
<section class="band">
  <h2>give your API a voice</h2>
  <p>the software you already run, speaking fluent AI by this afternoon.</p>
  <a class="btn" href="/signup">start free</a>
</section>
</main>
${siteFooter()}

<script>
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // scroll reveals
  const revealEls = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.14 });
    revealEls.forEach((el) => io.observe(el));
  }

  // hero terminal: the real generation loop, scripted
  const demo = document.getElementById('demo');
  if (!demo) return;
  const LINES = [
    { t: 'cmd', text: '$ makeittalk new https://docs.stripe.com' },
    { t: 'dim', text: 'reading docs.stripe.com... found the API reference' },
    { t: 'plain', text: 'auth: bearer (secret key) · base: https://api.stripe.com' },
    { t: 'plain', text: 'mapped 214 endpoints across 6 pages' },
    { t: 'dim', text: 'designing the toolset with claude...' },
    { t: 'chips', chips: ['list_customers', 'create_payment_link', 'search_charges', 'list_invoices', 'create_refund', 'get_balance'] },
    { t: 'ok', text: '18 tools ready · live at makeittalk.dev/mcp/stripe' },
    { t: 'dim', text: 'connect it to claude and say: "list my newest customers"' },
  ];
  const render = (upTo, partial, showCaret) => {
    let out = '';
    for (let i = 0; i < upTo; i++) {
      const l = LINES[i];
      if (l.t === 'chips') out += '<div>' + l.chips.map((c) => '<span class="chip">+ ' + c + '</span>').join('') + '</div>';
      else out += '<div class="' + (l.t === 'cmd' ? '' : l.t === 'plain' ? '' : l.t) + '">' + l.text + '</div>';
    }
    if (partial !== null) out += '<div>' + partial + (showCaret ? '<span class="caret"></span>' : '') + '</div>';
    else if (showCaret) out += '<div><span class="caret"></span></div>';
    demo.innerHTML = out;
  };
  if (reduced) { render(LINES.length, null, false); return; }
  let line = 0;
  const step = () => {
    if (line >= LINES.length) {
      setTimeout(() => { line = 0; step(); }, 7000);
      return;
    }
    const l = LINES[line];
    if (l.t === 'cmd') {
      let chars = 0;
      const type = () => {
        chars += 1 + Math.floor(Math.random() * 2);
        if (chars >= l.text.length) { line++; render(line, null, true); setTimeout(step, 500); return; }
        render(line, l.text.slice(0, chars), true);
        setTimeout(type, 26);
      };
      type();
    } else {
      line++;
      render(line, null, line < LINES.length);
      setTimeout(step, l.t === 'chips' ? 900 : l.t === 'dim' ? 780 : 560);
    }
  };
  step();
})();
</script>`;

  return page({
    title: 'makeittalk. paste a link, get an MCP',
    description: 'AI that reads any API\'s docs and builds a working, hosted MCP server your assistant can call. Paste a link, add credentials, connect Claude.',
    body,
    origin,
    path: '/',
  });
}
