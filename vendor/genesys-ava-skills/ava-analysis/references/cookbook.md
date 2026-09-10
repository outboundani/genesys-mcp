# Ava Cookbook References

Maps user intent and VersionDefinition structure to the right Ava cookbook reference chapter. Reference files live next to this file — one Markdown file per chapter, each focused on a single Ava VersionDefinition pattern. Chapters 01 through 08 are broad recipes; the 09-series files are focused anti-pattern lenses extracted from the original `09-anti-patterns.md`.

## Schema conventions used across these references

These chapters describe the public VersionDefinition contract. The following conventions apply to every example below:

- **Tools are discriminated by a `type` field**, not `kind`. Allowed values are `DataAction`, `KnowledgeBase`, `KnowledgeSetting`, and `ExternalA2AServer`.
- **Type definitions are discriminated by shape**, not by a `kind` tag. The parser inspects fields: `type: object | array` → struct; presence of `enum` → enum; `type: DataActionHttpError` → error; `type: string` with `undisclosed: true` → masked; otherwise aliased. Never author a `kind` field on a type definition.
- **`errors[]` (not `errorTypes[]`)** is the field on a `DataAction` tool that references error type names declared in `types[]`.
- **camelCase and snake_case are both accepted** by the API (`alias_generator=to_camel, populate_by_name=True`). Examples in these chapters mix the two; copy whichever shape the user's spec already uses and stay consistent within a single document.
- **Platform-injected fields** (`must_copy`, `interstitial_message`, `extra_field_behavior`, the synthesized error struct fields, built-in knowledge / A2A types, defender rules, the three built-in global instructions, and the per-turn language directive) are never authored. The chapters flag these as "Ava-injected defaults" wherever they apply.

---

## Reference index

| File | Chapter | Primary topics |
| --- | --- | --- |
| [01-authenticating-users.md](01-authenticating-users.md) | 1 | Pre-auth via Start Context (`InputData` + `source: "External"`), `AuthToken`, manual ID collection, gating tools behind auth |
| [02-collecting-multiple-inputs-from-the-user-for-a-function-call.md](02-collecting-multiple-inputs-from-the-user-for-a-function-call.md) | 2 | Multi-field forms, `SageAliasedType`, composite structs, ordering, confirmation, validation |
| [03-executing-multi-step-flows.md](03-executing-multi-step-flows.md) | 3 | Chained `ToolOutput` tokens, `outputInstructions`, `inputValidation`, explicit confirmation |
| [04-integrating-knowledge-bases.md](04-integrating-knowledge-bases.md) | 4 | GC native (`KnowledgeBase`, `KnowledgeSetting`) vs external DataAction KB, structured `KBSteps`, KB scope routing |
| [05-developing-an-agent-for-voice.md](05-developing-an-agent-for-voice.md) | 5 | Voice phrasing in `instructions[]` / `outputInstructions[]`, per-channel definitions, STT-safe collection, read-back |
| [06-supporting-multiple-languages.md](06-supporting-multiple-languages.md) | 6 | Session-language runtime directive, language-scoped instruction prose, multilingual tool behavior |
| [07-keeping-the-agent-on-topic-scope-containment-and-guardrails.md](07-keeping-the-agent-on-topic-scope-containment-and-guardrails.md) | 7 | `role` scoping, tool surface, `guardrails.custom[]`, violation events |
| [08-escalating-to-a-human-agent.md](08-escalating-to-a-human-agent.md) | 8 | Runtime escalation/exit, custom transfer tools, structured handoff summaries |
| [09a-narrow-tool-types.md](09a-narrow-tool-types.md) | 9a | Overly wide function arguments, opaque auth tokens, identifier over whole struct, copy-forcing gotcha, superfluous output fields |
| [09b-type-provenance-and-copying.md](09b-type-provenance-and-copying.md) | 9b | Generic string types vs semantic aliases, misapplied `userUtteranceSubstring` |
| [09c-structural-flow-gates.md](09c-structural-flow-gates.md) | 9c | Prose ordering vs typed tool-output ordering |
| [09d-instruction-locality.md](09d-instruction-locality.md) | 9d | Misplaced instructions, tools without clear usage instructions |
| [09e-prompt-noise-and-format-examples.md](09e-prompt-noise-and-format-examples.md) | 9e | Verbose `role`, dummy concrete values in format templates |

---

## Routing procedure

1. **Classify the input** — user question, review request, or VersionDefinition snippet.
2. **Match signals** in the tables below: user-intent signals first, then VersionDefinition shape signals.
3. **Read the primary reference chapter(s)** in full before proposing changes.
4. **Always consult the relevant 09-series file(s)** when reviewing or debugging an existing VersionDefinition.
5. **Check Ava-injected defaults** — every chapter notes what the platform supplies automatically; do not recommend fields that are already injected at publish time.
6. **Cite the chapter** by number when explaining; pull JSON snippets from it rather than inventing patterns.

> **Context budget:** keep reads bounded — pick the most specific chapter(s) for the task. Each chapter is small but still competes for context with the version definition you are analyzing.

---

## Route by user query

Use keyword / intent matching. Prefer the most specific chapter; fall back to the 09-series for "why doesn't this work" or "is this wrong" questions.

| User intent / keywords | Read |
| --- | --- |
| authenticate, login, verify user, Start Context auth, pre-auth, externally supplied identifier, `AuthToken`, gate tools behind auth, unauthenticated access | **01** |
| collect multiple fields, form, signup, booking form, composite input, validate zip / phone / email, confirm before submit, `userUtteranceSubstring` on form fields | **02** |
| multi-step, chain tools, prerequisite token, stale token, confirm verbatim, hard gate before tool runs, `inputValidation`, response template | **03** |
| knowledge base, KB, RAG, FAQ, lookup docs, `KnowledgeBaseTool`, `KnowledgeSettingTool`, structured steps from KB, empty KB result | **04** |
| voice, phone, IVR, STT, speech, modality, chat vs voice, brevity, read back, spelled-out ID, no-markdown rule | **05** |
| multilingual, language, locale, Spanish / French / etc., per-language instructions, per-language tool wording | **06** |
| on-topic, scope, out of scope, guardrails, defender, jailbreak, policy, what agent can / cannot do, `guardrails.custom` | **07** |
| escalate, human agent, transfer, handoff, end conversation, `Escalation` event, `UserExit`, front desk, specialist | **08** |
| wide types, large copy tokens, identifier over struct, copy-forcing gotcha, oversized output struct | **09a** |
| generic `string` for IDs, missing aliased types, misapplied `userUtteranceSubstring`, free-form prose with substring constraint | **09b** |
| "always call X before Y" in prose, prose ordering vs type ordering | **09c** |
| misplaced instructions, tool routing rules in global `instructions[]`, tool with vague description | **09d** |
| verbose `role`, brand history in `role`, dummy phone / address in property descriptions | **09e** |
| review my VersionDefinition, audit, improve this agent, something feels off | the 09-series first, then feature chapters surfaced by VD signals |

---

## Route by VersionDefinition signals

Inspect the VD JSON (or the user's described structure). Match **any** signal in a row to open that chapter.

### Chapter 01 — Authenticating users

| Signal in VD | Example |
| --- | --- |
| Type named `AuthToken` (opaque-token struct, `direction: "output"`) | Trust token after auth |
| Tool named `Authenticate` whose inputs use `source: "External"` against `InputData` properties | Start Context pre-auth |
| `InputData` carrying a verified identifier property (member ID, customer key, phone, partner token) | Start Context-supplied identifier |
| Downstream tool inputs with `source: "ToolOutput"` referencing auth output | Auth gating |
| `SageErrorType` on auth tool with recoverable failure codes | Auth retry flow |
| Mix of tools — some require auth token param, some do not | Ungated vs gated surface |

### Chapter 02 — Collecting multiple inputs

| Signal in VD | Example |
| --- | --- |
| Single tool with **3+** user-sourced inputs | Form-style submission |
| Multiple `SageAliasedType` with `userUtteranceSubstring: true` | Verbatim field capture |
| Composite `SageStructType` used as tool input (not as an output token) | Grouped form fields |
| `instructions[]` describing field order, confirmation, or validation steps | Form workflow prose |
| `SageErrorType` + `errors[]` on a submit tool | Field-level validation errors |
| Display formatting vs tool-call formatting discussion in instructions | Formatting split |

### Chapter 03 — Executing multi-step flows

| Signal in VD | Example |
| --- | --- |
| Tool B input with `source: "ToolOutput"` from tool A | Token chain |
| `outputInstructions[]` with `when` / `then` | Response templates |
| `inputValidation[]` on a tool | Hard preconditions |
| `inputValidation` lambda doing structural checks on the tool's own inputs | Hard precondition with `else` explanation; the lambda only sees the tool's declared inputs and a small builtin whitelist (`len`, `min/max`, `int`, `str`, `isinstance`, ...) — there is no helper to reach into prior turns |
| `inputInstructions[]` paired with validation | Gate + guidance |
| Instructions requiring explicit user confirmation of a prior value | Verbatim confirm loop |
| Output-direction types passed between tools (`ValidatedX`, `ConfirmedY`) | Staged trust tokens |

### Chapter 04 — Integrating knowledge bases

> The VersionDefinition API accepts both snake_case and camelCase keys. These chapters mix the two; preserve whichever form the user's spec already uses.

| Signal in VD | Example |
| --- | --- |
| Tool with `"type": "KnowledgeBase"` or `"KnowledgeSetting"` | Native KB tools |
| `CustomerIssue`, `KnowledgeBaseQuery`, or KB-related aliased types | KB query shaping |
| Data Action tool returning a step list / structured KB payload | Structured KB results |
| `inputInstructions[]` disambiguating KB vs other tools | KB scope routing |
| `outputInstructions[]` branching on empty vs non-empty KB answer | Result-shape branching — `KnowledgeBase` / `KnowledgeSetting`: two UI slots only (no-result / with-result); see **04** |

### Chapter 05 — Developing an agent for voice

| Signal in VD | Example |
| --- | --- |
| `instructions[]` or `outputInstructions[]` prose containing `"When the conversation is over voice"` / `"in chat"` | **Anti-pattern** — Sage injects no runtime voice/digital signal; the agent cannot branch on this prose |
| Instructions banning markdown / bullets, capping response length, or spelling numbers out | Voice phrasing rules |
| Instructions about one question per turn, brevity, or read-back of an address / phone / email | Voice UX |
| Channel-redirect guidance (e.g. "offer SMS / chat for long codes") | STT-safe ID handling |
| Same VD intended to serve both voice and chat | Channel-neutral spoken phrasing, or separate definitions per channel |

### Chapter 06 — Supporting multiple languages

| Signal in VD | Example |
| --- | --- |
| Instructions in `instructions[]` gated by phrases like "When the session language is es-ES" | Per-language tone / formality |
| `outputInstructions[]` / `inputInstructions[]` with `"When the session language is ..."` branching inside `then` | Per-tool, per-language wording |
| User mentions language code on session / turn API (not in VD) | Runtime language directive (Ava-injected); the VersionDefinition itself carries no `supportedLanguages` field |

### Chapter 07 — Scope containment and guardrails

| Signal in VD | Example |
| --- | --- |
| Narrow `role` with explicit can / cannot do lists | Positive / negative scope |
| Small tool surface — only in-scope actions exposed | Scope via tools |
| `SageMaskedType` with `undisclosed: true` used as a gating token on downstream tools | Scope via tool surface (auth-style gating) |
| `guardrails.custom[]` with `instruction` + `enabled` | Custom guardrail rules |
| `events` with `Guardrails` violation messaging | Violation responses |
| Agent should refuse off-topic requests without escalating | Scope containment |

### Chapter 08 — Escalating to a human agent

| Signal in VD | Example |
| --- | --- |
| `events.Escalation` and / or `events.UserExit` with custom `message` only | Override built-in handoff / exit copy; runtime tools `escalate_to_human_agent` / `end_conversation` still fire |
| No `events[]` for escalation but request enables it | Built-in `escalate_to_human_agent` runs with default `"Transferring you now!"` |
| Custom transfer `DataActionTool` with `inputInstructions[]` describing when / why to call | Branded handoff that does real backend work, paired with built-in exit |
| `HandoffSummary` / `GuestConcern` struct + `Department` enum used as the transfer tool's inputs | Structured escalation payload |
| `ReservationId` / `CheckInDate` with `direction: "output"` referenced inside a transfer-tool struct | Trusted IDs copied into handoff |

### Chapter 09a — Narrow tool types

| Signal in VD | Example |
| --- | --- |
| Large struct with `direction: "output"` flowing as a gated tool input on every call | Over-wide copy tokens |
| Auth tool returning a struct with `name` / `email` / `phone` / `tier` instead of an opaque token | Token bloat on every gated call |
| Mutation tool accepting the full record struct instead of an identifier alias | Identifier should be the trust token |
| Aliased type relied on for provenance, but used directly as an input on a sibling tool | Copy-forcing gotcha — wrapping struct doesn't extend to fields used elsewhere |
| Output struct lists every backend field (rate plan code, housekeeping notes, channel source, …) | Superfluous output fields |

### Chapter 09b — Type provenance and copying

| Signal in VD | Example |
| --- | --- |
| Plain `string` types for semantic IDs (order ID, member ID, confirmation code) | Missing `SageAliasedType` |
| `userUtteranceSubstring: true` on narrative / free-text fields (notes, reason-for-visit) | Misapplied substring constraint |
| Aliased input types without `direction` or without `userUtteranceSubstring` where verbatim capture is needed | No provenance guarantee |

### Chapter 09c — Structural flow gates

| Signal in VD | Example |
| --- | --- |
| `instructions[]` contains phrases like "CRITICAL: always call X before Y" | Prose ordering instead of type ordering |
| Two tools with no shared output→input type but the agent is expected to call them in sequence | Ordering not enforced by the type graph |
| Mutation tool accepts a plain `string` ID instead of an output-direction alias from the lookup tool | Missing structural gate |

### Chapter 09d — Instruction locality

| Signal in VD | Example |
| --- | --- |
| Global `instructions[]` contain tool-specific routing rules ("After calling X, do Y", "Only call X if …") | Misplaced instructions |
| Post-success behavior lives in `instructions[]` rather than the tool's `outputInstructions[]` | Wrong locality |
| Precondition described in prose instead of `inputValidation[]` | Wrong locality |
| Tool with a vague `description`, no `inputInstructions[]`, and sibling tools with overlapping themes | Missing routing guidance |

### Chapter 09e — Prompt noise and format examples

| Signal in VD | Example |
| --- | --- |
| Verbose `role` packed with brand history, ratings, mission statements | Superfluous prompt content |
| Property `description` contains a concrete value like `(123) 555-6789` or a real-looking email | Dummy value the model can copy into a reply |
| Type / property descriptions explaining backend trivia the agent will never act on | Description bloat |

---

## Multi-chapter combinations

Some tasks span chapters — read all listed, in order.

| Scenario | Chapters |
| --- | --- |
| Authenticated voice agent collecting order details | 01 → 02 → 05 |
| KB-backed support agent with escalation | 04 → 07 → 08 |
| Multilingual voice IVR with auth | 01 → 05 → 06 |
| Multi-step booking with confirmation | 02 → 03 |
| New agent from scratch | 07 (scope) → feature chapters → relevant 09-series (review) |
| VD review / PR feedback | 09a–09e → feature chapters flagged by signals above |
