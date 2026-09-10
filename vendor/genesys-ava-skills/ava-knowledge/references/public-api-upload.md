# Knowledge Fabric FileUpload contract

Scope: AVA design Step 5 using FileUpload / File Connector only (Malac sources and synchronizations; Tesseract settings). Use harness MCP tools, not direct Genesys API calls or custom upload scripts.

## Local and remote naming

- `.ava-lifecycle/<lifecycle-slug>/` is the local artifact directory.
- The exact, case-sensitive Knowledge Source name is separately confirmed.
- The exact, case-sensitive Knowledge Setting name is separately confirmed.
- Source and setting names may differ. Neither is implied by the lifecycle slug.
- Provenance stays outside the corpus at `.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`.
- Follow [Research modes and source lineage](research-mode.md) for canonical mode and lineage requirements. Detailed document paths, URLs, and lineage remain in that external provenance file, never in customer-retrievable cards.

## Read-only preflight

Before mutation:

1. Call `list_resources(resource_type="knowledge_source", fetch_all=true)`. Select the exact source name client-side from the complete set. Use the complete set to detect duplicate exact names and report exact source count/capacity.
2. Call `list_resources(resource_type="knowledge_setting", name="<setting-name>", fetch_all=true)`. The backend filter is prefix-based, but `list_resources` exact-filters the complete returned set case-sensitively; stop on duplicate exact names.
3. Report existing/would-create state, source type, duplicate names, capacity risk, absolute file paths, BCP-47 language, and Full/Incremental impact.

Discovery does not prove compatibility. `ensure_knowledge_source` verifies exact source naming and FileUpload type. `ensure_knowledge_setting` verifies setting compatibility.

Source capacity is limited (about 10 is typical). Prefer deliberate reuse. If writes are hidden by `AVA_KNOWLEDGE_UPLOAD_DISABLED=true`, stop after discovery and validation.

## Tools and required sequence

1. `validate_knowledge` — strict Markdown validation is mandatory. The skill must never disable upload validation.
2. `ensure_knowledge_source` — reuse or create the separately confirmed FileUpload source.
3. `upload_knowledge_documents` — pass the full source-ensure result as `source_context`, then sync, request upload tickets, PUT bytes, complete, and wait for readiness.
4. `ensure_knowledge_setting` — pass the upload's returned `uploadResultPath`; reuse or create the separately confirmed setting bound to the resolved source and finalize that artifact.
5. Finalize and report `knowledge-upload-result.json` with source, upload, files, and setting.

Required permissions:

- `knowledge:source:view`, `knowledge:source:add`
- `knowledge:synchronization:view|add|edit|upload`
- `knowledge:knowledgeSetting:view|add|edit`

## Sync modes

- **Full** requires `confirm_full_replacement=true`. The upload set must be the complete intended corpus because all source files are replaced by exactly this set.
- **Incremental** requires `confirm_incremental=true`. The upload set must be explicit additions or updates; omitted files remain and may conflict with new content.

Do not default the mode. List every intended file before confirmation. Never upload `knowledge-sources.md` or any provenance file. Both Full and Incremental upload sets must explicitly exclude `knowledge-sources.md` and every provenance or lineage artifact.

## File and validation checks

Before starting a synchronization, the harness validates local paths:

- supported extensions are `.txt`, `.md`, `.doc`, `.docx`, `.csv`, `.xls`, `.xlsx`, `.html`, and `.pdf`;
- disallowed characters, maximum 255-character names, leading `.`, `..`, and control characters are rejected;
- basenames are NFC-normalized and unique case-insensitively across at most 500 files; and
- symlinks are rejected.

Every Markdown card must pass strict AVA validation, including `Audience: End user / Customer`. Validation cannot be bypassed by this skill.

## Granular lifecycle and artifact states

The upload operation:

1. starts the synchronization;
2. creates a ticket and uploads each file;
3. patches the synchronization to `Completed`; and
4. waits until `status=Completed` and `ingestionStatus=Complete`.

If a step fails before completion is attempted, the harness attempts to patch the open synchronization to `Cancelled`. Once completion is attempted, the harness does not cancel; a completion/readiness error returns `workflowStatus=outcome_unknown` and must be inspected rather than blindly retried. Report the actual observed outcome. A started, uploading, pending, cancelled, failed, or ambiguous synchronization is not successful.

On successful upload, `upload_knowledge_documents` can return an `uploadResultPath`. At this point the artifact may be **partial**: it records source/upload evidence but has no Knowledge Setting. Pass the resolved source ID and returned `uploadResultPath` to `ensure_knowledge_setting`; ensure finalizes the same sanitized result artifact with the compatible setting. Only that enriched artifact is the final handoff artifact. If ensure cannot enrich it, report the failure, partial artifact, and missing setting evidence explicitly; do not label it complete.

The final artifact should contain:

- source ID/name/type and reuse/create state;
- synchronization ID/type plus terminal status and ingestion status;
- uploaded filenames, counts, hashes, and local paths;
- setting ID/name/language, binding, and reuse/create state; and
- timestamps and final `uploadResultPath`.

Never persist upload URLs, ticket headers, OAuth tokens, or credentials.

## Setting compatibility

`ensure_knowledge_setting` verifies that a reused or newly created setting:

- is bound exclusively to the resolved source ID;
- has Answer generation enabled;
- has stateful Search with context enabled;
- has no source filtering; and
- has the confirmed generation language.

Only generation language may be patched automatically during compatible reuse. Do not claim a setting is compatible based on list results alone. AVA normalizes the confirmed BCP-47 value; the Genesys Knowledge Configuration API determines whether that language is supported.

## Public API map

- List/create sources: `GET/POST /api/v2/knowledge/sources`
- Start sync: `POST .../sources/{id}/synchronizations`
- Upload ticket: `POST .../synchronizations/{id}/uploads`
- PUT bytes: ticket HTTPS URL, held in memory only
- Complete/cancel: `PATCH .../synchronizations/{id}` with status
- Ready: `status=Completed` and `ingestionStatus=Complete`
- Settings: `GET/POST/PATCH /api/v2/knowledge/settings`

The final setting UUID is attached only in AVA design Step 5 as the `KnowledgeSetting` tool's plain UUID `targetId`.
