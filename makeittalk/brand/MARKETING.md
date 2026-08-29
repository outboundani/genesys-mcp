# makeittalk launch kit

Ready-to-post copy. Everything below follows the brand voice (lowercase,
no em-dashes, no filler verbs) and is written to be pasted as-is.

---

## Elevator pitch (10 seconds)

makeittalk turns any API into an MCP server your AI can use. Paste a docs
link, add a credential, and a few minutes later Claude or ChatGPT is driving
your software. From the builder of genesys-mcp and five9-mcp.

## Elevator pitch (30 seconds)

Every platform you run has an API, and almost none of them speak MCP, the
protocol AIs use to call tools. Writing that wrapper by hand means reading
every docs page, mapping auth, shaping schemas, and hosting a server.
makeittalk does the whole build from a pasted link: an AI reads the docs,
maps the API, designs a curated toolset with receipts (every tool shows the
docs page it was learned from), and hosts it at a live endpoint with OAuth
built in. Credentials are encrypted, deletes are off by default, and you can
export the whole server as your own zero-dependency Cloudflare Worker.

---

## X/Twitter launch thread

**1/**
i built genesys-mcp and five9-mcp by hand: read the docs, map the API, design
tools an AI can actually wield.

then i productized the process itself.

makeittalk.dev: paste a link. get an MCP. 🗣️

**2/**
how it works:

paste any API docs URL
→ it hunts for an OpenAPI spec (the jackpot)
→ no spec? it reads the reference pages like a human
→ maps auth + endpoints
→ designs 8-25 tools with real schemas

every step streams into a live log.

**3/**
the part i care most about: receipts.

every generated tool shows the exact HTTP call it makes and the docs page it
was learned from. nothing is a black box. there's an api_call escape hatch
for the long tail, and DELETE is refused unless you flip a switch.

**4/**
your credentials never touch the AI that designs the tools. they're
encrypted at rest, decrypted only at call time, and the MCP can only do what
the key you pasted allows. scope the key, and the server is scoped.

**5/**
it's live at a real endpoint with OAuth 2.1, so it drops straight into
claude.ai as a custom connector, or Claude Code, or ChatGPT, or anything
that speaks MCP.

and if you ever want out: export the whole server as a single-file
cloudflare worker. zero dependencies. yours.

**6/**
free tier: 1 MCP, on the house.
pro $29/mo, scale $99/mo.

built by hand, zero npm packages, same as everything i ship.

makeittalk.dev 🌱

## LinkedIn post

I've spent the last year connecting AIs to contact center platforms. The
pattern was always the same: read the API docs end to end, map the auth,
design a toolset an assistant can actually use, host it. genesys-mcp and
five9-mcp came out of that process, and both are open source.

makeittalk.dev is that process, productized.

You paste a link to any API's documentation. An AI reads it the way I would:
finds the spec if one exists, crawls the reference pages if not, maps
authentication and endpoints, then designs a curated MCP toolset. Minutes
later you have a live endpoint with OAuth that plugs into Claude, ChatGPT,
or any MCP client.

The design choices are the ones I'd want as a buyer: every tool cites the
docs page it was learned from, credentials are encrypted and never shown to
the AI, deletes are off by default, and paid plans can export the entire
server as a standalone zero-dependency Cloudflare Worker and self-host it.

Free tier is live if you want to point it at something. I'd love to see what
you make talk.

## Product Hunt draft

**Tagline:** Paste a link, get an MCP server your AI can use

**Description:** makeittalk reads any API's documentation with AI, maps the
endpoints and auth, and generates a hosted MCP server with a curated
toolset. Every tool shows the docs page it was learned from. Credentials
are encrypted, deletes are off by default, OAuth is built in, and you can
export the whole server as a zero-dependency Cloudflare Worker. Free tier:
one MCP on the house.

**First comment:** Builder here. This is the productized version of how I
built genesys-mcp and five9-mcp (both open source): read the docs, design a
toolbox an AI can wield, host it as a tiny worker. Happy to answer anything
about the engine, the security model, or MCP in general.

## Cold DM / intro email (for CX platform people)

subject: your platform, but your customers' AI can use it

Hey {{name}}, quick one. Your API is solid but it doesn't speak MCP yet,
which means Claude and ChatGPT users can't drive {{platform}} directly. I
built makeittalk.dev: it reads your public docs and generates a hosted MCP
server in minutes. I already ran it against {{platform}}'s docs and it
mapped {{n}} endpoints cleanly. Want the link to try the generated server,
or 15 minutes to talk about an official one?

## One-liners for ads / social cards

- your AI can do everything, except call your software. fix that in minutes.
- the docs were always the interface. now they're the implementation.
- APIs can listen. makeittalk gives them a voice.
- read the docs once, never again.

## Launch checklist

- [ ] deploy per SETUP.md, smoke test with a real docs link
- [ ] og.png renders on x.com/linkedin card validators
- [ ] record a 45s screen capture: paste stripe docs → log runs → tools
      appear → claude lists customers (this is the whole ad)
- [ ] post the thread + linkedin on a tuesday morning
- [ ] product hunt the following week with the video
- [ ] pin a "built with makeittalk" server demo in the genesys-mcp readme
