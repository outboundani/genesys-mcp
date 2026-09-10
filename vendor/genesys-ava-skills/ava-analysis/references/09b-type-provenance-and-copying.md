# 9b Type provenance and copying

Cover the anti-patterns where type declarations fail to carry provenance:

- Generic `string` types instead of semantic aliases.
- Misapplying `userUtteranceSubstring` to free-form prose.

## Generic string types instead of semantic aliases

A bare `string` carries no provenance — the model can fill it with any value from any source. Trusted identifiers and inputs the user must literally say need their own aliased types so Ava can enforce where they come from.

Use the `userUtteranceSubstring: true` flag on an aliased `string` type (with `direction: "input"`) for any value that must be a verbatim substring of something the user actually said.

Wrong — `string` everywhere, no trust boundary:

```json
{
  "tools": [
    {
      "type": "DataAction",
      "name": "lookup_reservation",
      "description": "Look up a reservation.",
      "inputs": [
        { "targetName": "reservation_id", "type": "string", "source": "User", "required": true },
        { "targetName": "last_name", "type": "string", "source": "User", "required": true }
      ],
      "output": "Reservation"
    }
  ]
}
```

Right — each value has a type that declares its origin:

```json
{
  "types": [
    {
      "name": "InputReservationId",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "A reservation identifier the user spoke. Must be copied as a verbatim substring of the user's utterance."
    },
    {
      "name": "InputLastName",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "The guest's last name as spoken by the user. Must be copied as a verbatim substring of the user's utterance."
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "lookup_reservation",
      "description": "Look up a reservation by the identifier and last name the caller provides.",
      "inputs": [
        { "targetName": "reservation_id", "type": "InputReservationId", "source": "User", "required": true },
        { "targetName": "last_name", "type": "InputLastName", "source": "User", "required": true }
      ],
      "output": "Reservation"
    }
  ]
}
```

## Constraining free-form text with `userUtteranceSubstring`

`userUtteranceSubstring: true` forces the captured value to be a verbatim substring of something the user said. Use it for identifiers like order IDs, confirmation codes, and zip codes — but **not** for free-form fields like appointment notes, reason-for-visit, or description-of-issue. When a composed sentence has to satisfy the substring constraint, the model can get stuck and in the worst case produce a runaway string.

Rule of thumb: use `userUtteranceSubstring: true` to copy individual values or entities — never to capture free-form prose.

Wrong — substring constraint on a free-form narrative field:

```json
{
  "types": [
    {
      "name": "AppointmentNotes",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "Free-form notes for an appointment."
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "schedule_appointment",
      "description": "Schedule a patient appointment.",
      "inputs": [
        { "targetName": "patient_id", "type": "PatientLookup", "source": "ToolOutput", "required": true, "mapping": ["PatientLookup", "patient_id"] },
        { "targetName": "notes", "type": "AppointmentNotes", "source": "User", "required": true }
      ],
      "output": "Appointment"
    }
  ]
}
```

Right — plain `string` for narrative; the substring constraint is reserved for the identifier. Steer the shape of the narrative through the input's description rather than a type constraint:

```json
{
  "tools": [
    {
      "type": "DataAction",
      "name": "schedule_appointment",
      "description": "Schedule a patient appointment.",
      "inputs": [
        { "targetName": "patient_id", "type": "PatientLookup", "source": "ToolOutput", "required": true, "mapping": ["PatientLookup", "patient_id"] },
        {
          "targetName": "notes",
          "type": "string",
          "source": "User",
          "required": true,
          "description": "1-2 sentences summarizing the reason for the visit in third person, e.g. 'Patient reports intermittent headaches for the past two weeks.'"
        }
      ],
      "output": "Appointment"
    }
  ]
}
```
