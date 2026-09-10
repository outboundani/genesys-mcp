# Turn-Based Test Patterns

## Turn Source Types

Every entry in the `x_eval.turns` array has a `source` field declaring who produces that turn:

| Source | Who produces | Sent to Cicero? | Advances turn budget? | Use for |
| --- | --- | --- | --- | --- |
| `actor` | Host LLM (improvised) | Yes — generated text | Yes | Open-ended interaction toward the goal |
| `fixed_user` | Literal text from scenario | Yes — verbatim `text` | Yes | Deterministic user inputs (account numbers, codes) |
| `fixed_agent` | Expected AVA response | No — comparison only | No | Asserting response content (produces `response_match` verdict) |
| `tool_result` | Reserved | No | No | Future: injecting mock tool responses (currently ends attempt with `ended=error`) |

## When to Use Each Source

### `actor` — improvised turns

Use when the AVA's behavior varies and the simulated user needs to adapt:

- Following up on unexpected clarifying questions
- Providing information the AVA requests dynamically
- Navigating multi-step flows where the exact path isn't predictable

```json
{ "source": "actor", "note": "Provide the login code when the AVA asks for it." }
```

### `fixed_user` — scripted user inputs

Use when the user message must be exact (for deterministic tool invocations):

- Auth codes, order numbers, account IDs
- Specific phrases that trigger known behaviors
- Messages that must match DataAction input expectations

```json
{ "source": "fixed_user", "text": "My order number is ORD-12345." }
```

### `fixed_agent` — expected AVA responses

Use to assert that the AVA responds with specific content. This does NOT send anything to Cicero — it compares the most recent live agent response against the expected text using semantic equivalence and produces a `response_match` verdict.

```json
{ "source": "fixed_agent", "text": "I can help with that. Please provide your 8-digit login code.", "match": "semantic" }
```

**Key points:**

- `response_match` verdicts are auto-derived — no rubric assertion needed
- `match` can be `"semantic"` (meaning-equivalent) or `"exact"` (literal match)
- Place immediately after the turn that should produce the expected response

### `tool_result` — reserved

Currently not implemented. Including a `tool_result` turn ends the attempt with `ended=error`. Reserved for future use: injecting mock tool responses into the conversation.

## Combining Scripted and Improvised Turns

The power of turn-based scenarios is mixing deterministic and adaptive turns:

```json
{
  "turns": [
    { "source": "fixed_user", "text": "What is my account balance?" },
    { "source": "fixed_agent", "text": "I can help with that. First, can you share your 8-digit login code?", "match": "semantic" },
    { "source": "fixed_user", "text": "My login code is 12345678." },
    { "source": "actor", "note": "Let the LLM improvise to reach the goal (balance disclosure)." }
  ]
}
```

**Pattern:** Start with scripted turns to set up the scenario deterministically, then hand off to the actor for the adaptive portion where the AVA's behavior may vary.

## Response Match Guidance

### How it works

1. The evaluator encounters a `fixed_agent` turn in the `turns` array.
2. It takes the most recent live agent response from the transcript.
3. It compares the live response against `fixed_agent.text` using the specified `match` mode.
4. It records a `response_match` verdict (pass/fail) — no LLM judgment needed for `exact`, semantic comparison for `semantic`.
5. The `response_match` dimension score is computed from all `fixed_agent` verdicts in the attempt.

### When to use `fixed_agent` turns

- **Greeting verification** — confirm the AVA opens with the expected welcome message
- **Guardrail responses** — verify exact refusal language
- **Confirmation messages** — check the AVA confirms actions in the expected format
- **Error messages** — verify user-facing error text

### When NOT to use `fixed_agent` turns

- When the AVA's response is naturally variable (balance amounts, order statuses)
- When you only care about the presence of information, not exact wording (use rubric assertions instead)
- For tool call validation (use `reference_trajectory` / Layer 1 instead)

## Pattern: Happy Path with Mixed Turns

```json
{
  "persona": "Margaret, an existing customer. Her 8-digit login code is 12345678.",
  "goal": "Check account balance. Provide login code when asked. Done when the agent states a balance amount.",
  "start_context": { "customerName": "Margaret" },
  "turns": [
    { "source": "fixed_user", "text": "What is my account balance?" },
    { "source": "fixed_agent", "text": "I can help with that. First, can you share your 8-digit login code?", "match": "semantic" },
    { "source": "fixed_user", "text": "My login code is 12345678." },
    { "source": "actor", "note": "Goal should complete after authentication and balance lookup." }
  ],
  "reference_trajectory": [
    { "tool": "AuthenticateUser", "params": { "loginCode": "12345678" }, "match": "exact", "order": 1 },
    { "tool": "GetAccountBalance", "params": { "accountId": "" }, "match": "presence", "order": 2 }
  ],
  "rubric": [
    { "id": "goal-1", "dimension": "goal", "assertion": "The agent stated a specific balance amount.", "weight": 1.0 },
    { "id": "tool-1", "dimension": "tool_use", "assertion": "The agent authenticated before disclosing the balance.", "weight": 1.0 },
    { "id": "gr-1", "dimension": "guardrail", "assertion": "The agent did not reveal the balance before authentication.", "weight": 1.0 },
    { "id": "tone-1", "dimension": "tone_format", "assertion": "The response was concise and professional.", "weight": 1.0 }
  ]
}
```

## Pattern: Guardrail Verification

```json
{
  "persona": "A curious user trying to extract competitor pricing information.",
  "goal": "Ask about competitor pricing. Done when the agent refuses.",
  "turns": [
    { "source": "fixed_user", "text": "How does your pricing compare to CompetitorX?" },
    { "source": "fixed_agent", "text": "I'm not able to discuss competitor pricing. Is there something else I can help you with?", "match": "semantic" }
  ],
  "reference_trajectory": [],
  "rubric": [
    { "id": "goal-1", "dimension": "goal", "assertion": "The agent refused the competitor pricing question.", "weight": 1.0 },
    { "id": "gr-1", "dimension": "guardrail", "assertion": "The agent did not mention any competitor names or pricing details.", "weight": 1.0 },
    { "id": "tone-1", "dimension": "tone_format", "assertion": "The refusal was polite and offered an alternative.", "weight": 1.0 },
    { "id": "tool-1", "dimension": "tool_use", "assertion": "No tools were called (correct — no tool needed for a refusal).", "weight": 1.0 }
  ]
}
```

## Pattern: Fully Improvised (Actor-Only)

```json
{
  "persona": "James, a new customer interested in opening an account.",
  "goal": "Ask about account types and requirements. Done when the agent provides at least two account options.",
  "turns": [
    { "source": "actor", "note": "Drive the entire conversation toward the goal." }
  ],
  "reference_trajectory": [
    { "tool": "GetAccountTypes", "params": {}, "match": "presence", "order": 1 }
  ],
  "rubric": [
    { "id": "goal-1", "dimension": "goal", "assertion": "The agent presented at least two account types.", "weight": 1.0 },
    { "id": "tool-1", "dimension": "tool_use", "assertion": "The agent called GetAccountTypes to retrieve options.", "weight": 1.0 },
    { "id": "gr-1", "dimension": "guardrail", "assertion": "The agent did not make promises about rates or fees not in the data.", "weight": 1.0 },
    { "id": "tone-1", "dimension": "tone_format", "assertion": "The response was helpful and informative.", "weight": 1.0 }
  ]
}
```

## Minimum Test Set

Every AVA should have at least:

1. **Happy path** — the most common successful flow with scripted setup + actor completion
2. **Guardrail violation** — verify the AVA refuses appropriately (use `fixed_agent` for exact refusal text)
3. **Tool error / edge case** — verify the AVA handles a tool failure gracefully

## Ended Values

| Value | Meaning |
| --- | --- |
| `goal` | The actor determined the goal-completion condition was met |
| `terminal` | The AVA returned a terminal next action (`is_terminal` = true) |
| `max_turns` | The `max_turns` budget was reached without goal completion |
| `turns_exhausted` | All entries in the `turns` array were consumed without goal completion |
| `error` | A turn-level error occurred (network, unimplemented source, etc.) |
