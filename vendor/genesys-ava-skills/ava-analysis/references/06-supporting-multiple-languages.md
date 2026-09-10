# 6 Supporting multiple languages

Every Ava session carries a language code, and the platform uses it to steer the model on every turn. A VersionDefinition whose `instructions` are authored only in English can still support other languages — what changes between languages is the instruction set the model sees on each turn (formality norms, greeting conventions, per-tool wording), not the agent's `types`, `tools`, or control flow.

What Ava does automatically (you do **not** need to author any of this):

- At runtime, Ava prepends a language directive to the agent's `instructions` on every turn: `Your responses must be in {language_display_name}. A user can speak to you in any language but you must respond to the user in {language_display_name}`. You do **not** need an instruction telling the agent to match the customer's language — Ava already binds it to the session language.
- For knowledge tools, Ava swaps the built-in "query is at least three words" precondition to a "query is at least three characters" precondition for non-space-delimited languages (`zh`, `th`, `ja`, `ko`, `my`, `km`, `lo`).

Your authoring job is therefore narrower than it looks: there is **no `supportedLanguages` field on the VersionDefinition itself**. Which languages a session can use is controlled by the surrounding agent / session configuration; the VersionDefinition just needs to carry any per-language tone or wording nuances that aren't covered by "respond in the user's language".

# Where the session language comes from

The language code is supplied per-session by the platform (for example, on the session-start API) and is not part of the persisted VersionDefinition. Do **not** invent a `supportedLanguages`, `languages`, or similar key on the VersionDefinition — the contract has no such field and a publish-time validator will reject unknown fields if `extra_field_behavior` is strict.

If a VersionDefinition is intended for multiple languages, the only authoring change is in `instructions[]`: keep language-agnostic guidance language-agnostic, and add explicit per-language blocks for anything that varies. Ava's per-turn language directive then routes the right block at runtime.

# Per-language tone and formality

The runtime language directive guarantees the model replies in the session language, but it does not encode tone conventions (e.g. Spanish `usted` vs. `tú`, formal greetings, regional phrasing). To express that, write the conventions directly as static entries in `instructions[]`, addressing each language by code so the model can apply the right block.

```json
{
  "role": "You help customers check order status.",
  "instructions": [
    "When the session language is es-ES or es-MX: use a formal but warm tone. Address the customer with 'usted' rather than 'tú'. Greet them with '¡Buenos días!' or '¡Buenas tardes!' as appropriate.",
    "When the session language is en-US: respond in clear, friendly English and greet the customer warmly.",
    "Greet the customer and ask for their order ID before doing anything else."
  ]
}
```

A few notes on this shape:

- `instructions[]` is a list of static behavior strings. There is no platform-level branching primitive on instructions — the language gating is communicated in the instruction text itself, and Ava's per-turn language directive ensures the model applies the right block based on the session language.
- Per-language guidance can be authored in English — e.g. "When responding in Spanish, use the formal 'usted'..." — or in the target language. Both work; choose whichever you find easier to maintain.
- Keep the per-language entries narrow. Anything that applies to *every* language (scope, escalation triggers, ordering rules) should be a separate, language-agnostic instruction so it doesn't need to be repeated for each code.

# Per-tool, per-language wording

When a specific tool needs different phrasing across languages (e.g. the confirmation line after a successful order lookup), express the variants in the tool's `inputInstructions[]` / `outputInstructions[]`. As with top-level `instructions`, there is no `language=` filter on these — the language is identified in the instruction text and Ava's session-level language directive handles the rest.

The example below uses an order-lookup tool whose post-lookup confirmation differs between Spanish and English. The `InputOrderId` aliased type uses `userUtteranceSubstring: true` to require that the order ID be copied verbatim from the user's message, and the verified `OrderId` is a `direction: "output"` aliased type — only produced by a successful lookup.

```json
{
  "types": [
    {
      "name": "InputOrderId",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "Order ID captured verbatim from the user's message."
    },
    {
      "name": "OrderId",
      "type": "string",
      "direction": "output",
      "description": "Verified order ID — only produced by a successful lookup."
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "lookup_order",
      "description": "Validate an order ID the customer provided.",
      "inputs": [
        { "targetName": "input_id", "type": "InputOrderId", "source": "User", "required": true }
      ],
      "output": "OrderId",
      "outputInstructions": [
        {
          "when": "True",
          "then": "When the session language is es-MX: tell the customer, 'Su pedido está en camino. ¿Hay algo más en lo que pueda ayudarle?'. When the session language is en-US: tell the customer, 'Your order is on its way. Is there anything else I can help with?'."
        }
      ]
    }
  ]
}
```

Key points:

- `outputInstructions[]` entries are `(when, then)` pairs. `when` is the literal string `"True"`; the language branching lives inside `then`.
- For pre-call wording (the equivalent of a `before_calling` rule), use `inputInstructions[]` — a list of plain strings — and apply the same "When the session language is XX-XX: ..." pattern in the prose.
- If a tool's wording should be the same across all supported languages, omit the language hints entirely and let the runtime language directive translate the single instruction. Only add language-specific entries where you genuinely need different phrasing.

# Built-in behaviors you do not need to author

Ava always injects the following at publish time and runtime, so they should not appear in the VersionDefinition:

- The per-turn language directive (prepended to `instructions[]` on every turn).
- The three built-in global instructions covering capability disclosure, persona stability, and response length.
- The three built-in defender rules (internal-implementation leakage, persona manipulation, response manipulation).
- The knowledge-tool query precondition and its language-aware variant for non-space-delimited languages.
- The guardrail blocked-reply messages (configured via the optional `Guardrails` event) and the runtime-injected end-of-conversation and human-handoff functions.

Authoring multilingual support is therefore entirely a matter of describing any per-language tone or wording your domain needs in the existing `instructions[]`, `inputInstructions[]`, and `outputInstructions[]` fields. There is nothing language-related to declare at the top level of the VersionDefinition.
