---
name: ava-build
description: >
  Build and publish a Genesys Cloud AVA from a design artifact. Use after the design skill
  has produced a design-artifact.json. Handles both new AVA creation and updating an existing
  AVA version. Validates the definition before sending to the Sage API.
compatibility: ava-harness
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# AVA Build

> **Lifecycle:** [dispatch](../ava-dispatch/SKILL.md) → [design](../ava-design/SKILL.md) ⇄ [knowledge](../ava-knowledge/SKILL.md) → **build** → [test](../ava-test/SKILL.md) → [evaluate](../ava-evaluate/SKILL.md) → [critique](../ava-critique/SKILL.md)

Creates or updates an AVA in Genesys Cloud using the design artifact. All payload transformation is handled by the MCP tools — no manual JSON construction needed. Knowledge Fabric uploads happen in [ava-knowledge](../ava-knowledge/SKILL.md) before design attaches the setting — this skill only publishes existing `targetId` references.

## Quick Reference

| Need | Reference |
| --- | --- |
| Sage API payload structure | [sage-api-schema.md](references/sage-api-schema.md) |

---

## Step 1: Read Design Artifact

Read `.ava-lifecycle/<slug>/design-artifact.json`. `slug` is carried forward from the dispatch skill.

- If missing: tell the author to run the design skill first, then stop.
- If `_meta.local_status: design-in-progress`: warn the artifact is partial and confirm they want to proceed.
- Note `_meta.agent_id` (may be `null` for new AVAs) and `_meta.gc_version`.

Validate that the following required fields are present and non-empty:

- `name` (string)
- `role` (string)
- `instructions` (array with at least 1 element)
- `events` (object)

If any required field is missing, report the specific validation error and stop.

---

## Step 2: New or Update?

**New mode** (`_meta.agent_id` is `null`):

- Call `create_ava` with the name from the design artifact.
- The tool is idempotent — if an AVA with this name already exists it returns the existing one.
- Note the `agent_id` from the response.

**Update mode** (`_meta.agent_id` is set):

- Skip `create_ava` — use `_meta.agent_id` directly.
- Proceed to Step 3.

---

## Step 2.5: Pre-Flight Artifact Validation

Before calling `create_version`, scan the design artifact locally for known payload issues that would cause a deterministic 422 failure. Catching these here saves a round-trip and avoids confusing Pydantic errors from the MCP tool.

**Check L5 — ToolOutput type direction:**

For every tool input with `source: "ToolOutput"`:

1. Read the input's `type` value.
2. If `type` is a primitive (`string`, `number`, `boolean`, `integer`) → ❌ **Block.** Report: "Tool '[tool_name]' input '[input_name]' has `type: \"[primitive]\"` with `source: ToolOutput`. The type must be the producer's output type name (e.g. `AccountResult`), not the primitive type of the mapped field. Fix in the design artifact before proceeding."
3. If `type` is not found in the artifact's `types[]` array with `direction: "output"` → ❌ **Block.** Report: "Tool '[tool_name]' input '[input_name]' references type '[type_name]' which is not declared with `direction: \"output\"` in the types array."
4. If `mapping` is present, verify `mapping[0]` equals the `type` value. Mismatch → ⚠️ **Warn.**

**Check T8 — Output types have direction: "output":**

For every tool with an `output` field set:

1. Find the referenced type name in `types[]`.
2. If the type is missing entirely → ❌ **Block.** Report: "Tool '[tool_name]' references output type '[type_name]' which is not declared in types[]."
3. If the type exists but lacks `direction: "output"` → ❌ **Block.** Report: "Tool '[tool_name]' output type '[type_name]' is missing `direction: \"output\"`. Add it to the type declaration."

**Check L11 — User-sourced inputs reference named input types:**

For every tool input with `source: "User"`:

1. If `type` is a primitive (`string`, `number`, `boolean`, `integer`) → ❌ **Block.** Report: "Tool '[tool_name]' input '[input_name]' has `type: \"[primitive]\"` with `source: User`. Create a named type with `direction: \"input\"` and reference it instead."
2. If `type` is not found in `types[]` with `direction: "input"` → ❌ **Block.** Report: "Tool '[tool_name]' input '[input_name]' references type '[type_name]' which is not declared with `direction: \"input\"` in the types array."

**Check L10 — Mock error codes (when DataActions were authored in-session):**

If the design artifact contains inline mock definitions (from `create_mock_data_action` during design):

1. For each mock with an `error` block containing a `code` field:
2. If `error.status` is already set explicitly → no warning needed; a non-canonical `code` is harmless once `status` is set.
3. If `error.status` is **not** set, verify the code is in the canonical set: `bad.request`, `invalid.value`, `not.found`, `resource.not.found`, `forbidden`, `unauthorized`, `conflict`, `too.many.requests`, `rate.limit.exceeded`, `server.internal.error`, `service.unavailable`.
4. If non-canonical and no `error.status` → ⚠️ **Warn:** "Mock error code '[code]' is not canonical and no `error.status` is set — it will silently resolve to HTTP 400. Set `error.status` explicitly or use a canonical code."

**Check N2 — Enum values are valid identifiers:**

For every type with an `enum` array where the type is `"string"`:

1. Validate each value matches `^[A-Za-z_][A-Za-z0-9_]*$`.
2. If any value contains spaces, leading digits, or special characters → ❌ **Block.** Report: "Enum type '[type_name]' has invalid value '[value]'. Enum values must be valid identifiers (no spaces, no special characters). Use PascalCase: e.g. 'ExpiringSoon' not 'Expiring Soon'."

**Start Context checks (when the artifact declares an `InputData` object):**

Locate the single type named `InputData` (`direction: "agentInput"`). If none exists, skip these.

**Check L14 — `description` reserved on InputData:**

1. If the `InputData` object type has a `description` field → ❌ **Block.** Report: "Start Context 'InputData' has a reserved `description` field. Remove it; descriptions belong on the per-property alias types."

**Check T7a — no required Start Context properties:**

1. For every property on `InputData`, if `required: true` → ❌ **Block.** Report: "Start Context property '[name]' has `required: true`, which is always rejected. Remove it and handle mandatory values via a tool input with `fallback_to_user` or by prompting."

**Check T7b — aliased primitive only, no enum:**

1. For every property on `InputData`, resolve its `type` in `types[]`.
2. If the `type` is a bare primitive (`string`, `number`, `boolean`, `integer`) used inline (not a named type) → ❌ **Block.** Report: "Start Context property '[name]' references a bare primitive. Create a named alias type (e.g. `CustomerId` of type string) and reference it."
3. If the resolved type is an enum type (has an `enum` array) → ❌ **Block.** Report: "Start Context property '[name]' references enum type '[type_name]'. Enums are not allowed in Start Context — use a plain string alias instead."
4. If the resolved named type is not one of string/integer/number/boolean → ❌ **Block.** Report: "Start Context property '[name]' type '[type_name]' must alias a bare primitive (string/integer/number/boolean)."

**Check L13 — Start Context property name format:**

1. For every property name on `InputData`, verify ALL of: matches `^[a-z0-9_]+$`; contains at least one `_`; does not start/end with `_`; does not start/end with a digit; no consecutive `__`; every underscore-separated segment is ≥2 chars.
2. On any violation → ❌ **Block.** Report: "Start Context property name '[name]' is invalid: [reason]. Use snake_case with at least one underscore, e.g. `customer_id`."

**Check L15 — External-sourced tool inputs:**

First, build the set of Start Context property types: the `type` values of every property on the `InputData` object (empty if no `InputData`).

For every tool input with `source: "External"`:

1. If `required: true` and `fallbackToUser` is not `true` → ❌ **Block.** Report: "External required input '[target_name]' on tool '[tool_name]' must set `fallbackToUser: true`."
2. If `type` is a bare primitive (`string`, `number`, `boolean`, `integer`) → ❌ **Block.** Report: "External input '[target_name]' on tool '[tool_name]' has bare primitive `type: \"[type]\"`. Reference a named type declared as a property on the `InputData` (Start Context) object."
3. If `type` is not in the Start Context property-type set → ❌ **Block.** Report: "External input '[target_name]' type '[type_name]' is not declared as a Start Context property. Add a property on `InputData` referencing that type."
4. If `fallbackToUser` is not set and the referenced type has `userUtteranceSubstring: true` → ❌ **Block.** Report: "External input '[target_name]' references a userUtteranceSubstring type without `fallbackToUser: true`. Set `fallbackToUser: true` or set `userUtteranceSubstring: false` on the type."

For every tool input where `fallbackToUser: true` but `source` is NOT `External` → ❌ **Block.** Report: "`fallbackToUser` is only valid on `source: \"External\"` inputs; input '[target_name]' on tool '[tool_name]' has source '[source]'."

**On any ❌ Block:** Stop and report all violations. Do not call `create_version` until fixed. The author must update the design artifact (route back to [design](../ava-design/SKILL.md) in update mode).

**On ⚠️ Warn only:** Report warnings but proceed to Step 3.

---

## Step 3: Create Version

Call `create_version` with:

- `agent_id` from Step 2
- `definition` built from the design artifact

The MCP tool validates the full definition via Pydantic before sending. If validation fails, it returns a specific error describing the field issue — fix it in the design artifact and retry. Do not guess at corrections.

Key transformation rules (applied automatically by the tool):

- `instructions` must be plain strings (not `[{"content":"..."}]` objects)
- `guardrails` must be wrapped in `{"rules": [...]}` envelope
- `events` must be a typed array with capitalized type tags
- `types` must be TypeDefinition objects (not channel strings)
- `tools[].inputInstructions` must be an array of strings
- `tools[].output` is required for DataActions whose data is consumed by other tools

See [sage-api-schema.md](references/sage-api-schema.md) for the full transformation rules and ToolOutput mapping documentation.

---

## Step 4: Publish Version

By default, publish the version as **TestReady** — this makes it available for Cicero conversations (testing and evaluation) without routing production Botflow traffic to it.

Call `publish_version` with `agent_id`, `version` from Step 3, and `test_only: true`.

The tool blocks until the publish job completes (configurable via `AVA_PUBLISH_POLL_TIMEOUT`, default 120s) and returns the **raw Sage job JSON**. Read the `status` field, and on failure read the `errors` array — each entry has `message`, `code`, `status`, and `details[].fieldName` pointing at the exact offending field.

| `status` | Action |
| --- | --- |
| `Succeeded` | Proceed to Step 5 |
| `Failed` | Read the `errors` array for field-level detail. This is a **deterministic** failure — DO NOT retry blindly. Fix the specific field in the design artifact, re-run `create_version`, then publish again. |
| `Timeout` | The job may still be running — this is **transient**; safe to retry or increase `AVA_PUBLISH_POLL_TIMEOUT`. |

**Retry rule — deterministic vs transient:**

- `Failed` with `errors[].status` of `400` / `code: bad.request` (or any 4xx) = a payload problem. Retrying the same payload will fail identically. Fix the field named in `details[].fieldName`, then retry.
- `Timeout`, or a `5xx` status = transient backend issue. Safe to retry the same payload.

**Common `Failed` causes** (see [sage-api-schema.md](references/sage-api-schema.md) Known Issues):

- `Invalid expression in outputInstructions` → an `outputInstructions[].when` is not the literal `"True"`. Set every `when` to `"True"` and move conditional logic into the `then` text.
- Output type properties don't match the Data Action schema.
- Required input flags missing.

### Production publish (promotion)

> **⚠️ Production-publish implication — read before promoting.** Publishing an AVA to production **locks the version contract** and causes **Botflow to route production traffic to that version**. This is a live change: real conversations will hit the published version.

A production publish (`test_only: false`) should only happen **after**:

1. The [evaluate](../ava-evaluate/SKILL.md) skill has run and the scorecard passes threshold, AND
2. The [critique](../ava-critique/SKILL.md) has no blocking errors, AND
3. The author has **explicitly requested** promotion to production.

Before calling `publish_version` with `test_only: false`, confirm with the author:

> "Publishing '[name]' to production locks this version's contract and routes Botflow traffic to it. This is a live production change. Do you want me to promote to production now?"

Wait for an explicit **yes** before proceeding. If the author only wants to review, iterate, or test, the TestReady publish is sufficient.

---

## Step 5: Save and Hand Off

Save `.ava-lifecycle/<slug>/sage-agent.json`:

```json
{
  "_meta": {
    "slug": "<slug>",
    "agent_id": "<uuid>",
    "gc_version": "<version>",
    "last_synced_at": "<iso8601>"
  },
  "agent_name": "<name>",
  "version": "<version>",
  "publish_status": "TestReady"
}
```

Update the `_meta` block in `.ava-lifecycle/<slug>/design-artifact.json`:

- Set `agent_id` to the confirmed UUID
- Set `gc_version` to the published version
- Set `last_synced_at` to now
- Set `local_status` to `"test-ready"`

Update `.ava-lifecycle/index.json`:

- Set `agent_id`, `gc_version`, `local_status = "test-ready"`, `last_updated` to now for this slug

Report to author:

> "AVA '[name]' version [version] is published as TestReady — available for evaluation and testing. Running a quality review..."

### Step 5a: Critique (Optional)

After successful publish, check if post-build critique is needed:

1. Read `.ava-lifecycle/<slug>/design-artifact.json` → extract `_meta.critique_status`
2. Apply critique skip logic:

| Critique Status | Action |
| --- | --- |
| `"analysis-clean"` (0 errors, 0 warnings) | Skip to Step 6. Post-build critique not needed — design-time analysis already validated. Author can still request critique explicitly. |
| `"needs-review"` | Run post-build critique as defined below. |
| `null` or missing | Run post-build critique (legacy artifact or analysis skipped). |

**If skipping:**

> "✅ Design analysis was clean (0 errors, 0 warnings). Skipping post-build critique. Proceeding to test phase."

**If running critique:**

> "Running post-build critique to validate the published AVA..."

Then follow the critique process:

1. Call `get_latest_published_version` with `agent_id` to load the live `VersionDefinition`.
2. Run the full critique checklist (Name/Role, Instructions, Guardrails, Tools, Payload Format, Events, Test Cases, Context Variables) as defined in the [critique](../ava-critique/SKILL.md) skill.
3. Present results to the author (Errors / Warnings / Info).

Route based on findings:

| Critique result | Action |
| --- | --- |
| Errors found | "These errors should be fixed before testing. Would you like to address them now?" → route to [design](../ava-design/SKILL.md) in update mode. |
| Warnings only | "Would you like to address these warnings, or proceed to testing?" Author chooses. |
| Clean | "Quality review passed. Ready to set up test cases." → proceed to [test](../ava-test/SKILL.md). |

**Author override:** If author explicitly requests critique ("run critique anyway", "analyze the published AVA"), override skip logic and run critique regardless of status.
