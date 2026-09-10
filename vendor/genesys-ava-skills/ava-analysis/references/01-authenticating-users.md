# 1 Authenticating users

There are two main ways to verify the user: rely on a trusted identifier the surrounding system already supplies through **Start Context**, or collect an identifier from the user directly inside the conversation. Pre-authentication via Start Context is recommended whenever the calling system can supply a trustworthy identifier, because it eliminates a collection step and gets the user to their request more quickly. Pre-authentication should work in conjunction with manual collection for extra security or as a fallback.

In an Ava VersionDefinition, the recipe for both flows is the same:

- Define an `AuthToken` struct in `types[]` with `direction: "output"` and a single opaque token property so it can only be produced by a tool.
- Define an authentication tool in `tools[]` that returns `AuthToken`.
- Have every tool that should be gated declare a `ToolOutput` input mapped from `AuthToken`'s opaque token property. Ungated tools simply omit it.

The platform handles tool-call wiring, the publish-time computation of which types are "must copy", and the runtime injection of preconditions and global behaviors — none of that needs to appear in the version payload.

# Pre-authenticating the user via Start Context

**Start Context** is Ava's name for the reserved `InputData` struct: a typed payload the surrounding system attaches to the session before the first user turn. Each property on `InputData` is a primitive aliased type and is referenced from a tool input with `source: "External"`, so the agent can run a tool against externally supplied values without ever prompting the user for them. Anything the calling system already knows about the user — a member ID forwarded from a portal, a CRM customer key, a verified phone number, a partner-issued token — belongs in Start Context.

If a Start Context property is sufficient to resolve an `AuthToken` deterministically, the user is authenticated before the conversation begins. The model sees the `AuthToken` already in the conversation history and can skip directly to greeting the user.

The VersionDefinition fragment for this flow looks like:

```json
{
  "types": [
    {
      "name": "CallerPhone",
      "type": "string",
      "direction": "input",
      "description": "Verified phone number forwarded from the calling system. Sourced from Start Context, with `fallbackToUser` letting the agent collect it manually if Start Context did not supply it."
    },
    {
      "name": "InputData",
      "type": "object",
      "properties": [
        { "name": "caller_phone", "type": "CallerPhone" }
      ]
    },
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
      "description": "Proof of authentication. Contains only an opaque gate token; read user data from the backend that fulfils gated tools.",
      "properties": [
        { "name": "opaque_token", "type": "OpaqueToken", "required": true }
      ]
    },
    {
      "name": "StartContextAuthFailure",
      "type": "DataActionHttpError",
      "statusCodes": [404],
      "defaultInstruction": "No account matches the identifier provided in Start Context. Tell the user and offer to collect a confirmation code instead.",
      "description": "The Start Context identifier could not be resolved to an account."
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "authenticate",
      "description": "Authenticate the user using the identifier supplied in Start Context.",
      "inputs": [
        {
          "targetName": "caller_phone",
          "type": "CallerPhone",
          "source": "External",
          "required": true,
          "fallbackToUser": true
        }
      ],
      "output": "AuthToken",
      "errors": [
        { "type": "StartContextAuthFailure" }
      ],
      "targetId": "<authenticate-data-action-id>",
      "targetName": "authenticate"
    }
  ]
}
```

Notes on the shape this takes in the contract:

- `InputData` is reserved. The platform auto-sets its `direction` to `agentInput`, requires each property to reference a separate primitive aliased type (not an enum, not a base Sage type), and does not allow properties to be marked `required`. Property names must be lowercase with underscores (e.g. `customer_id`, not `customerId`).
- The `authenticate` tool consumes the Start Context value with `source: "External"`. External inputs that are `required` must set `fallbackToUser: true` so the agent can ask the user for the value if the surrounding system did not supply it — that single flag is what makes Start Context degrade gracefully into manual collection.

`AuthToken` intentionally carries only an opaque token because adding user-data fields would add tokens and latency to every gated tool that accepts it. Read user data from the backend system that fulfils the tool instead — the platform never needs to understand the token's contents.

The pattern generalizes beyond auth. Any deterministic lookup the surrounding system can perform up front can flow in through Start Context the same way — pulling up the user's account record, their open tickets, loyalty tier, or recent order status. The mechanism is identical: declare a primitive aliased type, expose it as a property on `InputData`, and consume it from a tool with `source: "External"`.

This is also the default error-signaling pattern. Whenever a tool has a recoverable failure mode, define an error type in `types[]` (`"type": "DataActionHttpError"`) and reference it from `errors[]` on the tool. The error type's `defaultInstruction` is what the agent reads at runtime when the backend returns a matching `statusCodes[]` value — there is no need to author the equivalent of a Python `raise`.

### Notes on Ava-injected defaults

Several things the author does **not** declare in the VersionDefinition for this flow:

- A `must_copy` flag on `AuthToken`. The platform computes it at publish time from `direction: "output"`.
- The three-field shape (`user_message`, `error_code`, `status`) that the error type takes on at publish time. Authors declare only the error type's `name`, `statusCodes`, `defaultInstruction`, and `description`; Ava synthesizes the struct.

## Collecting user input manually

The recommended pattern for collecting identifiers for authentication is a 3-step process:

- An aliased type with `userUtteranceSubstring: true` that captures the user's exact words.
- A validation output struct returned by a validation tool that normalizes the raw value.
- The `AuthToken` struct returned on successful authentication.

A VersionDefinition snippet that wires this together:

```json
{
  "types": [
    {
      "name": "InputMemberId",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "Member ID as spoken/typed by the user - extracted verbatim."
    },
    {
      "name": "ValidatedMemberId",
      "type": "object",
      "direction": "output",
      "description": "Member ID after format validation. Normalized to canonical form.",
      "properties": [
        { "name": "member_id", "type": "string", "required": true }
      ]
    },
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
      "description": "Proof of authentication. Contains only an opaque gate token; read user data from the backend that fulfils gated tools.",
      "properties": [
        { "name": "opaque_token", "type": "OpaqueToken", "required": true }
      ]
    },
    {
      "name": "AuthFailure",
      "type": "DataActionHttpError",
      "statusCodes": [400, 404],
      "defaultInstruction": "The member ID could not be validated. Ask the user to double-check and provide a revised value.",
      "description": "Member ID validation or lookup failed."
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "validate_member_id",
      "description": "Normalize and validate the member ID format.",
      "inputs": [
        {
          "targetName": "input_id",
          "type": "InputMemberId",
          "source": "User",
          "required": true
        }
      ],
      "output": "ValidatedMemberId",
      "errors": [
        { "type": "AuthFailure" }
      ],
      "targetId": "<validate-member-id-action-id>",
      "targetName": "validate_member_id"
    },
    {
      "type": "DataAction",
      "name": "authenticate",
      "description": "Verify the user's identity using a validated member ID.",
      "inputs": [
        {
          "targetName": "member_id",
          "type": "ValidatedMemberId",
          "source": "ToolOutput",
          "required": true,
          "mapping": ["ValidatedMemberId", "member_id"]
        }
      ],
      "output": "AuthToken",
      "errors": [
        { "type": "AuthFailure" }
      ],
      "targetId": "<authenticate-data-action-id>",
      "targetName": "authenticate"
    }
  ]
}
```

How the three steps line up with the JSON:

- `InputMemberId` has `userUtteranceSubstring: true` and `direction: "input"`. At publish time the platform binds this to a verbatim-substring constraint so the model is forced to copy the user's words rather than paraphrase them.
- `ValidatedMemberId` and `AuthToken` both use the same AVA gating mechanism: `direction: "output"` means only a tool can produce the value, and Ava marks it `must_copy` so downstream tools receive it unchanged. They are sequential steps in the auth chain — `ValidatedMemberId` gates `authenticate` through `mapping: ["ValidatedMemberId", "member_id"]`, and `AuthToken` gates every later gated action through `mapping: ["AuthToken", "opaque_token"]` — not two interchangeable patterns.

`validate_member_id` consumes a `userUtteranceSubstring` input directly from the user (`source: "User"`). `authenticate` consumes the validated member ID from the previous tool's output (`source: "ToolOutput"` plus `mapping`). From AVA's perspective both steps are tool calls; the difference is only where the input value comes from.

**Gotcha:** `userUtteranceSubstring` guarantees a value came from the user, not that the value is valid. If the user says something unexpected (e.g., "skip this" when asked for an email), the constraint forces the model to pick some substring from the conversation, which can result in nonsensical values being passed.

We strongly recommend always routing `userUtteranceSubstring` values through a validation tool before passing them to a backend tool. The validation tool checks format and returns a `direction: "output"` type that can be mapped downstream, or surfaces an error from `errors[]` if the input is invalid (which tells the model that it should ask the user to try again).

### Notes on structural tool dependencies

For the manual-collection flow, the author does **not** declare an explicit precondition like "only call authenticate after validate_member_id". The dependency is expressed structurally: `authenticate` requires `ValidatedMemberId`, which only `validate_member_id` can produce, so the platform refuses to let the model fabricate that value.

# Gating actions behind authentication

Define an `AuthToken` struct that is an output of the authentication tool, and require it as an input on every tool that needs to be authenticated. Any tool that does not take `AuthToken` is ungated. That is what makes this pattern work where some actions are fine to run without user authentication, like human escalation or other general informational queries.

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
      "description": "Proof of authentication. Contains only an opaque gate token; read user data from the backend that fulfils gated tools.",
      "properties": [
        { "name": "opaque_token", "type": "OpaqueToken", "required": true }
      ]
    },
    {
      "name": "StoreHours",
      "type": "object",
      "direction": "output",
      "description": "Store hours for the user's region.",
      "properties": [
        { "name": "weekday", "type": "string", "required": true },
        { "name": "open", "type": "string", "required": true },
        { "name": "close", "type": "string", "required": true }
      ]
    },
    {
      "name": "AccountBalance",
      "type": "object",
      "direction": "output",
      "description": "Authenticated user's account balance.",
      "properties": [
        { "name": "currency", "type": "string", "required": true },
        { "name": "amount", "type": "number", "required": true }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "get_store_hours",
      "description": "Return store hours for the user's region.",
      "inputs": [],
      "output": "StoreHours",
      "targetId": "<store-hours-action-id>",
      "targetName": "get_store_hours"
    },
    {
      "type": "DataAction",
      "name": "get_account_balance",
      "description": "Return the authenticated user's account balance.",
      "inputs": [
        {
          "targetName": "auth_token",
          "type": "AuthToken",
          "source": "ToolOutput",
          "required": true,
          "mapping": ["AuthToken", "opaque_token"]
        }
      ],
      "output": "AccountBalance",
      "targetId": "<account-balance-action-id>",
      "targetName": "get_account_balance"
    }
  ]
}
```

`get_store_hours` is ungated: the model can call it regardless of the user's authentication state. `get_account_balance` requires `AuthToken` as an input with `source: "ToolOutput"`, so the platform only allows the call when an `AuthToken` produced by a previous `authenticate` tool result is available in the conversation. There is no separate "is the user authenticated?" flag — the type system carries that contract on its own.

When a downstream Data Action expects a **primitive** input from a prior tool's output, add a `mapping` field on the `ToolOutput` input. The `type` references the producer's output type; `mapping` is `["OutputTypeName", "fieldName"]`:

```json
{
  "targetName": "session_token",
  "type": "AuthResult",
  "source": "ToolOutput",
  "required": true,
  "mapping": ["AuthResult", "session_token"]
}
```

Here `authenticate` declares `output: "AuthResult"`, and `AuthResult` includes a `session_token` property. `get_account_balance` wires that primitive through to its Data Action input. The opaque `AuthToken` pattern works the same way: the downstream tool maps `["AuthToken", "opaque_token"]` and treats the value only as proof that authentication succeeded.
