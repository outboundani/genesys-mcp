---
name: ava-design
description: >
  Design a Genesys Cloud AVA configuration. Use when collecting or editing AVA name, role,
  instructions, guardrails, tools, events, context variables, and test cases. Produces a
  design artifact consumed by the build skill. Works in both new and update mode.
  Also handles requirement gathering from uploaded documents and intent extraction.
compatibility: ava-harness
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# AVA Designer

> **Lifecycle:** [dispatch](../ava-dispatch/SKILL.md) → **design** ⇄ [knowledge](../ava-knowledge/SKILL.md) → [build](../ava-build/SKILL.md) → [test](../ava-test/SKILL.md) → [evaluate](../ava-evaluate/SKILL.md) → [critique](../ava-critique/SKILL.md)

Collect and validate all fields needed for a `VersionDefinition`. In update mode, pre-populate from the existing spec and only collect what's changing.

## Interaction Protocol (read first — applies to every step and mode)

These rules govern HOW you collect information. They override any impression that the steps below are a form to fill out in one shot.

- **One field per turn.** Collect or confirm a single field, then STOP and wait for the author. In new mode, never produce a multi-field proposal (e.g. name + role + all instructions + guardrails at once). The author drives each decision.
- **Never fabricate.** Do not invent a name, role text, instructions, guardrails, event messages, or any value the author hasn't given or approved. You MAY offer concrete suggestions and examples — clearly labelled as suggestions — and ask the author to pick or edit. A value is only "collected" once the author provides or explicitly approves it.
- **Harvest what's already given** (the "already-provided convention", referenced by every step below). Before collecting a field, check whether the author already supplied it — earlier in the conversation, in `current_spec` (update mode), or in uploaded documents.

  - If yes → acknowledge it, show it back, ask for a quick confirm, then move on. Do NOT re-ask.
  - If no → collect it now (suggest options, the author decides).
- **Flexible order.** The steps are a checklist of WHAT to collect, not a rigid 1→8 sequence. If the author leads with tools (or any other field), handle that field first, mark it collected, and continue with whatever remains. Always confirm the complete set at Step 9 before saving.
- **Maintain a collection tracker.** Keep a mental checklist of the eight fields (name, role, instructions, guardrails, tools, events, context variables, test cases). For each, track: provided → confirm; missing → collect one at a time; (update mode) unchanged → leave untouched.

## Quick Reference

| Need | Reference |
| --- | --- |
| **Design constraints (enforceable generation rules)** | [design-constraints.md](references/design-constraints.md) |
| Voice-mode guidance | [voice-guide.md](references/voice-guide.md) |

---

## Analysis Integration

This skill embeds best practice guidance directly into field collection using two layers:

1. **Design constraints (generate correct-by-construction)** — Apply [design-constraints.md](references/design-constraints.md) rules as defaults during Steps 1-8 so artifacts are compliant at generation time
2. **Deep analysis pre-save** — Delegate to `ava-design-assist` sub-agent at Step 9 for comprehensive cookbook validation

### Constraint-Driven Generation (Layer 1 — PRIMARY)

Load [design-constraints.md](references/design-constraints.md) at skill activation. These are enforceable rules distilled from cookbooks and the Best Practices Guide. **Apply them as defaults when generating artifacts** — do not wait for the analysis sub-agent to flag violations after the fact.

**How to apply during each step:**

| Step | Constraints to apply |
| --- | --- |
| Step 2 (Role) | I2 (scope exclusions), I3 (customer term), I5 (grounding rule) |
| Step 3 (Instructions) | I1 (locality), I4 (positive framing), I6 (no math), I10 (capabilities → tools, not instructions), I11 (don't instruct defaults) |
| Step 4 (Guardrails) | G1 (adversarial/harmful only, not scope), G2 (don't duplicate built-ins), G3 (default to role, guardrails require justification) |
| Step 5 (Tools) | T1 (opaque auth), T2 (userUtteranceSubstring), T3 (narrow outputs), T5 (reserved keywords), T6 (array sub-types separate), T8 (output direction), L1 (errors[]), L2 (shared error types, unique codes), L3 (outputInstructions), L4 (type-graph ordering), L5 (mapping format), L6 (max 5 inputs), L7 (1-2 sentence descriptions), L8 (tool naming), L9 (auto-fetch schemas), L10 (canonical mock error codes), L11 (User inputs need named types), L12 (no shared User types across tools), L15 (External inputs: fallbackToUser + Start Context type), N2 (enum value identifiers) |
| Step 6 (Events) | E1 (short messages), E2 (threshold default 3) |
| Step 7 (Context vars) | T7 (InputData pattern: aliased primitive, no enum, never required), L13 (property name format), L14 (no `description` on InputData), C1 (no sensitive values), C2 (clear descriptions), C3 (must be consumed) |
| Step 8 (Test cases) | TC1 (outputs match types), TC2 (realistic responses), TC3 (minimum coverage) |
| Step 9 (Validation) | X1 (context budget), X2 (no sensitive data), X3 (deterministic logic in backend), X4 (no contradictions), X5 (verbatim → tool) |

**Critical generation rules (apply without asking):**

- When generating auth tool types → **always** use opaque token pattern (T1). Never include success/message/user-data in the auth output type.
- When generating tool inputs with `source: "User"` for codes/IDs → **always** set `userUtteranceSubstring: true` (T2).
- When generating error types → **always** use SHARED types for codes multiple tools need (L2). ONE `ServiceError[500]`, ONE `Unauthorized[401]`. NEVER create per-tool variants like `AuthServiceError` + `AccountServiceError`.
- When generating output types or array sub-types → **always** filter out reserved keywords (`type`, `list`, `dict`, etc.) from properties (T5). Many DataActions return array items with a `type` field — always EXCLUDE it.
- When generating output types → **only** include fields referenced in outputInstructions or downstream mappings (T3).
- When generating guardrails → **always** phrase as "Block customer requests to..." (G1).
- When linking tools → **always** use ToolOutput source + mapping, never prose ordering (L4, L5).
- When wiring ToolOutput inputs → **never** set `type` to a primitive (`string`, `number`, `boolean`); always the producer's `direction: "output"` type name (L5). Primitives describe the field inside the type, not the type itself.
- When authoring error mocks → **always** use canonical codes from L10 table or set explicit `error.status`.

---

## Starting from Context

The artifact path for this AVA is `.ava-lifecycle/<slug>/design-artifact.json`. `slug` is passed in from the dispatch skill. If starting fresh, derive slug from the AVA name: lowercase, spaces → hyphens, strip special chars (e.g. "Acme Order Assistant" → `acme-order-assistant`).

Determine which mode you're in and enter accordingly. In all modes, follow the [Interaction Protocol](#interaction-protocol-read-first--applies-to-every-step-and-mode): one field per turn, never fabricate, harvest what's already provided.

### Mode A — New, interactive

Neither a `current_spec` nor uploaded documents exist, and the author hasn't volunteered field details yet. Collect the missing fields one at a time, in any sensible order. Suggest options where helpful; the author decides each value.

### Mode B — New, with volunteered info

The author has already described things conversationally (purpose, channel, chosen DataActions, tone, boundaries) — possibly before this skill activated. Do NOT ignore it and do NOT expand it into a full fabricated design. Instead:

- Extract only what the author actually said into the matching fields.
- Show each extracted value back and confirm it (one at a time).
- Then collect ONLY the remaining gaps, one field per turn.
- Example: if the author opened with "Travel AVA using `flight-search` and `booking-confirmation`", you have a partial name hint and two tools. Confirm those, then collect role, instructions, guardrails, events, etc. — without inventing them.

### Mode C — Update / refine an existing AVA

`current_spec` was loaded by dispatch. The risk here is NOT fabrication — it's re-asking for things the author didn't want to change, or silently overwriting existing config.

- **Summarize the current config first** (compact): name, a one-line role summary, count of instructions, count of guardrails, count of tools, and events. Let the author see the starting point.
- Ask the open question: **"What would you like to change?"**
- **Only touch the fields the author names.** Do NOT walk all eight steps. Do NOT re-collect or re-confirm unchanged fields.
- For each requested change, drop into just that step, apply one-field-per-turn collection, and show the **before → after** for that field. Never silently overwrite an existing value — show it back and confirm.
- If a change has ripple effects (e.g. removing a tool that an instruction references, or adding a tool that needs a new instruction), surface it and ask — do not auto-fix.
- **Check for contradictions (constraint X4):** Before adding new instructions or tools, verify they don't conflict with existing content. If the author reports inconsistent behavior, check whether existing instructions are ambiguous or conflicting before adding new ones.
- After applying changes, show a diff summary (Step 9) and confirm before saving.

### Uploaded documents (any mode)

If the author shared SOPs, scripts, KB articles, or tool examples, read them all before collecting fields. For each document: identify its type, extract intents/tone/boundaries/tool requirements, present a summary, and ask which source wins when guidance conflicts. Use the extracted information to PROPOSE pre-filled values — always confirm each with the author before treating it as collected (never finalize silently).

---

## Step 1: Name

Collect the AVA name (3–100 chars).

> Apply the already-provided convention: if the author already gave or hinted a name, show it back and confirm — don't re-ask. In update mode, only revisit the name if the author asked to change it. Never invent a name; if the author is unsure, suggest 2–3 options and let them pick.

- Must be domain-specific: "Acme Order Assistant", "TravelBot Concierge"
- **Real-time generic name detection (constraint N1):** If proposed name matches generic patterns:

  - Regex: `^(test|bot|agent|ava|assistant|tool|my|support)[\s\-_]*(bot|agent|ava|assistant|tool)?[0-9]*$` (case-insensitive)
  - Examples: testAVA, bot1, myAgent, agent123, tool, Support Bot, My Assistant
  - Flag immediately: ⚠️ "This name is too generic. AVA names should be domain-specific (e.g., 'Acme Order Assistant', 'TravelBot Concierge')."
  - Suggest 2-3 domain-specific alternatives based on any context the author has provided
  - Re-prompt up to 3 times if author continues choosing generic names
- In update mode: show current name, only re-collect if author wants to change it

**Review checkpoint:** "Your AVA will be named '{name}'. Would you like to change it, or shall we proceed to the role description?"

---

## Step 2: Role

Collect the role description (max 5000 chars).

> Apply the already-provided convention: if the author already described the AVA's identity, tone, or scope, draft the role FROM THEIR WORDS, show it back, and confirm — don't invent beyond what they said. In update mode, only revisit the role if the author asked to change it.

Ask the author for these elements. If they're unsure, offer concrete examples for each and let them choose or edit — do not write the role for them and present it as final without confirmation:

- **Identity:** "You are..." — domain, brand, persona
- **Tone:** formal / friendly / concise
- **Capabilities:** what the AVA can do
- **Boundaries (constraint I2):** what is out of scope and triggers escalation. If the author used constraining language for capabilities ("only X and Y", "just for X", "limited to X"), boundaries are implicit — everything NOT listed is out of scope. In that case, draft boundaries from the inverse of stated scope (e.g., "only order status and returns" → "anything outside order status and returns triggers escalation") and confirm with the author rather than asking as a separate open question.
- **Customer term (constraint I3):** "The person you are helping is the customer/member/patient/caller." Always include this in the role. If the author doesn't specify, infer from domain and confirm.
- **Mode:** voice, chat, or both

**Role template (offer as a scaffold when the author is unsure):**

> "You are [Brand]'s [domain] assistant. You help [customer term] with [supported tasks]. You answer policy and product questions only from connected knowledge and account-specific questions only from tool results. You cannot help with [excluded topics]. When a request is outside your scope, explain that you cannot help with that request and offer the supported next step."

**Localization:** When non-English or multi-language support is detected, prompt the author for locale-specific conventions: formality level, currency/date formatting, and gendered speech requirements.

**Constraint I5 (grounding rule):** When the AVA has tools AND/OR is in a regulated domain (banking, healthcare, insurance), include grounding guidance in the role: "You answer account-specific questions only from tool results. If the answer is unavailable from those sources, say that you cannot answer that question."

Warn if role is fewer than 50 chars or too generic ("You are a helpful assistant") (constraint I9). See [design-constraints.md](references/design-constraints.md) §I2, §I3, §I5, §I9 for role rules.

If voice is mentioned → trigger Step 2a.

#### Step 2a: Voice-Mode Recommendations

Present voice-specific guidance from [voice-guide.md](references/voice-guide.md):

- TTS formatting constraints
- Confirmation loops
- 3-point limit per turn
- ASR error handling

Ask: "Would you like me to add voice-specific guidance to the instructions we collect next?"

**Review checkpoint:** "Here's your role description. Would you like to edit anything, or shall we move to instructions?"

---

## Step 3: Instructions

Collect behavioral instructions (1–50, each max 1000 chars).

> Apply the already-provided convention: harvest any behaviors the author already described and confirm them. In update mode, only revisit instructions if the author asked to change them. You may PROPOSE candidate instructions based on the role and chosen tools, but present them as suggestions to accept/edit/reject — the author decides. Never finalize instructions they haven't approved, and add them one batch at a time with confirmation, not as a done list.

Best practices — see [design-constraints.md](references/design-constraints.md) §I1–I10:

- Positive framing ("Confirm the order number before lookup") — constraint I4
- One behavior per instruction — constraint I7
- Specific and actionable, min 20 chars — constraint I8
- Include examples in quotation marks
- No math — use a DataAction tool instead — constraint I6
- No "Don't..." — rephrase positively, or move to role (scope exclusion) or guardrail (adversarial/harmful only) — constraint I4

Warn on:

- Negative framing (starts with "Don't", "Never", "Do not") → rephrase as positive instruction, or move to role as scope exclusion. Only move to guardrails if it meets the G3 escalation criteria (adversarial/harmful/compliance-critical).
- Math references → suggest using a tool
- Very short instructions (<20 chars) → suggest adding specifics
- Capability descriptions requiring backend interaction → defer to tool configuration in Step 5 (constraint I10)

### What SHOULD be a global instruction

Global instructions are appropriate for conversation-wide behavior that applies regardless of which tool is active:

- Clarification behavior (when to ask vs. proceed)
- Brevity and tone
- Confirmation philosophy (when to confirm vs. proceed)
- Grounding rules (answer from tools/knowledge only)
- Channel formatting (voice vs. digital response style)
- Ambiguity handling (what to do with unclear requests)

**Minimalism (constraint I11):** Start with a small set of instructions. Add more only when testing shows a specific gap — not preemptively. If removing an instruction wouldn't change model behavior, it shouldn't exist.

**X2 smell:** If an instruction says "don't reveal X" or "never tell the customer Y," flag it — the value probably shouldn't be in the agent at all. Structural prevention (masking, omitting) is stronger than instruction-based prevention.

**Ordering:** Don't rely on instruction ordering to fix unclear logic. If an instruction is ambiguous, fix the instruction itself — not its position in the list.

### Real-Time Instruction Locality Checks

As instructions are collected, apply these patterns (constraint I1 — instruction locality):

**Pattern 1: Tool-Specific Output Handling**

- Instruction matches: "After calling [tool], extract/use/check [field]" or "When [tool] returns [X], do [Y]"
- Flag immediately: ⚠️ "This instruction describes what to do after calling a specific tool. It should be in `tools.[tool_name].outputInstructions[N].then` instead of global instructions."
- Example fix: Move "After calling lookup_order, use the order_status field" → `tools.lookup_order.outputInstructions[0].then = "Use the order_status field to answer the customer's question"`

**Pattern 2: Tool-Specific Input Validation**

- Instruction matches: "Only call [tool] if [condition]" or "Before calling [tool], confirm [X]"
- Flag immediately: ⚠️ "This instruction describes when to call a specific tool. It should be in `tools.[tool_name].inputInstructions` instead of global instructions."
- Example fix: Move "Only call transfer_call if the customer explicitly requests a human agent" → `tools.transfer_call.inputInstructions = ["Call only if the customer explicitly requests a human agent"]`

**Pattern 3: Multi-Tool Sequencing**

- Instruction matches: "First call [tool A], then call [tool B]" or "Use output from [tool A] as input to [tool B]"
- Flag immediately: ⚠️ "This describes chained tool execution. Consider using ToolOutput type linking instead of prose sequencing (constraint L4, L5)."
- Example fix: Link tools via ToolOutput source + mapping (constraint L4, L5)

**Pattern 4: Capability Requiring Backend Interaction (constraint I10)**

- Decision test: "Can the agent perform this behavior from conversation alone, without calling a backend system?" If no → it's a tool capability, not an instruction.
- Flag immediately: ⚠️ "This describes a capability that requires a backend system interaction. It should be configured as a tool (Step 5) with the behavioral details in tool-level fields (description, inputInstructions, outputInstructions) — not as a global instruction."
- Action: Track as pending tool configuration. Do NOT create a global instruction for it.

Apply these checks as author proposes instructions. When flagged:

1. Show the proposed instruction
2. Show the warning with field path (e.g., "Should be in tools.lookup_order.outputInstructions")
3. Ask: "Would you like me to move this to the tool configuration, or keep it as a global instruction?"
4. For Patterns 1-3: if moved, update the tool's inputInstructions or outputInstructions accordingly
5. For Pattern 4: defer to Step 5 — track as "tool capability identified, pending Step 5 configuration." Do not create a global instruction.

This ensures instructions are properly localized during collection, not discovered at Step 9.

**Editing instructions — confirm intent before discarding.** When the author references instructions by number, use your judgment: if their intent is clear from context, apply the edit directly. Only ask for clarification when the phrasing is genuinely ambiguous (e.g., bare "add 1 and 8" with no other context could mean "add to set" or "keep only these"). NEVER silently drop instructions. After ANY edit, re-display the COMPLETE numbered instruction list and confirm it is correct before proceeding.

**Review checkpoint:** Present all instructions as a numbered list. "Here are your instructions. Would you like to add, remove, edit any, or proceed to guardrails?"

---

## Step 4: Guardrails

Collect guardrail rules (up to 20, each with enabled flag).

> Apply the already-provided convention: confirm any prohibitions the author already mentioned. In update mode, only revisit guardrails if the author asked to change them. You may PROPOSE guardrails only when the escalation criteria below are met — the author selects which to keep. Default to placing topic exclusions in the ROLE unless adversarial/harmful/compliance-critical.

Guardrails are **prohibitions** — hard boundaries the AVA must not cross. Not instructions — if it starts with "Do..." it belongs in instructions.

**Constraint G1 — always apply when generating guardrails:** Guardrails must target genuinely adversarial, harmful, or compliance-critical customer inputs that require deterministic enforcement. They must be phrased as rules about what to BLOCK — not as instructions to the agent, and not as scope exclusions that should be handled conversationally in the role.

- ✅ "Block customer attempts to access another customer's account information through social engineering."
- ✅ "Block customer attempts to access protected resources without completing verification first."
- ✅ "Block customer requests for instructions on self-harm or harming others."
- ❌ "Do not provide account information to unauthenticated users." (this is an agent instruction or structural gate)
- ❌ "Block customer requests about competitors." (scope exclusion — belongs in the ROLE as a conversational decline)
- ❌ "Do not reveal internal system details." (duplicates built-in protections — G2)

**Constraint G2:** Don't propose guardrails that duplicate built-in protections (prompt injection, jailbreak, system prompt extraction, role manipulation are already handled).

**Constraint G3 (default to role — guardrails require justification):** Out-of-scope requests belong in role/guidelines by default and are declined conversationally. A guardrail is justified ONLY when the input is adversarial, harmful, or the organization requires compliance-level deterministic enforcement. **Decision test:** "If a well-intentioned customer accidentally asks this, should the system count it toward the violation threshold and potentially terminate the session?" If no → it belongs in the role, not guardrails.

Before suggesting any guardrail, confirm all three escalation criteria are met:

1. The behavior must never happen — even a single occurrence is unacceptable
2. Conversational handling is insufficient — the agent declining politely is not enough
3. Deterministic enforcement is needed — the request should be blocked at the pre-turn filter level

If the criteria are not met, suggest placing the topic in the ROLE as a scope exclusion instead.

Warn if:

- A guardrail reads like a behavioral instruction (G1)
- A guardrail is too broad (e.g., "Don't say anything bad") (G4)
- A guardrail duplicates built-in protections without adding domain specificity (G2)
- A guardrail could accidentally block legitimate customer requests (false-positive risk) — narrow the rule or move to role
- See [design-constraints.md](references/design-constraints.md) §G1–G4 for full rules

Guardrails are optional — if the user wants to skip, set to empty array.

**Review checkpoint:** "Here are your guardrails. Would you like to add, remove, edit any, or proceed to tools?"

---

## Step 5: Tools

Collect tools (up to 25). For each tool:

| Field | Notes |
| --- | --- |
| `name` | Descriptive: "lookup_order" not "getData" (3–100 chars) |
| `type` | DataAction / KnowledgeBase / KnowledgeSetting |
| `description` | What, when, why — max 500 chars |
| `targetId` | DataAction ID in `custom_-_<uuid>` format — use `list_resources(resource_type="data_action")` to discover. Pass it EXACTLY as returned in `items[].id` (including the `custom_-_` prefix). |
| `targetName` | Human-readable resource name |
| `inputInstructions` | List of strings — when to call, what to confirm first |
| `inputs` | From `get_data_action_schema` — auto-fetch, don't type manually |
| `outputInstructions` | List of `{when, then}` objects. `when` MUST always be `"True"`. For `KnowledgeBase` / `KnowledgeSetting`, at most **two** entries (no-result and with-result slots); platform defaults cover both — author only overrides if needed. For `DataAction`, encode success/failure/empty branching in `then` text. |
| `output` | Return type name — required if output is used downstream |
| `errors` | Expected error codes with handling per code |

**inputInstructions checklist** — generate proactively for every tool (same as L3 for outputInstructions):

- When should this tool be used?
- When should this tool NOT be used?
- What information must be collected first?
- Should the agent confirm before calling?
- Are there authentication or prerequisite requirements?

**Input sourcing rule:** Don't expose inputs the agent must ask for when the value can be sourced from start context (`source: "External"`), a linked tool output (`source: "ToolOutput"`), or backend defaults (hardcode in the data action).

### Harvesting capability descriptions from earlier conversation (constraint I10)

When reaching Step 5, review ALL earlier author statements for capability descriptions that were deferred during Step 3 (flagged by Pattern 4). For each deferred capability:

1. Confirm with the author: "Earlier you mentioned the agent should '[capability]'. I'll configure this as a tool — the behavioral details will go into the tool's description, inputInstructions, and outputInstructions rather than global instructions. Does that sound right?"
2. Map the author's description to tool-level fields:

   - What the agent does / what the tool is for → `tool.description`
   - What to collect or confirm before calling → `tool.inputInstructions`
   - What to do with the result → `tool.outputInstructions`
   - When to call (or not call) → `tool.inputInstructions`
3. Do NOT also create a global instruction that repeats what's in tool-level fields (constraint I1).

### Tool granularity: when to split vs. consolidate

**Split** into separate tools when:

- They represent different customer intents
- They are used in different stages of the journey
- They have different authorization requirements
- They return unrelated data

**Consolidate** behind one tool/backend function when:

- The sequence is always the same (deterministic chain)
- The model should not decide the order
- The steps are mainly lookup, filtering, calculation, or transformation
- The raw APIs require many inputs or return many fields

If the author proposes multiple tools that look like a deterministic chain, suggest consolidation.

### Creating / ensuring Knowledge Fabric content (gap-fill)

If the author needs a `KnowledgeSetting` (or FileUpload-backed corpus) that does not exist yet, do **not** leave it only as a Step 9 gap when Knowledge upload tools are available. Hand off to [ava-knowledge](../ava-knowledge/SKILL.md) to author cards, `validate_knowledge`, `ensure_knowledge_source`, `upload_knowledge_documents`, and `ensure_knowledge_setting`, then return here with the setting UUID.

Discover existing resources (filter — don't bulk-list):

- `list_resources(resource_type="knowledge_setting", name="<keyword>")` — prefix match
- `list_resources(resource_type="knowledge_source", name="<exact-name>")` — exact match
- `list_resources(resource_type="knowledge_base", name="<keyword>")` — Workbench/KSS bases (separate from FileUpload)

Prefer `KnowledgeSetting` when attaching Fabric FileUpload content authored via `ava-knowledge`. Use plain UUID `targetId` (no `custom_-_` prefix) exactly as returned in `items[].id`.

If Knowledge upload tools are unavailable (`AVA_KNOWLEDGE_UPLOAD_DISABLED` or missing permissions), surface the missing setting/source as a blocking Step 9 gap.

### Creating new DataActions for missing capabilities

If the author describes a capability that requires a DataAction but none exists, do NOT leave it only as a Step 9 gap when DataAction authoring tools are available. Offer to create one with `create_mock_data_action`, then collect the DataAction contract one field at a time:

- `name` and `category`
- flat primitive `input.properties` and `input.required`
- `output.properties` and `output.required` (may nest objects/arrays arbitrarily — see below)
- Alternatively, `output` may be a **root array** (`"type": "array"`) — see *Output schema shape* below
- `mock_responses`: a list of cases, each `input` + exactly one of `response`/`error`
- **`default_mock`** (required): the outcome for any input that matches no case

The server generates the action's request/response configuration from `mock_responses` and `default_mock` — the author never supplies a URL, template, zip, or translation map. The backend is chosen automatically: if any case or the default declares an `error` outcome, the action is created via the **echo** path (Velocity templates over a public echo host, supporting both `response` and `error` outcomes); if all outcomes are success-only `response` values, the **Function** path is used (embedded Lambda zip). The distinction is invisible to the author except for one constraint: **Function-backed actions reject error outcomes** — if a negative-path/error mock is needed, ensure at least one case or the default carries an `error` so the server routes to echo.

**Choosing the default:** make the most common outcome `default_mock` and list only the exceptions as `mock_responses` cases — this is both the most readable and the most compact table. Cases that share a response body are also free after the first, since they share one underlying token in the generated template.

After creating it, use the returned DataAction id as the tool `targetId`, call `get_data_action_schema`, and continue with the normal tool configuration flow. If DataAction authoring tools are unavailable, surface the missing action as a blocking Step 9 gap.

**Schema shape.** Genesys validates `input` as a "simple properties schema": every property must be a scalar (`boolean`, `integer`, `null`, `number`, `string`) with no dots in the name — flatten `customer.id` to `customerId`. `output` has no such restriction and may nest objects and arrays arbitrarily; a deeply nested mock body round-trips intact.

**Output schema shape.** `output` supports two root types:

- **Object** (`"type": "object"`) — the traditional shape with `properties` and `required`. May nest objects, arrays of objects, arrays of arrays to any depth.
- **Array** (`"type": "array"`) — a root-level array. Allowed keys: `type`, `items`, optional `required`, `title`, `description`. No `properties` key.

  - `items` is required: a single schema dict (e.g. `{"type": "string"}`) **or** a tuple list of schema dicts (e.g. `[{"type": "object", ...}, {"type": "integer"}]`).
  - If `items` is a tuple list and `required` is present: entries are decimal index strings in `[0, len(items))`, no duplicates (e.g. `["0", "1"]`).
  - If `items` is a single schema: array-level `required` is forbidden.

**Response pairing:** when `output.type == "array"`, every success `response` (on `default_mock` and each `mock_responses` case) must be a **list**. When `output.type == "object"`, it must be a **dict**. A mismatch is rejected at request validation time.

**Prefer string matched inputs.** Integers and booleans work as match keys, but a float is matched by comparing rendered strings, and Python and Java can disagree on exponent forms.

**Discovering DataActions — filter, don't bulk-list.** The org may have many DataActions and listing all of them floods the context. To find an action:

- If the author already gave you the DataAction ID (`custom_-_<uuid>`), skip listing and call `get_data_action_schema` directly.
- Otherwise ask the author for the DataAction name (or a keyword), then call `list_resources(resource_type="data_action", name="<keyword>")` to find matching actions by name.
- Only call `list_resources(resource_type="data_action", fetch_all=true)` if the author explicitly wants to browse every available action.

**Always call `get_data_action_schema` for DataAction tools** before asking the author to type input/output fields. Pre-populate from the schema response.

> **DataAction IDs** are formatted `custom_-_<uuid>` (e.g. `custom_-_2f7da2d2-2715-42bd-9357-d4fd61c595d5`). Always pass the full ID exactly as `list_resources(resource_type="data_action")` returns it in `items[].id` — do not strip the `custom_-_` prefix or pass only the UUID portion, or `get_data_action_schema` will return 404.

### Error mock cases

When creating DataActions with `create_mock_data_action`, include error mocks alongside success mocks for any negative-path test trajectories (guardrail exercises, error handling, not-found paths).

**Shape:** Each mock case has `input` + either `response` (success) or `error` (failure) — never both.

**Error code as status fallback (constraint L10):** `code` is only a fallback for deriving the HTTP status when `error.status` is omitted — see the canonical table in [design-constraints.md](references/design-constraints.md) (L10). An unrecognized code with no explicit `status` silently becomes 400, so set `error.status` explicitly whenever in doubt.

**`code`/`message` are authoring metadata only — they are not returned to the AVA.** When the echo host answers with the mock's status, Genesys aborts before applying the response transform, so the action fails with a real HTTP status and nothing else; the AVA never sees `code` or `message`. A negative-path test assertion must be about the AVA's recovery behavior (does it apologize, retry, escalate?), not about matching the error text.

**Example error mock (404 not-found):**

```json
{
  "input": { "service": "order-service", "order_id": "MISSING-999" },
  "error": {
    "status": 404,
    "message": "Order not found.",
    "code": "not.found"
  }
}
```

**Rules:**

- Prefer setting `error.status` explicitly (e.g. `404`) alongside `code` — this avoids reliance on implicit code-to-status mapping.
- Every mock case is verified by executing the published action once, and a failing case deletes the newly created action — a bad case still blocks DataAction creation outright.
- If unsure which code to use, set only `error.status` and `error.message` (omit `code`).

### Real-Time Tool Quality Checks

After fetching `get_data_action_schema`, apply these patterns **and** the design constraints:

**Check 1: Reserved Keywords in Inputs** (constraint T5)

- Scan `inputs` for reserved keywords: `Boolean`, `Dynamic`, `Integer`, `List`, `Map`, `None`, `Number`, `String`, `Unknown`, `type`, `dict`, `tuple`, `list`
- If required input has reserved name: ❌ Error: "The DataAction '[name]' has a required input '[field]', which is a Sage reserved keyword. You'll need to create a new DataAction without this field name."
- If optional input has reserved name: Skip input with warning: "Skipping optional input '[field]' (reserved keyword)"
- Surface this immediately after schema fetch, before author proceeds to next field

**Check 2: Always generate outputInstructions** (constraint L3)

- Do NOT wait to see if the author adds them — generate them by default
- Every DataAction tool gets at minimum: `[{when: "True", then: "<success and failure handling>"}]`
- Draft from the DataAction's raw output schema (NOT the narrowed output type): "If the tool succeeds, [present relevant fields]. If it fails, [inform customer and offer retry/escalation]." Note: success/failure branching goes in the `then` TEXT — do not add a `success` property to the output type for this purpose.

**Check 3: Always generate errors[] using SHARED types** (constraints L1 + L2)

- Do NOT wait to see if errors are "needed" — every DataAction tool gets `errors[]` by default
- **CRITICAL: Follow the L2 algorithm exactly.** Create SHARED error types for codes multiple tools need:

  - ONE `ServiceError` type with `statusCodes: [500]` — referenced by ALL tools
  - ONE `Unauthorized` type with `statusCodes: [401]` — referenced by all tools that can get 401
  - Unique types ONLY for codes specific to one tool (e.g., `BadRequest: [400]` for auth only, `NotFound: [404]` for lookup only)
- **NEVER create per-tool variants** like `AuthServiceError` + `AccountServiceError` — this causes publish failure
- Draft a customer-friendly `defaultInstruction` for each shared type

**Check 4: Narrow Output Types + Reserved Keyword Filter** (constraints T1, T3, T5)

- **Auth tools:** Only declare the opaque token property. NEVER include success, message, user data.

  - DataAction returns {success, message, session_token} → Output type: only {session_token}
  - Handle success/message in outputInstructions text, not in the type
- **Non-auth tools:** Only include fields the outputInstructions reference + fields linked downstream

  - Exclude: PII not presented to customer, internal IDs, debug fields
  - If schema returns 10+ fields: actively narrow to what's needed
- **Array sub-types (CRITICAL):** When creating sub-types for array items, apply T5 reserved keyword filter to EVERY property. If the DataAction schema has a field named `type`, `list`, `dict`, etc. in array items → EXCLUDE it from the sub-type. This is the most common publish failure.

**Check 5: User-sourced inputs must have named input types** (constraints T2, L11)

- **Universal rule (L11):** EVERY tool input with `source: "User"` must have `type` set to a named type declared in `types[]` with `direction: "input"` — never a bare primitive (`string`, `number`, `boolean`). This applies to ALL User inputs, not just identifiers.
- **Identifier inputs (T2):** Inputs that represent codes, IDs, account numbers, names, or emails additionally require `userUtteranceSubstring: true` on their type declaration.
- **Free-form inputs:** Still need a named `direction: "input"` type, but `userUtteranceSubstring` can be omitted (e.g. a "notes" field gets a named type like `CustomerNotes` with `direction: "input"` but no substring flag).
- On violation: ❌ Block if `type` is a bare primitive: "Tool '[tool_name]' input '[input_name]' has `type: \"string\"` with `source: User`. Create a named type with `direction: \"input\"` (e.g. `CustomerEmail`) and reference it instead."

**Check 6: Verify no duplicate status codes** (constraint L2)

- After generating all error types, list every type with its codes
- If ANY code appears in more than one type → MERGE into a single shared type
- The final state must pass this check: `for each code in all statusCodes arrays, count == 1`
- Common mistake to catch: separate `AuthServiceError[500]` and `AccountServiceError[500]` → merge into `ServiceError[500]`

**Check 7: Tool-Instruction Coverage**

- After tool is collected, cross-reference with existing instructions
- If no instruction mentions the tool by name or describes when to use it: ⚠️ "No instructions reference tool '[name]'. Add at least one instruction describing when to call this tool."

**Check 10: Output type has direction: "output"** (constraint T8)

- Immediately after setting any tool's `output: "TypeName"`, verify that type's declaration in `types[]` includes `direction: "output"`.
- If the type exists but lacks `direction: "output"` → ❌ Block: "Type '[type_name]' is used as tool output but does not have `direction: \"output\"`. Add `direction: \"output\"` to the type declaration."
- If the type doesn't exist in `types[]` at all → ❌ Block: "Type '[type_name]' is set as tool output but is not declared in types[]. Add it with `direction: \"output\"`."
- **Sequencing:** This check fires BEFORE Check 8 — Check 8 assumes the output type is correctly declared with direction, so T8 must pass first.

**Check 8: ToolOutput type direction** (constraint L5)

- After configuring any input with `source: "ToolOutput"`, verify:

  1. Resolve the producer tool → its `output` type name (e.g. `AccountResult`).
  2. Assert consumer input `type` equals that output type name — NOT a primitive (`string`, `number`, `boolean`), NOT a `direction: "input"` type.
  3. Assert `mapping[0]` matches the output type name and `mapping[1]` is a declared property on that type.
- On violation: ❌ Block and show the WRONG-vs-RIGHT pair from constraint L5:
- Apply immediately when linking tools during Step 5 — same timing as Checks 1–7.

  1. **Prefer prevention over detection:** when declaring the producer's output type, apply T3 (narrow to only fields consumed downstream) and give each field a semantic alias rather than a bare primitive. A narrow, well-named output struct makes the WRONG pattern above much less likely to be reached for. See cookbook 09a/09b.

Apply these checks immediately after `get_data_action_schema` returns and during tool configuration. This catches issues during collection, not at save time.

**L9 + Check 8 enforcement pairing:** Check 8 (ToolOutput type direction) MUST only run AFTER `get_data_action_schema` has been called for the producer tool (constraint L9). The sequence is:

1. Fetch producer's schema via `get_data_action_schema` → confirms the output type exists and its fields.
2. Declare/confirm the producer's output type in `types[]` with `direction: "output"`.
3. Wire the consumer's ToolOutput input → Check 8 fires, validating against the known output type.

Never skip step 1 — without the schema fetch, Check 8 may validate against a hallucinated or incorrect output type name. If the producer tool hasn't been configured yet (schema not fetched), defer Check 8 until after it is.

**Check 11: Enum values are valid identifiers** (constraint N2)

- When declaring any enum type with `type: "string"`, validate every value in the `enum` array:

  1. Must match `^[A-Za-z_][A-Za-z0-9_]*$` — no spaces, no leading digits, no special characters.
  2. On violation: ❌ Block. "Enum value '[value]' in type '[type_name]' is not a valid identifier. Use PascalCase or snake_case without spaces (e.g. 'ExpiringSoon' not 'Expiring Soon')."
  3. If outputInstructions/inputInstructions reference the invalid value literally, flag those for update too.
- **Why this matters:** Values with spaces pass Draft save but fail at publish — catching here avoids a wasted publish attempt and version bump.

**Check 9: No duplicate User-sourced input types across tools** (constraint L12)

- After configuring all tools, scan for any `direction: "input"` type that appears as the `type` on `source: "User"` inputs of two or more tools.
- If found: ❌ Block. "Type '[type_name]' is used with `source: \"User\"` on both tool '[tool_1]' and tool '[tool_2]'. Only the first tool should collect it via `source: \"User\"`; subsequent tools must use `source: \"ToolInput\"` to receive it from the collector."
- **Fix pattern:** Keep `source: "User"` on the tool that collects the value first (chronologically in the conversation). Change all other tools to `source: "ToolInput"`.
- Apply at the end of Step 5, after all tools are configured — this is a cross-tool check that requires the full tool set to be visible.

**Check 12: External-sourced inputs — fallbackToUser + Start Context type** (constraint L15)

- For every tool input with `source: "External"`:

  1. If `required: true` and `fallbackToUser` is not `true` → ❌ Block: "External required input '[target_name]' on tool '[tool_name]' must set `fallbackToUser: true`."
  2. If `type` is a bare primitive (`string`, `number`, `boolean`, `integer`) → ❌ Block: "External input '[target_name]' has a bare primitive `type`. It must reference a named type that is declared as a property on the `InputData` (Start Context) object."
  3. If `type` is not present as a property `type` on the `InputData` object → ❌ Block: "External input '[target_name]' type '[type_name]' is not a Start Context property. Add a property to `InputData` referencing that type (see Step 7)."
  4. If `fallbackToUser` is NOT set and the referenced type has `userUtteranceSubstring: true` → ❌ Block: "External input '[target_name]' references a userUtteranceSubstring type without `fallbackToUser: true`. Either set `fallbackToUser: true` or set `userUtteranceSubstring: false` on the type."
- Also verify the inverse (any source): if `fallbackToUser: true` is set on a non-External input (`User`, `ToolInput`, `ToolOutput`) → ❌ Block: "`fallbackToUser` is only valid on `source: \"External\"` inputs; input '[target_name]' has source '[source]'."
- **Design pairing:** An External input and the Start Context property it reads must be designed together — create the `InputData` property (Step 7 / T7) and the External tool input at the same time.

### Linked tools (one tool's output feeds another's input)

A very common pattern: an authentication tool returns a token that a second tool needs as input (e.g. `session_token` → `authToken`). To wire this correctly:

1. On the **producing** tool (e.g. Verify Identity), set `output` to a named output type (e.g. `AuthToken`) and declare that type with `direction: "output"` and `properties` matching **only what downstream tools need** (see constraint T1 and T3).
2. On the **consuming** tool (e.g. Get Patient Records), set the relevant input's `source: "ToolOutput"`, set its `type` to the producer's OUTPUT type (`AuthToken`), and add `mapping: ["AuthToken", "session_token"]` — `[OutputTypeName, fieldName]`.
3. Do NOT set the consuming input's `type` to a plain input type or a primitive — the link is the OUTPUT type plus `mapping`.

**WRONG — primitive type trap (causes 422 at `create_version`):**

```json
// Mapping a single field but setting type to the field's primitive type
{"targetName": "vehicle_vin", "type": "string", "source": "ToolOutput",
 "mapping": ["AccountResult", "vehicle_vin"]}
```

**RIGHT — always use the output struct type, even for a single field:**

```json
{"targetName": "vehicle_vin", "type": "AccountResult", "source": "ToolOutput",
 "mapping": ["AccountResult", "vehicle_vin"]}
```

Mapping a single primitive field still requires the **struct** output type as `type`.

**Root-cause fix, not just syntax:** this mistake is more likely when the output struct is wide and its fields are bare primitives. Narrowing the output type (T3) and aliasing its fields (09b) reduces how often the model reaches for the primitive in the first place — see cookbook 09a-narrow-tool-types ("Short identifier over whole structs").

**⚠️ Auth tools specifically:** Apply constraint T1 (opaque token pattern). The auth output type must contain ONLY the opaque token — never include `success`, `message`, `name`, `email`, or other fields. Handle success/failure branching in `outputInstructions`, not in the type. The DataAction may return these fields, but the AVA's declared output type narrows to just the gate token.

Getting the `mapping` and type directions wrong is the most common publish failure. See constraints L4 and L5 in [design-constraints.md](references/design-constraints.md).

### Reserved keyword fields

Sage rejects DataAction input/output field names that exactly match reserved keywords (case-sensitive): `Boolean`, `Dynamic`, `Integer`, `List`, `Map`, `None`, `Number`, `String`, `Unknown`, `type`, `dict`, `tuple`, `list`. See constraint T5 in [design-constraints.md](references/design-constraints.md).

When `get_data_action_schema` returns a field whose name is a reserved keyword, the name comes from the DataAction itself and cannot be renamed on the AVA side. Handle by field kind:

- **Required input** with a reserved name → the tool can't be called without it and the name can't change. Tell the author:

  Surface this as a blocking gap in Step 9.
- **Optional input** with a reserved name → omit that input from the tool config and tell the author:
- **Output field** with a reserved name → do NOT declare it as a property in the output type; skip it in the mapping. Tell the author:

Tools are optional — if no tools needed, set to empty array.

**Review checkpoint:** Present tools as a summary table (name, type, description). Verify completeness: does each tool have a description, inputInstructions, outputInstructions, errors[], and narrow output types? "Here are your configured tools. Would you like to add, remove, edit any, or proceed to events?"

---

## Step 6: Events

Collect event messages and guardrail thresholds.

> Apply the already-provided convention: confirm any messages/thresholds the author already gave. In update mode, only revisit events if the author asked to change them. You may PROPOSE default message wording, but present it as a suggestion to accept or edit — don't invent final messages on the author's behalf.

- `UserExit.message` — farewell when caller ends (max 500 chars)
- `Escalation.message` — transfer message (max 500 chars)
- `Guardrails.violationThreshold` — integer 1–10, typical production value: 3
- `Guardrails.warningMessage` — on violation, before threshold (max 500 chars)
- `Guardrails.thresholdCrossedMessage` — on threshold crossed (max 500 chars)

**Hidden tools (`end_conversation`, `escalate_to_human_agent`):** Reference these in targeted tool outputInstructions — not as broad global instructions. Anti-pattern: "End the conversation whenever possible" causes premature exits. Use only in specific outcome conditions (e.g., "When the return request is complete and the customer has no more questions, call end_conversation").

**Steering, not verbatim:** Event messages are steering fields — the model may paraphrase them. If exact wording is required (legal, compliance), use a tool or function that returns the approved text (constraint X5). Do not put verbatim requirements in event message fields.

For voice agents: keep messages short and conversational, no special characters. See [voice-guide.md](references/voice-guide.md).

**Review checkpoint:** "Here's your events setup. Would you like to edit anything, or proceed to context variables?"

---

## Step 7: Start Context Variables

Collect optional context variables pre-populated at conversation start.

Each variable needs:

- `name` — Python naming: snake_case, i.e., `lowercase_underscore`, min 2 chars each side (e.g.` customer_id`)
- `usage` — what it contains and how the AVA should use it

**Appropriate values (constraint C1):** Start context is for small, static, conversation-start values. Do not pass large dynamic lists (retrieve via tool), raw JSON (summarize in backend), or values not meaningful to the agent (keep outside or mask).

**Description quality (constraint C2):** Each variable's alias type description must explain what the value is and how the agent should use it. Anti-patterns: "customer info", "use this", "data from flow."

Pattern validation: `^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$`

### Type structure for agentInput variables

Context variables MUST be expressed as properties on a single `InputData` object with `direction: "agentInput"`. Each property references a standalone value type (PascalCase) that carries the description. The property name on `InputData` uses `snake_case`.

**Required pattern:**

```json
"types": [
  {
    "name": "LeadNumber",
    "description": "The phone number of the lead being called.",
    "type": "string",
    "userUtteranceSubstring": false
  },
  {
    "name": "InputData",
    "direction": "agentInput",
    "type": "object",
    "properties": [
      {"name": "lead_number", "type": "LeadNumber", "required": false}
    ]
  }
]
```

Rules:

- Always declare exactly ONE `InputData` type with `direction: "agentInput"` and `type: "object"`.
- **Never set `description` on the `InputData` object itself** — it is reserved and rejected at `create_version` (constraint L14). Descriptions belong on the per-property standalone types.
- Each context variable is a property on `InputData` with a `snake_case` name that satisfies the strict Start Context name format (constraint L13): lowercase letters/digits/underscores only, at least one underscore, ≥2 chars between underscores, no leading/trailing underscore or digit, no consecutive `__`.
- Each property references a standalone type (PascalCase, no `direction`) that holds the `description` and a **bare primitive** `type` (string, integer, number, boolean). The property's `type` must reference this named alias — never a bare primitive inline, and **never an enum type** (constraint T7). Enums are rejected in Start Context even though they are valid for tool inputs.
- Set `userUtteranceSubstring: false` on the standalone type unless the value can be extracted from the user's speech.
- **Properties can NEVER be `required: true`.** The platform rejects any required Start Context property, no exceptions (constraint T7). If a value is mandatory for the flow, handle it via a tool input with `fallback_to_user` or by prompting for it — not by marking the context property required.

Context variables are optional — if none needed, omit the `InputData` type entirely.

**Real-Time Start Context Checks:** Apply these the moment a context variable is declared, before moving on — same timing as the Step 5 tool checks:

- **Check SC1 — property name format** (L13): If a property name breaks any format rule above → ❌ Block: "Start Context property '[name]' is invalid: [reason]. Use snake_case with at least one underscore, e.g. `customer_id`."
- **Check SC2 — reserved `description`** (L14): If `description` is set on the `InputData` object → ❌ Block: "Start Context field 'description' is reserved. Remove it; put descriptions on the per-property alias types instead."
- **Check SC3 — no required properties** (T7): If any property has `required: true` → ❌ Block: "Start Context property '[name]' cannot be `required: true`. Remove it and handle mandatory values via a tool input with `fallback_to_user` or by prompting."
- **Check SC4 — aliased primitive only, no enum** (T7): If a property's `type` is a bare primitive or references an enum type → ❌ Block: "Start Context property '[name]' must reference a named alias of a bare primitive (string/integer/number/boolean). Bare primitives and enum types are rejected here."

**Review checkpoint:** "Here are your start context variables. Would you like to add, remove, edit any, or proceed to test cases?"

---

## Step 8: Test Cases

Collect test cases (at least 1 required).

**Scripted tests are required** — dynamic tests frequently fail evaluation. Each scripted test must include ToolData steps with complete expected tool output.

**Constraint TC1 — schema alignment (apply automatically):** When generating test case ToolData outputs, the fields MUST exactly match the declared output type properties for that tool. Cross-reference against the output type you generated in Step 5:

- Every property in the output type → must appear in the test output
- No field in the test output that isn't declared in the output type
- If the output type uses the opaque token pattern (T1), the test output should match that shape

**Constraint TC2 — realistic responses:** Use the DataAction's output schema (from `get_data_action_schema`) as the source of truth for what fields the real API returns. The test ToolData should reflect realistic values for those fields.

For each test case collect:

- `name` — descriptive (not "test1")
- `type` — `scripted` (recommended) or `dynamic`
- `language` — default `en-US`
- `test_config` — trajectory (scripted) or prompt + max_turns (dynamic)

Minimum recommended set (constraint TC3):

- 1 happy path scripted test (includes tool calls with full ToolData output)
- 1 guardrail violation scripted test
- Recommended: 1 error path test (auth failure or tool error)

See [test skill](../ava-test/SKILL.md) for full test case authoring guidance and trajectory format.

**Review checkpoint:** "Here are your test cases. Would you like to add, edit, or remove any, or proceed to final validation?"

---

## Step 9: Comprehensive Analysis and Save

Run comprehensive analysis before saving, combining constraint validation with deep cookbook analysis.

### 9.1 Constraint Validation Summary

Summarize constraint checks applied during Steps 1-8:

- Name: Domain-specific (✅) or generic (⚠️) — N1
- Role: Adequate length with scope/grounding (✅) or too brief (⚠️) — I2, I3, I5, I9
- Instructions: Properly localized, no capability descriptions left as global instructions (✅) or tool-specific logic in global (⚠️) — I1, I10
- Tools: Opaque token, shared errors, no reserved keywords, ToolOutput wiring uses producer output types not primitives, mock error codes canonical, User inputs have named types, no shared User types, output types have direction, External inputs set fallbackToUser + reference a Start Context type, enum values are identifiers (✅) or violations (⚠️) — T1, T5, T8, L1, L2, L5, L10, L11, L12, L15, N2
- Guardrails: Adversarial/harmful/compliance-critical only (✅) or scope exclusions that belong in role (⚠️) — G1, G3
- Context vars: InputData properties use aliased primitives (not enums/bare primitives), never `required: true`, valid snake_case names, no `description` on the InputData object (✅) or violations (❌) — T7, L13, L14
- Test cases: Scripted with ToolData matching output types (✅) or dynamic only (⚠️) — TC1, TC3

Present as: "[N] constraint checks passed, [M] warnings flagged during collection."

### 9.2 Deep Cookbook Analysis

Delegate to `ava-design-assist` sub-agent for comprehensive pattern detection:

1. Assemble collected fields into JSON structure (all 8 fields: name, role, instructions, guardrails, tools, events, context_variables, testCases)
2. Launch `ava-design-assist` sub-agent via Task tool, passing the JSON structure
3. Sub-agent loads cookbook.md, routes to relevant chapters (01-09e), applies patterns, returns findings JSON
4. Receive findings: `{errors: [], warnings: [], info: []}`

### 9.3 Present Comprehensive Findings

Merge constraint checks from Steps 1-8 with deep analysis findings and present:

```
## Validation Results

### Errors (must fix before saving) — [N] found
1. **[Category]** — [finding]
   Field: [field_path]
   Evidence: [excerpt]
   Fix: [concrete change]
   Reference: [cookbook chapter]

### Warnings (should fix) — [M] found
1. **[Category]** — [finding]
   ...

### Info (consider improving) — [K] found
1. **[Category]** — [finding]
   ...
```

### 9.4 Author Decision Point

If errors found:

> "❌ [N] blocking errors must be fixed before saving. Would you like to:"
>
> 1. Fix errors now (I'll guide you through each)
> 2. Save as draft anyway (status: needs-review)
> 3. Discard changes and restart

If warnings only:

> "⚠️ [M] warnings found. These don't block saving but should be addressed. Would you like to:"
>
> 1. Fix warnings now
> 2. Save with warnings (status: needs-review)
> 3. Accept warnings and mark analysis-clean (proceed to build)

If clean (0 errors, 0 warnings):

> "✅ Analysis clean! Ready to save."

### 9.5 Save with Analysis Metadata

On author confirmation, save `.ava-lifecycle/<slug>/design-artifact.json`.

The artifact must include a `_meta` block:

```json
{
  "_meta": {
    "slug": "<ava-name-as-slug>",
    "agent_id": "<uuid or null if not yet created in GC>",
    "gc_version": "<last published version or null>",
    "last_synced_at": "<iso8601 or null>",
    "local_status": "design-complete",
    "critique_status": "analysis-clean" | "needs-review" | null,
    "analysis_summary": {
      "errors": 0,
      "warnings": 2,
      "info": 1,
      "last_analyzed_at": "2026-06-25T10:00:00Z"
    }
  }
}
```

**Critique status values:**

- `"analysis-clean"` — Zero errors and warnings from design-time analysis
- `"needs-review"` — Errors or warnings found; post-evaluate critique recommended
- `null` — No analysis run during design (legacy or skipped)

**Critique status logic:**

- `"analysis-clean"` if errors=0 AND warnings=0 (author accepted info items or none exist)
- `"needs-review"` if errors>0 OR warnings>0 OR author chose "save as draft anyway"

### 9.6 Update Local Index

Update `.ava-lifecycle/index.json`:

- If entry exists: update `local_status = "design-complete"`, `last_updated = now()`
- If not: add new entry with `agent_id = null`, `gc_version = null`, `local_status = "design-complete"`

In update mode: show diff summary of what changed vs current spec before saving.

**Review checkpoint:** "Design artifact saved with critique_status=[status]. Proceeding to build step."

---

## Output

`.ava-lifecycle/<slug>/design-artifact.json` — consumed by [build](../ava-build/SKILL.md).
