# Knowledge Fabric authoring rules

This is the "why" behind the skill. Read it once before authoring; the rules stop feeling arbitrary once you understand how retrieval actually works.

> Source of truth: this distills the official Genesys guide **"Knowledge Fabric — Best Practices for AI Answer Quality"** (© 2025 Genesys). When the guide and this file ever disagree, the guide wins — but the rules below are a faithful, complete summary.

**The golden test — apply it to every section you write:** *"If the AI only saw this section, could it give a complete, correct answer to the question this section is meant to address?"* If not, add the missing context (or split the section). Every rule here is just a way of passing that test.

## The mental model documented in the 2025 guide

The 2025 Genesys guide documents **Amazon Bedrock standard chunking + Titan Text Embeddings v2**. Use current Genesys documentation as authoritative if this behavior has changed:

- Every document is automatically split into **fixed ~400-token / ~300-word chunks**. You do not control where the cuts land — the system does, by size.
- At answer time, retrieval embeds the user's question and pulls the **top ~3 matching chunks**, which are the *only* context the LLM sees to write the answer.
- Titan v2 retrieves best when chunks are **focused (~150–400 tokens)**, have **clear headings**, and **don't mix multiple intents**.

Consequences you must design around:

- If one section covers several tasks, a query can retrieve a chunk holding a **blended or half-finished** procedure. The answer will be wrong or partial.
- If the answer to a question is spread across distant parts of a page, the needed pieces may never land in the same chunk. The model can't reassemble what retrieval didn't co-locate.
- Tables and images are **not ingested reliably** today, so anything critical living only in a table or screenshot is effectively invisible to the model.

So: **author for chunks, not for pages.** The unit of work is a small, labeled card that maps to one real user question.

> Direction of travel (context, not something to author for): standard fixed-size chunking today; hierarchical/semantic chunking and multimodal embeddings are being evaluated for the future. Author for today's fixed chunks.

## Top 3 rules

1. **One intent per section.** Split content so each local section answers a single task, question, issue, rule, or concept.
2. **Self-contained text.** Assume the model only sees that section. Include the essential steps, rules, scope, and role in the same block.
3. **Consistent structure and labels.** Use the templates (Task, Question, Answer, Procedure, Rule, Scope, etc.) to create clean chunk boundaries.

## The 10 general best practices

1. **Design for chunks, not pages.** Treat each card (SOP card, FAQ, issue card, config task, rule card, concept card) as the retrieval unit. Aim ~150–400 tokens (~100–300 words): small enough to stay in one chunk, large enough to be self-contained. Avoid long scrolling narratives; use short, well-labeled sections that map to real questions.
2. **One intent per section.** One SOP task or decision path; one FAQ question; one issue/error; one configuration task; one atomic policy rule; one concept. If a section tries to cover several, split it.
3. **Self-contained text (no hidden dependencies).** Each card includes enough context (product, feature, role, region) to stand alone, plus every critical step/rule/definition needed to answer its question. Avoid "see above/below" for essential information — briefly repeat what matters in each card.
4. **Tables: mirror critical information in text.** Tables aren't ingested reliably, so never put limits, thresholds, or mappings *only* in a table. Restate the key rows as plain text — "For EU, retention is 180 days. For US, 365 days." — and turn mappings into if/then sentences: "If the queue is in region EU, set retention to 180 days." Keep tables for humans, but treat them as visual aids, not the model's source.
5. **Images/diagrams/screenshots: supportive only.** Images aren't used by the model today. Never let a rule or step exist only in an image. Restate it in nearby text: describe the diagram ("The call enters the IVR flow, then routes to the 'Support - EN' queue") and the screenshot ("Set Policy type to Voice and Direction to Inbound"). Use descriptive captions and repeat key info in the body.
6. **Clear, consistent headings and labels.** Use predictable labels per pattern (see [use-case templates](use-case-templates.md)) and keep spelling and order consistent across documents so chunking and retrieval recognize the pattern.
7. **Make logic explicit in text.** Express rules and decisions as explicit text, not implied. Use if/then, must/must not/may, and concrete criteria. Replace "get help if necessary" with "If tracking has not updated for 48 hours, use Contact us and select Delivery problem." For policy and configuration especially, write deterministic statements AVA can safely reuse verbatim.
8. **Front-load key information.** Put the most important line at the top: SOP → the Task + short Purpose; FAQ → the question and direct answer; Troubleshooting → the issue and main symptoms; Policy → the rule and scope; Conceptual → the definition. Detail, examples, and edge cases come after.
9. **Use simple, unambiguous language.** Prefer short sentences and customer-visible wording ("Open Order history and choose Track shipment" over "check the order system"). Avoid internal jargon, and avoid pronouns ("this", "that", "they") whose referent is not obvious *within the same card*.
10. **Use plain metadata lines.** Do not use YAML frontmatter. Every AVA card must include `Audience: End user / Customer` on its own line. Add `Product:`, `Region:`, `Channel:`, and `Last updated:` as separate plain lines when useful. Metadata disambiguates similar cards and prepares for future filtering.

## The bad → good instinct

Most source content is "bad" for Knowledge Fabric in the same few ways. Train yourself to spot and fix them:

- **Mega-section covering many intents** → split into one card per intent.
- **Vague qualifiers** ("small", "high", "generally", "reasonable period", "some regions", "as appropriate") → replace with explicit criteria, thresholds, and values.
- **Implicit rules** ("escalate if needed") → explicit if/then with who/what/when.
- **Critical info trapped in a table or screenshot** → mirror it in plain text.
- **Cross-references for essential info** ("see the global policy") → summarize the relevant rule inline, then link.
- **Topic-label headings** ("Call recording") instead of real questions → write the actual question a user would ask.
- **Ambiguous pronouns / "Yes, this is supported."** → name the subject: "Yes. Genesys Cloud supports call recording for voice channels."

If you internalize just this list plus the ~100–300-word ceiling, most cards come out AI-ready on the first pass.

## Quick reference cheat-sheet

The official guide's consolidated summary — the most critical rule for every content type:

| Principle | What to do | Why it matters |
| --- | --- | --- |
| **Chunk-fit sizing** | Keep sections at 150–400 tokens (~100–300 words) | Ensures one section ≈ one chunk for clean retrieval |
| **One intent** | One task / question / rule / concept per section | Prevents blended or incomplete answers |
| **Self-contained** | Include all context, steps, and rules in the section | The model only sees the retrieved chunk, not the full page |
| **Text over tables** | Mirror all table data in plain text / if-then rules | Tables are not reliably ingested today |
| **Text over images** | Restate all visual information in nearby text | Images are not processed by the model |
| **Explicit logic** | Use if/then, must/must not, specific thresholds | Deterministic rules yield precise AI answers |
| **Consistent labels** | Use the same heading patterns across all documents | Improves chunk-boundary detection and retrieval accuracy |

Then run the golden test on the section one more time: *"If the AI only saw this section, could it give a complete, correct answer?"*
