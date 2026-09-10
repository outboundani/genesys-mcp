# genesys-mcp

**Your Genesys Cloud org, in your AI's hands.** An open-source MCP server for Genesys Cloud on Cloudflare Workers. Zero dependencies, no terminal required, and its whole purpose is to **build**: queues, skills, users, wrap-up codes, Architect flows, the outbound stack - contact lists, campaigns, and multi-campaign cadences - and **agentic virtual agents (AVA)**, end to end, using Genesys' own AVA playbooks.

> It builds, not just reads.

Prompt Claude (or any MCP client):

- *"create a queue called Weekend Support"*
- *"build a call flow: greet callers, press 1 for Weekend Support, press 9 to end the call. show me the diagram first"*
- *"draw my Main IVR as a diagram"*
- *"onboard prep: create a spanish skill and assign it to Jess at proficiency 4"*
- *"set up a reactivation cadence: two preview campaigns against the Billing queue, weekday windows 9 to 7 eastern, 3 attempts max, retry no-answers after 4 hours, respect a DNC list. show me the diagram"*
- *"design an agentic virtual agent for order status, build it, chat with it, score it, and publish it as a bot flow"*

The flow builder composes real Archy YAML, shows you the flow as a Mermaid diagram in chat, then publishes through Genesys' own flow-jobs pipeline (the same one CX as Code uses), so Genesys validates and publishes server-side.

## What it deliberately does NOT do

- **No analytics or KPI tools.** That lane is already covered; for conversation analytics over MCP, check out [MakingChatbots' genesys-cloud-mcp-server](https://github.com/MakingChatbots/genesys-cloud-mcp-server).
- **No campaign ignition.** Campaigns and sequences are always created **off**, and no tool here can start one. The AI builds the machine; a human presses go.
- **No silent production agents.** AVA versions publish as **TestReady** (chat, test, evaluate). Publishing to production, which routes live traffic, needs `production: true` and your explicit yes.
- **No mocks.** Every data action an agent can call is a real integration in your org. There are no fake backends, sample responses, or demo stubs.
- **No deletes.** There are no delete tools, and the raw API tool refuses `DELETE`. Create-first by design.

## Deploy your own in 3 steps

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/outboundani/genesys-mcp)

1. **Deploy**: click the button (free Cloudflare account), or `git clone` + `npx wrangler deploy`. The CONFIG KV namespace is auto-provisioned.
2. **Create a Genesys OAuth client**: Admin → Integrations → OAuth → Add Client → grant type **Client Credentials** → assign a role (see [Scoping the role](#scoping-the-role)) → save.
3. **Configure**: open `/setup` on your new Worker and paste the Client ID, Secret, and your region. The wizard validates them live against Genesys before saving, then hands you your access key (shown once).

Prefer terminal-managed config? Set Wrangler secrets instead; they override the wizard: `GENESYS_CLIENT_ID`, `GENESYS_CLIENT_SECRET`, `GENESYS_REGION` (e.g. `usw2.pure.cloud`), `MCP_AUTH_TOKEN`.

## Connect your AI

The MCP endpoint is `https://<your-worker>/mcp`.

- **Claude (web/desktop)**: Settings → Connectors → Add custom connector → paste the URL. When the authorization screen appears, paste your access key.
- **Claude Code**: `claude mcp add --transport http genesys https://<your-worker>/mcp` and authenticate when prompted.
- **ChatGPT**: Settings → Connectors → Advanced → Developer mode → add the MCP server URL.
- **Anything else**: standard streamable HTTP MCP with OAuth 2.1 (or send the access key as a Bearer token).

Then try: *"check the connection and list my queues."*

## The toolbox (71 tools)

| Group | Tools |
|---|---|
| 🔌 Org & Connection | `about`, `check_connection`, `list_divisions`, `list_did_pools` |
| 📞 Queues & Routing | `list_queues`, `get_queue`, `create_queue` ✏️, `list_wrapup_codes`, `create_wrapup_code` ✏️ |
| 👥 Users & Skills | `list_users`, `get_user`, `list_skills`, `create_skill` ✏️, `assign_user_skill` ✏️ |
| 🕐 Schedules & Hours | `list_schedules`, `create_schedule` ✏️, `create_schedule_group` ✏️ |
| 📤 Outbound (Campaigns & Cadences) | `list_contact_lists`, `get_contact_list`, `create_contact_list` ✏️, `add_contacts` ✏️, `create_attempt_limits` ✏️, `create_callable_time_set` ✏️, `create_dnc_list` ✏️, `list_campaigns`, `get_campaign`, `create_campaign` ✏️, `create_campaign_sequence` ✏️, `list_outbound_assets`, `render_cadence` |
| 🌳 Flows (Architect) | `list_flows`, `get_flow`, `get_flow_configuration`, `list_prompts`, `render_flow`, `export_flow` |
| 🏗️ Flow Builder | `build_flow`, `publish_flow` ✏️, `get_flow_job`, `unlock_flow` ✏️ |
| 🧠 Agentic Virtual Agents (AVA) | `ava_playbook`, `list_avas`, `get_ava`, `create_ava` ✏️, `get_ava_version`, `create_ava_version` ✏️, `publish_ava_version` ✏️, `get_ava_publish_job`, `list_data_actions`, `get_data_action_schema`, `create_data_action` ✏️, `list_knowledge_assets`, `validate_knowledge`, `ensure_knowledge_source` ✏️, `upload_knowledge_documents` ✏️, `get_knowledge_sync`, `ensure_knowledge_setting` ✏️, `ava_chat_start` ✏️, `ava_chat_send` ✏️, `ava_chat_end`, `ava_run_scripted_scenario` ✏️, `ava_record_verdicts`, `ava_validate_trajectory`, `ava_estimate_eval`, `ava_scorecard`, `ava_critique_report`, `ava_workspace_put`, `ava_workspace_get`, `ava_workspace_list`, `build_ava_bot_flow` |
| ⚡ Power | `genesys_api_call` ✏️ (any Platform API endpoint; GET/POST/PUT/PATCH only) |

✏️ = writes to your Genesys org (or spends its tokens); the AVA workspace tools only save to the server's own storage. Everything resolves names to GUIDs for you, so "the Weekend Support queue" just works.

### How the cadence builder works

1. `create_attempt_limits` is the retry brain: max attempts per contact and per-outcome recalls ("no answer: try again in 4 hours, twice"). Attach it to a `create_contact_list` (give the list a zip column and it maps every contact to their local time zone automatically).
2. `create_callable_time_set` is the compliance window ("Mon-Fri, 9 to 7, Eastern"), and `create_dnc_list` is the internal suppression list. Both attach to campaigns. Windows need the list built for them: a `time_zone_column` for callable time sets, or a `zip_column` for Genesys' automatic local-time mapping (one or the other, decided at list creation).
3. `create_campaign` wires a contact list to a queue (preview, progressive, predictive, or agentless), inheriting the list's phone columns, defaulting to your org's published outbound script and default call analysis response set.
4. `create_campaign_sequence` chains campaigns into an ordered cadence, and `render_cadence` draws the whole machine as a Mermaid diagram in chat.

Everything lands **off**. You review it in Admin, then you press go.

### How the flow builder works

1. `build_flow` turns a spec into Archy YAML and a Mermaid diagram: a TTS greeting, an optional **business-hours gate** (open goes to the menu; closed and holiday play a message, then disconnect or take a voicemail), and a DTMF menu whose choices can **transfer to a queue, take a queue voicemail, dial an external number, or disconnect**. Your AI shows you the diagram first.
2. `publish_flow` registers an Architect flow job, uploads the YAML, and polls. Genesys validates and publishes server-side; validation errors come back verbatim.
3. `render_flow` also diagrams flows that already exist in your org, and `export_flow` round-trips any flow back to YAML.

TTS is inline in the flow (your org's TTS engine speaks it), so there are no audio files to record or upload.

### How the AVA lifecycle works

Genesys open-sourced the AVA workflow their own teams use, as skills for coding IDEs: [purecloudlabs/genesys-ava-skills](https://github.com/purecloudlabs/genesys-ava-skills) (MIT, Genesys Cloud Services, Inc.). genesys-mcp vendors those eight playbooks **verbatim** ([vendor/genesys-ava-skills](vendor/genesys-ava-skills)) and serves them through `ava_playbook`, so the same lifecycle runs from Claude Desktop, or any MCP client, with one URL and no local install:

1. **dispatch** establishes context and routes. **design** is an interview: one field at a time, nothing fabricated, with Genesys' design constraints and cookbook applied as you go. **knowledge** authors customer-facing cards for the agent's knowledge.
2. **build**: `create_ava` -> `create_ava_version` (accepts the design artifact as-is; normalizes it to the public API shape and runs the playbook's pre-flight checks, so payloads that would fail deterministically never leave the server) -> `publish_ava_version` as **TestReady**.
3. **test** authors turn-based scenarios (persona, goal, scripted and free turns, a reference tool-call trajectory, a rubric across goal / tool use / guardrails / tone). **evaluate** runs them against the live agent: `ava_run_scripted_scenario` plays fully scripted ones server-side, the chat tools drive free-form ones turn by turn, Layer 1 trajectory checks are pure code, your AI judges the rubric, and `ava_scorecard` computes the versioned scorecard (the rubric weights are Genesys', ported line for line).
4. **critique** reviews the definition against the quick guide and cookbook and renders a report.
5. **Knowledge**: `validate_knowledge` checks the cards against Genesys' Knowledge Fabric rules, then `ensure_knowledge_source` -> `upload_knowledge_documents` -> `ensure_knowledge_setting` gets them searchable and attached to the agent.
6. **Tools the agent calls** are real data actions in your org: `list_data_actions` and `get_data_action_schema` to design against them, `create_data_action` to add one on an existing integration.
7. **Deploying**: `build_ava_bot_flow` composes the Architect bot flow that runs the agent (the *Call Agentic Virtual Agent* action) and `publish_flow` publishes it. Architect only accepts a **ProductionReady** agent here, so this is where the production publish (and your explicit yes) happens.

**Bot flow or IVR, not chained.** Genesys only lets an inbound call flow invoke a bot flow when a paid, non-legacy text-to-speech engine is installed (the default "Genesys TTS" is rejected). Rather than make you buy one, this server keeps the two separate: the IVR builder builds IVRs, the AVA ships as its own bot flow that an admin attaches to channels in Architect, and you test the agent through chat sessions (`ava_chat_start`, `ava_chat_send`) and the evaluate stage.

Where the IDE version wrote to a local `.ava-lifecycle/` folder and spawned sub-agents, this server keeps the state in its KV workspace (`ava_workspace_put/get/list`, keyed by the AVA's slug) and each playbook opens with an adapter table that maps the file paths, tool names, and sub-agents onto these tools. Re-vendor a newer Genesys release with `npm run vendor:ava`.

Differences from the IDE harness: knowledge uploads are text formats only (Markdown, text, CSV, HTML; PDFs and Word files go through Admin > Knowledge), there are no mock data actions (real integrations only), and reports come back as Markdown in chat instead of HTML files.

## Security model

- Your Genesys credentials live in **your** Cloudflare account (Wrangler secrets or the auto-provisioned KV), and nowhere else.
- The AI can only do what the **OAuth client's role** allows. You scope it; Genesys enforces it.
- The MCP endpoint requires the access key (raw Bearer or the built-in OAuth 2.1 flow for connectors).
- No delete tools exist, and `genesys_api_call` refuses `DELETE` outright.

### Scoping the role

For everything here to work, the OAuth client's role needs: Routing (queues, skills, wrap-up codes) view + add, Directory user view + edit (for skill assignment), Architect flow view + add + edit + publish, Outbound (contact lists, campaigns, sequences, attempt limits, callable time sets, DNC lists) view + add, Scripter published-script view, and Telephony view. For AVAs add Agentic (virtual agent, version, version job, session, session turn) view + add + edit, Integrations action view (+ add + edit to create data actions), and Knowledge (knowledge base, setting, source) view; the org also needs the Genesys Cloud AI Experience entitlement for agentic virtual agents. Master Admin works for a sandbox; scope down for production. The server can only ever be as powerful as the role you assign.

## Local dev

```bash
git clone https://github.com/outboundani/genesys-mcp
cd genesys-mcp
cp .dev.vars.example .dev.vars   # or create it: GENESYS_CLIENT_ID / GENESYS_CLIENT_SECRET / GENESYS_REGION / MCP_AUTH_TOKEN
npm test                          # zero-dep unit tests (node --test)
npm run smoke                     # live read-tools smoke against your org
npm run smoke -- --writes         # also exercises create tools (MCP_Test_* artifacts)
npm run ava-e2e                   # live AVA lifecycle: create, version, publish, chat, scenario, knowledge, mocks, bot flow, IVR (MCP_Test_* artifacts)
npm run smoke:prod -- https://<your-worker>   # drive the DEPLOYED server over MCP (real KV): persisted evaluate chain
node scripts/cleanup-test-artifacts.mjs --delete   # sandbox hygiene: remove MCP_Test_* leftovers (maintainer script, not a server tool)
npm run vendor:ava                # re-vendor the latest Genesys AVA skills release
npm run dev                       # wrangler dev
```

## About

Built in the open by [Ryan Shatzkamer](https://www.linkedin.com/in/ryanshatzkamer) (Director, Technical Services at outboundIQ), creator of [five9-mcp](https://github.com/ryanshatz/five9-mcp), the same zero-dependency architecture pointed at a second platform. Issues and PRs welcome; the roadmap is the issue tracker.

The AVA playbooks are the work of Genesys Cloud Services, Inc., published as [purecloudlabs/genesys-ava-skills](https://github.com/purecloudlabs/genesys-ava-skills) under the MIT License and vendored here unchanged (see [vendor/genesys-ava-skills/NOTICE.md](vendor/genesys-ava-skills/NOTICE.md)). Thank you to the Genesys labs team for open-sourcing them.

MIT
