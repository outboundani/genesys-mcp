# 7 Keeping the agent on-topic (scope containment and guardrails)

If the `role` does not explicitly state what is out of scope, the agent may invent a flow that does not match the declared `types` or `tools`. In a VersionDefinition, tell the model what it cannot do, not just what it can.

## Scope via `role` — positive and negative examples

Put broad scope in the agent's `role`, including negative examples of capabilities that are out of scope. The `role` field is the agent persona / high-level setting; it is the most influential lever for keeping the agent on-topic.

```json
{
  "role": "You help customers with orders. The ONLY identifier you collect from the customer is the order ID. Do NOT ask for the customer's email, phone number, full name, billing address, date of birth, or any other personally identifying information. If the customer volunteers one of those, politely redirect them: tell them you only need the order ID and ask for it.",
  "instructions": [
    "Greet the customer and ask for their order ID before doing anything else."
  ]
}
```

Without negative examples — for instance, a thin `role` like `"You are a helpful order assistant"` — the agent may offer help with something it cannot actually do. For example, asking for an email "for account verification", which isn't actually required and is a capability that doesn't exist anywhere in the VersionDefinition's `tools` or `types`.

Notes on what Ava injects automatically (you do **not** need to author these):

- Three built-in global instructions are appended to `instructions[]` at publish time (covering capability disclosure, persona stability, and response length). Do not duplicate them.
- A per-turn language instruction is prepended at runtime.

## Scope via tool surface

The `tools[]` and `types[]` graph is itself a scoping mechanism. Anything that is not declared cannot be called, and any tool whose parameter type can only be produced by another tool forces the agent to complete that earlier step first.

The canonical gating pattern is to model an authentication token as an output-only type that some upstream tool returns, then require that type as an input on every gated tool downstream. Anything that does not depend on the token is automatically ungated. Two interchangeable shapes are common:

- An **opaque-token struct** with `direction: "output"` — the shape chapter 01 uses; the platform seeds `must_copy=true` on output-direction types so the value is treated as trusted provenance, while the only field is a meaningless gate token.

The example below uses the opaque-token struct from chapter 01.

```json
{
  "types": [
    {
      "name": "OpaqueToken",
      "type": "string",
      "direction": "output",
      "description": "Opaque proof-of-authentication token. Do not inspect, reveal, or derive meaning from this value."
    },
    {
      "name": "AuthToken",
      "type": "object",
      "direction": "output",
      "description": "Proof of authentication. Contains only an opaque gate token.",
      "properties": [
        { "name": "opaque_token", "type": "OpaqueToken", "required": true }
      ]
    },
    {
      "name": "Region",
      "type": "string",
      "direction": "input",
      "description": "ISO region code supplied by the caller, e.g. 'us-west'."
    },
    {
      "name": "StoreHours",
      "type": "object",
      "direction": "output",
      "description": "Opening hours for a given region.",
      "properties": [
        { "name": "open", "type": "string", "required": true, "description": "Opening time, HH:MM 24h." },
        { "name": "close", "type": "string", "required": true, "description": "Closing time, HH:MM 24h." }
      ]
    },
    {
      "name": "AccountBalance",
      "type": "object",
      "direction": "output",
      "description": "Authenticated caller's account balance.",
      "properties": [
        { "name": "currency", "type": "string", "required": true, "description": "ISO 4217 currency code." },
        { "name": "amount", "type": "number", "required": true, "description": "Current balance amount." }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "Get Store Hours",
      "description": "Return store hours for the caller's region.",
      "output": "StoreHours",
      "inputs": [
        { "targetName": "region", "type": "Region", "source": "User", "required": true }
      ]
    },
    {
      "type": "DataAction",
      "name": "Get Account Balance",
      "description": "Return the authenticated caller's account balance.",
      "output": "AccountBalance",
      "inputs": [
        { "targetName": "auth_token", "type": "AuthToken", "source": "ToolOutput", "required": true, "mapping": ["AuthToken", "opaque_token"] }
      ]
    }
  ]
}
```

Two scoping properties fall out of this shape automatically:

- **Ungated tools** (`Get Store Hours`) take only `User`-sourced inputs of plain authored types, so the model can call them at any point.
- **Gated tools** (`Get Account Balance`) require an opaque token mapped from `AuthToken` with `source: "ToolOutput"`. Because `AuthToken` is a `direction: "output"` type, the model can only obtain it by calling the upstream authentication tool first — the type graph itself enforces the ordering, no extra instruction needed.

The same principle generalizes: scope the agent by what `tools` you register and what `types` they require. If a capability is not in `tools[]`, the model cannot perform it.

## Guardrails for stronger scoping

`guardrails.custom[]` is the place to declare domain-specific block rules. Each entry is an `instruction` plus an `enabled` flag, and each one becomes a pre-turn input filter at runtime: it evaluates the user's message before the agent responds and blocks the reply if any rule fires.

```json
{
  "guardrails": {
    "custom": [
      { "instruction": "Never confirm or deny account ownership.", "enabled": true },
      { "instruction": "Never discuss pricing for non-retail customers.", "enabled": true }
    ]
  }
}
```

Ava augments this set with a fixed set of built-in defender rules at publish time — covering internal-implementation leakage, persona manipulation, and response manipulation — and turns on the platform's built-in defenses. You do **not** declare those built-ins in `guardrails.custom[]`; only add domain-specific rules.

### Customising the blocked-reply messages

When a rule fires, Ava produces a substitute reply using the messages configured on a `Guardrails` event. Both messages have defaults; only override them if you want different wording.

```json
{
  "events": [
    {
      "type": "Guardrails",
      "violationThreshold": 3,
      "message": "I can't help with that. Is there anything else I can help you with?",
      "violationThresholdCrossedMessage": "I'm sorry, but I can't help you with that."
    }
  ]
}
```

| Field | Default | Purpose |
| --- | --- | --- |
| `violationThreshold` | `3` | Number of violations before the conversation hits the threshold-crossed state. |
| `message` | `"Sorry I cannot answer that. Is there anything else I can help you with?"` | Reply sent on each individual blocked turn. |
| `violationThresholdCrossedMessage` | `"I'm sorry, but I can't help you with that."` | Reply sent once the violation count crosses the threshold. |

You can omit the `Guardrails` event entirely if the defaults are acceptable; Ava still wires the blocked-reply behavior in automatically.

## Layering: `role` first, guardrails second

A vague `role` paired with tight `guardrails.custom[]` rules can still produce off-topic conversations, because guardrails only react to messages that match a rule — they don't shape the agent's intent. Prioritize scoping in the `role` (and reinforce it through the `tools[]` / `types[]` surface), then use `guardrails.custom[]` for stronger constraints and edge-case handling.
