# makeittalk.dev

**Paste a link. Get an MCP.** A self-serve SaaS that reads any API's documentation with Claude, designs a curated MCP toolset, and hosts it as a live streamable-HTTP MCP endpoint with OAuth 2.1 - the productized version of how [genesys-mcp](https://github.com/ryanshatz/genesys-mcp) and [five9-mcp](https://github.com/ryanshatz/five9-mcp) were built.

One Cloudflare Worker, zero npm dependencies. Marketing site, auth, Stripe billing, the generation engine, the dashboard, the admin panel, and every generated MCP endpoint all live in `src/`.

## How it works

```
docs URL ──▶ read ──▶ spec hunt ──▶ crawl ──▶ map ──▶ design ──▶ /mcp/<slug>
             │          │  (OpenAPI  (Claude    (auth,   (Claude       │
             │          │   jackpot)  picks the  base,    designs      ▼
             │          │             reference  endpoints) 8-25 tools) live MCP
             └── or pasted docs ──────────────────────────▶            + api_call
```

- **Engine** (`src/engine.js`): fetches the docs, hunts well-known OpenAPI paths, has Claude (`claude-opus-5`) triage links, distills an API map, then designs the toolset with names/schemas/request-templates/provenance. Every step streams into a live activity log.
- **Manifest** (`src/manifest.js`): the core artifact. Declarative tools (`{name, input_schema, request: {method, path, query, body}}`) validated and executed by one universal runtime. DELETE endpoints are dropped unless the owner opts in.
- **MCP runtime** (`src/mcpserve.js`): serves every project at `POST /mcp/<slug>` - stateless streamable HTTP, JSON-RPC (initialize / tools/list / tools/call / ping), plus an `api_call` escape hatch.
- **Per-project OAuth 2.1** (`src/mcpoauth.js`): stateless HMAC-blob client registration + PKCE, so claude.ai connectors work with zero storage. Raw `Bearer mit_...` keys also work.
- **Credentials** (`src/crypto.js`): AES-256-GCM at rest, decrypted only at call time, never included in any Claude prompt, never displayed after saving.
- **Billing** (`src/stripe.js`): Stripe Checkout + customer portal + signature-verified webhook over raw HTTPS. Plans in `src/plans.js` (free / pro $29 / scale $99 / comp).
- **Auth** (`src/auth.js`): PBKDF2-210k passwords, hashed DB sessions, origin-checked CSRF, login rate limiting, optional Resend email verification.
- **Export** (`src/exporter.js`): pro feature - any project downloads as a standalone zero-dependency Worker (own account, own secrets, no makeittalk in the path).

## Run it

```bash
cd makeittalk
npm test                 # 18 tests incl. a full signup→generate→MCP→webhook e2e
cp .dev.vars.example .dev.vars   # fill in keys
npx wrangler d1 create makeittalk # paste the id into wrangler.toml
npm run migrate:local
npm run dev
```

Deploying for real: see **[SETUP.md](./SETUP.md)** - D1, secrets, Stripe products + webhook, the makeittalk.dev custom domain, and admin bootstrap, in order.

Brand kit and launch copy live in [`brand/`](./brand).
