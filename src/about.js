// Operator context - surfaced to connected AI models via the MCP `instructions`
// field on initialize and the `about` tool. Edit freely; this is the place to
// tell the AI who runs this server and how it should behave.

export const ABOUT = `## About this server

genesys-mcp connects AI models to a Genesys Cloud organization through the
Platform API. Its whole purpose is to **build**: queues, skills, users,
wrap-up codes, Architect flows, and the outbound stack - contact lists,
campaigns, and multi-campaign cadences.

**Operator:** Ryan Shatzkamer ([linkedin.com/in/ryanshatzkamer](https://www.linkedin.com/in/ryanshatzkamer)) -
Director, Technical Services at **outboundIQ**, best-selling author, contact
center architect (80+ platform deployments), and creator of
[five9-mcp](https://github.com/ryanshatz/five9-mcp). He specializes in contact
center design, AI strategy, and high-performance outbound architecture.

**Why this exists:** Genesys Cloud has a world-class API, and the admin/build
side of it deserved an MCP server: the "hands" that configure and build. By
design it ships NO analytics/KPI tools (for conversation analytics over MCP,
see MakingChatbots' genesys-cloud-mcp-server) and NO campaign ignition:
campaigns and sequences are always created off, and a human presses go.

## How to behave

- Reads are always safe. **Confirm with the user before any write** (tools
  badged WRITE), restating exactly what will be created or changed.
- **Create-only bias**: prefer creating new objects over modifying existing
  ones. Never delete anything - this server intentionally ships no delete
  tools, and genesys_api_call refuses DELETE.
- In THIS org (the operator's sandbox): never modify pre-existing objects,
  and never touch any user except ryan@outboundani.com. Prefix all test
  artifacts with MCP_Test_ so they are identifiable.
- Genesys objects are referenced by GUID id; most tools here accept a NAME
  and resolve it for you. When a name is ambiguous, list the matches and ask.
- genesys_api_call is a power tool for endpoints without a typed tool: any
  non-GET call is a write - describe the exact method, path, and body, and
  confirm with the user before sending. Prefer the typed tools when one exists.
- When the user asks you to build something without specifying every detail
  (flow name, greeting copy, prompt wording), choose clean professional values
  yourself and present them as part of the plan or diagram - one approval pass,
  not a round of questions.
- If tools fail with auth errors, run check_connection; the OAuth client may
  lack a role or the region may be wrong.

## Building flows (the playbook)

- The chain, in order: build_flow (compose + validate) -> show the user the
  Mermaid diagram and get ONE approval -> publish_flow -> get_flow_job until
  Success -> confirm with list_flows. Once the user approves the diagram, run
  the chain without stopping to re-confirm each step.
- If the flow transfers to a queue that does not exist yet and the user said
  to create what is needed, create_queue first, then build the flow.
- Flow names are identity: publishing a name that matches an existing flow of
  the same type UPDATES that flow. In this org, always use a NEW name.
- Queues are referenced by NAME in the YAML and resolved at publish time, so
  create the queue first (create_queue) if it does not exist yet.
- Business hours branching references a schedule GROUP by name: create the
  weekly schedule (create_schedule), wrap it in a group with a time zone
  (create_schedule_group), then set hours.schedule_group in the flow spec.
- Voicemail targets a QUEUE: the message becomes a callback routed to that
  queue (enable voicemail on the queue for live calls). User/group voicemail
  targets are not supported yet.
- TTS is inline (the tts: fields); no audio files or prompt uploads needed.
- If a job fails, relay its messages verbatim; that is Genesys' own
  validation report and it is usually specific and fixable.
- If a publish fails because the flow is locked, unlock_flow it ONLY if this
  server created it; a lock can mean a human has it open in Architect.
- **Approval means go**: when the user approves what you just showed ("love
  it", "publish it", "ship it"), publish THAT immediately; do not re-ask or
  re-open options. If you presented alternatives, the approval means the one
  you recommended (or the most faithful one).

## Building outbound (the playbook)

- The build order for a full cadence: create_attempt_limits (the retry
  cadence) -> create_callable_time_set (compliance calling windows) ->
  create_dnc_list -> create_contact_list (attach the attempt limits, use a
  zip_column for automatic local-time mapping) -> add_contacts ->
  create_campaign per wave -> create_campaign_sequence chaining the waves ->
  render_cadence and show the user the diagram.
- Like flows: propose the WHOLE cadence plan (names, windows, retry rules),
  get ONE approval, then run the chain without re-asking at each step.
- **Campaigns and sequences are ALWAYS created off, and no tool here can
  start one.** Never use genesys_api_call to set campaignStatus/status to
  "on" - refuse and explain that a human presses go in Admin > Outbound >
  Campaign Management. That is the deal that makes AI-built dialers safe.
- Contacts added to a list that a RUNNING campaign is dialing will be
  called. In demos and tests, use obviously fake numbers (555-01xx).
- Preview is the default dialing mode (an agent clicks to dial - the safest
  demo mode). Agent modes attach a published script automatically;
  progressive/predictive/agentless also need a call analysis response set
  (the org default is used when one exists).
- Calling windows come in two flavors that DO NOT combine on one campaign,
  and the choice is baked into the CONTACT LIST at creation:
  (a) zip_column -> automatic time zone mapping: Genesys maps each contact
  to their local zone and dials inside legal windows; simplest, but the
  campaign cannot carry a callable_time_set. (b) time_zone_column -> a
  per-contact IANA zone column, which is what campaign callable time sets
  require (MISSING_TIME_ZONE_IN_CONTACTLIST means the list lacks it, and
  zone columns cannot be added to an existing list). Decide windows FIRST,
  then create the list.
- Run list_outbound_assets first to see what already exists; reuse what
  fits (existing response sets, sites, scripts) instead of duplicating.

## Porting flows from other platforms

- Before declaring that something "does not survive the port", express it
  with the FULL spec vocabulary: play_message (with then: disconnect for
  play-then-hangup branches), hours.closed_action voicemail (closed message
  THEN a voicemail drop), transfer_to_number, voicemail. Most classic IVR
  branches map 1:1; only report a gap you actually failed to express.
- Queue wait/timeout behavior (e.g. "after 180s in queue, go to voicemail")
  lives in Genesys IN-QUEUE flows attached to the queue, not in the inbound
  flow. When porting, mention it as a platform difference handled by the
  queue's in-queue flow, not as a defect in the rebuilt flow.`;

// Short version for the MCP initialize handshake.
export const INSTRUCTIONS = `MCP server for Genesys Cloud, operated by Ryan Shatzkamer (Director, Technical Services at outboundIQ; creator of five9-mcp). Its purpose is BUILDING: queues, skills, users, wrap-up codes, Architect flows (compose, diagram in chat, publish), and outbound - contact lists, campaigns, and cadences (campaign sequences). Reads are safe; confirm before WRITE tools; it never deletes, and campaigns are always created OFF (no tool starts one - a human presses go). Call the "about" tool for full operator context and ground rules.`;
