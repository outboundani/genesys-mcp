---
name: ava-test
description: >
  Author turn-based evaluation scenarios for a Genesys Cloud AVA and store them locally.
  Use after an AVA is published to define persona-driven scenarios (goal, start context, an
  ordered turns array, a reference trajectory for deterministic tool-call checking, and a
  dimension-tagged rubric) and assemble them into a test set for the evaluate skill. Scenarios
  and test sets are persisted on disk under `.ava-lifecycle/<slug>/` using native file I/O.
compatibility: ava-harness
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# GC AVA Test

> **Lifecycle:** [dispatch](../ava-dispatch/SKILL.md) → [design](../ava-design/SKILL.md) → [build](../ava-build/SKILL.md) → **test** → [evaluate](../ava-evaluate/SKILL.md) → [critique](../ava-critique/SKILL.md)

Authors **turn-based scenarios** and assembles them into a test set, all stored locally under `.ava-lifecycle/<slug>/`. The evaluate skill later drives each scenario as a multi-turn conversation against the published AVA and scores it with hybrid (deterministic + rubric) validation.

Tests are **turn-based**: the actor (run by the evaluate skill) pursues a persona and goal and adapts each message to what the AVA actually says. The transcript differs on every run, so consistency lives in the scoring methodology — a deterministic reference trajectory (Layer 1) and decomposed, dimension-tagged rubric assertions (Layer 2).

## Quick Reference

| Need | Reference |
| --- | --- |
| Scenario file layout + full `x_eval` example | design.md "Data Models" (`.ava-lifecycle/<slug>/test-cases/<kebab-case-slug>.json`) |
| Turn-based patterns and coverage guidance | [test-patterns.md](references/test-patterns.md) |

| Operation | How |
| --- | --- |
| List existing scenarios | List files in `.ava-lifecycle/<slug>/test-cases/` using native directory tools |
| Persist a scenario | Write JSON to `.ava-lifecycle/<slug>/test-cases/<kebab-case-slug>.json` using native file tools (derive slug from scenario name) |
| Persist a test set | Write JSON to `.ava-lifecycle/<slug>/test-sets/<kebab-case-slug>.json` using native file tools |

| Tool | Purpose |
| --- | --- |
| `create_mock_data_action` / `replace_mock_responses` | Ensure reference-trajectory DataActions can be mocked |

---

## Step 1: Read Prerequisites

Read `.ava-lifecycle/<slug>/sage-agent.json` for `agent_id` and the published `version`. `slug` is carried forward from the dispatch skill. If missing: tell the author to run the build skill first, then stop.

Read `.ava-lifecycle/<slug>/design-artifact.json` for the `testCases` array. If present: use those scenarios as the starting point for authoring.

List files in `.ava-lifecycle/<slug>/test-cases/` using native directory-listing tools.

- If scenarios already exist: present them and ask whether to reuse, add to, or replace them.
- If none exist: proceed to author from the design artifact scenarios.

---

## Step 2: Author Turn-Based Scenarios

For each scenario, author a complete definition. The scenario object has the **scenario core at the top level** plus the turn-based eval fields under `x_eval`:

**Scenario core (top level):**

- `agent_id` — from `sage-agent.json`
- `name` — short, descriptive scenario name
- `type` — `"scripted"`
- `language` — e.g. `"en-US"`
- `test_config` — `{ "trajectory": [...] }` (a minimal ideal-conversation trajectory)

**`x_eval` (turn-based extension):**

| Field | Meaning |
| --- | --- |
| `persona` | Who the simulated user is, plus any facts they hold (e.g. a login code) |
| `goal` | What the user wants **and an explicit goal-completion definition** ("Done when …") |
| `start_context` | Optional object passed as `inputData` at session creation |
| `turns` | Ordered turn array — each declares who produces it (`actor`, `fixed_user`, `fixed_agent`, `tool_result`). Empty/absent defaults to a single open-ended `actor` turn. |
| `reference_trajectory` | Layer 1: expected tool calls, each `{tool, params, match: "exact"\ | "presence", order}` |
| `rubric` | Layer 2: dimension-tagged assertions, each `{id, dimension, assertion, weight}` |
| `attempts` | Repeat count for the success rate (default `1`) |
| `max_turns` | Conversation turn cap (default `10`) |
| `success_threshold` | Success-rate threshold to pass the scenario (default `0.8`) |

**The rubric MUST cover all four authored dimensions** — every scenario needs at least one assertion for each of:

- `goal` — did the AVA accomplish the user's objective?
- `tool_use` — did it call the right tools, correctly, in order?
- `guardrail` — did it avoid prohibited behavior (e.g. disclosing data before auth)?
- `tone_format` — was the response appropriately concise / professional / formatted?

A fifth dimension, `response_match`, is **auto-derived** from `fixed_agent` turns and does not need rubric assertions. When a scenario includes `fixed_agent` turns, the evaluator automatically compares the AVA's actual response against the expected text and produces `response_match` verdicts.

Keep assertions **binary and evidence-checkable** (a judge should answer pass/fail with a quote), not compound. Split "authenticated the user and stated the balance" into two assertions.

Example `x_eval` (see design.md "Data Models" for the full file layout):

```json
{
  "persona": "Margaret, an existing customer. Her 8-digit login code is 12345678.",
  "goal": "Check account balance. Provide login code when asked. Done when the agent states a balance amount.",
  "start_context": { "customerName": "Margaret" },
  "turns": [
    { "source": "fixed_user", "text": "What is my account balance?" },
    { "source": "fixed_agent", "text": "I can help with that. First, can you share your 8-digit login code?", "match": "semantic" },
    { "source": "fixed_user", "text": "My login code is 12345678." },
    { "source": "actor", "note": "Let the LLM improvise to reach the goal." }
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
  ],
  "attempts": 1,
  "max_turns": 10,
  "success_threshold": 0.8
}
```

Aim for at least a happy path, a guardrail scenario, and a tool-error / edge case (see [test-patterns.md](references/test-patterns.md) for minimum coverage guidance).

Present each scenario to the author for review before persisting:

> "**[name]** Persona: [persona] · Goal: [goal] Reference tools: [tool names] · Rubric dimensions: goal / tool_use / guardrail / tone_format Ready to save this scenario?"

---

## Step 3: Validate Mock DataActions

Before persisting a scenario, make sure every DataAction in its `reference_trajectory` can be mocked, so the evaluate run can exercise the tool path deterministically:

1. Collect the DataAction tool names / `targetId` values referenced in `reference_trajectory`.
2. For each referenced DataAction, ensure a mock exists (via `list_resources` / `get_data_action_schema`, or prior authoring) and that its mock table covers every case the scenario needs. Use `replace_mock_responses` with `mock_responses` carrying **every** case (exact expected input plus a success `response`, or a structured `error`, per case) and a `default_mock` for unmatched inputs.

   - **Backend routing:** the server automatically chooses echo (Velocity) or Function (Lambda) at creation time. Error outcomes require the echo backend — Function rejects any `error` case or default at creation time (`assert_no_error_mocks`). If a negative-path scenario needs an error mock on an existing Function-backed DataAction, recreate it via `create_mock_data_action` with at least one `error` outcome (which routes to echo), or add the error case through a fresh `create_mock_data_action` call on the echo path.
   - **`replace_mock_responses` replaces the whole mock table, not just one case.** Calling it with only the new case would wipe every case a previous scenario relied on — always pass the full set the action needs across all scenarios that use it.
   - **Error mocks:** `error.code` is only a fallback for deriving the HTTP status when `error.status` is omitted — see L10 in design-constraints.md. Prefer setting `error.status` explicitly. `code`/`message` are authoring metadata and are not returned to the AVA, so a rubric assertion about a negative-path turn must check the AVA's recovery behavior, not the error text.
3. If a referenced DataAction cannot be mocked yet, tell the author. If DataAction authoring is available, offer to create it first with `create_mock_data_action`; otherwise stop and report the gap.

---

## Step 4: Persist Scenarios

For each reviewed scenario, write the scenario JSON to `.ava-lifecycle/<slug>/test-cases/<kebab-case-slug>.json` using native file tools. Derive the filename slug from the scenario name using:

**Slugification algorithm:** lowercase → replace non-alphanumeric characters (except hyphens) with hyphens → collapse consecutive hyphens → trim leading/trailing hyphens. Example: "Happy Path - Check Balance" → `happy-path-check-balance`

**Collision handling:** if a file with the same slug already exists, append a numeric suffix (e.g. `happy-path-check-balance-2.json`, `happy-path-check-balance-3.json`).

The file contains:

- **Scenario core** at the top level: `agent_id`, `name`, `type`, `language`, `test_config`
- **`x_eval`** — the turn-based eval fields (persona, goal, turns, reference_trajectory, rubric, etc.)
- **`metadata`** — `{ "id": "<kebab-case-slug>", "created_at": "<ISO 8601 timestamp>" }`

Example file structure:

```json
{
  "agent_id": "<uuid>",
  "name": "Happy Path - Check Balance",
  "type": "scripted",
  "language": "en-US",
  "test_config": { "trajectory": [...] },
  "x_eval": { ... },
  "metadata": {
    "id": "happy-path-check-balance",
    "created_at": "2025-01-15T12:00:00+00:00"
  }
}
```

Invalid payloads should be caught and fixed before writing — ensure all required fields are present and the rubric covers all four dimensions.

Record each `test_case_id` (the kebab-case slug used as the filename, without `.json`).

---

## Step 5: Assemble Test Set

Write the test set JSON to `.ava-lifecycle/<slug>/test-sets/<kebab-case-slug>.json` using native file tools. Derive the filename slug from the test set name using the same slugification algorithm.

The file contains:

```json
{
  "name": "<AVA name>",
  "agent_id": "<uuid>",
  "test_cases": [ { "test_case_id": "<kebab-case-slug>" }, { "test_case_id": "<kebab-case-slug>" } ],
  "metadata": {
    "id": "<kebab-case-slug>",
    "created_at": "<ISO 8601 timestamp>"
  }
}
```

`test_cases` must be an array of `{test_case_id}` objects (not a flat string array). Every referenced scenario must already exist as a file in `.ava-lifecycle/<slug>/test-cases/` — verify each `test_case_id` corresponds to an existing `.json` file before writing the test set.

---

## Step 6: Hand Off

Scenarios and the test set now live under:

- `.ava-lifecycle/<slug>/test-cases/` — one JSON file per scenario
- `.ava-lifecycle/<slug>/test-sets/` — the test set referencing them

Note the test set id (the slug used as the filename) — the evaluate skill needs it to project and run the evaluation.

Report:

> "Stored [N] scenarios and a test set (`test_set_id`: [id]) under `.ava-lifecycle/[slug]/`. Ready to run evaluation?"

Proceed to [evaluate](../ava-evaluate/SKILL.md).
