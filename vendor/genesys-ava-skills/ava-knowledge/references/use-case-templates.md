# AVA customer use-case templates

Use one template per customer intent. Each card targets ~100–300 words (~150–400 tokens), stands alone, and can be delivered directly by AVA. Follow [Knowledge Fabric authoring rules](knowledge-fabric-rules.md) and [AVA customer audience](ava-audience.md). For canonical research modes and source-lineage handling, see [Research modes and source lineage](research-mode.md).

Whether facts are supplied, researched, or transformed, put only customer-safe content in these cards. Keep detailed source paths, URLs, and lineage in the external `.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`, not in customer-retrievable cards.

Every card must include plain metadata lines immediately before its template fields:

```plaintext
Product: <customer-visible product or service>
Audience: End user / Customer
Region: <region when relevant>
Channel: <channel when relevant>
Last updated: <YYYY-MM-DD when known>
```

Do not use YAML frontmatter. `Audience: End user / Customer` is mandatory on every card.

## Choosing a template

- **SOP:** one customer task or decision path.
- **FAQ:** one customer question with a direct answer.
- **Troubleshooting:** one customer-visible problem and safe resolution.
- **Configuration:** one setting the customer is allowed to change.
- **Policy:** one rule that affects the customer.
- **Conceptual:** one customer-relevant concept.

## 1. SOP

Use for one customer self-service task. Omit any employee-only procedure.

```plaintext
Product: <product>
Audience: End user / Customer
Task:
<How to perform one customer action>
Purpose:
<When this applies and why>
Prerequisites:
- <Customer-visible requirement>
Procedure:
1. <Safe action in a customer channel>
2. <Next action>
Outcome:
<What the customer should see when complete>
Exceptions / Rules:
- If <customer-visible condition>, then <safe customer action or support route>.
```

Good example: updating a delivery address before an order ships. Split separate outcomes or regional paths into separate cards. Do not include administrative navigation, internal approval steps, or internal escalation targets.

## 2. FAQ

Use one natural customer question and answer it immediately.

```plaintext
Product: <product>
Audience: End user / Customer
Question:
<Full question as a customer would ask it>
Answer:
<Direct, complete answer>
Notes:
- <Customer-relevant condition, limitation, or safe next step>
```

Good example: "Can I change my delivery address after placing an order?" Name the subject, region, plan, and channel when they affect the answer. Split materially different conditions instead of writing one long "it depends" response.

## 3. Troubleshooting

Use for one customer-visible issue. Resolution steps must be safe for the customer.

```plaintext
Product: <product>
Audience: End user / Customer
Issue:
<Problem in customer language, including a displayed error code when useful>
Symptoms:
- <Customer-visible symptom>
Possible Causes:
- <Cause safe and useful to disclose>
Resolution Steps:
1. <Safe customer check or action>
2. <Documented recovery action>
Escalation:
- If <condition>, use <customer-visible support route> and provide <non-sensitive details>.
```

Good example: a password reset email has not arrived. Never ask the customer to inspect logs, change administrative settings, bypass security, expose secrets, or contact an internal team.

## 4. Configuration

Use only for a setting the customer can change through a customer-facing experience.

```plaintext
Product: <product>
Audience: End user / Customer
Task:
<Change one customer setting>
Purpose:
<Why and when the customer would change it>
Prerequisites:
- <Plan, account, or channel requirement>
Procedure:
1. Open <customer-visible page or menu>.
2. Set <customer-visible control> to <value>.
3. Save or confirm.
Validation:
- <What the customer should see>
Rollback:
- <How the customer can safely undo the change, when relevant>
```

Good example: enabling order-status notifications in Account preferences. If only an employee can configure the feature, do not make a Configuration card; explain customer availability or the documented request path in an FAQ.

## 5. Policy

Use one atomic rule with explicit customer scope and conditions.

```plaintext
Product: <product>
Audience: End user / Customer
Policy Title:
<Customer-relevant rule>
Scope:
<Customer, product, region, plan, channel, or transaction>
Rule:
<One must / must not / may statement>
Conditions:
- <When the rule applies or does not apply>
Examples:
- Allowed: <customer example>
- Not allowed: <customer example>
```

Split rules that vary by region, plan, channel, or transaction type. Do not expose internal approval thresholds, fraud signals, exception handling, or private policy sources. Keep source URLs and lineage in the external `knowledge-sources.md` ledger, not in the card.

## 6. Conceptual

Use for one concept the customer needs to understand.

```plaintext
Product: <product>
Audience: End user / Customer
Concept:
<Customer-visible feature or idea>
Definition:
<Direct plain-language definition>
Key Points:
- <What it does>
- <When the customer uses or encounters it>
Important Distinctions:
- <How it differs from a nearby customer-visible concept>
Example:
<Short customer scenario>
```

Lead with the definition. Avoid internal architecture, organizational roles, implementation history, and marketing language. Split multiple concepts into separate cards.

## Template-wide checks

- Plain metadata lines are used; no YAML frontmatter.
- `Audience: End user / Customer` appears on every card.
- One intent, one template, and one customer outcome per card.
- Critical values and conditions appear in prose, not only in tables or images.
- Actions and escalation follow [AVA customer audience](ava-audience.md).
- Cards are separated with `---` in upload files.
