# 9c Structural flow gates

Cover the anti-pattern where ordering between tools is expressed in prose `instructions[]` rather than enforced by the type graph.

## Prose ordering instead of type ordering

Writing "CRITICAL: always call A before B" in `instructions` is strictly worse than making B require a type that only A can produce. The type system can guarantee the ordering; prose can only ask for it.

Wrong — a prose rule the model can ignore, paired with an input type that any string fits:

```json
{
  "instructions": [
    "CRITICAL: Always call lookup_reservation before cancel_reservation."
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "cancel_reservation",
      "description": "Cancel a reservation.",
      "inputs": [
        { "targetName": "reservation_id", "type": "string", "source": "User", "required": true }
      ],
      "output": "string"
    }
  ]
}
```

Right — `cancel_reservation` accepts only a `reservation_id` mapped from the `Reservation` that `lookup_reservation` produced. Ava enforces the ordering through the input type's provenance:

```json
{
  "types": [
    {
      "name": "Reservation",
      "type": "object",
      "direction": "output",
      "description": "Reservation returned by lookup_reservation.",
      "properties": [
        { "name": "reservation_id", "type": "string", "required": true }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "lookup_reservation",
      "description": "Look up a reservation by user-provided details.",
      "inputs": [
        { "targetName": "query", "type": "InputReservationId", "source": "User", "required": true }
      ],
      "output": "Reservation"
    },
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
