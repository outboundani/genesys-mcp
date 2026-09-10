# Local File Format Reference

All test cases and test sets are persisted as JSON files under `.ava-lifecycle/<slug>/`.

## Test Case File

**Path:** `.ava-lifecycle/<slug>/test-cases/<kebab-case-slug>.json`

```json
{
  "agent_id": "<uuid>",
  "name": "Happy Path - Check Balance",
  "type": "scripted",
  "language": "en-US",
  "test_config": {
    "trajectory": [...]
  },
  "x_eval": {
    "persona": "...",
    "goal": "...",
    "start_context": {},
    "turns": [
      { "source": "fixed_user", "text": "..." },
      { "source": "fixed_agent", "text": "...", "match": "semantic" },
      { "source": "actor", "note": "..." }
    ],
    "reference_trajectory": [...],
    "rubric": [...],
    "attempts": 1,
    "max_turns": 10,
    "success_threshold": 0.8
  },
  "metadata": {
    "id": "happy-path-check-balance",
    "created_at": "2025-01-15T12:00:00+00:00"
  }
}
```

### `x_eval` Fields

| Field | Type | Description |
| --- | --- | --- |
| `persona` | string | Who the simulated user is, plus any facts they hold |
| `goal` | string | What the user wants and an explicit goal-completion definition ("Done when …") |
| `start_context` | object | Optional object passed as `inputData` at session creation |
| `turns` | array | Ordered turn array — each declares who produces it (`actor`, `fixed_user`, `fixed_agent`, `tool_result`) |
| `reference_trajectory` | array | Layer 1: expected tool calls, each `{tool, params, match, order}` |
| `rubric` | array | Layer 2: dimension-tagged assertions, each `{id, dimension, assertion, weight}` |
| `attempts` | integer | Repeat count for the success rate (default `1`) |
| `max_turns` | integer | Conversation turn cap (default `10`) |
| `success_threshold` | number | Success-rate threshold to pass the scenario (default `0.8`) |

## Test Set File

**Path:** `.ava-lifecycle/<slug>/test-sets/<kebab-case-slug>.json`

```json
{
  "name": "Acme Order Assistant",
  "agent_id": "<uuid>",
  "test_cases": [
    { "test_case_id": "happy-path-check-balance" },
    { "test_case_id": "guardrail-competitor-pricing" }
  ],
  "metadata": {
    "id": "acme-order-assistant-suite",
    "created_at": "2025-01-15T12:00:00+00:00"
  }
}
```

## Evaluation Run Output

**Path:** `.ava-lifecycle/<slug>/eval-runs/eval-run-YYYY-MM-DD-NNN/`

```
eval-run-2026-07-06-001/
├── scorecard.json
├── scorecard.md
├── scorecard.html
├── happy-path-check-balance/
│   ├── attempt-1.json
│   └── attempt-2.json
└── guardrail-competitor-pricing/
    └── attempt-1.json
```

`attempt-N.json` files are written by the scenario-runner sub-agent as each attempt completes. `scorecard.json`/`.md`/`.html` are written once per run by `generate_scorecard`, called by the main agent after every scenario-runner has finished — never by scenario-runner itself.

### attempt-N.json

Written by scenario-runner immediately after each attempt, before scoring exists. Contains `test_case_id`, `name`, `threshold` (denormalized so `generate_scorecard` can score from files alone), `attempt`, `ended`, the raw `layer1` metrics, `layer2` verdicts (each now also carrying an `assertion` field — the rubric entry's own text), and `response_match` verdicts, plus the full `transcript` (every turn) and, when the scenario declares one, the `reference_trajectory` (full expected-call objects, each `{tool, params, match, order}`) and `tool_calls`/`guardrail_events` observed during the attempt. Also contains a `script_turns` array (the outlined `fixed_user`/`fixed_agent` script, distinct from the full simulated `transcript`) and a `scenario_meta` object (`persona`, `goal`, `opening_message`, `conversation_instructions`, `language`, `max_turns`, `attempts`, `success_threshold`, `start_context`, `name`). No dimension scores or pass/fail live here — those are computed later, once, by `generate_scorecard`. `transcript`, `tool_calls`, `guardrail_events`, `reference_trajectory`, `script_turns`, and `scenario_meta` are not read by scoring (`scorecard.compute_scorecard`) — they exist solely so `scorecard.html`'s renderer can inline the full transcript/rubric-evidence/trajectory detail per attempt; a missing `reference_trajectory` degrades gracefully to a badge-cloud trajectory view instead of a Mermaid diagram.

### scorecard.json

Written once per run by `generate_scorecard`, which scans every `<test_case_id>/attempt-*.json` file under the run directory and scores them. Contains the full result: per-scenario success rates, per-attempt dimension scores, and the overall verdict. Its shape is independent of `scorecard.html`'s richer content — it only ever sees `attempt`, `ended`, `layer1`, `layer2`, and `response_match` (transcript/tool_calls/reference_trajectory never flow into it).

### scorecard.md

A human-readable GFM summary of `scorecard.json` — small enough to read back into context for presenting the Step 5 success-rate table.

### scorecard.html

A self-contained interactive report: a hero (overall verdict + Pass Rate/Total Simulations metric cards + a Results donut chart) followed by "Needs Attention" and "Passing Tests" scenario lists, each row opening a per-scenario modal with Results/Scenario tabs. The Results tab shows three score cards (Success criteria / Tool check / Script match) that double as tab triggers for a detail panel, plus a simulation transcript alongside. Unlike `scorecard.json`/`.md`, it re-reads the full raw `attempt-*.json` files (not just the scored subset) to inline transcripts, rubric evidence, and tool-call detail. Point the author here; do not read its contents back into context.

## Key Rules

1. **Filenames are kebab-case slugs** derived from the name: lowercase → replace non-alphanumeric with hyphens → collapse → trim
2. **test_cases is an array of objects** — `[{"test_case_id": "..."}]` not a flat string array
3. **All persistence uses native file I/O** — no Maya API calls
4. **run_id format** — `eval-run-YYYY-MM-DD-NNN` (zero-padded sequence number per day)
