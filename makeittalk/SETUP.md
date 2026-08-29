# Taking makeittalk.dev live

## The fast path: one command

```bash
cd makeittalk
CLOUDFLARE_API_TOKEN=... ANTHROPIC_API_KEY=... STRIPE_SECRET_KEY=sk_live_... node golive.mjs
```

`golive.mjs` runs this entire document: creates the D1 database + migrations,
generates and sets the encryption key (it prints it once - save it), creates
the Stripe products, prices, webhook, and customer portal config via API,
patches wrangler.toml with every id, enables the makeittalk.dev routes, and
deploys. Re-running is safe; it skips what already exists. The Cloudflare
token needs Account → Workers Scripts:Edit + D1:Edit and Zone
(makeittalk.dev) → Workers Routes:Edit + DNS:Edit. Then sign up with
ryan@getdylr.com and you're the admin.

The manual steps below are the same work, spelled out - useful for
understanding or debugging, skippable otherwise.

---

Everything below happens once. Total time: ~30 minutes. Prerequisites: the
Cloudflare account that holds the makeittalk.dev domain, a Stripe account, an
Anthropic Console API key, and (optional) a Resend account for emails.

> Tip: this folder currently lives inside the genesys-mcp repo. Before launch,
> consider splitting it into its own `makeittalk` repo (`git filter-repo` or a
> plain copy) so open-source genesys-mcp and the commercial product don't share
> history going forward. Nothing below depends on where the folder lives.

## 1 · Database

```bash
cd makeittalk
npx wrangler d1 create makeittalk
# paste the printed database_id into wrangler.toml under [[d1_databases]]
npx wrangler d1 migrations apply makeittalk --remote
```

## 2 · Secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY      # console.anthropic.com → API keys
npx wrangler secret put ENCRYPTION_KEY         # openssl rand -hex 32
npx wrangler secret put STRIPE_SECRET_KEY      # dashboard.stripe.com → Developers → API keys (sk_live_...)
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # created in step 4, come back for this one
npx wrangler secret put RESEND_API_KEY         # optional; skip = signups auto-verify, no reset emails
```

The `ENCRYPTION_KEY` encrypts every stored customer credential. Save a copy in
your password manager: lose it and stored credentials are unrecoverable (users
would re-enter them).

## 3 · Stripe products

Dashboard → Product catalog → Add product (or via CLI):

```bash
stripe products create --name "makeittalk pro"
stripe prices create --product <prod_...> --unit-amount 2900 --currency usd -d "recurring[interval]=month"
stripe products create --name "makeittalk scale"
stripe prices create --product <prod_...> --unit-amount 9900 --currency usd -d "recurring[interval]=month"
```

Put the two `price_...` ids into `wrangler.toml` → `STRIPE_PRICE_PRO` /
`STRIPE_PRICE_SCALE`.

## 4 · Stripe webhook

Dashboard → Developers → Webhooks → Add endpoint:

- URL: `https://makeittalk.dev/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`

Copy the signing secret (`whsec_...`) into the `STRIPE_WEBHOOK_SECRET` secret
(step 2). Also enable the **customer portal** (Settings → Billing → Customer
portal) so the in-app "billing" button works.

## 5 · Deploy + domain

```bash
npx wrangler deploy
```

Then Cloudflare dashboard → Workers & Pages → makeittalk → Settings → Domains
& Routes → add custom domains `makeittalk.dev` and `www.makeittalk.dev` (or
uncomment the `routes` block in wrangler.toml and redeploy). DNS is already in
the account, so this is one click each.

## 6 · You

Sign up at makeittalk.dev with **ryan@getdylr.com** - that address is in
`ADMIN_EMAILS`, so the account arrives as role `admin`, plan `comp` (unlimited
tier, no Stripe). The **admin** button in the dashboard shows users, plans,
usage, MRR, and lets you comp anyone.

## 7 · Emails (optional but recommended)

Resend → add domain `makeittalk.dev` → add the DKIM/SPF records it gives you
(the domain is on Cloudflare, takes 2 minutes) → create an API key → set the
`RESEND_API_KEY` secret. From then on: signup verification + password reset
emails from `hello@makeittalk.dev`. Also add an email routing rule in
Cloudflare (Email → Email Routing) so inbound `hello@makeittalk.dev` forwards
to you.

## 8 · Smoke test

1. `https://makeittalk.dev/health` → `{"ok":true,"configured":true}`
2. Sign up with a throwaway, create a project pointed at a small public API
   docs page, watch the activity log run.
3. Add the API's key in Credentials, open Connect, add the endpoint to Claude
   as a custom connector, authorize with the MCP key, and say
   *"list the tools you have and try the safest read."*
4. Stripe test: switch `STRIPE_SECRET_KEY` to `sk_test_...` + test-mode prices
   and webhook first if you want to rehearse checkout before going live.

## Costs while running

- Cloudflare Workers Paid: $5/mo (D1 + the CPU allowances you'll want).
- Anthropic API: each generation is one docs-reading pipeline on
  `claude-opus-5` - typically $1-4 per generation depending on docs size.
  Free-tier abuse is capped by plan limits (3 generations/mo/user).
- Stripe: 2.9% + 30¢ per charge. Resend: free tier covers thousands of emails.
