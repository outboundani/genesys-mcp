# Agentic Virtual Agent Quick Guide

Compressed reference for AVA configuration. Focuses on **what not to do** across the five core sections in AI Studio: **Agent**, **Tools**, **Knowledge**, **Configuration**, and **Guardrails**.

---

## Agent

The Agent section includes the agent name, **Role**, and **Guidelines**.

### Role

The Role is the agent's job description. Use short natural-language sentences.

A well-structured Role usually includes:

- Brand and identity.
- Domain and primary purpose.
- Supported capabilities at a high level.
- Important out-of-scope boundaries.
- The term the agent should use for the person it helps.
- Channel context, when important.

**Sample template:**

> You are [Brand]'s [domain] assistant. You help [customer term] with [supported tasks]. You answer policy and product questions only from connected knowledge and answer account-specific questions only from tool results. You cannot help with [excluded topics]. When a request is outside your scope, explain that you cannot help with that request and offer the supported next step.

**Do not:**

| Avoid | Why |
| --- | --- |
| You help customers with anything related to shopping. | Too broad; encourages over-helpfulness. |
| You are a banking assistant. | Missing scope, exclusions, and customer term. |
| Speak slowly and use a friendly voice. | Audio controls belong outside Role; shape text for TTS instead. |
| Mix user, customer, caller, and patient interchangeably. | Inconsistent terminology causes confusion. |
| A full procedural flow (authenticate, compare values, set flags, then ask…). | Deterministic flows belong in tools, functions, or Architect. |
| You are a helpful assistant. | Generic identity invites out-of-scope behavior. |
| Scope with inclusion only ("You help with order questions."). | Add explicit exclusions to remove gray areas. |

**Prefer positive instructions over negatives:**

| Avoid | Prefer |
| --- | --- |
| Do not hallucinate. | Use tool results for account-specific answers and connected knowledge for policy answers. If the answer is unavailable, say you cannot answer it. |
| Do not transfer too much. | Offer escalation when the customer asks for a human, when a required tool fails, or when the request is outside scope. |

### Guidelines

Guidelines are conversation-wide behavior instructions. They apply across the whole interaction.

**Use Guidelines for:**

- Clarification behavior.
- Brevity and tone.
- Global confirmation rules.
- Grounding rules for factual answers.
- Voice or digital response formatting.
- General channel behavior.
- How to handle ambiguous or unexpected customer input.

**Do not put in Guidelines:**

| Avoid | Better location |
| --- | --- |
| Detailed tool execution steps. | Tool pre-instructions, inputs, and outcome instructions. |
| Pseudo-code or step-by-step flow scripts. | Tools, data actions, functions, or Architect. |
| No-input timeout counts or retry logic. | Architect. |
| "Speak slower" or "change volume." | Not in AVA; shape text for TTS instead. |
| "Do not tell the customer the one-time passcode." | Do not expose the passcode to the agent at all. Validate in backend and return only `is_valid`. |
| Many turns of dialog as examples. | Tools, knowledge, or Architect. |
| Adding another instruction when behavior is inconsistent. | First check for ambiguous or conflicting existing instructions. |

**Voice-specific do nots:**

- Do not use markdown, bullets, numbered lists, headings, or asterisks in voice mode.
- Do not ask the agent to control audio directly (pauses, speed, volume).
- Do not apologize repeatedly for partial ASR input; confirm what was heard and ask for the rest.

---

## Tools

Tools are where most reliability is won or lost. Put instructions close to the behavior they control.

**Do not:**

| Avoid | Why / fix |
| --- | --- |
| Design tools around raw API endpoints (`get_order`, `get_payment`, `calculate_days…`). | Combine deterministic backend steps into one business-capability tool. |
| Vague names: `tool123`, `get_user_details`, `do_everything`, `check_user`. | Use specific, action-oriented names like `check_return_eligibility`. |
| Descriptions that say "gets customer information" or "returns everything." | One to two sentences: what it does, when to use it, what it returns. |
| Procedural descriptions ("First ask for X, then call API…"). | Move collection to pre-instructions; move sequencing to the data action. |
| More than about five inputs, many of them static defaults. | Hardcode static values in the data action or function. |
| Exposing `country_code`, `brand`, `channel`, `api_version` as agent inputs. | Hardcode in backend; agent only provides values that change per conversation. |
| Selecting all outputs because the API returns them. | Return only fields the agent needs to reason, speak, link, or pass to end context. |
| Raw API payloads, large arrays, nested objects, internal IDs, tokens. | Return compact objects with booleans and status fields. |
| Chaining many tools for logic the model should not reason through. | One backend function calculates eligibility and returns `is_eligible`, `reason_code`, etc. |
| "If Tool A returned success, remember that and call Tool B." | Link tool outputs to downstream inputs. |
| Outcome instructions that collect inputs or define when to call the tool. | Pre-instructions and input descriptions. |
| Outcome instructions that say "be polite" or "add these balances." | Role/Guidelines or data action/calculator tool. |
| Generic error names: `Error1`, `HTTP_400_500_etc`. | Use plain-language names: `OrderNotFound`, `PaymentDeclined`. |
| Passing access tokens, OTPs, or secrets through model input or start context. | Validate or inject in backend; return only safe status fields. |
| Treating HTTP 200 with no record as a tool failure. | Add a business-level `record_found` or `success` flag. |
| Asking the agent to do math, date arithmetic, or eligibility calculations. | Calculator tool, function, or data action returns the result. |

**Tool checklist before publish:**

- One business purpose per tool.
- Minimal inputs with clear descriptions and format examples.
- Compact outputs with success/found flags where needed.
- Linked downstream inputs tested.
- Every `source: "ToolOutput"` input: `type` must match a `types[]` entry with `direction: "output"` — never `string`, `number`, `boolean`, or an input-direction type.
- Every `source: "ToolOutput"` input with `mapping`: `mapping[0]` equals the output type name; `mapping[1]` is a declared property on that type.
- Output types feeding ToolOutput mappings are narrow (T3) with semantically-aliased field types, not wide structs of bare primitives (see cookbook 09a/09b).
- Every `source: "User"` input: `type` is a named type with `direction: "input"` — never a bare primitive.
- Sensitive values masked or omitted.
- Data action tested in isolation before AVA preview.

**Start Context (InputData) checklist:**

- No `description` on the `InputData` object itself — descriptions live on the per-property alias types (L14).
- No property is `required: true` — the platform always rejects required Start Context properties (T7).
- Every property references a named alias of a bare primitive (string/integer/number/boolean) — never a bare primitive inline, and never an enum type (T7).
- Property names are snake_case with at least one underscore, ≥2 chars between underscores, no leading/trailing underscore or digit, no `__` (L13).
- Every `source: "External"` input references a named type that is a property on `InputData` — never a bare primitive (L15).
- Every required `source: "External"` input sets `fallbackToUser: true`; `fallbackToUser` never appears on non-External inputs (L15).

---

## Knowledge

Knowledge is for approved informational answers. It is not for actions, account-specific data, or content the agent must never reveal.

**Do not:**

| Avoid | Why / fix |
| --- | --- |
| Connect sources with internal-only, outdated, draft, or prohibited content. | Curate content before connecting; omit what must never surface. |
| Rely on instructions to hide content that should not be available. | Remove it from the source; instructions are temporary mitigation only. |
| Vague source names or descriptions ("Insurance information."). | Name and describe topics covered and when to use the source. |
| One large mixed-topic source when intents differ. | Split into product- or topic-specific sources. |
| Use knowledge for exact legal, compliance, or disclosure wording. | Use Architect, static message, or a tool that returns approved text verbatim. |
| Use knowledge for account-specific balances, transactions, or eligibility. | Use tools. |
| Skip testing no-result and follow-up behavior. | Configure and test both before launch. |

---

## Configuration

Configuration controls start context, end context, exit behavior, escalation behavior, and wait experience.

**Do not:**

| Avoid | Why / fix |
| --- | --- |
| Pass large dynamic lists, raw profile JSON, credit card numbers, or access tokens as start context. | Retrieve via tool when needed; mask or omit sensitive values. |
| Use masking as a substitute for omitting values the agent never needs. | If the agent does not need it, do not pass it. |
| Vague start context descriptions ("customer info", "use this"). | Explain what the value is and how the agent may use it. |
| Return large strings or unnecessary fields in end context. | Select only what Architect needs; prefer booleans and compact status values. |
| Broad instructions like "End the conversation whenever possible." | Use targeted outcome instructions that call `end_conversation` after final success. |
| Put exact legal or compliance wording in exit, escalation, or guardrail response fields. | These are steering fields and may be paraphrased; use Architect or a tool for verbatim text. |
| Long, repetitive comfort statements during tool waits. | Keep them short: "I am checking that now." |
| Put timeout, no-input, and retry logic in AVA. | Handle in Architect. |

**Hidden session tools** — use only in targeted instructions:

- `end_conversation` — after final task is complete and the customer has no remaining need.
- `escalate_to_human_agent` — when the customer asks for a human, a tool requires review, or recovery is not possible.

---

## Guardrails

Guardrails block unsafe, adversarial, prohibited, or out-of-policy **customer inputs**. They do not define normal agent behavior.

**Do not:**

| Avoid | Better location |
| --- | --- |
| Tone and brevity rules ("Be nice and professional."). | Role or Guidelines. |
| "Do not use markdown." | Voice Guidelines. |
| "Do not accept payments." | Role, tool pre-instructions, or scope — unless the input must be blocked entirely. |
| Every out-of-scope request as a guardrail violation. | Handle conversationally in Role/Guidelines; guardrails are for inputs that must be blocked. |
| Turning Guardrails into a second prompt field. | Keep minimal; ask whether built-in protections already cover the case. |
| Writing guardrails as instructions to the agent. | Write rules about customer input: "Block customer requests to…" |

**Use guardrails for:**

- Prompt injection and jailbreak attempts.
- Requests to reveal system prompts.
- Attempts to change the agent's identity or role.
- Prohibited high-risk categories (e.g., medical diagnosis when out of scope).
- Domain-specific blocked requests (e.g., competitor non-public data).

---

## Red flags (stop and fix)

- Role says the agent can help with "anything" or "all customer questions."
- Guidelines contain a long step-by-step procedural flow.
- Sensitive data is passed to the agent with a guideline telling it not to reveal it.
- Tool returns raw API payloads or the agent is expected to calculate eligibility in text.
- Knowledge includes content the agent must never surface.
- Guardrails define tone or normal behavior.
- Exact legal wording is placed in a steering field.
- Testing happens only in preview, not in Architect and the production-like channel.

## Instruction locality (quick rule)

| Where | Put |
| --- | --- |
| Role | Identity, domain, broad capabilities, exclusions, customer term. |
| Guidelines | Global tone, clarification, grounding, channel formatting. |
| Tool name/description | What it does and when it is relevant. |
| Tool pre-instructions | When to call, when not to call, what to collect first. |
| Tool inputs/outputs | Format, meaning, exact capture, field descriptions. |
| Tool outcome/error handling | What to do after success, no-result, or failure. |
| Knowledge name/pre-instructions | What the source covers and when to search it. |
| Configuration | Start/end context, exit, escalation, wait experience. |
| Guardrails | Block prohibited customer inputs only. |

When behavior breaks, remove ambiguity first — do not add another instruction.
