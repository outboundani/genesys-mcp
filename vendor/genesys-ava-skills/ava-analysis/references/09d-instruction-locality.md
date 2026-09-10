# 9d Instruction locality

Cover the anti-patterns where instructions live in the wrong place in the VersionDefinition hierarchy:

- Misplaced instructions in the top-level `instructions[]` array.
- Tools without clear usage instructions.

## Misplaced instructions

The VersionDefinition has a hierarchy for where instructions belong. Piling everything into the top-level `role` field or the global `instructions[]` list makes the agent harder to maintain and less reliable — those texts are read every turn, regardless of which tool is being considered.

Prefer the most-local home for each rule:

- **Behavior after a tool succeeds** → `outputInstructions[]` on the tool that produced the value.
- **Per-input precondition the tool requires** → `inputValidation[]` on the tool itself.
- **When to pick a tool over alternatives** → `inputInstructions[]` (or `description`) on that tool.

Wrong — tool-specific rules crammed into global instructions:

```json
{
  "instructions": [
    "After calling lookup_reservation, tell the user the check-in date.",
    "Only call cancel_reservation if the reservation is still refundable.",
    "When calling search_policy_kb, only use it for cancellation-policy questions."
  ]
}
```

Right — each instruction lives where it has the most effect. The post-success note belongs on `lookup_reservation`'s `outputInstructions`; the refundability requirement belongs on `cancel_reservation`'s `inputValidation`; the routing guidance belongs on `search_policy_kb`'s `inputInstructions`:

```json
{
  "tools": [
    {
      "type": "DataAction",
      "name": "lookup_reservation",
      "description": "Look up a reservation by the identifier and last name the caller provides.",
      "inputs": [
        { "targetName": "reservation_id", "type": "InputReservationId", "source": "User", "required": true },
        { "targetName": "last_name", "type": "InputLastName", "source": "User", "required": true }
      ],
      "output": "Reservation",
      "outputInstructions": [
        { "when": "True", "then": "After calling lookup_reservation, tell the user the check-in date." }
      ]
    },
    {
      "type": "DataAction",
      "name": "cancel_reservation",
      "description": "Cancel a reservation by its identifier.",
      "inputs": [
        { "targetName": "reservation_id", "type": "Reservation", "source": "ToolOutput", "required": true, "mapping": ["Reservation", "reservation_id"] },
        { "targetName": "is_refundable", "type": "Reservation", "source": "ToolOutput", "required": true, "mapping": ["Reservation", "is_refundable"] }
      ],
      "output": "CancellationReceipt",
      "inputValidation": [
        {
          "type": "python",
          "if": "is_refundable is True",
          "else": "Only refundable reservations can be cancelled."
        }
      ]
    },
    {
      "type": "KnowledgeBase",
      "name": "search_policy_kb",
      "description": "Search the hotel policy knowledge base.",
      "inputInstructions": [
        "Use this for cancellation-policy and fee questions only."
      ]
    }
  ]
}
```

Note that you do **not** need to add a preamble instruction like "Call a precondition before X" — Ava generates the appropriate guardrail behavior from the `inputValidation` entry automatically at publish time.

## Tools without clear usage instructions

A tool with a vague `description`, no `inputInstructions`, and no routing condition is an invitation for the model to guess when to call it. Every `DataActionTool`, `KnowledgeBaseTool`, and `KnowledgeSettingTool` should make its purpose obvious from the top-level `description` alone and, when there are sibling tools with overlapping themes, distinguish itself through `inputInstructions[]`.

Wrong — no routing guidance:

```json
{
  "tools": [
    {
      "type": "KnowledgeBase",
      "name": "search_policy_kb",
      "description": "Search the knowledge base."
    }
  ]
}
```

Right — says when to pick this tool, and when to pick a sibling instead:

```json
{
  "tools": [
    {
      "type": "KnowledgeBase",
      "name": "search_policy_kb",
      "description": "Search the hotel policy knowledge base.",
      "inputInstructions": [
        "Use this for cancellation-policy, fee, and amenity questions.",
        "Do NOT use this for questions about a specific reservation — call lookup_reservation instead."
      ]
    }
  ]
}
```
