# AVA knowledge research modes

Use exactly one confirmed mode for each authoring run, in this preference order:

1. **Transform (recommended)** — supplied documents provide the strongest grounding.
2. **Research** — public sources can support the full corpus without supplied documents.
3. **Combined** — supplied documents govern what they cover; public research fills confirmed gaps.

Explain the recommendation, present all three choices, and obtain explicit confirmation. Never select a mode from the available inputs or proceed on an assumed default.

## Confirm before authoring

Confirm the mode, lifecycle slug, requested scope, products, regions, channels, brand terms, and approximate card count. For Research or Combined, explain before authoring:

> This content will be synthesized from public sources. It is not equivalent to verified internal documentation, and volatile facts such as prices, availability, eligibility, and policies may change.

For Combined, also confirm the gaps that research may fill. If synthetic fallback may be useful, do not bundle consent into mode confirmation; ask separately only after identifying an unsupported gap and follow [Synthetic AVA content](synthetic-content.md).

## Transform (recommended)

Read every supplied document fully before authoring. Treat supplied documents as authoritative: preserve meaning, do not invent missing facts, and do not use external sources to override them. Identify every customer intent and map each resulting card to:

- supplied filename;
- page, heading, section, or another stable locator;
- import or access date;
- transformation notes; and
- ambiguities, contradictions, or conflicts.

Do not guess through ambiguity or blend conflicting statements. Surface them for a decision. For an unsupported requested gap, offer to omit it, switch to Research or Combined, or separately request consent for synthetic demo content.

## Research

Research may create the complete requested corpus without supplied documents.

1. Search public material and read the relevant pages, not only search-result summaries.
2. Prefer first-party company websites, help centers, product and pricing pages, published policies, FAQs, and press releases.
3. Use reputable third-party sources when first-party coverage is unavailable. Record that limitation. Obtain confirmation before relying on a third-party source for a high-risk claim, including legal, medical, financial, safety, security, eligibility, pricing, or policy claims.
4. Cross-check consequential facts across independent authoritative pages when possible. If that is not possible, record the claim as not cross-checked and disclose the limitation.
5. Record each material fact with its URL, access date, source owner/type, cross-check status, affected card or intent, and limitations. Flag volatile facts for freshness review.
6. Never invent a missing fact. Offer omission or separately approved synthetic fallback.

Map findings to the six AVA-safe card types in [AVA customer use-case templates](use-case-templates.md):

- **SOP** for one customer task or decision path.
- **FAQ** for one customer question and direct answer.
- **Troubleshooting** for one customer-visible problem and safe resolution.
- **Configuration** for one setting the customer may change.
- **Policy** for one rule affecting the customer.
- **Conceptual** for one customer-relevant concept.

Research does not make internal or unsafe material suitable for AVA. Apply [AVA customer audience](ava-audience.md) and omit internal procedures, controls, and escalation paths from customer cards.

## Combined

Read supplied documents fully first and identify the exact gaps approved for research. Supplied documents prevail wherever they speak; research fills only confirmed gaps. Deduplicate by customer intent so one question does not produce competing cards.

When sources overlap or conflict, do not blend claims. Surface the conflict, record both lineages, and obtain or record the decision about what the card will say. The ledger must identify which source prevailed and why. An unresolved conflict blocks the affected card.

## Canonical all-mode lineage ledger

Keep the canonical ledger at:

`.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`

This file applies to Transform, Research, Combined, and synthetic fallback. It is outside `knowledge/`: never upload it or copy detailed local paths, filenames, URLs, or lineage notes into customer cards.

Use this concrete Markdown structure, omitting inapplicable fields rather than fabricating values:

```markdown
# Knowledge source lineage

Mode: Transform | Research | Combined
Lifecycle slug: <slug>
Ledger updated: <YYYY-MM-DD>
Scope: <confirmed scope>
Public-research disclaimer acknowledged: <yes/no/not applicable; date/context>

## <card filename> — <card heading or intent>
Card type: SOP | FAQ | Troubleshooting | Configuration | Policy | Conceptual
Intent: <one customer intent>
Decision/status: <included, omitted, blocked, or pending confirmation>

### Transform lineage
Supplied file: <filename or workspace-relative identifier>
Stable locator: <page + heading/section, or another durable locator>
Import/access date: <YYYY-MM-DD>
Transformation notes: <split, rewrite, table/image extraction, or none>
Ambiguity/conflict: <details or none>

### Research lineage
Fact/claim: <material fact supporting this card>
URL: <https://...>
Source owner/type: <owner; first-party help center, official policy, reputable third-party, etc.>
Access date: <YYYY-MM-DD>
Cross-check status: <cross-checked + independent URL(s), not possible, or not consequential>
Volatility: <stable or what may change>
Limitation/conflict: <coverage, authority, disagreement, or none>

### Combined decision
Gap approved for research: <gap and confirmation context/date>
Overlap/conflict: <both claims or none>
Prevailing source and decision: <supplied document/research; who confirmed, when, and why>

### Synthetic consent
Unsupported gap: <fact or intent no authoritative source supports>
Affected synthetic card: <_SYNTHETIC.md heading>
Consent: <explicit approval, context, and YYYY-MM-DD>
Grounding status: No authoritative source supports this demo claim.
Approved placeholder limits: <scope/values approved, or none>
```

Repeat `Research lineage` for each consequential claim or source. In Combined entries, retain both Transform and Research sections even when one source prevails. Synthetic entries supplement, never replace, the mandatory in-corpus banner and metadata.

## Final checks

- [ ] The author explicitly confirmed Transform, Research, or Combined after seeing all choices.
- [ ] The mode-specific precedence and public-research disclaimer were followed.
- [ ] Every card or intent has complete mode-appropriate lineage in the external ledger.
- [ ] Consequential researched facts were cross-checked when possible; limitations and volatility are visible.
- [ ] Combined gaps were confirmed, intents deduplicated, and conflicts surfaced with decisions.
- [ ] Unsupported claims were omitted or separately approved under the synthetic safeguards.
- [ ] Cards use one AVA-safe template and pass the customer-safety and golden checks in [Knowledge Fabric authoring rules](knowledge-fabric-rules.md).
- [ ] `knowledge-sources.md` is not in the upload set and customer cards contain no detailed lineage paths or URLs.
