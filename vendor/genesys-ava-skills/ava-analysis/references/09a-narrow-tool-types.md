# 9a Narrow tool types

Cover the anti-patterns where tool input or output types carry more data than the tool actually needs:

- Overly wide function argument types (opaque trust tokens).
- Identifier over whole struct on mutations.
- Copy-forcing on a wrapping struct does not extend to its fields.
- Superfluous output fields on return structs.

## Overly wide function argument types

Every field on a tool's input type costs tokens. When an input type is one the model is forced to copy verbatim (any type reachable as a `DataActionTool` input whose value originates from a tool output, or any struct with `direction: "output"`), the model has to emit the full contents in its tool call — each extra field adds latency to the response. Even when copying is not forced, the fields show up in the published spec the model reads every turn. Default to the narrowest type that encodes what the tool needs.

**Opaque trust tokens.** For auth, a gated tool only needs to know the session was authenticated. An `AuthToken` struct with a single opaque token property expresses exactly that. Fields like `name`, `email`, and `phone` add nothing the tool implementation can't read from its own context, and force the model to emit them as copy tokens on every gated call.

The pattern in a VersionDefinition: declare an output struct with one opaque property, return it from your authentication tool, then map that property into every gated downstream tool. Because the struct is `output`-directed, Ava marks it as a forced-copy parameter, so the model can only pass it after the auth tool has actually produced one.

Wrong — auth payload re-emitted on every gated call:

```json
{
  "types": [
    {
      "name": "AuthenticatedUser",
      "type": "object",
      "direction": "output",
      "description": "The authenticated user.",
      "properties": [
        { "name": "name", "type": "string", "required": true, "description": "Full name." },
        { "name": "email", "type": "string", "required": true, "description": "Email address." },
        { "name": "phone", "type": "string", "required": true, "description": "Phone number." },
        { "name": "tier", "type": "string", "required": true, "description": "Loyalty tier." }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "get_account_balance",
      "description": "Look up the current account balance for the authenticated user.",
      "inputs": [
        { "targetName": "user", "type": "AuthenticatedUser", "source": "ToolOutput", "required": true }
      ],
      "output": "AccountBalance"
    }
  ]
}
```

Right — opaque trust token; customer data stays out of the model's context:

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
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "get_account_balance",
      "description": "Look up the current account balance for the authenticated user.",
      "inputs": [
        { "targetName": "auth_token", "type": "AuthToken", "source": "ToolOutput", "required": true, "mapping": ["AuthToken", "opaque_token"] }
      ],
      "output": "AccountBalance"
    }
  ]
}
```

## Short identifier over whole structs

The same principle extends to mutations. `cancel_reservation` only needs to know which reservation to cancel, so the input should be a `ReservationId` aliased type — not the full `Reservation` struct the model already looked up. Default to making the identifier the forced-copy type and let the struct carry unmarked reference data.

In a VersionDefinition this means: keep `Reservation` as the producer's output type, then map only its primitive `reservation_id` field into `cancel_reservation`. Because the input value flows from a previous tool output, Ava forces the model to copy it verbatim without passing the whole reservation record.

Wrong — whole struct flows as the input; the model re-emits every field to cancel:

```json
{
  "types": [
    {
      "name": "Reservation",
      "type": "object",
      "direction": "output",
      "description": "A hotel reservation.",
      "properties": [
        { "name": "reservation_id", "type": "string", "required": true, "description": "Reservation identifier." },
        { "name": "guest_name", "type": "string", "required": true, "description": "Guest name on the booking." },
        { "name": "check_in_date", "type": "string", "required": true, "description": "Check-in date, ISO-8601." },
        { "name": "room_number", "type": "string", "required": true, "description": "Assigned room number." },
        { "name": "rate_cents", "type": "integer", "required": true, "description": "Nightly rate in cents." },
        { "name": "is_refundable", "type": "boolean", "required": true, "description": "Whether the reservation is refundable." }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "cancel_reservation",
      "description": "Cancel a reservation by its full record.",
      "inputs": [
        { "targetName": "reservation", "type": "Reservation", "source": "ToolOutput", "required": true }
      ],
      "output": "CancellationReceipt"
    }
  ]
}
```

Right — the identifier is the trust token; the struct carries reference data:

```json
{
  "types": [
    {
      "name": "ReservationId",
      "type": "string",
      "description": "Opaque reservation identifier."
    },
    {
      "name": "Reservation",
      "type": "object",
      "direction": "output",
      "description": "A hotel reservation.",
      "properties": [
        { "name": "reservation_id", "type": "ReservationId", "required": true, "description": "Reservation identifier." },
        { "name": "guest_name", "type": "string", "required": true, "description": "Guest name on the booking." },
        { "name": "check_in_date", "type": "string", "required": true, "description": "Check-in date, ISO-8601." },
        { "name": "room_number", "type": "string", "required": true, "description": "Assigned room number." },
        { "name": "rate_cents", "type": "integer", "required": true, "description": "Nightly rate in cents." },
        { "name": "is_refundable", "type": "boolean", "required": true, "description": "Whether the reservation is refundable." }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "cancel_reservation",
      "description": "Cancel a reservation by its identifier.",
      "inputs": [
        { "targetName": "reservation_id", "type": "Reservation", "source": "ToolOutput", "required": true, "mapping": ["Reservation", "reservation_id"] }
      ],
      "output": "CancellationReceipt"
    }
  ]
}
```

### Gotcha: copy-forcing on a wrapping struct does not extend to its fields

Ava decides whether a value must be copied verbatim by looking at the **declared input type** on the tool, not at the original source of the value. So a property like `confirmation_number: ConfirmationNumber` inside a `BookingRef` struct is reliable only when the model is passing the whole `BookingRef` — because the wrapping struct is what gets marked forced-copy.

A different tool that accepts `confirmation_number: ConfirmationNumber` **directly** is constrained only by whatever rules `ConfirmationNumber` itself has. If that aliased type isn't reachable as an output (or isn't tagged `userUtteranceSubstring`), the model can fabricate the value.

```json
{
  "types": [
    {
      "name": "ReservationId",
      "type": "string",
      "description": "Opaque reservation identifier."
    },
    {
      "name": "ConfirmationNumber",
      "type": "string",
      "description": "Booking confirmation number. Reliable only when nested inside BookingRef."
    },
    {
      "name": "BookingRef",
      "type": "object",
      "direction": "output",
      "description": "A reference to a booking returned by lookup tools.",
      "properties": [
        { "name": "reservation_id", "type": "ReservationId", "required": true, "description": "Reservation identifier." },
        { "name": "confirmation_number", "type": "ConfirmationNumber", "required": true, "description": "Confirmation number, reliable inside BookingRef." }
      ]
    }
  ]
}
```

If you want `ConfirmationNumber` to be safe wherever it appears as an input, give it its own provenance — either route it through a struct that is `direction: "output"`, or make it an aliased type with `userUtteranceSubstring: true` and `direction: "input"`.

## Superfluous output fields

Only return the fields the agent actually needs, not every field from the backend. Struct and property descriptions are included in the published spec the model sees on every turn, so every unused field adds tokens the model pays for every turn.

Wrong — 30 fields from the backend on a single struct:

```json
{
  "types": [
    {
      "name": "Reservation",
      "type": "object",
      "direction": "output",
      "description": "A hotel reservation.",
      "properties": [
        { "name": "reservation_id", "type": "string", "required": true, "description": "Reservation identifier." },
        { "name": "status", "type": "string", "required": true, "description": "Free-form status string from the backend." },
        { "name": "rate_plan_code", "type": "string", "required": false, "description": "Internal rate plan code." },
        { "name": "channel_source", "type": "string", "required": false, "description": "Booking channel." },
        { "name": "housekeeping_notes", "type": "string", "required": false, "description": "Housekeeping notes." },
        { "name": "loyalty_tier_at_booking", "type": "string", "required": false, "description": "Loyalty tier when the booking was made." }
      ]
    }
  ]
}
```

Right — only the fields the agent actually uses, with closed-set enums where possible. Add separate tools to query additional details on demand, so only explicitly requested information enters the context:

```json
{
  "types": [
    {
      "name": "ReservationStatus",
      "type": "string",
      "enum": ["confirmed", "checked_in", "checked_out", "cancelled"],
      "description": "The lifecycle status of a reservation."
    },
    {
      "name": "Reservation",
      "type": "object",
      "direction": "output",
      "description": "A hotel reservation.",
      "properties": [
        { "name": "reservation_id", "type": "ReservationId", "required": true, "description": "Reservation identifier." },
        { "name": "guest_name", "type": "string", "required": true, "description": "Guest name on the booking." },
        { "name": "status", "type": "ReservationStatus", "required": true, "description": "Lifecycle status." },
        { "name": "check_in_date", "type": "string", "required": true, "description": "Check-in date, ISO-8601." },
        { "name": "is_refundable", "type": "boolean", "required": true, "description": "Whether the reservation is still within the refundable window." }
      ]
    }
  ]
}
```
