# 3 Executing multi-step flows

A customer service agent often needs to walk the user through an ordered sequence of steps. Ava version definitions provide primitives that compose to enforce deterministic flows: typed tool inputs and outputs, output instructions that pin the agent's reply, input validations that act as hard gates, and aliased types that capture the user's verbatim utterance. These primitives can be chained sequentially or composed in parallel.

#### Chained token collection

Make each tool's `output` type the next tool's `input` type. The model cannot call step N+1 without step N's return because it has no other way to produce the required type — Ava propagates `must_copy` through every type with `direction: "output"` so the value can only be obtained from the previous tool's result.

Express this in the VersionDefinition by:

- Declaring an aliased type for the user's raw input, with `direction: "input"` and `userUtteranceSubstring: true`.
- Declaring an output struct for the verified token, with `direction: "output"` (Ava will seed `must_copy = true` on it during conversion).
- Declaring a struct type for any richer return value, also with `direction: "output"`.
- Declaring an error type for the lookup failure path.
- Declaring two `DataActionTool`s whose inputs reference the appropriate types and whose outputs produce the next gating token.

```json
{
  "types": [
    {
      "name": "InputReservationId",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "Reservation ID captured verbatim from the user's message."
    },
    {
      "name": "ReservationLookup",
      "type": "object",
      "direction": "output",
      "description": "Verified reservation lookup result — only produced by a successful lookup.",
      "properties": [
        { "name": "reservation_id", "type": "string", "required": true }
      ]
    },
    {
      "name": "CancellationReceipt",
      "type": "object",
      "direction": "output",
      "properties": [
        { "name": "confirmationNumber", "type": "string", "required": true },
        { "name": "refundedCents", "type": "integer", "required": true }
      ]
    },
    {
      "name": "ReservationLookupFailure",
      "type": "DataActionHttpError",
      "statusCodes": [404],
      "defaultInstruction": "Tell the caller the reservation ID was not found and ask them to double-check and provide a revised value.",
      "description": "No reservation matches the submitted ID."
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "lookup_reservation",
      "description": "Look up a reservation by the ID the customer provided.",
      "inputs": [
        {
          "targetName": "input_id",
          "type": "InputReservationId",
          "source": "User",
          "required": true
        }
      ],
      "output": "ReservationLookup",
      "errors": [
        { "type": "ReservationLookupFailure" }
      ]
    },
    {
      "type": "DataAction",
      "name": "cancel_reservation",
      "description": "Cancel a previously looked-up reservation.",
      "inputs": [
        {
          "targetName": "reservation_id",
          "type": "ReservationLookup",
          "source": "ToolOutput",
          "required": true,
          "mapping": ["ReservationLookup", "reservation_id"]
        }
      ],
      "output": "CancellationReceipt"
    }
  ]
}
```

`cancel_reservation` requires a `reservation_id` mapped from `ReservationLookup`. `ReservationLookup` is only produced by `lookup_reservation`. The model has no way to cancel without first looking up — no instruction needed. Because `cancel_reservation` only needs the ID string, the mapped field is primitive, saving the model from copying fields it won't use.

> **Ava defaults to know:** Ava forces `extra_field_behavior = "error"` on every emitted struct and seeds `must_copy = true` on every type with `direction: "output"` (and on properties reachable through them). You don't author either field — they're applied at publish time.

#### Response templates

When a step produces data the user must see verbatim — cancellation penalties, important disclaimers, confirmation numbers — pin the reply with an `outputInstructions[]` entry on the tool. Each entry is a `{ when, then }` pair: `then` is the exact instruction the agent must follow when the entry applies.

> **Note:** `when` currently supports only the literal string `"True"`. Conditional expressions (for example, `lambda result: len(result) > 0`) are not supported yet and will fail at publish time. Encode any branching logic in the `then` text instead.

##### Shape:

```json
{
  "outputInstructions": [
    {
      "when": "True",
      "then": "Respond to the user exactly like this: \"<verbatim message referencing result and parameters>\"."
    }
  ]
}
```

The `then` text references the return value's fields and any input parameters by name.

##### Example:

```json
{
  "type": "DataAction",
  "name": "cancel_reservation",
  "description": "Cancel a previously looked-up reservation.",
  "inputs": [
    {
      "targetName": "reservation_id",
      "type": "ReservationLookup",
      "source": "ToolOutput",
      "required": true,
      "mapping": ["ReservationLookup", "reservation_id"]
    }
  ],
  "output": "CancellationReceipt",
  "outputInstructions": [
    {
      "when": "True",
      "then": "Respond to the user exactly like this: \"Reservation {reservation_id} cancelled. Confirmation: {result.confirmationNumber}. Refund: ${result.refundedCents / 100:.2f}.\""
    }
  ]
}
```

# Input validations for hard gates

A DataActionTool's `inputValidation[]` enforces hard gates. Each entry is `{ type, if, else }` — `if` is the **body** of a Python lambda over the tool's input parameters (not the full `lambda ...:` declaration), and `else` is the failure explanation returned to the model when the expression evaluates false.

> **Note:** Data Action tool inputs only support primitive types. When a prior tool returns a struct, wire a primitive field into the downstream tool with `source: "ToolOutput"` and `mapping: ["OutputTypeName", "fieldName"]`. `inputValidation` expressions can only reference the tool's declared input parameter names — so field-level checks must target a primitive that is actually wired as an input, or be enforced in `inputInstructions` / an upstream tool.

In this variant, `lookup_reservation` returns a `Reservation` struct. `cancel_reservation` maps the `reservationId` primitive out of that struct for its Data Action input:

```json
{
  "types": [
    {
      "name": "Reservation",
      "type": "object",
      "direction": "output",
      "properties": [
        { "name": "reservationId", "type": "string", "required": true },
        { "name": "checkInTimestamp", "type": "number", "required": true }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "lookup_reservation",
      "description": "Look up a reservation by the ID the customer provided.",
      "inputs": [
        {
          "targetName": "input_id",
          "type": "InputReservationId",
          "source": "User",
          "required": true
        }
      ],
      "output": "Reservation",
      "errors": [
        { "type": "ReservationLookupFailure" }
      ]
    },
    {
      "type": "DataAction",
      "name": "cancel_reservation",
      "description": "Cancel a previously looked-up reservation.",
      "inputs": [
        {
          "targetName": "reservationId",
          "type": "Reservation",
          "source": "ToolOutput",
          "required": true,
          "mapping": ["Reservation", "reservationId"]
        }
      ],
      "output": "CancellationReceipt",
      "inputInstructions": [
        "Only call this tool when the reservation's check-in date is still in the future."
      ],
      "inputValidation": [
        {
          "type": "python",
          "if": "reservationId is not None and len(reservationId) > 0",
          "else": "No reservation ID is available. Call lookup_reservation first."
        }
      ]
    }
  ]
}
```

> **Gotcha:** The model has no visibility into the `inputValidation` lambda when predicting a tool call — if the check fails, the call is blocked and only the `else` string is returned to the model. Since the model can't see the lambda, always mirror the constraint elsewhere in the spec (for example, in the tool's `inputInstructions` or in an aliased / struct type `description`). A bare `inputValidation` entry with no related instruction elsewhere costs a full model round-trip:

1. A user asks to cancel yesterday's reservation
2. Model predicts `cancel_reservation(...)`
3. The validation lambda rejects it
4. The `else` explanation comes back
5. Model re-infers

Always pair an `inputValidation` rule with a hint in `inputInstructions` so the model has a chance to avoid a blocked call, and reserve `inputValidation` for hard safety guarantees that must never be bypassed.

> **Feature toggle note:** `inputValidation` only emits enforced runtime checks when `FT_AVA_TOOL_INPUT_PRECONDITIONS` is enabled for the organization. Treat them as hard gates only when you know the toggle is on.

#### Getting explicit user confirmation on verbatim terms

To prove the user agreed to specific terms, four layers can be combined:

1. An `outputInstructions` entry on the terms-fetching tool prescribes the exact acceptance phrase the user should say.
2. An aliased type with `userUtteranceSubstring: true` captures the user's verbatim reply, validated against a narrow whitelist by an error type the downstream tool raises.
3. An `inputValidation` entry on the confirm tool rejects a structurally inconsistent payload (for example, an empty consent reply). The expression only sees the tool's own input parameters and a small set of safe builtins (`len`, `min`, `max`, `abs`, `int`, `float`, `str`, `bool`, `all`, `any`, `round`, `sum`, `Decimal`, `isinstance`); there is no helper to reach into earlier turns or pick the "most recent" emission of a type, so freshness has to be enforced through the type graph (re-running the terms-fetching tool emits a fresh `CancellationTerms` and the model has to copy from that one).
4. A trimmed `inputInstructions` entry closes the remaining semantic gap of a stale "yes" uttered before the current terms were shown.

```json
{
  "types": [
    {
      "name": "ReservationLookup",
      "type": "object",
      "direction": "output",
      "description": "Verified reservation lookup result.",
      "properties": [
        { "name": "reservation_id", "type": "string", "required": true }
      ]
    },
    {
      "name": "ConsentUtterance",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "Passenger's verbatim acceptance phrase — expected to be 'Yes'."
    },
    {
      "name": "CancellationTerms",
      "type": "object",
      "direction": "output",
      "properties": [
        { "name": "reservationId", "type": "string", "required": true },
        { "name": "cancellationFee", "type": "string", "required": true },
        { "name": "refundAmount", "type": "string", "required": true },
        { "name": "refundMethod", "type": "string", "required": true },
        { "name": "deadline", "type": "string", "required": true },
        { "name": "policyText", "type": "string", "required": true }
      ]
    },
    {
      "name": "AcceptedCancellation",
      "type": "object",
      "direction": "output",
      "description": "Gate token for the downstream execute step.",
      "properties": [
        { "name": "reservationId", "type": "string", "required": true }
      ]
    },
    {
      "name": "ConsentNotClear",
      "type": "DataActionHttpError",
      "statusCodes": [422],
      "defaultInstruction": "Ask the passenger to reply with just 'Yes' or 'No' and call again with the new reply.",
      "description": "Raised when the captured consent isn't a clean 'yes'."
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "get_cancellation_terms",
      "description": "Fetch the cancellation terms for a previously looked-up reservation.",
      "inputs": [
        {
          "targetName": "reservation_id",
          "type": "ReservationLookup",
          "source": "ToolOutput",
          "required": true,
          "mapping": ["ReservationLookup", "reservation_id"]
        }
      ],
      "output": "CancellationTerms",
      "outputInstructions": [
        {
          "when": "True",
          "then": "Respond to the user exactly like this: \"Cancellation terms for {reservation_id}:\n- Fee: {result.cancellationFee}\n- Refund: {result.refundAmount} to {result.refundMethod}\n- Deadline: {result.deadline}\nPolicy: {result.policyText}\nPlease say 'Yes' to proceed, or 'No' to decline.\""
        }
      ]
    },
    {
      "type": "DataAction",
      "name": "confirm_cancellation",
      "description": "Record the passenger's explicit acceptance of the cancellation terms.",
      "inputs": [
        {
          "targetName": "reservation_id",
          "type": "CancellationTerms",
          "source": "ToolOutput",
          "required": true,
          "mapping": ["CancellationTerms", "reservationId"]
        },
        {
          "targetName": "consent",
          "type": "ConsentUtterance",
          "source": "User",
          "required": true
        }
      ],
      "output": "AcceptedCancellation",
      "inputInstructions": [
        "The `consent` token must be the passenger's direct reply to the cancellation terms you just presented — not a 'yes' from an earlier turn. If the reply is ambiguous, re-ask instead of calling."
      ],
      "inputValidation": [
        {
          "type": "python",
          "if": "len(consent.strip()) > 0 and reservation_id is not None",
          "else": "The consent reply was empty or no cancellation terms have been fetched yet. Re-fetch the terms with get_cancellation_terms and ask the passenger to reply 'Yes' or 'No'."
        }
      ],
      "errors": [
        { "type": "ConsentNotClear" }
      ]
    }
  ]
}
```

How the four layers cooperate:

1. The `outputInstructions` template on `get_cancellation_terms` forces the agent to read the terms verbatim and request the literal reply `'Yes'` — pinning what the user must say.
2. `ConsentUtterance` is an aliased string with `direction: "input"` and `userUtteranceSubstring: true`. Ava enforces that the model can only fill this parameter with a substring copied directly from the most recent user message, so the `consent` argument is always the user's own words. The `ConsentNotClear` error type lets the back-end reject anything that isn't a clean `"yes"`.
3. The `inputValidation` entry is a structural sanity check on the tool's own arguments — the expression only sees the inputs declared on the tool (here `reservation_id` and `consent`) plus a small whitelist of safe builtins. The check above blocks calls with an empty consent reply or a missing mapped reservation ID; freshness against an older terms fetch is enforced by re-running `get_cancellation_terms` (the model then copies from the new output) rather than by reaching into earlier turns from inside the expression.
4. The `inputInstructions` line tells the model in plain language not to reuse a stale `"yes"`, closing the small semantic gap that the validation alone can't articulate to the model.

> **Ava defaults to know:** Ava platform-injects the standard guardrail rules, the violation-handling responses, the comfort-statement runtime gate, and per-tool interstitial messages automatically. You do not declare any of those in the VersionDefinition — focus the spec on the tools, types, instructions, and validations that encode your flow.
