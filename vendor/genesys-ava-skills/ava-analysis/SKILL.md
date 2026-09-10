---
name: ava-analysis
description: >
  Analyze a Genesys Cloud AVA version definition for authoring quality issues and build
  an in-memory AnalysisReport with change suggestions. Used by the ava-critique subagent.
  Applies quick-guide checks first, then deepens findings via cookbook references. Use when
  reviewing an AVA role, tools, knowledge, configuration, or guardrails for best-practice
  violations.
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# AVA Analysis

Auxiliary subagent skill for analyzing an AVA `VersionDefinition` against authoring best practices. Invoked by **ava-critique** — not a lifecycle step on its own. Produces an in-memory `AnalysisReport` that ava-critique passes to `generate_critique_report`.

## Quick Reference

| Need | Reference |
| --- | --- |
| First-pass checks (Agent, Tools, Knowledge, Configuration, Guardrails) | [quick-guide.md](references/quick-guide.md) |
| Anti-pattern → deeper cookbook mapping | [cookbook.md](references/cookbook.md) |

---

## Step 1: Resolve the Target

You receive **exactly one** of:

| Input | Action |
| --- | --- |
| `design_artifact_path` | Read the file (typically `.ava-lifecycle/<slug>/design-artifact.json`) |
| `agent_id` | Call `get_latest_published_version`. If the prompt says to review an unpublished draft, use `get_latest_saved_version` instead. |

Both paths yield a `VersionDefinition` (`role` / `instructions` / `guardrails` / `tools` / `types` / `events` / context variables).

If the file or API call fails, stop and report what is missing.

---

## Step 2: Resolve the Lifecycle Slug Directory

Resolve the lifecycle slug directory for this AVA:

- `.ava-lifecycle/<slug>/` — preferred when slug is known
- `.ava-lifecycle/<agent_id>/` — when only `agent_id` is available

**Slug resolution:**

1. From `design_artifact_path` → use the `<slug>` segment in the path, or `_meta.slug` in the artifact.
2. From `agent_id` → read `.ava-lifecycle/index.json` and match `agent_id` to `slug`.
3. If no slug is found, use the `agent_id` path.

Create the directory if it does not exist. Critique output is stored under `report/` in that directory (handled by `generate_critique_report` — do not write it yourself).

Freshness rule:

- Do not use output from a previous critique run while analyzing.

---

## Step 3: Quick Analysis (quick-guide)

Read [quick-guide.md](references/quick-guide.md) and scan the version definition section by section:

1. **Agent** — Role scope, exclusions, customer term, guideline locality
2. **Tools** — naming, inputs/outputs, instruction placement, backend vs agent logic
3. **Knowledge** — source curation, account-specific data boundaries
4. **Configuration** — start/end context, exit/escalation, wait experience
5. **Guardrails** — blocked inputs only, not normal behavior rules

Also check the **Red flags** and **Instruction locality** sections at the end of the quick guide.

Schema sanity checks to apply on every scan (see `references/cookbook.md` for the canonical conventions):

- Tools must be discriminated by a `type` field with one of `DataAction`, `KnowledgeBase`, `KnowledgeSetting`, `ExternalA2AServer`. Flag any `kind` field, any `*Tool` suffix on the discriminator value (e.g. `DataActionTool`), and any `errorTypes[]` (current contract uses `errors[]`).
- Type definitions are discriminated by shape (`type`, `enum`, `undisclosed`, `direction`); flag any `kind` field on a type entry.
- There is no `supportedLanguages` field on the VersionDefinition. Flag it if present.
- `inputValidation` lambdas can only reference the tool's own input parameters and a small builtin whitelist (`len`, `min`, `max`, `abs`, `int`, `float`, `str`, `bool`, `all`, `any`, `round`, `sum`, `Decimal`, `isinstance`). Flag any reference to other identifiers (e.g. `latest(...)`, session helpers, other tools' outputs).
- Author-supplied `must_copy`, `interstitial_message`, `extra_field_behavior`, or built-in defender / global-instruction text should be flagged as Ava-injected fields that must not be authored.

For each issue found, record:

- **Severity:** error / warning / info
- **Category:** Agent | Tools | Knowledge | Configuration | Guardrails | Red flag
- **Finding:** what is wrong in the definition (cite the field or text)
- **Quick fix:** one-line remediation from the quick guide

Do not stop at the first issue — cover all five sections.

---

## Step 4: Deep Analysis (cookbook)

Read [cookbook.md](references/cookbook.md). For each anti-pattern category flagged in Step 3, load the cookbook reference file(s) it maps to (under `references/`).

Use those references to:

- Confirm or refine each finding
- Add domain-specific change suggestions the quick guide does not cover
- Propose concrete rewrites (Role text, guideline bullets, tool pre-instructions, etc.)

If `cookbook.md` has no mapping yet for a category, keep the quick-guide finding and note that no deeper cookbook reference is available.

---

## Step 5: Build report payload (in memory)

Construct the `report` argument for `generate_critique_report` from your findings. Do **not** write any files — keep the payload in memory for ava-critique to pass to the tool.

1. Read the `generate_critique_report` tool schema for the `report` parameter — field names, types, and required fields. That schema is the source of truth, not this skill.
2. Populate every field you can from Steps 3–4; include optional fields when your analysis produced the data.
3. Set `target` to the `design_artifact_path` or `agent_id` you analyzed.

Rules:

- Every finding from Steps 3 and 4 must appear in the appropriate findings lists — do not drop items.
- Prefer specific, actionable fixes over generic advice.
- Include `source` on each finding so the author knows whether it came from the quick guide or a cookbook reference.
- Fill `summary` with counts, `overall`, `prose`, and `top_priorities` from your analysis.

---

## Step 6: Hand off to ava-critique

Return the in-memory report payload to ava-critique. Do not write critique output yourself — ava-critique calls `generate_critique_report`.
