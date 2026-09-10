---
name: ava-dispatch
description: >
  Dispatch to the correct step of the full Genesys Cloud AVA lifecycle. Use when an author wants to create a new AVA,
  update an existing one, or run the complete design → build → test → evaluate → critique flow.
  Always starts here — detects org context, lists existing AVAs, and routes to the right skill.
compatibility: ava-harness
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# GC AVA Dispatcher

> **Lifecycle:** **dispatch** → [design](../ava-design/SKILL.md) ⇄ [knowledge](../ava-knowledge/SKILL.md) → [build](../ava-build/SKILL.md) → [test](../ava-test/SKILL.md) → [evaluate](../ava-evaluate/SKILL.md) → [critique](../ava-critique/SKILL.md)

This skill is the entry point for every AVA authoring session. It establishes org context, reads any local sessions, checks for staleness against GC, and routes to the correct skill.

---

## Step 0: Read Local Workspace

Before calling any API, check the local `.ava-lifecycle/` directory.

**Read `.ava-lifecycle/index.json`** if it exists. This file lists every AVA the author has worked on locally with its slug, agent_id, last known GC version, and status.

```json
{
  "avas": [
    {
      "name": "Acme Order Assistant",
      "slug": "acme-order-assistant",
      "agent_id": "agt-abc123",
      "gc_version": "2.0",
      "local_status": "published",
      "last_updated": "2026-06-08T10:00:00Z"
    }
  ]
}
```

`local_status` values:

- `design-in-progress` — design artifact exists, not yet complete
- `design-complete` — design artifact saved, not yet created in GC
- `published` — last known sync was successful
- `stale` — local detected it was behind GC at last check

If `index.json` does not exist, the workspace is fresh — proceed to Step 1.

---

## Step 1: Establish Intent (do NOT bulk-fetch AVAs)

The org may contain hundreds of AVAs. Listing them all floods the context window, so **never call `list_resources(resource_type="ava")` without a filter at startup.**

If the author's message already makes their intent clear (e.g., "I want to create a banking AVA", "help me update my order bot"), act on it directly — do not re-ask what they want to do. Only present the menu below if the intent is genuinely ambiguous:

> "What would you like to do?
>
> 1. Create a new AVA
> 2. Update or resume an existing AVA (I'll need its name)
> 3. Browse all your existing AVAs"

Then act based on the answer:

- **Create new** → do NOT call `list_resources(resource_type="ava")` at all (the build skill's `create_ava` is idempotent and checks for name collisions itself). Set `mode = new`, proceed to Step 5.
- **Update/resume a specific AVA** → ask for the AVA name (or a fragment), then call `list_resources(resource_type="ava", name="<fragment>")` to locate just that AVA. Proceed to Step 2.
- **Browse all** (explicit request only) → call `list_resources(resource_type="ava", fetch_all=true)` and present the summarized list. Proceed to Step 2.

If `list_resources` fails with a connection error: tell the author to check `AVA_HABITAT` and their Genesys OAuth credentials in MCP config, then stop.

Always cross-reference the local index from Step 0 first — if the author's AVA is already a known local session, you may not need to call `list_resources(resource_type="ava")` at all.

---

## Step 2: Present View and Get Author Choice

Merge the local index (Step 0) with whatever `list_resources(resource_type="ava")` returned (a filtered match or, only on explicit request, the full summarized list) into one view.

**If no local sessions and no GC AVAs:**

> "No AVAs found. Let's create your first one. What would you like your AVA to do?"

Set `mode = new`. Proceed to Step 5.

**Otherwise, present the combined list:**

> "Here are your AVAs:
>
> Local sessions:
>
> 1. Acme Order Assistant — design-complete (never published)
> 2. Billing Support AVA — published (GC v2.0, last synced 2 days ago)
>
> Live in GC (no local session):
>
> 3. Password Reset Bot — v1.0 (Active)
>
> Would you like to create a new AVA, resume a local session, or update a live AVA?"

Wait for author choice:

- **Create new** → set `mode = new`, proceed to Step 5
- **Resume local session** (has `agent_id`) → set `mode = update`, proceed to Step 3 (staleness check)
- **Resume local session** (no `agent_id`, `design-complete`) → set `mode = new` (was never published), skip Step 3, proceed to Step 5 routing to build
- **Update live AVA** (no local session) → set `mode = update`, note `agent_id`, skip Step 3, proceed to Step 4

---

## Step 3: Staleness Check (resume with agent_id only)

Read `.ava-lifecycle/<slug>/sage-agent.json` for `_meta.gc_version`.

Call `get_latest_published_version` with the `agent_id` to get the current live version.

Compare local `gc_version` vs live version:

| Situation | What to do |
| --- | --- |
| **Match** — local version equals live | "Local matches GC v[N] — resuming." Proceed to Step 4 based on what artifacts exist. |
| **GC ahead** — live version is higher than local | Present the 3-way choice below. |
| **No version found** — `get_latest_published_version` returns nothing | "The AVA this session was tracking has no published versions. Treat as a new AVA, or discard this local session?" |

**When GC is ahead — ask the author:**

> "Your local session is on v[local] but GC is now on v[live]. This could mean a colleague edited the AVA, or you published from another machine.
>
> How would you like to proceed?
>
> 1. **Pull GC version** — load the live v[live] config as your starting point (recommended)
> 2. **Continue local** — keep your local changes and publish over v[live]
> 3. **Start fresh** — discard the local session and begin a new design"

**Option 1 — Pull GC version:**

- Call `get_latest_published_version(agent_id)` to fetch the live **editable `VersionDefinition`** (`role` / `instructions` / `guardrails` / `tools` / `types` / `events`). This is the schema the build skill publishes.
- Overwrite `.ava-lifecycle/<slug>/design-artifact.json` with that definition, preserving `_meta.slug`
- Update `_meta.agent_id`, `_meta.gc_version` to the live values, set `_meta.last_synced_at` to now
- Update `index.json` entry: `local_status = "published"`, `gc_version = live version`
- Proceed to Step 4 in `update` mode (pre-populated from the live definition)

**Option 2 — Continue local:**

- Keep artifacts as-is. Warn:
  > "Proceeding with local v[local] config. Publishing will create v[live+1] over the current live v[live]."
- Proceed to Step 4 in `update` mode

**Option 3 — Start fresh:**

- Delete `.ava-lifecycle/<slug>/` and remove the entry from `index.json`
- Proceed to Step 5 in `new` mode

---

## Step 4: Route Resume to Correct Skill

Based on which artifacts exist in `.ava-lifecycle/<slug>/`:

| Artifacts present | Resume from |
| --- | --- |
| `design-artifact.json` only | [design](../ava-design/SKILL.md) (update mode, pre-populated) or [build](../ava-build/SKILL.md) |
| `design-artifact.json` + `sage-agent.json` | [test](../ava-test/SKILL.md) |
| `design-artifact.json` + `sage-agent.json` + `test-cases/` + `test-sets/` | [evaluate](../ava-evaluate/SKILL.md) |

Ask the author to confirm:

> "Resuming [AVA name] from the [X] step. Want to continue there, or go back further?"

For update mode (`mode = update`): proceed to Step 4b below before routing.

---

## Step 4b: Classify the Update (update mode only)

Ask: "What would you like to change?"

Wait for the author's description, then route to [design](../ava-design/SKILL.md) in update mode. The design skill handles both targeted edits and new capability additions (tool discovery, intent extraction, etc.) internally.

---

## Step 5: Hand Off

| Mode | Next skill |
| --- | --- |
| `new` | [design](../ava-design/SKILL.md) |
| `update` | [design](../ava-design/SKILL.md) (pre-populated from `current_spec`) |
| Fabric content needed first | [knowledge](../ava-knowledge/SKILL.md) → then design Step 5 |

**When to route to `ava-knowledge`:** the author needs new Knowledge Fabric FileUpload content, research/transform of docs into Fabric cards, or ensure/upload of a source + Knowledge Setting before attaching tools. Prefer knowledge first when design would otherwise block on a missing `KnowledgeSetting` / `KnowledgeBase` target.

Carry forward into the design skill:

- `mode` (`new` or `update`)
- `slug` (derived from AVA name for new; from index for resume)
- `agent_id` (update/resume mode only)
- `current_spec` (update mode only — loaded in Step 3 or 4b)
- Author's stated intent / change description
- When returning from knowledge: confirmed source/setting names and setting `id` for Step 5
