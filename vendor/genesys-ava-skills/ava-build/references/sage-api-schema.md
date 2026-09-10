# Sage API Schema

Transformation rules from design artifact format to Sage API VersionDefinition format. The MCP tool `create_version` applies these automatically via Pydantic validation. This reference explains WHY each transformation exists and documents critical constraints.

## Transformation Rules

| # | Design Artifact field | Sage API field | Rule |
| --- | --- | --- | --- |
| 1 | `instructions: [{"content":"..."}]` | `instructions: ["..."]` | Plain strings — API rejects objects |
| 2 | `guardrails: [{rule, enabled}]` | `guardrails: {rules: [{rule, enabled}]}` | Must be wrapped in `{rules:[]}` envelope |
| 3 | `events: {userExit:{}, escalation:{}, guardrails:{}}` | `events: [{type:"UserExit",...}, ...]` | Typed array with capitalized type tags |
| 4 | `types: ["Messaging"]` | `types: [{name, type, direction}]` | TypeDefinition objects derived from tool I/O — NOT channel strings |
| 5 | `tools[].inputVariables: [{name, description}]` | `tools[].inputs: [{name, targetName, type, source, required}]` | Expanded to full input schema |
| 6 | `tools[].preInstructions: "string"` | `tools[].inputInstructions: ["string"]` | Renamed + wrapped in array |
| 7 | `tools[].outcomeInstructions: "string"` | `tools[].outputInstructions: [{"when":"True","then":"..."}]` | Renamed + array of `{when, then}` objects |
| 8 | (missing) | `tools[].output: "TypeName"` | Required for DataActions that return data consumed by other tools |

## Tool Input Source Values

| Source | When to use |
| --- | --- |
| `User` | Value collected from the caller during conversation |
| `ToolOutput` | Value produced by a previous tool call (requires `mapping` field) |
| `External` | Value from a startContext variable |
| `ToolInput` | Value passed through from another tool's input |

## ToolOutput Mapping (Critical)

When a tool input has `"source": "ToolOutput"`, it MUST include a `mapping` field:

```json
{
  "name": "authToken",
  "targetName": "AuthToken",
  "type": "AuthToken",
  "source": "ToolOutput",
  "required": true,
  "mapping": ["AuthToken", "session_token"]
}
```

Rules:

- `mapping` is an array of strings: `["OutputTypeName", "fieldWithinThatOutput"]`
- The `type` field MUST reference a type with `"direction": "output"` (NOT an input type)
- The referenced output type MUST be declared as the `output` of another tool in the definition
- The second element in mapping must be a field name that exists in the output type's `properties` array

## Linked Tools Worked Example

The most common (and most error-prone) pattern: an **authentication** tool returns a token that a **second** tool needs as input. Concretely: `Authenticate User` returns `session_token`, and `Get Account Details` needs that value as its `authToken` input.

Follow these steps exactly:

**Step 1 — Producing tool declares its output type.** The `Authenticate User` tool sets `output: "AuthResult"`, and `AuthResult` is declared in `types` with `direction: "output"` and `properties` matching the DataAction's success schema:

```json
{
  "name": "AuthResult",
  "type": "object",
  "direction": "output",
  "properties": [
    {"name": "success", "type": "boolean"},
    {"name": "message", "type": "string"},
    {"name": "session_token", "type": "string"}
  ]
}
```

**Step 2 — Consuming tool's input references the producer's output via `mapping`.** The `Get Account Details` tool has an input whose `source` is `"ToolOutput"`. Its `type` references the producer's OUTPUT type (`AuthResult`), and `mapping` points at `[OutputTypeName, fieldName]`:

```json
{
  "targetName": "authToken",
  "type": "AuthResult",
  "source": "ToolOutput",
  "required": true,
  "mapping": ["AuthResult", "session_token"]
}
```

The `type` references the output type `AuthResult` (per the rule above — a ToolOutput input's `type` must reference an `direction: "output"` type), and `mapping`'s second element (`session_token`) is a field within that output type's `properties`.

Full picture — two linked tools plus their types:

```json
{
  "tools": [
    {
      "name": "Authenticate User",
      "type": "DataAction",
      "description": "Verifies the customer's identity using their login code.",
      "targetId": "custom_-_372c6dce-8732-4d38-a58f-edb178ba1f3a",
      "targetName": "sofia-bankg-voice-login",
      "inputInstructions": ["Ask for the login code before calling this tool"],
      "inputs": [
        {"targetName": "code", "type": "LoginCode", "source": "User", "required": true}
      ],
      "outputInstructions": [
        {"when": "True", "then": "If authentication succeeded, confirm the customer's name; otherwise ask them to retry."}
      ],
      "output": "AuthResult"
    },
    {
      "name": "Get Account Details",
      "type": "DataAction",
      "description": "Retrieves all account information for the authenticated customer.",
      "targetId": "custom_-_2f7da2d2-2715-42bd-9357-d4fd61c595d5",
      "targetName": "sc-get-all-account-details",
      "inputInstructions": ["Only call after a successful authentication"],
      "inputs": [
        {"targetName": "authToken", "type": "AuthResult", "source": "ToolOutput", "required": true, "mapping": ["AuthResult", "session_token"]}
      ],
      "outputInstructions": [
        {"when": "True", "then": "Present each account's type and balance clearly."}
      ],
      "output": "AccountResult"
    }
  ],
  "types": [
    {"name": "LoginCode", "type": "string", "direction": "input"},
    {
      "name": "AuthResult", "type": "object", "direction": "output",
      "properties": [
        {"name": "success", "type": "boolean"},
        {"name": "message", "type": "string"},
        {"name": "session_token", "type": "string"}
      ]
    },
    {
      "name": "AccountResult", "type": "object", "direction": "output",
      "properties": [
        {"name": "success", "type": "boolean"},
        {"name": "user_email", "type": "string"},
        {"name": "total_balance", "type": "number"},
        {"name": "currency", "type": "string"},
        {"name": "accounts", "type": "array"}
      ]
    }
  ]
}
```

Common mistakes that cause publish failures:

- Setting the consuming input's `type` to a plain input type instead of the producer's `direction: "output"` type. A ToolOutput input's `type` references the OUTPUT type; the specific field is selected by `mapping`'s second element.
- Forgetting `direction: "output"` on the producer's output type.
- `mapping` second element naming a field that isn't in the output type's `properties`.
- Declaring the output type without `properties` when a field is referenced via `mapping`.

## Type Definitions

Types represent the data flowing in and out of tools.

```json
{
  "name": "OrderId",
  "type": "string",
  "direction": "input"
}
```

- `direction: "input"` — used in `tools[].inputs[].type` for variables the tool receives
- `direction: "output"` — used in `tools[].output` for data the tool returns
- `direction: "agentInput"` — start context variables (see below)
- `direction: "agentOutput"` — end context variables (see below)
- Output types MUST declare `properties` matching the actual Data Action response schema when they need to be referenced via `mapping`
- Use empty `properties: []` only if you don't need to reference specific fields

Channel type strings (e.g., `"Messaging"`, `"Voice"`) from the design artifact are NOT sent to the Sage API. The `types` field contains only TypeDefinition objects derived from tool I/O analysis.

### Start Context Variables (agentInput)

Context variables pre-populated at conversation start MUST follow this structure:

1. Declare a standalone value type (PascalCase, no `direction`) with `description` and `userUtteranceSubstring: false`:
2. Declare exactly ONE `InputData` type with `direction: "agentInput"`, `type: "object"`, and `properties` referencing the value types via `snake_case` property names.

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

- Always use `InputData` as the agentInput object name.
- Property names on `InputData` use `snake_case`.
- The referenced value type uses PascalCase and has NO `direction` field.
- Set `userUtteranceSubstring: false` on the value type unless it can be extracted from speech.
- Do NOT declare agentInput variables as top-level types with `direction: "agentInput"` directly — they must be properties on the `InputData` object.

## Reserved Keywords

Sage rejects DataAction input/output **field names** that exactly match these reserved keywords (case-sensitive):

```
Boolean  Dynamic  Integer  List  Map  None  Number  String  Unknown
type  dict  tuple  list
```

These names come from the DataAction's own schema (fetched via `get_data_action_schema`), so you cannot simply rename them on the AVA side — the field name must match the DataAction exactly. Handle them per the procedure in the design skill (Step 5):

- **Reserved name on a REQUIRED input** → the AVA cannot call the tool without it and the name can't be changed → the author must create a new DataAction without the reserved field name.
- **Reserved name on an OPTIONAL input** → omit that input and inform the author.
- **Reserved name on an OUTPUT field** → skip that field in the Sage type mapping (do not declare it as a property) and inform the author the field is being ignored.

## Events Format

Events are a typed array (not a nested object):

```json
[
  {"type": "UserExit", "message": "Thank you for calling. Goodbye!"},
  {"type": "Escalation", "message": "Let me connect you with an agent."},
  {
    "type": "Guardrails",
    "message": "I can only help with order-related questions.",
    "violationThreshold": 3,
    "violationThresholdCrossedMessage": "Transferring you to a human agent now."
  }
]
```

Field names for Guardrails event:

- `message` — warning shown on each violation (NOT `warningMessage`)
- `violationThreshold` — integer 1–10
- `violationThresholdCrossedMessage` — shown when threshold is crossed (NOT `thresholdCrossedMessage`)

## Correct Payload Example

```json
{
  "definition": {
    "role": "You are a helpful order assistant...",
    "instructions": [
      "Greet the caller warmly",
      "Confirm the order number before looking it up"
    ],
    "guardrails": {
      "rules": [
        {"rule": "Do not discuss competitor pricing", "enabled": true}
      ]
    },
    "tools": [
      {
        "name": "lookup_order",
        "type": "DataAction",
        "description": "Looks up order status by order ID",
        "targetId": "da-uuid-here",
        "targetName": "Order Lookup Action",
        "inputInstructions": ["Ask for the order number before calling this tool"],
        "inputs": [
          {
            "name": "orderId",
            "targetName": "OrderId",
            "type": "OrderId",
            "source": "User",
            "required": true
          }
        ],
        "outputInstructions": [
          {"when": "True", "then": "Tell the caller the order status and ETA. If the lookup failed, apologize and offer to escalate."}
        ],
        "output": "OrderResult",
        "errors": [
          {"code": "NOT_FOUND", "message": "Order not found", "handling": "Ask the caller to verify the order number"}
        ]
      }
    ],
    "types": [
      {"name": "OrderId", "type": "string", "direction": "input"},
      {"name": "OrderResult", "type": "object", "direction": "output"}
    ],
    "events": [
      {"type": "UserExit", "message": "Thank you for calling. Goodbye!"},
      {"type": "Escalation", "message": "Let me connect you with an agent."},
      {"type": "Guardrails", "message": "I can't help with that.", "violationThreshold": 3, "violationThresholdCrossedMessage": "Transferring you now."}
    ]
  }
}
```

## API Notes

- **POST creates a new version.** PATCH updates an existing version.
- **PATCH requires the full definition.** Partial updates are not supported — always send role, instructions, guardrails, tools, types, and events.
- **PUT is NOT supported.** Use POST for creation, PATCH for updates.
- **`required: true` on inputs** is validated by the publish job — set it for mandatory Data Action fields.
- **Publish job payload:** `{"virtualAgentVersion": {"status": "ProductionReady"}}`
- **Publish job polling:** GET the job URL every 3s, max 120s. Terminal statuses: `Succeeded`, `Failed`.

## Known Issues

**Guardrails not persisting in UI:** The API accepts `{rules:[...]}` but the published spec display may show `custom: []`. This is a known Sage API behavior — the payload format is correct, the display is misleading. Do not change the format.

**inputInstructions / outputInstructions field names:** Confirmed through live testing. If the API returns a 400 on these fields, check with the Sage API team for current field names.

**outputInstructions `when` must be `True`:** Each `outputInstructions` entry is a `{"when": "...", "then": "..."}` object. Sage does NOT yet support conditional expressions in `when` — it must always be the literal string `"True"`. Any other value (including natural-language conditions like `"authentication is successful"` or expressions like `"success == true"`) causes the publish job to FAIL with:

```json
{"message": "Invalid expression in outputInstructions", "code": "bad.request", "status": 400,
 "details": [{"fieldName": "definition.tools[0].outputInstructions[0].when"}]}
```

Encode any conditional logic in the `then` text instead, e.g. `{"when": "True", "then": "If authentication succeeded, confirm the customer's name; otherwise ask them to retry."}`

**KnowledgeBase / KnowledgeSetting `outputInstructions` — two slots only:** The AVA UI exposes exactly two output-instruction fields for native knowledge tools:

1. **No-result** — what to say when the lookup returns nothing useful.
2. **With-result** — what to say when the lookup returns an answer.

The platform supplies defaults for both cases. Author `outputInstructions[]` only to override a default you want to change — you do not need to author both if the platform default is acceptable. Do **not** author more than two entries; the UI and platform model do not support additional output-instruction slots for these tool types. Put any extra delivery guidance (step-by-step pacing, voice phrasing, escalation offers) inside the `then` text of the relevant slot, or move pre-call scope guidance to `inputInstructions[]`.

```json
{
  "name": "Search Product FAQ",
  "type": "KnowledgeBase",
  "description": "Search the product FAQ knowledge base.",
  "targetId": "<kb-uuid>",
  "targetName": "product-faq",
  "inputInstructions": [
    "Use for product how-to questions. Do NOT use for billing or account issues."
  ],
  "outputInstructions": [
    {
      "when": "True",
      "then": "Apologize that you could not find an answer and offer to transfer to a specialist."
    },
    {
      "when": "True",
      "then": "Answer using only the retrieved content. Keep the reply concise and ask whether it resolved the issue."
    }
  ]
}
```

For `DataAction` tools (including KB lookups that return structured records), there is no two-slot UI limit — you may author multiple `outputInstructions[]` entries, but `when` must still be `"True"` for every entry, so branch on result shape inside `then` (see the lookup_order example above).

**Output type properties validation:** The publish job validates that declared properties exist in the Data Action's output schema. Mismatched property names cause publish failures with a generic "validation failed" error — check the Data Action schema carefully.
