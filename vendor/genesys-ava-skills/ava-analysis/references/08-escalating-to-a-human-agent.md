# 8 Escalating to a human agent

There are natural times for an agent to consider a conversation finished — for example, when the user has no further questions, or when they ask to be put through to a human representative. In a VersionDefinition you express these moments by configuring the built-in `Escalation` and `UserExit` events, and (when you need to do real backend work as part of the handoff) by defining a `DataActionTool` that carries the structured handoff payload.

## Ending the conversation

Ava ships with two conversation-ending capabilities that the platform injects automatically at runtime — you do not declare them in your VersionDefinition:

| Built-in capability | Triggered when | Default message |
| --- | --- | --- |
| `escalate_to_human_agent` | The user explicitly asks to speak with a human agent. Available whenever escalation is enabled on the request (default `true`). | `Transferring you now!` |
| `end_conversation` | The user indicates they are finished or have no more questions. Always available. | `Goodbye` |

To customise the message either of those built-ins says before terminating the turn, add the matching entry to `events[]` on your VersionDefinition:

```json
{
  "events": [
    {
      "type": "Escalation",
      "message": "Thanks for your patience — connecting you with a team member now."
    },
    {
      "type": "UserExit",
      "message": "Thanks for chatting with us. Have a great day!"
    }
  ]
}
```

Both events are optional. If you omit them, the platform uses the defaults above. `events[].type` and `events[].message` are the only fields the author supplies for these two events.

### Defining your own transfer tool

Use the built-in `escalate_to_human_agent` whenever the only thing you need is to say the escalation line and end the turn. When the handoff also has to do real work in a downstream system (open a queue ticket, notify a front-desk app, write a CRM note, etc.), declare a `DataActionTool` that performs that work. The tool runs as a normal tool call; the platform's built-in `escalate_to_human_agent` (or `end_conversation`) still handles the closing message.

The author-facing equivalent of "thank the guest before transferring" is `inputInstructions` on the tool. The platform reads those instructions before the tool is called, so they act as gating / pre-call guidance.

```json
{
  "types": [
    {
      "name": "GuestConcern",
      "type": "string",
      "description": "Description of the guest's issue, captured before transfer.",
      "direction": "input",
      "userUtteranceSubstring": true
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "transfer_to_front_desk",
      "description": "Transfer the guest to the front desk team.",
      "inputInstructions": [
        "Thank the guest for their patience and let them know you are transferring them to a team member who will have the full conversation context."
      ],
      "inputs": [
        {
          "targetName": "concern",
          "type": "GuestConcern",
          "source": "User",
          "required": true
        }
      ]
    }
  ]
}
```

Notes on what Ava handles for you:

- The aliased type `GuestConcern` uses `userUtteranceSubstring: true` so the value the agent passes must be a verbatim substring of the guest's own words. With `direction: "input"`, the platform also enforces the copy-from-user behaviour automatically.
- You do not declare any "this tool ends the conversation" flag. If the conversation should terminate after the transfer, simply let the runtime's built-in `escalate_to_human_agent` or `end_conversation` close the turn afterwards — both are injected on every turn (escalation when the request enables it, end-of-conversation always).
- You never declare `interstitial_message`, the three global instructions, or the built-in guardrail rules. The platform injects them at publish time.

## Handoff summaries

The simplest pattern uses a free-form `string` parameter for the summary — useful when the receiving system just needs human-readable context:

```json
{
  "tools": [
    {
      "type": "DataAction",
      "name": "transfer_to_front_desk",
      "description": "Transfer the guest to the front desk team.",
      "inputInstructions": [
        "Thank the guest for their patience and let them know you are transferring them to a team member who will have the full conversation context.",
        "Write a 2-3 sentence handoff summary in third person describing what the guest needed, what you tried, and why a transfer is required."
      ],
      "inputs": [
        {
          "targetName": "handoff_summary",
          "type": "string",
          "source": "User",
          "required": true
        }
      ]
    }
  ]
}
```

When the receiving system also needs to parse specific fields, define a struct type for the summary and reference trusted aliased types produced by earlier tool calls.

### Structured handoff with a struct parameter

This example pairs:

- an enum type (`Department`) so the agent can only pick from an allowed set;
- two aliased types (`ReservationId`, `CheckInDate`) marked as `direction: "output"`, meaning the agent must copy them from the result of an earlier lookup tool (they cannot be invented);
- a struct type (`HandoffSummary`) that bundles the free-form summary with the trusted IDs, with individual primitive fields mapped into the transfer tool;
- a struct type (`TransferResult`) for the backend response;
- the `DataActionTool` that ties it all together.

```json
{
  "types": [
    {
      "name": "Department",
      "type": "string",
      "description": "Departments the agent can transfer a call to.",
      "enum": [
        "booking_specialist",
        "cancellation_specialist",
        "customer_relations",
        "special_assistance"
      ]
    },
    {
      "name": "ReservationId",
      "type": "string",
      "description": "Trusted reservation identifier from lookup_reservation.",
      "direction": "output"
    },
    {
      "name": "CheckInDate",
      "type": "string",
      "description": "Check-in date from a reservation lookup.",
      "direction": "output"
    },
    {
      "name": "HandoffSummary",
      "type": "object",
      "description": "Structured summary for the receiving specialist.",
      "direction": "output",
      "properties": [
        {
          "name": "conversation_summary",
          "type": "string",
          "required": true,
          "description": "Two to three sentences in third person: what the guest needed, what you tried, why escalation is needed."
        },
        {
          "name": "reservation_id",
          "type": "ReservationId",
          "required": false,
          "description": "Reservation identifier from a prior lookup_reservation result, or omit if no reservation was discussed."
        },
        {
          "name": "check_in_date",
          "type": "CheckInDate",
          "required": false,
          "description": "Check-in date from a prior lookup result, or omit if no date was discussed."
        }
      ]
    },
    {
      "name": "TransferResult",
      "type": "object",
      "description": "Backend response after a transfer is initiated.",
      "direction": "output",
      "properties": [
        { "name": "department", "type": "Department", "required": true },
        { "name": "queue_position", "type": "integer", "required": true },
        { "name": "estimated_wait_minutes", "type": "integer", "required": true }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "transfer_to_human_agent",
      "description": "Transfer the guest to a human specialist with conversation context.",
      "inputInstructions": [
        "Only call after the guest has confirmed they want a specialist.",
        "Fill out the conversation_summary parameter: 2-3 sentences in third person ('The guest asked about...'). Sentence 1: what the guest needed. Sentence 2: what you tried or confirmed. Sentence 3: why escalation is needed.",
        "reservation_id: copy the ReservationId from a prior lookup_reservation result, or omit if no reservation was discussed.",
        "check_in_date: copy the CheckInDate from a prior lookup result, or omit if no date was discussed."
      ],
      "inputs": [
        {
          "targetName": "department",
          "type": "Department",
          "source": "User",
          "required": true
        },
        {
          "targetName": "conversation_summary",
          "type": "HandoffSummary",
          "source": "ToolOutput",
          "required": true,
          "mapping": ["HandoffSummary", "conversation_summary"]
        },
        {
          "targetName": "reservation_id",
          "type": "HandoffSummary",
          "source": "ToolOutput",
          "required": false,
          "mapping": ["HandoffSummary", "reservation_id"]
        },
        {
          "targetName": "check_in_date",
          "type": "HandoffSummary",
          "source": "ToolOutput",
          "required": false,
          "mapping": ["HandoffSummary", "check_in_date"]
        }
      ],
      "output": "TransferResult"
    }
  ]
}
```

Notes on what Ava handles for you:

- `ReservationId` and `CheckInDate` only need `direction: "output"`. The platform computes the must-copy behaviour for you, so the agent can populate `reservation_id` / `check_in_date` only by copying the exact value returned by an earlier tool call — it cannot fabricate one.
- `HandoffSummary` is itself a struct used to carry trusted output-direction fields into the next tool. Declaring `direction: "output"` on the struct and mapping each primitive transfer input from it tells the platform to consolidate it as output-sourced data, the same gating pattern used elsewhere for things like auth tokens.
- The `TransferResult` struct's `description` is what the agent reads to interpret the backend response. You do not need to add any "tool called" interstitials or built-in error scaffolding — those are injected automatically when the tool runs.
- You do not need to declare conversation-ending semantics. After this tool returns, let the built-in `escalate_to_human_agent` (or `end_conversation`) handle the closing message; customise its text via the `Escalation` (or `UserExit`) event entry described in the first section.
