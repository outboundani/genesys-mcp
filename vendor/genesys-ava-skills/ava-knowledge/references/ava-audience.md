# AVA customer audience

AVA knowledge is customer-facing. AVA may deliver a retrieved answer directly to an end customer, so every card must be safe and useful without an employee interpreting it first. Facts gathered through research or transformed from supplied material still become customer-safe AVA cards. Source authority does not make internal procedures, team names, thresholds, employee-only navigation, private URLs, or secrets safe to expose.

For canonical research modes and source-lineage handling, see [Research modes and source lineage](research-mode.md). Keep detailed document paths, URLs, and lineage in `.ava-lifecycle/<lifecycle-slug>/knowledge-sources.md`, outside customer-retrievable cards.

## Mandatory metadata

Include this exact plain line on every card:

`Audience: End user / Customer`

Metadata is plain Markdown text, not YAML frontmatter. Put one field per line, for example:

```plaintext
Product: Acme Orders
Audience: End user / Customer
Region: United States
Channel: Web messaging
Last updated: 2026-08-11
```

## Voice

- Address the customer as "you".
- Use warm, direct, plain language and customer-visible product terms.
- State the answer first. Explain only the context needed to act safely.
- Do not expose internal jargon, system names, queues, team names, thresholds, routing rules, approval logic, or handling instructions.
- Never tell the customer to contact an internal role or perform an employee-only action.

## Customer-safe actions

Include steps only when the customer can perform them through an approved customer channel. Name the customer-visible page, control, or support route and explain the expected outcome.

Good:

> Open Order history, select the order, and choose Track shipment. If tracking has not updated for 48 hours, use Contact us and select Delivery problem.

Unsafe:

> Open the administration console, inspect the routing queue, and notify the Logistics tier.

If source material describes an internal procedure, do not translate its internal steps. Instead, write one of these only when supported by the source:

- a customer self-service procedure;
- a customer-facing explanation of what will happen after a request;
- a safe way to contact customer support; or
- no card, when the information is not appropriate for customers.

## Troubleshooting and escalation

Troubleshooting may include safe checks such as confirming entered information, retrying once, checking a customer-visible status, or using a documented recovery option. Do not ask customers to change administrative settings, inspect logs, bypass security, repeatedly retry payments, or share secrets.

Escalation must use a customer-visible route and state what the customer should provide:

> If the payment still fails after one retry, use Secure support in the app and provide the order number and displayed error code. Do not send card details.

Do not name internal teams, tiers, queues, severity rules, or approval thresholds. Do not promise an outcome or response time unless the authoritative source explicitly guarantees it.

## Policy and sensitive topics

- Explain how a policy affects the customer and what the customer may or must do.
- Preserve eligibility, regional, plan, and channel conditions exactly.
- Do not expose anti-fraud logic, internal exception criteria, security controls, or private operational procedures.
- Never include credentials, tokens, payment data, unnecessary personal data, or private URLs.
- For legal, medical, financial, safety, or account-security topics, prefer authoritative supplied or first-party material. If only a reputable third-party source is available, disclose the limitation, obtain explicit author confirmation before using the claim, and provide a documented customer route for help. Omit claims that cannot be grounded safely.

## Card acceptance check

Before accepting a card, confirm:

- `Audience: End user / Customer` appears as a plain metadata line;
- the answer can be delivered directly to a customer;
- every action is available and safe for that customer;
- escalation uses only a documented customer-visible route;
- no internal procedure, navigation, role, threshold, or hidden policy is exposed; and
- the card is self-contained and does not depend on employee interpretation.
