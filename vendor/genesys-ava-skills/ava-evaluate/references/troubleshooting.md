# Evaluation Troubleshooting

## Infrastructure Error Pattern

**Symptoms:**

- Attempt `ended: "error"` with no transcript turns recorded
- Cicero session creation failed or returned immediately
- All attempts in a scenario ended with `error`

**Meaning:** The evaluation runner cannot reach the AVA runtime (Cicero). This is NOT a test logic failure — the AVA was never exercised. The test cases themselves are fine.

**Diagnosis steps:**

1. Verify publish succeeded: call `get_latest_published_version` and confirm version exists
2. Verify `agent_id` matches the published AVA
3. Wait 60–120 seconds — the Cicero runtime may still be initializing after publish
4. Re-run evaluation

If the error persists after 3 retries, escalate to the platform team with:

- `agent_id`
- `version`
- `run_id` (e.g. `eval-run-2026-07-06-001`)
- The relevant `attempt-N.json` transcript file
- Environment (habitat / region)

## Test Failure Patterns

### Agent did not call expected tool

**Cause:** Tool description is not specific enough for the agent to identify when to call it.

**Fix:** Improve `description` and `inputInstructions` in the tool config. Use "Call this when the caller asks about X" language.

### Agent called tool with wrong arguments

**Cause:** Input field names don't match what the DataAction expects, OR the agent is fabricating values instead of collecting them from the caller.

**Fix:**

1. Re-fetch the schema with `get_data_action_schema` and verify field names
2. If the agent is fabricating — the input type needs a `source: User` constraint

### Agent response doesn't match expected

**Cause:** `outputInstructions` are missing or too vague.

**Fix:** Add specific instructions for success and each error code in `outputInstructions`.

### Guardrail test passing when it should trigger

**Cause:** Guardrail rule is too vague for the model to enforce consistently.

**Fix:** Be more specific: "Do not discuss CompetitorX pricing" not "Don't discuss competitors".

## Response Match Issues

### All `fixed_agent` turns failing

**Symptoms:**

- `response_match` dimension score consistently 0.0
- Other dimensions passing normally

**Cause:** The AVA's actual responses don't semantically match the expected text in `fixed_agent` turns. This could mean:

1. The AVA's wording changed after a version update
2. The expected text is too specific (exact phrasing vs intent)
3. The `match` mode is `"exact"` but should be `"semantic"`

**Fix:**

1. Review the transcript in `attempt-N.json` — compare actual vs expected
2. Update `fixed_agent` text to match the AVA's current behavior
3. Consider using `"match": "semantic"` for flexible matching
4. If the AVA's response is intentionally different, update the scenario

### `response_match` not appearing in scorecard

**Cause:** The scenario has no `fixed_agent` turns in its `turns` array.

**Note:** `response_match` is auto-derived only from `fixed_agent` turns. If a scenario uses only `actor` and `fixed_user` turns, no `response_match` verdicts are produced and the dimension scores vacuously **1.0** for that attempt.

## Re-running After Fixes

After any design change:

1. Run build skill to publish a new version
2. Re-run evaluation against the new version — a new `run_id` is generated automatically
3. The test set can be reused — no need to recreate test cases unless scenarios changed
4. Compare results across runs by reading scorecards from `.ava-lifecycle/<slug>/eval-runs/`
