---
name: ava-critique
description: >
  Review a Genesys Cloud AVA design or published version for quality issues. Use when asked
  to critique, audit, or review an AVA for Polaris 28 compliance, payload correctness,
  test coverage, or deployment readiness. Can review a design artifact or a live published spec.
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# GC AVA Critique

> **Lifecycle:** [dispatch](../ava-dispatch/SKILL.md) → [design](../ava-design/SKILL.md) → [build](../ava-build/SKILL.md) → [test](../ava-test/SKILL.md) → [evaluate](../ava-evaluate/SKILL.md) → **critique**

Review an AVA configuration for issues that would cause incorrect behavior, evaluation failures, or deployment problems.

Critiquing is delegated to the **ava-critique** subagent. Your job is to figure out the target, launch the subagent, then give the author pointed recommendations from the subagent's summary.

---

## Step 1: Resolve the Target

Determine what to critique. Pass **exactly one** of these to the subagent:

**Option A — Design artifact:** `.ava-lifecycle/<slug>/design-artifact.json` (use the full path as `design_artifact_path`)

**Option B — Live version by agent_id:** `agent_id` from `.ava-lifecycle/index.json` or agent name. The subagent resolves the version to critique: it calls `get_latest_published_version` first (ProductionReady); if None, falls back to `get_latest_saved_version` (latest version regardless of status — covers TestReady and Draft).

If both exist, review the design artifact (what will be published) unless the author specifically asks to review the live version.

Do **not** pass the full AVA definition in the prompt. The subagent only needs `design_artifact_path` or `agent_id`; it will load the version definition itself.

Include author-specific focus areas (e.g. "check test coverage", "review guardrails") as priorities, but the subagent still performs a full analysis.

---

## Step 2: Launch the Subagent

Launch the **ava-critique** subagent via the Task tool. Pass the resolved input and any author focus areas in the task prompt.

Do **not** perform the critique yourself — delegate entirely to the subagent and wait for it to return a critique summary.

---

## Step 3: Respond to the Author

Use the subagent's returned report paths, counts, priorities, and prose as the source of truth. Do not read persisted critique output back into context.

Respond with a concise, pointed summary:

```
# AVA Critique Report

Report paths:
  <repeat paths from subagent — e.g. html_path, md_path, json_path, or save_path>

## Errors (must fix before publishing)
- **[Category]** — Description
  Fix: ...

## Warnings (should fix)
- **[Category]** — Description
  Fix: ...

## Info (consider improving)
- **[Category]** — Description

## Summary
[N] errors, [N] warnings, [N] info items
Overall: [Ready to publish / Fix errors first / Needs work]

## Recommended next changes
1. <highest-impact change suggestion>
2. <next change suggestion>
3. <next change suggestion>
```

Keep the response pointed: surface the highest-impact findings and suggested changes. Include the report paths the subagent returned so the author can open the critique output.

---

## After the Critique

- If errors found: route back to [design](../ava-design/SKILL.md) to fix, then rebuild and re-evaluate
- If warnings only: author decides whether to fix or accept risk
- If clean and evaluation has passed: offer production promotion:

> "Critique is clean and evaluation passed. This AVA is currently TestReady. Would you like to promote to production (routes live Botflow traffic to this version)?"

If author confirms, call `publish_version` with `agent_id`, `version`, and `test_only: false`. Update `.ava-lifecycle/<slug>/sage-agent.json` `publish_status` to `"ProductionReady"` and `design-artifact.json` `_meta.local_status` to `"published"`.

If critique is clean but evaluation has **not** been run, recommend running it first:

> "Critique passed — no errors or warnings. Run the evaluate skill to validate runtime behavior before promoting to production."
