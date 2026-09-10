---
name: ava-knowledge
description: >
  Authors, validates, and uploads customer-facing Genesys Cloud Knowledge Fabric
  FileUpload content for AVA. Use when creating demo/POC knowledge, transforming
  documents into AI-ready cards, researching public information, or ensuring a
  FileUpload Knowledge Source and Knowledge Setting through the harness.
compatibility: ava-harness
metadata:
  version: 1.5.1
  author: Genesys Cloud Services, Inc.
license: MIT. See root LICENSE file.
---

# AVA Knowledge — author and upload customer knowledge

> **Scope:** AVA design Step 5 and Knowledge Fabric **FileUpload / File Connector API** only. Not Workbench V2, SharePoint UI connectors, or Knowledge Base V1 article APIs.

## Purpose and audience

Create Markdown cards that AVA can retrieve to answer an end customer safely and accurately, then upload the intended corpus through harness MCP tools. Every card is customer-facing:

- include the plain metadata line `Audience: End user / Customer`;
- address the customer as "you" in warm, plain language;
- include only actions a customer can safely perform;
- describe customer-visible support or escalation routes, never internal teams or procedures.

Read `references/ava-audience.md` and `references/knowledge-fabric-rules.md` before authoring. The golden test is: *If AVA saw only this card, could it give the customer a complete, correct, safe answer?*

Target size is **~100–300 words (~150–400 tokens)** per card. Use one intent per card, self-contained text, consistent labels, and the templates in `references/use-case-templates.md`.

## Local artifacts and names

Keep uploadable cards under:

`.ava-lifecycle/<lifecycle-slug>/knowledge/`

The **lifecycle slug** is a local, filesystem-safe AVA/use-case identifier. It determines the artifact directory only. It is not a Genesys resource name.

When upload is in scope, separately propose and confirm:

1. the exact, case-sensitive **Knowledge Source name**; and
2. the exact, case-sensitive **Knowledge Setting name**.

The two resource names may differ. Never derive either name from the lifecycle slug without confirmation, never hardcode a shared name, and never require source and setting to share a name. Source capacity is limited (about 10 is typical), so prefer intentional reuse.

Store the canonical all-mode source-lineage ledger outside the upload corpus:

`.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`

Do not create `Sources.md`, source notes, URLs, or provenance files inside `knowledge/`, and do not include `knowledge-sources.md` in an upload.

## Workflow

### Authoring modes

Present these modes in this exact order:

1. **Transform (recommended)** — safely convert supplied documents into retrieval-ready cards. Recommend this when authoritative source material exists because it minimizes unsupported claims, but require explicit confirmation; never select it silently.
2. **Research** — build a complete corpus from public sources when supplied documents are not available or are not intended to define the content.
3. **Combined** — transform supplied documents and use public research only to fill confirmed gaps.

Follow the detailed mode and lineage rules in `references/research-mode.md`. Mode selection does not authorize synthetic content; synthetic content always requires separate explicit consent and must follow `references/synthetic-content.md`.

### Step 1 — Confirm inputs

Confirm only what is missing:

1. **Authoring mode** — explicitly confirm Transform, Research, or Combined. Confirm this as a separate decision; never infer it from the inputs or lifecycle slug and never default silently.
2. **Lifecycle slug** — local artifact directory identifier.
3. **Inputs** — supplied documents, public research topic, or both.
4. **Scope** — products, regions, channels, topics, and approximate card count.
5. **Brand context** — customer-facing names, terms, plans, and support routes.
6. **Upload details**, if applicable — source name, setting name, BCP-47 generation language, and Full or Incremental synchronization.

### Step 2A — Transform

1. Read every supplied document fully before authoring. Supplied documents are authoritative wherever they speak.
2. Identify each distinct customer intent: task, question, issue, rule, or concept.
3. Transform safely: preserve meaning, make implicit logic explicit, restate critical table or image content in plain text, and never invent a fact.
4. Give every transformed claim a stable source locator, such as document title plus page, heading, or section, in `.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`. Keep detailed paths and locators outside `knowledge/` and outside the upload.
5. For a gap, omit it, ask to switch to Research or Combined mode, or separately request explicit consent for synthetic content. If approved, follow `references/synthetic-content.md` and include its required disclosure in each synthetic card.
6. Exclude credentials, private URLs, payment data, unnecessary personal data, internal procedures, and agent/admin-only actions.

### Step 2B — Research

1. Before authoring, present this disclaimer: the corpus will be synthesized from public sources, is not verified against internal documents, and may contain volatile facts. Proceed only after the author acknowledges it.
2. Research enough public material to create the complete confirmed corpus. Prefer first-party sources, but use suitable third-party sources when necessary.
3. Cross-check consequential facts, including eligibility, pricing, limits, policy, safety, and escalation claims. Disclose limitations of third-party evidence instead of overstating certainty.
4. Record fact-to-URL lineage in `.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`. Keep URLs and detailed research notes outside `knowledge/` and outside the upload.
5. Map each customer intent to one of the six templates in `references/use-case-templates.md`.
6. Ask separately before creating any synthetic content. If approved, follow `references/synthetic-content.md` and include its required disclosure in each synthetic card; otherwise omit unsupported gaps.

### Step 2C — Combined

1. Read every supplied document fully. Treat supplied documents as authoritative wherever they speak, and research only confirmed gaps.
2. Apply the Research disclaimer before public research and authoring.
3. Deduplicate supplied and researched material by customer intent. Do not create two cards that answer the same question.
4. Surface conflicts to the author; never blend contradictory claims. Record both sources and the author's resolution or decision in `.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`.
5. Preserve lineage for both supplied-document claims and researched claims. Keep detailed locators, paths, URLs, and decisions outside `knowledge/` and outside the upload.
6. Ask separately before creating any synthetic content. If approved, follow `references/synthetic-content.md` and include its required disclosure in each synthetic card.

For every mode, follow `references/research-mode.md`, exclude unsafe or internal-only material, and keep the uploadable cards free of provenance details.

### Step 3 — Author each card

For every card:

1. Choose one template from `references/use-case-templates.md`.
2. Add plain metadata lines, not YAML frontmatter. `Audience: End user / Customer` is mandatory. Add `Product:`, `Region:`, `Channel:`, and `Last updated:` when useful.
3. Front-load the Task, Answer, Rule, Issue, or Definition.
4. Make the card self-contained and explicit. Repeat product, region, plan, and channel when needed. Never say "see above" or rely on a neighboring card.
5. Use customer-safe voice, actions, and escalation guidance from `references/ava-audience.md`.
6. Keep one intent and ~100–300 words. Split long or branching content.

Separate cards with `---`. Group them by type, creating only files that are needed:

```plaintext
.ava-lifecycle/<lifecycle-slug>/knowledge/
├── faqs.md
├── sops.md
├── troubleshooting.md
├── configuration.md
├── policies.md
├── concepts.md
└── _SYNTHETIC.md
```

`_SYNTHETIC.md` is allowed only when synthetic content was explicitly approved.

### Step 4 — Validate

Run `validate_knowledge` in strict mode against every uploadable Markdown file. AVA Markdown validation is mandatory: fix all FAIL findings, address WARN findings, and never disable upload validation. Manually confirm the mandatory Audience line, one intent, customer safety, and the golden test for every card.

### Step 5 — Preflight and upload

Before any write, perform read-only discovery and show the author a preflight summary:

1. Confirm source name, setting name, BCP-47 language, absolute upload paths, and sync type.
2. Call `list_resources(resource_type="knowledge_source", fetch_all=true)` and select the exact, case-sensitive source name client-side. Use the complete result set for exact-name duplicates and source-capacity reporting.
3. Call `list_resources(resource_type="knowledge_setting", name="<confirmed-setting-name>", fetch_all=true)`. The backend query is prefix-based, but `list_resources` exact-filters the complete results case-sensitively; stop on duplicate exact names.
4. State whether each resource exists or would be created, source type, exact-name duplicates, source count/capacity risk, language, upload paths, and Full/Incremental impact.
5. Obtain explicit confirmation before mutation.

`ensure_knowledge_source` is the authoritative source-type and exact-name gate. `ensure_knowledge_setting` is the authoritative compatibility check: it verifies exclusive binding to the resolved source, Answer generation, stateful Search with context, no source filtering, and generation language. Discovery is informative; do not claim compatibility until ensure succeeds.

Write tools may be hidden when `AVA_KNOWLEDGE_UPLOAD_DISABLED=true`. If so, stop after discovery and validation.

## Synchronization semantics

- **Full** requires `confirm_full_replacement=true` and a complete intended corpus. It replaces all files in the source with exactly the supplied upload set. Do not use a partial folder.
- **Incremental** requires `confirm_incremental=true` and explicit additions or updates. Omitted files remain; warn that stale or conflicting older content can still be retrieved.

Do not default the sync type. Before confirmation, list the exact files and classify the set as the complete intended corpus or as explicit additions/updates.

## Granular artifact flow

Use this order and report each result truthfully:

1. `validate_knowledge` — mandatory strict validation for Markdown.
2. `ensure_knowledge_source` — reuse or create the confirmed FileUpload source; its authoritative result reports `workflowStatus=source_ready`. If an ambiguous create cannot be reconciled, it reports `outcome_unknown` with no source ID; stop and inspect remote state before retrying.
3. `upload_knowledge_documents` — pass the complete result from source ensure as `source_context`, then synchronize the confirmed files. Markdown validation is enforced. On success it returns synchronization status, ingestion status, and possibly a partial `uploadResultPath` whose artifact contains source/upload evidence but no setting.
4. Require successful terminal readiness: synchronization `status=Completed` and `ingestionStatus=Complete`. A started upload, ticket PUT, or partial artifact is not complete.
5. `ensure_knowledge_setting` — pass the resolved source ID, separately confirmed setting name, and the upload's returned `uploadResultPath`. Compatibility is verified here, and ensure finalizes that artifact with the setting.
6. Report the finalized `knowledge-upload-result.json`, which must include the ensured setting as well as source, synchronization, and file evidence. Do not present the partial upload artifact as final. If ensure cannot finalize it, report that failure and the partial status explicitly. An unreconciled setting mutation is `outcome_unknown`, not `setting_failed`; inspect remote state before retrying.

On upload failure before synchronization completion is attempted, the tool attempts to cancel the open synchronization. After completion is attempted it never cancels: it returns `workflowStatus=outcome_unknown` with stage/error evidence so the author can inspect the remote state without blindly retrying. Never call a failed, cancelled, pending, ambiguous, or partial flow successful. Never persist presigned URLs, signed headers, OAuth tokens, or credentials.

See `references/public-api-upload.md` for the detailed contract.

## Handoff to AVA design Step 5

After the complete artifact is finalized, return only to AVA design Step 5. Report the setting ID/name, source ID/name, sync type and terminal statuses, uploaded file list, and final `uploadResultPath`. Attach the setting as:

```json
{
  "type": "KnowledgeSetting",
  "name": "Search customer knowledge",
  "targetId": "<knowledge-setting-uuid>",
  "targetName": "<confirmed-setting-name>",
  "description": "Customer-facing knowledge available to this AVA.",
  "inputInstructions": ["Use this knowledge to answer customer questions accurately."]
}
```

## Final checklist

- The explicitly confirmed mode is Transform, Research, or Combined; it was not silently defaulted.
- For Research or Combined, the public-synthesis disclaimer was presented and acknowledged.
- Every card has `Audience: End user / Customer` as a plain metadata line.
- Voice, actions, troubleshooting, and escalation are customer-safe.
- Every mode has claim-level lineage in `.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`; provenance, detailed paths, locators, and URLs are outside the upload.
- Research cross-checks consequential facts and discloses third-party limitations.
- Combined mode keeps supplied documents authoritative where they speak, fills only confirmed gaps, deduplicates intents, and records surfaced conflicts plus their decisions.
- Synthetic content has separate explicit consent, follows `references/synthetic-content.md`, and carries the required in-card disclosure.
- Strict validation passed; upload validation was not disabled.
- Full contains the complete intended corpus, or Incremental contains explicit additions/updates.
- Discovery used `fetch_all=true`; setting prefix results were exact-filtered; ensure verified source type and setting compatibility.
- Final artifact includes source, terminal sync statuses, files, and setting; partial/failure states were reported honestly.
- Handoff returns to AVA design Step 5 only.

## References

- `references/knowledge-fabric-rules.md` — retrieval model and authoring rules. Read first.
- `references/use-case-templates.md` — six AVA customer card templates.
- `references/ava-audience.md` — mandatory customer audience, voice, actions, and escalation.
- `references/research-mode.md` — Transform, Research, Combined, disclaimer, and lineage rules.
- `references/synthetic-content.md` — permission, isolation, and labeling for demo content.
- `references/public-api-upload.md` — File Connector lifecycle and result artifact contract.
