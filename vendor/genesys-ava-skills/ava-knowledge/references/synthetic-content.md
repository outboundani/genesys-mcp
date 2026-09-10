# Synthetic AVA content

Synthetic content is allowed only for explicitly approved demo or POC gaps. Supplied documents remain authoritative. Public research may fill explicit gaps; invention may not.

## Location and names

Uploadable synthetic cards live only in:

`.ava-lifecycle/<lifecycle-slug>/knowledge/_SYNTHETIC.md`

The lifecycle slug identifies the local artifact directory. It is separate from the confirmed Knowledge Source and Knowledge Setting resource names.

The canonical all-mode source-lineage ledger belongs outside the upload corpus in:

`.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`

This is the canonical all-mode lineage ledger. Follow the schema in [AVA knowledge research modes](research-mode.md).

Do not create `Sources.md` or provenance notes inside `knowledge/`, and do not upload `knowledge-sources.md`.

## Permission and gap handling

- Ask before generating any synthetic fact or placeholder.
- Use supplied documents as authoritative and do not alter their claims to fit synthetic content.
- Use public research to fill only explicit gaps, record its URLs outside the corpus, and deduplicate by customer intent.
- Surface conflicts between supplied material, public research, and proposed synthetic content.
- If permission is declined, omit the gap.
- Representative prices, retention periods, SLAs, eligibility rules, or other policy values require explicit confirmation that they are demo stand-ins.
- Record the unsupported gap, affected `_SYNTHETIC.md` card, explicit consent context and date, approved placeholder limits, and the absence of authoritative support in `knowledge-sources.md`.

## Isolation and labeling

Keep all synthetic cards in `_SYNTHETIC.md`; never mix them into grounded files. Begin the file:

> ⚠️ SYNTHETIC DEMO CONTENT — not verified facts. Generated for demonstration only.

Every synthetic card must include these plain metadata lines, not YAML frontmatter:

```plaintext
Audience: End user / Customer
Source: SYNTHETIC (demo)
```

Add `Product:`, `Region:`, `Channel:`, and `Last updated:` as separate plain lines when useful.

## Customer safety and quality

- Follow [AVA customer audience](ava-audience.md), [use-case templates](use-case-templates.md), and [Knowledge Fabric authoring rules](knowledge-fabric-rules.md).
- Keep one customer intent per card, self-contained, ~100–300 words, and front-loaded.
- Include only customer-safe actions and customer-visible support routes.
- Never invent or expose internal procedures, teams, thresholds, system navigation, security controls, private URLs, credentials, payment data, or personal data.
- Prefer generic demo-safe wording over concrete claims that could be mistaken for company policy.
- Do not promise outcomes or response times without an explicitly approved placeholder.

## Validation and upload

Strict AVA Markdown validation is mandatory. Never disable validation for `_SYNTHETIC.md`. Before Full or Incremental confirmation, identify `_SYNTHETIC.md` as demo-only and list it explicitly in the intended upload set.

- Full synchronization requires the complete intended corpus, including synthetic content only when it is intentionally part of that corpus.
- Incremental synchronization must identify `_SYNTHETIC.md` as an explicit addition or update.

Do not describe synthetic content as verified research or a faithful transform. The final upload artifact and handoff must truthfully identify the uploaded file.

## Checklist

- [ ] Explicit permission was received.
- [ ] The unsupported gap and consent context/date are recorded in `knowledge-sources.md`.
- [ ] The gap was not already answered by supplied or researched material.
- [ ] Conflicts were surfaced and intents deduplicated.
- [ ] All synthetic cards are only in `_SYNTHETIC.md`.
- [ ] The banner is first and every card has both mandatory metadata lines.
- [ ] Voice, actions, and escalation are customer-safe.
- [ ] Strict Markdown validation passed.
- [ ] The author was told exactly what synthetic file Full or Incremental would upload.
