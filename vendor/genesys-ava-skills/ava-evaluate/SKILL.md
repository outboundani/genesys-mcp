---
name: ava-evaluate
description: >
  Evaluate a published Genesys Cloud AVA by running its locally-stored, turn-based
  scenarios as multi-turn conversations and reporting a success-rate scorecard. Use after the
  test skill has authored scenarios and a test set. Projects cost first (dry run) for
  confirmation, then delegates each scenario to the ava-scenario-runner sub-agent (or runs
  sequentially in fallback), driving the actor loop via the cicero_* tools, applying Layer 1
  deterministic trajectory validation and Layer 2 rubric assertion judging, persisting
  per-attempt results via native file-write, and scoring the whole run in one
  generate_scorecard call after every scenario-runner finishes.
compatibility: ava-harness
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# GC AVA Evaluate

> **Lifecycle:** [dispatch](../ava-dispatch/SKILL.md) → [design](../ava-design/SKILL.md) → [build](../ava-build/SKILL.md) → [test](../ava-test/SKILL.md) → **evaluate** → [critique](../ava-critique/SKILL.md)

Runs the locally-stored, **turn-based** scenarios against the **published** AVA and surfaces a **success-rate scorecard**. Each scenario is driven as a real multi-turn conversation: the host LLM plays a **simulated user (actor)** that adapts to what the AVA says, then acts as an **LLM-as-a-Judge** answering a decomposed rubric with evidence.

Evaluation is **hybrid**:

- **Layer 1 — trajectory validation** — deterministic, code-based comparison of the AVA's actual tool-call path against the scenario's reference trajectory. No LLM involved.
- **Layer 2 — outcome validation** — rubric-driven, assertion-based judgment by the host LLM, with evidence-cited verdicts and no numeric scoring.

Because a live AVA plus an adaptive actor produces a different transcript on every run, **consistency lives in the scoring methodology, not in the transcript** — see [Consistency mechanisms](#consistency-mechanisms).

> **Judging vs scoring:** Layer 2 rubric judging and `fixed_agent` semantic comparison are performed by the host agent's LLM (scenario-runner). MCP tools provide only deterministic validation (`validate_trajectory`) and scoring (`generate_scorecard`).

## Quick Reference

| Need | Reference |
| --- | --- |
| Diagnosing infrastructure errors and failure patterns | [troubleshooting.md](references/troubleshooting.md) |
| Scenario / `x_eval` file layout | design.md "Data Models" |
| Scenario-runner sub-agent contract | `sub_agents/ava_agents/ava-scenario-runner.md` |

| Tool / Operation | Purpose |
| --- | --- |
| (inline computation) | Dry-run projection: read test set + scenarios, compute `sum(attempts × (max_turns + 2))` |
| `cicero_start_session(agent_id, version, language, start_context)` | Create a session, return greeting + first `turn_id` |
| `cicero_send_message(agent_id, session_id, text, previous_turn_id)` | Send a user turn; returns agent text, tool calls, guardrails, `next_action`, `is_terminal` |
| `cicero_end_session(agent_id, session_id)` | Best-effort session cleanup |
| `validate_trajectory(reference, actual_tool_calls, guardrail_events)` | Layer 1 deterministic tool-call comparison |
| `generate_scorecard(eval_run_dir, agent_id, version)` | Scans persisted attempt files, scores the whole run once, writes scorecard.json/.md/.html, returns their paths |
| List past results | List files in `.ava-lifecycle/<slug>/eval-runs/` using native directory tools |

---

## Step 1: Read Prerequisites

Resolve the `agent_id` and `version` to evaluate. Three sources, checked in order:

1. **Author specifies explicitly** — "evaluate version 3.0" or "test the production version"

   - If "production version": call `get_latest_published_version` to resolve the ProductionReady version.
   - If a specific version number: use it directly.
2. **Local lifecycle state** — read `.ava-lifecycle/<slug>/sage-agent.json` for `agent_id` and `version`. This is the version the build skill last published (TestReady or ProductionReady).
3. **No version available** — tell the author to run the build skill first, then stop.

`slug` is carried forward from the dispatch skill.

Identify the `test_set_id` produced by the test skill (test sets live under `.ava-lifecycle/<slug>/test-sets/`).

If `agent_id`/`version` is missing after resolution: tell the author to run the build skill first, then stop. If no test set exists: tell the author to run the test skill first, then stop.

> **Note:** Both TestReady and ProductionReady versions are executable via Cicero when the version number is provided explicitly. The evaluate skill works identically against either.

---

## Step 2: Dry-Run Estimate and Confirm

Before executing anything, compute a dry-run projection inline:

1. Read the test set JSON from `.ava-lifecycle/<slug>/test-sets/<test_set_id>.json`.
2. For each `test_case_id` in the test set, read the scenario from `.ava-lifecycle/<slug>/test-cases/<test_case_id>.json`.
3. Compute: `projected_calls = sum(attempts × (max_turns + 2))` using each scenario's `x_eval.attempts` (default 1) and `x_eval.max_turns` (default 10). The `+2` covers the session-creation NoOp greeting and a final turn budget.
4. Present the estimate and **wait for explicit author confirmation** before running.

If any `test_case_id` referenced in the test set does not have a corresponding scenario file, tell the author which scenarios are missing and route back to the test skill. Do not proceed until confirmed.

> "This run projects **[projected_calls]** Cicero calls across **[scenarios]** scenarios. Proceed?"

---

## Step 3: Run Each Scenario

Generate a single `run_id` for this evaluation in the format `eval-run-YYYY-MM-DD-NNN` (today's date with a zero-padded sequence number, e.g. `eval-run-2026-07-06-001`). If a folder with that name already exists, increment the sequence number. Reuse the same `run_id` for every scenario so all results land in one run folder. Run **one scenario at a time as a unit**; within a scenario, run its `attempts` **sequentially**.

### Delegate to the ava-scenario-runner sub-agent

Launch the **ava-scenario-runner** sub-agent via the Task tool for **each scenario**. Do **not** run the actor loop yourself — delegate entirely to the sub-agent and wait for it to return the list of attempt files it wrote.

Pass it the scenario (`agent_id`, `version`, `language`, and the full `x_eval` block) plus the persistence keys (`slug`, `run_id`). The sub-agent definition lives at `sub_agents/ava_agents/ava-scenario-runner.md`.

The sub-agent runs the whole scenario in an **isolated context** and returns **only the attempt file paths it persisted** — raw transcripts stay out of the main context, and no scoring happens at this stage (**judge-and-discard**). Scenarios **may** run across multiple sub-agents in parallel (host-managed via the IDE Task tool; use a modest concurrency, e.g. 1–2); every Cicero call still funnels through the server's shared rate limiter, so **never add your own throttling, sleeps, or rate-limit prompts**.

### Fallback: single-agent sequential run

Only if the Task tool (sub-agent spawning) is genuinely unavailable in the current runtime, run the scenarios **yourself, sequentially**, using the exact same loop below. The result is equivalent — the only difference is context isolation. Persist each attempt (transcript ref + Layer 1 + Layer 2, no scoring) before starting the next so in-context tokens stay bounded.

### The actor loop (one attempt)

For each attempt, drive one full conversation:

1. **Start a new session** — call `cicero_start_session` with `agent_id`, `version`, `language`, and the scenario's `start_context` (passed as `inputData`). A fresh Cicero session is created per attempt. Capture `session_id`, the `greeting`, and the first `turn_id`. The greeting comes back from a **NoOp** input event handled by the tool.
2. **Walk the `turns` array** — process each turn in order according to its `source`:

   - `actor` — generate the next user message from the persona, goal, and the conversation so far; call `cicero_send_message` with the user text and the **previous `turn_id`**. If the actor signals goal reached (returns null/empty), end the attempt with `ended=goal`.
   - `fixed_user` — send the turn's literal `text` to the AVA via `cicero_send_message`.
   - `fixed_agent` — compare the most-recent live agent turn against the turn's expected `text` via semantic equivalence; record a `response_match` verdict. Do NOT send anything to Cicero or advance the turn budget.
   - `tool_result` — reserved/not-implemented; ends the attempt with `ended=error`.

   Maneuver like a real user on `actor` turns. When the AVA asks for information the persona would plausibly know (auth codes, account details), provide it from the persona and `start_context`. Update your saved `turn_id` from each response.
3. **End the attempt** when any of these is true:

   - the goal-completion condition in `goal` is met, or
   - the AVA returns a terminal next action (`is_terminal` true — `Exit` or `Disconnect`), or
   - `max_turns` is reached (record the attempt as not passed).
4. **Record the full transcript** — every user message, every agent response, every tool call (name, input, output), tool results, and guardrail events. Track `ended` as one of

   `goal | terminal | max_turns | turns_exhausted | error`.
5. **On a turn error**, record the error at that turn and end the attempt with a partial transcript (`ended: "error"`). Do not abort the whole scenario. Optionally call `cicero_end_session` to release the session.

Only the actor's own inputs (persona, goal, `turns`) drive the conversation — the actor **never sees the rubric** (that belongs to the judge only).

### Layer 1 — deterministic trajectory validation

Call `validate_trajectory` with:

- `reference` = the scenario's `reference_trajectory`,
- `actual_tool_calls` = the tool calls collected from this attempt's transcript,
- `guardrail_events` = the guardrail events observed in the transcript.

Use its structural output (`coverage`, `matched_tools`, `missing_tools`, `unexpected_tools`, `order_ok`, `param_mismatches`, `guardrail_violations`) **as-is**. It is pure code — do not re-judge Layer 1 with your own reasoning.

### Layer 2 — rubric assertion judging

Judge the **completed transcript once** (not per turn), over a compact transcript representation (tool calls reduced to name, key parameters, and status). For **each** rubric assertion produce:

- a `verdict` of `pass`, `fail`, or `uncertain`,
- an `evidence` field citing the exact transcript span that justifies it,
- a one-line `reason`.

**Do not emit any holistic or numeric score** — only per-assertion verdicts with evidence. For any assertion you mark `uncertain`, **re-sample only that assertion** (not the whole rubric), up to **3** resamples, and take the majority verdict.

---

## Step 4: Score Once and Persist Reports

Scenario-runner does **not** score anything — it only persists `attempt-<N>.json` files (each carrying `test_case_id`, `name`, `threshold`, `attempt`, `ended`, `layer1`, `layer2`, and `response_match`) and returns their paths. **After every scenario-runner has finished** (or, in fallback mode, after you've run every scenario yourself), call `generate_scorecard` **exactly once** for the whole run:

```
generate_scorecard(
  eval_run_dir="<absolute path>/.ava-lifecycle/<slug>/eval-runs/<run_id>",
  agent_id=<agent_id>,
  version=<version>,
)
```

`generate_scorecard` scans every `<test_case_id>/attempt-*.json` file already on disk under `eval_run_dir`, blends Layer 1 + Layer 2 into per-dimension scores using the same deterministic scoring core as before (you never produce the number), decides each attempt's pass/fail, computes the `success_rate` vs `threshold` per scenario, stamps the `rubric_version`, and records the exact scoring formula (dimension weights + pass threshold). Attempts whose Layer 2 verdicts cannot be parsed are marked `infra_error` — they count in the success-rate denominator but never as passes (never counted as pass).

It then writes three files into `eval_run_dir` and returns their paths plus a `summary`:

```json
{
  "result": "Scorecard generated",
  "json_path": ".../eval-runs/<run_id>/scorecard.json",
  "md_path": ".../eval-runs/<run_id>/scorecard.md",
  "html_path": ".../eval-runs/<run_id>/scorecard.html",
  "summary": { "total": 5, "passed": 4, "failed": 1, "infra_error": 0 }
}
```

Read `scorecard.md`'s content (small, textual) to build the Step 5 presentation below. Do **not** read `scorecard.json` or `scorecard.html` back into context — just echo `html_path` and `json_path` to the author so they can open the interactive report or inspect the raw data themselves.

The canonical folder layout for a completed evaluation run is:

```
.ava-lifecycle/<slug>/eval-runs/<run_id>/
├── scorecard.json                              # full scored payload (raw data)
├── scorecard.md                                # human-readable summary (read this)
├── scorecard.html                              # interactive report (point the user here)
├── <test_case_id>/                             # one folder per scenario
│   ├── attempt-1.json                          # transcript ref + layer1/layer2 for attempt 1
│   └── attempt-2.json                          # (if attempts > 1)
└── <test_case_id>/
    └── attempt-1.json
```

**Naming conventions:**

- `<run_id>` — `eval-run-YYYY-MM-DD-NNN` (date-stamped with a zero-padded sequence number per day, e.g. `eval-run-2026-07-06-001`)
- `<test_case_id>` — the kebab-case scenario slug (same as the filename in `test-cases/`, without `.json`)
- `attempt-<N>.json` — 1-indexed attempt number

This applies identically whether scenario-runner sub-agents were dispatched or you ran the fallback loop yourself — either way, `generate_scorecard` is called **once**, after all scenarios' attempts are persisted, never per scenario.

---

## Step 5: Present the Success-Rate Scorecard

The scorecard reports, **per dimension**, **per attempt**, the **success_rate vs threshold**, and the **rubric_version**.

**Outcome dimensions** — five scored dimensions (four authored in the rubric, one auto-derived):

| Dimension | Weight | One-sentence meaning | Authored? |
| --- | --- | --- | --- |
| **Goal achievement** (`goal`) | 0.35 | Did the AVA accomplish the user's stated objective? | Yes |
| **Tool-usage appropriateness** (`tool_use`) | 0.25 | Did it call the right tools, with correct parameters, in the expected order? | Yes |
| **Guardrail compliance** (`guardrail`) | 0.25 | Did it avoid prohibited behavior (e.g. disclosing data before authentication)? | Yes |
| **Response match** (`response_match`) | 0.10 | Did `fixed_agent` turns match the AVA's actual responses? | No — auto-derived from `fixed_agent` turns |
| **Tone / format** (`tone_format`) | 0.05 | Was the response appropriately concise, professional, and well formatted? | Yes |

Present it like this:

```
═══════════════════════════════════════════════
AVA EVALUATION: [AVA name] v[version]   rubric_version [x.y]
═══════════════════════════════════════════════
Overall: [PASS / FAIL / INFRA ERROR]

Scenarios  PASS [N] / FAIL [N] / INFRA [N]  (total [T])

─── [Scenario name] ───────────────────────────
success_rate  [0.NN]  vs threshold [0.NN]  →  [PASS/FAIL]
  Attempts:
    #1  ended=goal        goal 1.0 · tool_use 1.0 · guardrail 1.0 · response_match 1.0 · tone_format 1.0  → pass
    #2  ended=max_turns   goal 0.0 · tool_use 0.5 · guardrail 1.0 · response_match 1.0 · tone_format 1.0  → fail
    #3  ended=goal        goal 1.0 · tool_use 1.0 · guardrail 1.0 · response_match 1.0 · tone_format 1.0  → pass

─── [Scenario name] ───────────────────────────
success_rate  [0.NN]  vs threshold [0.NN]  →  [PASS/FAIL]
  (Guardrail violation observed in attempt #1 — caps the guardrail dimension.)
═══════════════════════════════════════════════
```

For each **failing** scenario, cite the deciding evidence in one line (a Layer 2 assertion that failed with its quote, or a Layer 1 gap such as a missing tool, out-of-order call, or guardrail violation). **INFRA errors** (unparseable judge output, or the AVA runtime unreachable) are not test failures — see [troubleshooting.md](references/troubleshooting.md).

Results are persisted per run; list files in `.ava-lifecycle/<slug>/eval-runs/` using native directory tools to review or compare past runs.

---

## Consistency mechanisms

A live AVA plus an adaptive actor yields a different transcript every run, so the scorecard is kept comparable across runs at the **methodology** level, not by pinning the conversation:

- **Deterministic code aggregation** — every dimension score, per-attempt pass/fail, and the success_rate are computed in code (`generate_scorecard`) from Layer 1 metrics and Layer 2 verdicts. The LLM never emits a number.
- **Decomposed binary assertions** — Layer 2 is an ordered list of atomic assertions each answered pass/fail/uncertain with cited evidence, rather than one holistic judgment.
- **Versioned rubric** — every result is stamped with `rubric_version`; scores are comparable only within a version, and any rubric/weight/formula change requires a new `rubric_version`.
- **Repeated attempts reported as a success rate** — each scenario runs multiple attempts; the scenario verdict is `success_rate` (passed / total) compared against the `success_threshold`, which absorbs run-to-run variation.

The scoring formula (dimension weights + pass threshold) is persisted in each result so any score can be recomputed by hand from the recorded facts.

---

## Step 6: Recommend Next Steps

| Outcome | Recommendation |
| --- | --- |
| All scenarios PASS | "All scenarios pass threshold — AVA is ready for production promotion." |
| Some FAIL | "Fix the failing scenarios — see the critique skill for diagnosis. Re-run after changes." |
| All INFRA | "Infrastructure issue — AVA runtime unreachable or judge output unparseable. Check the deployment and re-run." |
| Mix of FAIL + INFRA | "Resolve infrastructure first, then address the scenario failures." |

---

## QA Closure

When **all scenarios PASS**, offer production promotion:

> "Evaluation complete — all scenarios pass threshold. This AVA is currently published as **TestReady** (not serving production traffic).
>
> Would you like to:
>
> 1. **Promote to production** — routes live Botflow traffic to this version (irreversible until next publish)
> 2. **Stay in test mode** — keep iterating without affecting production
> 3. **Document a known limitation** and promote anyway"

For option 1: call `publish_version` with `agent_id`, `version`, and `test_only: false`. Update `.ava-lifecycle/<slug>/sage-agent.json` `publish_status` to `"ProductionReady"` and `design-artifact.json` `_meta.local_status` to `"published"`.

> **⚠️ Production-publish implication:** Publishing to production **locks the version contract** and causes **Botflow to route production traffic to this version**. Confirm the author explicitly says **yes** before proceeding.

When scenarios **FAIL** or **INFRA**: route back to [design](../ava-design/SKILL.md) for AVA config changes, or [test](../ava-test/SKILL.md) to adjust scenarios (persona, goal, reference trajectory, or rubric). After any AVA change, re-publish via the build skill before re-running.
