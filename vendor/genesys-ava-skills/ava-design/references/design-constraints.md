# Design Constraints

Enforceable generation rules for the design skill. A good AVA is narrow enough to be reliable, grounded enough to be trustworthy, and connected enough to complete a task — not a giant scripted prompt. Distilled from cookbooks (01–09e), Best Practices Guide, Polaris 28, and Sage API behavior.

Apply these rules during field collection — not after. The analysis sub-agent validates what you produce here; if you follow these constraints, Step 9 should find zero errors.

---

## Types

### T1: Opaque auth token pattern

**Rule:** Auth tool outputs must contain ONLY a single token property. Exclude all other fields the DataAction returns. **Shape:**

```json
{"name": "AuthToken", "type": "object", "direction": "output",
 "properties": [{"name": "session_token", "type": "string", "required": true}],
 "undisclosed": true}
```

**Why:** Extra fields (status indicators, profile data, descriptive messages) waste context tokens — the model re-emits them on every gated call downstream. The backend reads non-token data itself. **Algorithm:**

1. From the DataAction output schema, identify the token field that downstream tools consume
2. Create output type with ONLY that one property
3. Exclude everything else — handle status/messaging in outputInstructions text

**Apply when:** Any tool returns a session token, auth token, or login result that gates downstream tools. **Source:** cookbook/01, cookbook/09a, BPG §4.11 §9.1

### T2: userUtteranceSubstring on user-provided identifiers

**Rule:** Any value the user speaks/types that must be captured verbatim (codes, IDs, account numbers, names, emails) requires a named type with `direction: "input"` and `userUtteranceSubstring: true`. **Shape:**

```json
{"name": "InputVerificationCode", "type": "string", "direction": "input",
 "userUtteranceSubstring": true,
 "description": "Verification code as spoken by the customer. Must be copied verbatim."}
```

**Why:** Without this flag, the model can fabricate values instead of copying the user's exact words. **Exception:** Do NOT use on free-form prose fields (notes, descriptions, reason-for-visit). Only for discrete identifiers and codes. **Inverse rule:** Do NOT use `userUtteranceSubstring: true` when the agent needs to infer, normalize, summarize, or classify the value. If the user can express something multiple ways but the tool needs a normalized form (e.g., user says "h2o" but API expects "water"), let the model infer — do not force verbatim capture. **Apply when:** Any tool input with `source: "User"` that represents a code, ID, number, name, or email. **Source:** cookbook/09b, BPG §4.6

### T3: Output types include only fields the agent needs

**Rule:** Output type properties must be limited to fields the agent is instructed to present to the customer, link downstream, or return as end context. Do not include fields just because the API returns them. **Specifically exclude:**

- PII the agent never speaks (user_email, phone, address) unless outputInstructions say to present it
- Internal IDs, UUIDs, debug data
- Fields not referenced in any outputInstructions or downstream mapping

**Why:** Every unused field adds token cost every turn and risks inadvertent PII exposure. **Quality rule:** Output properties the agent must interpret should have clear descriptions on the type. Prefer boolean and status fields for decision points over ambiguous strings. **Apply when:** Constructing any output type from a DataAction schema. **Source:** cookbook/09a (superfluous output fields), BPG §4.7

### T4: Output types must include a success indicator when needed

**Rule:** If a NON-AUTH DataAction can return HTTP 200 with no usable result (e.g., record not found), the output type must include a `success` boolean or equivalent status field so the agent can distinguish "no data" from "has data." **Does NOT apply to auth tools** — T1 takes precedence (auth types contain only the token; handle success/failure in outputInstructions text). **Apply when:** Non-auth tools whose backend can return 200 with an empty or no-record response. **Source:** BPG §4.7 §4.10

### T5: No reserved keywords as type property names

**Rule:** Never declare a property with a name that is a Sage reserved keyword: `Boolean`, `Dynamic`, `Integer`, `List`, `Map`, `None`, `Number`, `String`, `Unknown`, `type`, `dict`, `tuple`, `list`.

**Algorithm (follow these steps exactly):**

1. **Scan EVERY type you declare** — top-level output types AND array sub-types (e.g., `OrderItem`, `FlightSegment`, `PolicyDetail`).
2. For each property in the type, check if the property `name` matches any reserved keyword (case-sensitive).
3. If a reserved keyword is found:

   - **EXCLUDE the property entirely.** Do not declare it in the type.
   - Tell the author: "The output field '[field]' is a Sage reserved keyword, so it's excluded from the type. The AVA won't reference that field."
4. **This applies to array item sub-types too.** If the DataAction returns `items[].type`, and you create a sub-type for those items, do NOT include `type` as a property.

**Common trap:** Many DataActions return arrays where items have a field named `type` (e.g., ticket type, order line type, policy type, transaction type). When building the array sub-type, you MUST skip any reserved keyword field.

**Correct (e.g., for an order items array):**

```json
{"name": "OrderLineItem", "type": "object", "properties": [
  {"name": "item_id", "type": "string"},
  {"name": "quantity", "type": "number"},
  {"name": "price", "type": "number"}
]}
```

Note: If the schema also returned a `type` field (e.g., "standard" vs "gift"), it is EXCLUDED.

**WRONG (causes publish failure):**

```json
{"name": "OrderLineItem", "type": "object", "properties": [
  {"name": "item_id", "type": "string"},
  {"name": "quantity", "type": "number"},
  {"name": "type", "type": "string"},       ← RESERVED KEYWORD
  {"name": "price", "type": "number"}
]}
```

**Apply when:** Constructing ANY type from a DataAction schema — both top-level and nested/array item types. **Source:** SKILL.md reserved keywords section

### T6: Array sub-types must be declared separately

**Rule:** When an output type has an `array` property, declare the items as a separate named type (e.g., `OrderLineItem`, `FlightSegment`, `ClaimEntry`), then reference it via `"items": "TypeName"`. Apply T5 (reserved keyword filter) to the sub-type properties. **Apply when:** Any output type with array fields. **Source:** sage-api-schema conventions

### T7: Context variable types need correct structure

**Rule:** Context variables must follow the InputData pattern: one `InputData` object with `direction: "agentInput"`, each property referencing a standalone PascalCase type with `userUtteranceSubstring: false` (unless extractable from speech). The referenced type must be an **alias of a bare primitive** (`string`, `integer`, `number`, `boolean`) — **never** a bare primitive inline, and **never an enum type**. **No required properties:** Start Context properties can **never** be `required: true`. The platform rejects any required InputData property with no exception. Handle mandatory values via a tool input with `fallback_to_user` or by prompting — not by marking the context property required. **No enums (Start-Context-specific):** Enum types are valid for tool inputs/outputs but are rejected for Start Context properties. Use a plain string alias instead of an enum. **WRONG:**

```json
// enum in Start Context + required property + inline primitive
{"name": "ContactChannel", "type": "string", "enum": ["voice", "chat"]}
{"name": "InputData", "direction": "agentInput", "type": "object",
 "properties": [
   {"name": "contact_channel", "type": "ContactChannel", "required": true},
   {"name": "customer_id", "type": "string"}
 ]}
```

**RIGHT:**

```json
{"name": "ContactChannel", "type": "string",
 "description": "Channel the contact arrived on (e.g. voice, chat).", "userUtteranceSubstring": false}
{"name": "CustomerId", "type": "string",
 "description": "The customer's account identifier.", "userUtteranceSubstring": false}
{"name": "InputData", "direction": "agentInput", "type": "object",
 "properties": [
   {"name": "contact_channel", "type": "ContactChannel", "required": false},
   {"name": "customer_id", "type": "CustomerId", "required": false}
 ]}
```

**Failure symptoms:** `create_version` 422 — *"Start Context property '[name]' cannot be required."* / *"Start Context property '[name]' references a type that is not primitive."* / *"...must have a 'type' that references a separate primitive type."* **Apply when:** Step 7 (context variables). **Source:** version_definition.py `_validate_reserved_input_data_property_attributes`, `_validate_input_data_type` (lines ~343–359, ~1062–1074)

### L13: Start Context property names have a strict format

**Rule:** Every property name on the `InputData` object must satisfy ALL of: lowercase letters, digits, and underscores only; contains at least one underscore; does not start or end with an underscore; does not start or end with a digit; no consecutive underscores (`__`); at least 2 characters between underscores. **WRONG:**

```json
{"name": "customerId", "type": "CustomerId"}   // uppercase, no underscore
{"name": "id", "type": "AccountId"}            // no underscore
{"name": "customer__id", "type": "CustomerId"} // consecutive underscores
{"name": "c_id", "type": "CustomerId"}         // <2 chars between underscores
```

**RIGHT:**

```json
{"name": "customer_id", "type": "CustomerId"}
{"name": "vehicle_vin", "type": "VehicleVin"}
{"name": "contact_channel", "type": "ContactChannel"}
```

**Failure symptom:** `create_version` 422 — *"Start Context Property name '[name]' ..."* (name format error). This is separate from the "at least one underscore" rule, which is enforced by the same validator. **Apply when:** Naming any `InputData` property in Step 7. **Source:** version_definition.py `_validate_input_data_property_name_format` (lines ~286–319)

### L14: `description` is reserved on the InputData object

**Rule:** Do not set a `description` field on the `InputData` object type itself. It is reserved and rejected at `create_version`. Descriptions belong on the per-property standalone alias types instead. **WRONG:**

```json
{"name": "InputData", "direction": "agentInput", "type": "object",
 "description": "Context passed in at conversation start.",
 "properties": [{"name": "customer_id", "type": "CustomerId"}]}
```

**RIGHT:**

```json
{"name": "InputData", "direction": "agentInput", "type": "object",
 "properties": [{"name": "customer_id", "type": "CustomerId"}]}
// description lives on the CustomerId alias type, not on InputData
```

**Distinct from C2:** C2 requires descriptions on each context variable's **alias type**. L14 forbids a description on the **InputData object** wrapping them. Both apply together. **Failure symptom:** `create_version` 422 — *"Start Context field 'description' is reserved."* **Apply when:** Declaring the `InputData` object in Step 7. **Source:** version_definition.py `_validate_reserved_input_data_attributes` (lines ~337–341)

### T8: Output types must declare direction: "output"

**Rule:** Every type referenced as a tool's `output` field must be declared in `types[]` with `direction: "output"`. A type without this direction will be rejected at `create_version` even if its shape is correct. **WRONG:**

```json
{"name": "AccountLookupResult", "type": "object",
 "properties": [{"name": "account_id", "type": "string"}]}
```

**RIGHT:**

```json
{"name": "AccountLookupResult", "type": "object", "direction": "output",
 "properties": [{"name": "account_id", "type": "string"}]}
```

**Failure symptom:** `create_version` 422 — tool output type not found in output type set. **Distinct from L5:** L5 checks the *consumer* side (ToolOutput input's `type` references an output-direction type). T8 checks the *producer* side (the type declaration itself has `direction: "output"`). **Apply when:** Declaring any type that will be set as a tool's `output`. **Source:** version_definition.py `_validate_tool_output_types_exist`

---

## Tools

### L1: Every tool must have an errors[] array

**Rule:** Every DataAction tool must declare at least one error type in `errors[]` with a corresponding `DataActionHttpError` type in `types[]`. **Minimum:** Map the most likely failure mode (e.g., 400 for bad input, 404 for not found, 500 for service failure). **Shape:**

```json
"errors": [{"type": "ValidationError", "instruction": "The input could not be processed. Ask the customer to try again."}]
```

Plus in types[]:

```json
{"name": "ValidationError", "type": "DataActionHttpError", "statusCodes": [400],
 "defaultInstruction": "The input could not be processed. Ask the customer to try again."}
```

**Why:** Without error handling, the agent has no structured recovery path for failures. **Naming:** Error type names should be descriptive and business-readable: `OrderNotFound`, `PaymentDeclined`, `ServiceUnavailable` — not `Error1`, `BadThing`, or `HTTP_400_500_etc`. **Instruction quality:** `defaultInstruction` should be customer-safe, specific to the failure mode, and suggest a recovery path (retry, rephrase, or escalate). **Apply when:** Every DataAction tool, no exceptions. **Source:** cookbook/01, BPG §4.10

### L2: No shared status codes across error types

**Rule:** Each HTTP status code must appear in exactly ONE error type's `statusCodes[]` array across the ENTIRE AVA (all tools combined). Sage rejects the payload if any code appears in two error types. **Why:** Sage validates globally, not per-tool.

**Algorithm (follow these steps exactly):**

1. **Create SHARED error types for codes that multiple tools need.** Do NOT create per-tool error types for the same code.

   - If multiple tools can return 401 → create ONE `Unauthorized` type with `statusCodes: [401]` and reference it from ALL those tools' `errors[]`.
   - If multiple tools can return 500 → create ONE `ServiceError` type with `statusCodes: [500]` and reference it from ALL those tools' `errors[]`.
2. **Create UNIQUE error types only for codes specific to one tool.**

   - A validation tool returns 400 (bad format) that no other tool returns → create `ValidationError` with `statusCodes: [400]`.
   - A lookup tool returns 404 (not found) that no other tool returns → create `NotFound` with `statusCodes: [404]`.
3. **Before finalizing, verify:** List every error type and its codes. Scan for duplicates. If any code appears twice → merge into a shared type.

**Correct pattern (e.g., verify_identity + get_patient_records):**

```json
{"name": "ValidationError", "type": "DataActionHttpError", "statusCodes": [400]}
{"name": "Unauthorized", "type": "DataActionHttpError", "statusCodes": [401]}
{"name": "NotFound", "type": "DataActionHttpError", "statusCodes": [404]}
{"name": "ServiceError", "type": "DataActionHttpError", "statusCodes": [500]}
```

Both tools reference `Unauthorized` and `ServiceError`. Only the identity tool references `ValidationError`. Only the records tool references `NotFound`.

**WRONG pattern (causes publish failure):**

```
IdentityUnauthorized: [401]   ← CONFLICT
RecordsUnauthorized: [401]    ← CONFLICT
IdentityServiceError: [500]   ← CONFLICT
RecordsServiceError: [500]    ← CONFLICT
```

**Never create:** Per-tool variants of the same HTTP code (ToolAServiceError + ToolBServiceError). Always consolidate into one shared type. **Source:** Sage API validation (discovered at publish time)

### L3: Every tool must have outputInstructions

**Rule:** Every DataAction tool must have at least one outputInstructions entry: `{when: "True", then: "..."}`. **Content must cover:**

- What to do on success (present results, move to next step)
- What to do on failure/empty (inform customer, offer retry or escalation)

**Why:** Without outputInstructions, the agent guesses what to say after a tool returns. **Apply when:** Every DataAction tool configuration. **Source:** polaris28, BPG §4.9

### L4: Tool ordering via type graph, not prose

**Rule:** When Tool B must run after Tool A, enforce this via `source: "ToolOutput"` + `mapping` on Tool B's input — not via prose instructions like "always call A before B." **Why:** Type-graph enforcement is guaranteed; prose instructions can be ignored by the model. **Redundant prose is noise:** If the type graph already enforces ordering, don't also add inputInstructions that repeat "call only after [Tool A]." **Apply when:** Any chained tool sequence (auth → action, lookup → mutation). **Source:** cookbook/09c, cookbook/03, BPG §4.8

### L5: Linked tool mapping format

**Rule:** When linking tools, the consuming input must set:

- `type` = the PRODUCER's output type name (not a new input type)
- `source` = "ToolOutput"
- `mapping` = ["OutputTypeName", "fieldName"]

**Example:**

```json
{"targetName": "authToken", "type": "AuthToken", "source": "ToolOutput",
 "required": true, "mapping": ["AuthToken", "session_token"]}
```

**Apply when:** Any tool input that consumes another tool's output. **Source:** cookbook/01, SKILL.md linked tools section

**WRONG vs RIGHT — field-level mapping (most common trap):**

```json
// WRONG — primitive type of the mapped field (422 at create_version)
{"targetName": "vehicle_vin", "type": "string", "source": "ToolOutput",
 "mapping": ["AccountResult", "vehicle_vin"]}
// RIGHT — producer's direction:"output" type; field selected by mapping[1]
{"targetName": "vehicle_vin", "type": "AccountResult", "source": "ToolOutput",
 "mapping": ["AccountResult", "vehicle_vin"]}
```

**Primitive-type trap:** The `type` field is the producer's **OUTPUT type name** — NEVER the primitive (`string`, `number`, `boolean`) of the field named in `mapping[1]`. Primitives are valid *inside* the output type's `properties`; they are not valid as the ToolOutput input's `type`. **Failure symptom:** `create_version` returns 422: *"ToolOutput sourced Input 'string' must reference a type with Output direction."* **Algorithm (3 steps):**

1. Find the producer tool's `output` type name (e.g. `AccountResult`).
2. Confirm that type exists in `types[]` with `direction: "output"`.
3. Set consumer input `type` to that name; use `mapping: ["AccountResult", "<field>"]` to pick the specific field.

**Deeper fix (recommended alongside the algorithm above):** Apply T3 (narrow outputs) and give each mapped field its own semantic alias instead of a bare primitive — a narrow, aliased output struct makes this mistake far less likely to occur in the first place, not just easier to catch. See cookbook 09a-narrow-tool-types ("Short identifier over whole structs") and 09b-type-provenance-and-copying ("Generic string types instead of semantic aliases").

### L6: Compact tool payloads (max ~5 inputs)

**Rule:** If a tool has more than 5 inputs, review whether static values should be hardcoded in the data action. Only expose inputs that change per conversation. **Hardcode candidates:** country_code, brand, channel, language, api_version, static config. **Apply when:** Tool input count exceeds 5. **Source:** BPG §4.6

### L7: Tool descriptions are 1-2 sentences

**Rule:** Tool description says WHAT it does, WHEN to use it, and what it returns. No procedural steps. **Anti-pattern:** "First ask for X, then call the API, then check status..." **Anti-pattern (vague):** "Gets customer information." — says nothing about when to use it or what it returns. **Anti-pattern (broad):** "Returns everything about the customer and should be used for any customer question." — overlaps with other tools and encourages overuse. **Fix:** Move collection to inputInstructions; move sequencing to data action. **Apply when:** Writing any tool description. **Source:** BPG §4.4

### L8: Tool naming

**Rule:** Names must be concise, specific, and action-oriented.

- ✅ "lookup_order", "check_inventory", "validate_login_code", "submit_refund"
- ❌ "getData", "action1", "tool123", "get_user_details", "do_everything", "check_user"

**Consistency:** When an agent has multiple related tools, use consistent naming with a shared prefix pattern: `promise_to_pay_status`, `promise_to_pay_date`, `create_promise_to_pay` — not mixed names like `payment_date` that could apply to unrelated flows. **Apply when:** Naming any tool. **Source:** polaris28, BPG §4.3

### L9: Always auto-fetch schemas

**Rule:** Always call `get_data_action_schema` before configuring tool inputs/outputs. Never let the author type field names manually. **Why:** Manual entry is error-prone and causes field name mismatches. **Apply when:** Every DataAction tool. **Source:** polaris28

### L10: Mock error codes map to an HTTP status

**Rule:** An error mock's `code` is a fallback for deriving the HTTP status when `error.status` is omitted. Use a code from the canonical table, or set `error.status` explicitly. **Canonical codes** (from `tools/data_actions/matching.py` `ERROR_CODE_TO_STATUS`):

| Code | HTTP status if `status` omitted |
| --- | --- |
| `bad.request` | 400 |
| `invalid.value` | 400 |
| `not.found` | 404 |
| `resource.not.found` | 404 |
| `forbidden` | 403 |
| `unauthorized` | 401 |
| `conflict` | 409 |
| `too.many.requests` | 429 |
| `rate.limit.exceeded` | 429 |
| `server.internal.error` | 500 |
| `service.unavailable` | 503 |

**Remaining risk:** an unrecognized code with no explicit `status` silently resolves to 400, which is rarely what the author meant. **Robust pattern (prefer this):**

```json
{
  "input": { "service": "...", "order_id": "missing" },
  "error": {
    "status": 404,
    "message": "Order not found.",
    "code": "not.found"
  }
}
```

If `code` is omitted, `status` drives resolution; if both are set, use canonical codes from the table above only. `code` and `message` are authoring metadata only — they are **not delivered to the AVA**. The echo host returns the mock's status and Genesys aborts before the response transform runs, so the AVA observes a failed tool call with no error text. **Apply when:** Authoring `mock_responses`/`default_mock` for `create_mock_data_action` or `replace_mock_responses`. **Source:** `tools/data_actions/matching.py` `ERROR_CODE_TO_STATUS`

### L11: User-sourced inputs must reference named input types

**Rule:** Every tool input with `source: "User"` must have its `type` set to a named type declared in `types[]` with `direction: "input"`. Bare primitives (`string`, `number`, `boolean`, `integer`) are never valid as the `type` for User-sourced inputs. **WRONG:**

```json
{"targetName": "email", "type": "string", "source": "User", "required": true}
```

**RIGHT:**

```json
{"targetName": "email", "type": "CustomerEmail", "source": "User", "required": true}
```

Plus in `types[]`:

```json
{"name": "CustomerEmail", "type": "string", "direction": "input",
 "description": "Customer's email address as provided by the caller."}
```

**Relationship to T2:** T2 mandates `userUtteranceSubstring: true` specifically for codes/IDs that must be copied verbatim. L11 is broader: ALL `source: "User"` inputs need a named `direction: "input"` type, even free-form fields where `userUtteranceSubstring` is omitted. **Failure symptom:** `create_version` 422 — *"User/ToolInput sourced Input 'string' referenced in tool '[name]' must reference a type with Input direction."* **Apply when:** Every tool input with `source: "User"`. **Source:** version_definition.py `_validate_tool_input_types` (lines ~1314–1320)

### L12: Don't reuse a direction: "input" type across two User-sourced tool inputs

**Rule:** Once a `direction: "input"` type has been consumed by one tool via `source: "User"`, any second tool needing the same value must reference it via `source: "ToolInput"` — not `source: "User"` again. **WRONG — same type on two tools both with source: "User":**

```json
// Tool 1:
{"targetName": "vin", "type": "VinOrAccountId", "source": "User"}
// Tool 2:
{"targetName": "vin", "type": "VinOrAccountId", "source": "User"}
```

**RIGHT — second tool chains via ToolInput:**

```json
// Tool 1 (collector):
{"targetName": "vin", "type": "VinOrAccountId", "source": "User"}
// Tool 2 (consumer):
{"targetName": "vin", "type": "VinOrAccountId", "source": "ToolInput"}
```

**Why:** The platform tracks which tool collected a User input. If two tools both declare `source: "User"` for the same type, the second is rejected — the platform expects it to receive the value via `ToolInput` chaining from the first. **Failure symptom:** `create_version` 422 — *"Tool input '[target_name]' for tool '[name]' has a source of 'User' which is defined by another tool. Check if this tool input should have a source of 'ToolInput'."* **Apply when:** Any time the same `direction: "input"` type appears on inputs of two+ tools. **Source:** version_definition.py `_validate_tool_input_types` (lines ~1301–1312)

### L15: External-sourced tool inputs — fallbackToUser + Start Context type

**Rule:** A tool input with `source: "External"` reads its value from Start Context (the `InputData` object). Three linked rules apply:

1. **Required needs fallback:** If `required: true`, the input MUST also set `fallbackToUser: true`. A required External input without it is rejected.
2. **Fallback is External-only:** `fallbackToUser: true` is valid ONLY on `source: "External"` inputs. Setting it on a `User`, `ToolInput`, or `ToolOutput` input is rejected.
3. **Type must be a Start Context property type:** The input's `type` must be a named type that appears as a property `type` on the `InputData` object — never a bare primitive (`string`, `number`, `boolean`, `integer`).

Additionally, an External input **without** `fallbackToUser` must not reference a type whose `userUtteranceSubstring` is `true`. **WRONG:**

```json
// bare primitive + required without fallback
{"targetName": "service", "type": "string", "source": "External", "required": true}
```

**RIGHT:**

```json
// 1) named alias declared as a Start Context property
{"name": "ServiceIdentifier", "type": "string", "userUtteranceSubstring": false,
 "description": "The service the caller is asking about."}
{"name": "InputData", "direction": "agentInput", "type": "object",
 "properties": [{"name": "service_identifier", "type": "ServiceIdentifier", "required": false}]}
// 2) tool input references that named type + sets fallbackToUser when required
{"targetName": "service", "type": "ServiceIdentifier", "source": "External",
 "required": true, "fallbackToUser": true}
```

**Failure symptoms:** `create_version` 422 —

- *"External Required input '[target_name]' must have fallbackToUser set to true"*
- *"Fallbacks can only be specified for external sources, but input '[target_name]' has source '[source]'"*
- *"External sourced Input '[type]' referenced in tool '[name]' must be defined as a property type in Start Context"*
- *"External sourced Input '[type]' referenced in tool '[name]' cannot be user utterance substring without a fallbackToUser"*

**Relationship to T7/C3:** T7 governs the `InputData` object's shape; C3 says every Start Context property should be consumed. L15 is the consumer side — the tool input that reads a Start Context property via `source: "External"`. Design the property (T7) and the External input (L15) together. **Apply when:** Any tool input with `source: "External"`, or any input setting `fallbackToUser`. **Source:** version_definition.py `_validate_fallback_fields` (lines ~638–650), `_validate_tool_input_types` External branch (lines ~1329–1333), `_validate_data_action_tool_input_types` (lines ~1408–1418)

---

## Instructions & Role

### I1: Instruction locality

**Rule:** Instructions belong at the most local level. **Priority:** Instruction locality is the most important design rule. If content can live at a more local level, it must.

| Content | Location |
| --- | --- |
| Identity, brand, domain, broad capabilities, broad exclusions | role |
| Conversation-wide: clarification, tone, brevity, grounding, channel formatting | instructions[] |
| What the tool does, when relevant, why to use it | tool.description |
| When to call, what to collect/confirm, when NOT to call | tool.inputInstructions |
| Input meaning, required format, examples, exact capture | tool input descriptions |
| What returned fields mean, how to interpret | tool output type descriptions |
| What to do after tool returns | tool.outputInstructions |
| What to do on specific error codes | tool error handling |
| What knowledge source covers, when to search | knowledge tool inputInstructions |
| Blocking adversarial/harmful/compliance-critical inputs | guardrails |

**Anti-pattern:** Global instruction like "After calling lookup_order, use the order_status field" → belongs in outputInstructions. **Apply when:** Every instruction proposed by the author. **Source:** cookbook/09d, BPG §1.3

### I2: Role must include scope exclusions

**Rule:** Role states both what the agent CAN do and what it CANNOT do. Inclusion-only scope causes the agent to over-help. **Pattern:** "You cannot help with [topic1], [topic2], or [topic3]." **Anchor to outcome:** The role should state what business task the customer should complete (the outcome), not just list features the agent has. Include a conversational-decline pattern: 'I cannot help with [X], but I can help with [Y], or connect you with a specialist.' **Apply when:** Writing role text. **Source:** cookbook/07, BPG §3.3

### I3: Role must include a customer term

**Rule:** The role should declare what to call the person: "The person you are helping is the customer/member/patient/passenger/caller." **Why:** Without it, the agent may mix terms inconsistently. **Apply when:** Writing role text. **Source:** BPG §3.2

### I4: Prefer positive instructions

**Rule:** Instructions should say what to DO, not what NOT to do. Pair any negative with the correct alternative. **Anti-pattern:** "Do not hallucinate." **Fix:** "Use tool results for customer-specific answers. If the answer is unavailable, say you cannot answer it." **Apply when:** Any instruction that starts with "Don't", "Never", "Do not". **Source:** BPG §3.5, polaris28 **Exception:** Strong negatives (MUST, MUST NOT) are appropriate for critical safety, compliance, authentication, or payment confirmation boundaries. The flag is for overuse on routine behavior — not for eliminating all negatives.

### I5: Include a grounding rule

**Rule:** For agents with tools AND knowledge, include an instruction that grounds answers: "Answer [domain]-specific questions only from tool results. Answer policy questions only from connected knowledge. If neither source has the answer, say you cannot answer." **Why:** Without grounding, the agent may improvise from training data in domains where accuracy is critical. **Apply when:** Any AVA with both tools and knowledge sources, or any AVA in a regulated domain (banking, healthcare, insurance, travel, utilities). **Source:** BPG §1.1, §3.4

### I6: No math in instructions

**Rule:** Never instruct the agent to calculate, add, compare numbers, or do date arithmetic. Use a tool/function instead. **Apply when:** Any instruction mentioning calculation or comparison. **Source:** BPG §9.6, polaris28

### I7: One behavior per instruction

**Rule:** Each instruction describes exactly one specific action or behavior. Don't combine multiple rules into one instruction. **Apply when:** Any instruction that contains "and" joining two unrelated behaviors. **Source:** polaris28

### I8: Instructions must be substantive

**Rule:** Each instruction should be at least 20 characters and specific enough to be actionable.

- ❌ "Be nice" — too vague
- ✅ "Confirm the order number before calling the lookup tool" — specific and actionable

**Disambiguation test:** Each instruction should disambiguate something specific to the business that the model would not know by default. If removing the instruction wouldn't change model behavior, it shouldn't exist (see I11). **Examples:** Use examples when behavior would be ambiguous without them. Avoid examples that become full multi-turn conversation scripts — those belong in tools or test cases. **Apply when:** Every instruction. **Source:** polaris28

### I9: Role length and quality

**Rule:** Role should be 200-1000 characters for production AVAs. Roles under 50 chars are too brief. Roles over 2000 chars likely contain procedural logic that belongs in tools. **Anti-patterns:**

- "You are a helpful assistant" — too generic, no domain
- Procedural flows, pseudo-code, long bullet lists, or step-by-step scripts — these belong in tools/backend functions regardless of character count

**Apply when:** Finalizing role text. **Source:** polaris28, BPG §1.4

### I10: Capability descriptions belong in tool configuration, not global instructions

**Rule:** When an author describes a capability that requires a backend system interaction, it is a tool concern — not a global instruction. Recognize the capability and configure it as a tool with appropriate tool-level fields. **Decision test:** "Can the agent perform this behavior from conversation alone, without calling a backend system?" If no → it's a tool capability, not an instruction. **Mapping:**

| Author's description | Tool-level field |
| --- | --- |
| What the agent does / what the tool is for | `tool.description` |
| What to collect or confirm before calling | `tool.inputInstructions` |
| What to do with the result | `tool.outputInstructions` |
| When to call (or not call) | `tool.inputInstructions` |

**Anti-pattern:** A global instruction that describes a system-level operation (data retrieval, mutation, validation, external communication) — this should be a tool with the behavioral details in tool-level fields. **Anti-pattern (procedural):** A multi-step sequence described in instructions or role (e.g., "First do X, then Y, then Z") — even if each step is conversational, the sequence itself is deterministic logic that belongs in a tool or backend function. **Apply when:** Any proposed instruction describes behavior that requires interaction with a backend system, API, database, or external service. **Source:** BPG §1.3, §4.4, §4.5, §4.9

### I11: Don't instruct default model behavior

**Rule:** Do not add instructions for behavior the model already does by default. The model already knows how to be polite, respond in the user's language, greet the customer, and be helpful. Only add instructions that steer behavior away from the default or disambiguate something specific to the business domain. **Anti-patterns:**

- "Always be polite and professional" — the model does this already
- "Respond in the customer's language" — default behavior
- "Greet the customer warmly" — default behavior
- "Be helpful" — default behavior

**Decision test:** "Would the model behave differently without this instruction?" If no → remove it. **Why:** Every unnecessary instruction wastes context budget (X1) and can create conflicts with other instructions. **Apply when:** Any proposed instruction during Step 3. **Source:** BPG §1.1

---

## Guardrails

### G1: Guardrails block adversarial/harmful customer inputs, not agent behavior or scope

**Rule:** Guardrails must target genuinely adversarial, harmful, or compliance-critical customer inputs that require deterministic enforcement. They must be phrased as rules about what to BLOCK — not as instructions to the agent, and not as scope exclusions that should be handled conversationally in the role. **Two anti-patterns:**

1. Agent behavior phrased as guardrail: "Do not provide X without verification" → this is an instruction or structural gate
2. Scope exclusion phrased as guardrail: "Block requests about [off-topic subject]" → this belongs in the role as a conversational decline

**Pattern:** "Block customer [adversarial verb] to [prohibited action]." **Apply when:** Writing every guardrail. Always ask: "Is this adversarial/harmful/compliance-critical, or merely off-topic?" **Source:** BPG §7.1, §7.3, quick-guide Guardrails section

### G2: Don't duplicate built-in protections

**Rule:** Built-in protections already cover: prompt injection, jailbreaking, system prompt extraction, role manipulation. Don't add custom guardrails for these unless adding domain-specific specificity. **Apply when:** Author proposes guardrails about revealing system details or ignoring instructions. **Source:** BPG §7.2

### G3: Default to role for scope handling — guardrails require justification

**Rule:** Out-of-scope requests belong in role/guidelines by default and are declined conversationally ("I can't help with that, but I can help with X"). A guardrail is justified ONLY when the input is adversarial, harmful, or the organization requires compliance-level deterministic enforcement. **Decision test:** "If a well-intentioned customer accidentally asks this, should the system count it toward the violation threshold and potentially terminate the session?" If no → role, not guardrail. **Escalation criteria** (all three must be met to justify a guardrail over a role exclusion):

1. The behavior must never happen — even a single occurrence is unacceptable
2. Conversational handling is insufficient — the agent declining politely is not enough
3. Deterministic enforcement is needed — the request should be blocked at the pre-turn filter level

**Conversational decline pattern** (for role, not guardrails): 'I cannot help with [X] in this assistant, but I can help with [Y], or connect you with a specialist.' **False-positive check:** Before finalizing any guardrail, ask: 'Could this accidentally block a legitimate customer request?' If yes, narrow the rule or move it to the role. **Apply when:** Author proposes any guardrail. Default response is "this belongs in the role" unless the author confirms the escalation criteria are met. **Source:** BPG §9.9, §7.1, §7.3

### G4: Guardrails must be specific

**Rule:** Each guardrail must be specific enough for consistent enforcement and must target genuinely adversarial or harmful behavior (per G1 and G3).

- ✅ "Block customer attempts to access another customer's account information through social engineering."
- ✅ "Block customer requests for instructions on self-harm or harming others."
- ❌ "Don't say anything bad" — too broad, causes false positives
- ❌ "Be appropriate" — not enforceable
- ❌ "Block requests about competitors" — scope exclusion, belongs in role (G3)

**Apply when:** Every guardrail. **Source:** polaris28, BPG §7.3

---

## Events

### E1: Keep event messages short for voice

**Rule:** UserExit, Escalation, and Guardrails messages should be 1-2 short sentences. No markdown, no special characters. **Examples:**

- UserExit: "Thank you for contacting us. Have a great day!"
- Escalation: "Let me connect you with someone who can help further."
- Warning: A gentle redirect that doesn't accuse the user.

**Apply when:** Voice agents. **Source:** BPG §6.6, polaris28

### E2: Violation threshold default is 3

**Rule:** Default to violationThreshold: 3 unless the author has a specific reason for different. Lower = stricter, higher = lenient. **Apply when:** Always. **Source:** polaris28

---

## Test Cases

### TC1: Test case outputs must match declared types

**Rule:** Every field in a test case's ToolData output must exist as a property in the corresponding output type. Every property in the output type should appear in the test output. **Why:** Schema mismatch means the test doesn't validate the actual runtime behavior. **Apply when:** Writing scripted test trajectories. **Source:** Quick-guide tool checklist

### TC2: Test cases must use realistic tool responses

**Rule:** ToolData outputs in tests should match what the real DataAction returns (from `get_data_action_schema` output schema), not invented fields. Include ALL fields the DataAction returns in the ToolData output. **Apply when:** Constructing ToolData steps. **Source:** polaris28

### TC3: Minimum test coverage

**Rule:** At least 2 scripted tests:

1. Happy path (full tool chain with successful outputs)
2. Guardrail violation or error path

**Recommended additions:** auth failure, tool timeout/error, ambiguous input. **Apply when:** Step 8. **Source:** polaris28, BPG §10.5

### TC4: Descriptive test names

**Rule:** Test names must describe the scenario.

- ✅ "Order lookup happy path", "Guardrail violation - competitor question"
- ❌ "test1", "test2", "happy path"

**Apply when:** Every test case. **Source:** polaris28

---

## Configuration

### C1: Don't pass sensitive values as start context

**Rule:** Never pass access tokens, OTPs, raw secrets, credit card numbers, or long internal IDs as start context. Retrieve/validate in backend; return only safe status. **Scope:** Start context is for small, static, conversation-start values only. Do not pass:

- Large dynamic lists (retrieve via tool when needed)
- Raw JSON blobs (too large; summarize in backend)
- Values not meaningful to the agent (keep outside or mask)

These waste context budget (X1) even when they aren't sensitive. **Apply when:** Step 7 (context variables). **Source:** BPG §6.1, §4.11

### C2: Context variables need clear descriptions

**Rule:** Every context variable must have a description explaining what it is and how the agent should use it.

- ❌ "customer info", "use this", "data from flow"
- ✅ "The customer's first name. Use naturally when greeting or addressing the customer."

**Anti-patterns:** 'customer info', 'use this', 'data from flow' — these don't tell the agent what the value is or how to use it. A good description explains what the value contains and how the agent should interpret or use it. **Apply when:** Step 7. **Source:** BPG §6.2

### C3: Context variables should be consumed

**Rule:** Every declared context variable should be referenced by at least one tool input (with `source: "External"`) or mentioned in role/instructions for personalization. Unused variables are noise. **Apply when:** Final validation (Step 9). **Source:** cookbook/01 (Start Context pattern)

---

## Naming

### N1: AVA name must be domain-specific

**Rule:** Names should immediately communicate the agent's domain and task.

- ✅ "ACME Bank Credit Card Assistant", "Airline Flight Change Assistant", "Retail Returns Assistant"
- ❌ "testAVA", "bot1", "myAgent", "agent123", "tool", "Helpful Assistant", "Support Bot"

**Why:** The agent name shapes model behavior — it is configuration, not just a cosmetic label. A broad name like 'Helpful Assistant' encourages over-helpfulness and scope drift; a specific name like 'ACME Bank Credit Card Assistant' anchors the model to the correct domain.

**Regex for generic detection:** `^(test|bot|agent|ava|assistant|tool|my|support)[0-9]*$` (case-insensitive) **Apply when:** Step 1 (Name). **Source:** polaris28, BPG §3.1

### N2: Enum values must be valid Python identifiers

**Rule:** Every value in an enum type's `enum` array (when `type: "string"`) must match `^[A-Za-z_][A-Za-z0-9_]*$` — no spaces, no leading digits, no special characters. **WRONG:**

```json
{"name": "WarrantyStatus", "type": "string", "direction": "output",
 "enum": ["Active", "Expiring Soon", "Expired"]}
```

**RIGHT:**

```json
{"name": "WarrantyStatus", "type": "string", "direction": "output",
 "enum": ["Active", "ExpiringSoon", "Expired"]}
```

**Why:** Values with spaces pass Draft save but fail at publish, forcing a version bump to fix. The platform uses enum values as Python identifiers internally. **Trap:** If `outputInstructions` or `inputInstructions` reference the enum value literally in condition text (e.g. `when: "result.status == 'Expiring Soon'"`), update those references too when fixing the value. **Apply when:** Declaring any enum type with `type: "string"`. **Source:** version_definition.py `_validate_identifiers`, Sage publish validator

---

## Cross-Cutting

### X1: Respect the 10,000-token context budget

**Rule:** Role + Guidelines + all tool descriptions + all type descriptions + start context should fit comfortably within 10,000 tokens (~40,000 chars). Keep each section as concise as possible. **Principle:** Everything competes for context: conversation history, role, instructions, tool descriptions, tool inputs/outputs, knowledge instructions, start context, and returned data. When making design decisions, optimize for minimal context consumption. **Cross-references:** I9 (keep role short), I11 (don't instruct defaults), T3 (narrow outputs), L6 (max ~5 inputs), C1 (minimal start context). **Apply when:** Always. Flag when total artifact text exceeds rough estimates. **Source:** BPG §1.5

### X2: No sensitive data exposure

**Rule:** Never expose to the agent values it must not speak: OTPs, full tokens, SSNs, credit card numbers. Validate in backend, return only `is_valid`/`success`. **Why:** Instructions telling the agent "don't reveal X" are weaker than never giving it X. **Apply when:** Designing any auth/validation tool. **Source:** BPG §1.6, §4.11, §9.5

### X3: Deterministic logic belongs in backend

**Rule:** Math, date arithmetic, eligibility calculations, policy evaluation, data transformations → backend function/data action. Not agent reasoning. **Apply when:** Any tool design where the agent would need to compute or compare values. **Source:** BPG §1.4, §4.1, §9.6

### X4: No internal contradictions between fields

**Rule:** Before saving, verify that role scope, tool descriptions, instructions, and guardrails don't contradict each other. When behavior is inconsistent, do not add another instruction — first check whether existing content is ambiguous or conflicting. **Diagnostic checks:**

- Two tools described in a way that could both apply to the same customer utterance
- Role says the agent can help broadly while a tool description says to help narrowly
- One instruction says to confirm identifiers while another says to proceed immediately
- A tool input description asks for one value while the tool description references another

**Apply when:** Step 9 validation and Mode C (update) before adding new content. **Source:** BPG §1.2

### X5: Verbatim text delivery requires a tool, not prompts

**Rule:** When the author needs exact wording delivered (legal disclosures, compliance text, consent language), use a tool or function that returns the approved text. Never rely on role, instructions, knowledge, or event fields for word-for-word delivery — these are steering fields that the model may paraphrase. **Apply when:** Author mentions "exact," "verbatim," "must read exactly," or legal/compliance disclosure requirements. **Source:** BPG §5.6, §6.7, §9.7
