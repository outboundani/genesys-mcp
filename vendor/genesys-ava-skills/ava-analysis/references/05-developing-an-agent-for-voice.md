# 5 Developing an agent for voice

Voice is a different rendering channel for the same Ava version. The `tools`, `types`, type `direction` rules, and tool input/output instructions are all expressed exactly the same way as for chat. What changes is the wording the author puts into `instructions[]` and into each tool's `outputInstructions[]` — voice deployments need spoken-language phrasing, while chat deployments can use light formatting.

A VersionDefinition is a single static payload; Ava does not branch on the runtime modality at the spec level. Sage also does **not** add runtime instructions telling the agent whether the session is in voice or digital mode — only the per-turn language instruction and a small set of global instructions are injected automatically. The agent therefore cannot reliably evaluate prose like "When the conversation is over voice" inside a shared definition. Voice-aware behavior must be encoded in `instructions[]` and `outputInstructions[]` prose, with one of these deployment strategies:

- **Channel-specific definitions (recommended for different behavior):** publish a separate VersionDefinition per channel with instructions written for that channel only — no branching prose needed.
- **Single definition for both channels:** write instruction text that is safe in either channel — typically spoken-language phrasing with no markdown — because the agent has no modality signal to branch on.

# Dynamic instructions

Modality-specific guidance lives in the top-level `instructions[]` array. For a voice-only deployment, write each instruction as a self-contained sentence describing the spoken behavior you want. There is no modality discriminator on `instructions[]`; Ava reads the array verbatim into the published spec and prepends a runtime language instruction at each turn.

A voice-targeted VersionDefinition fragment:

```json
{
  "role": "Customer support agent for ExampleCo.",
  "instructions": [
    "You are on a voice call. Never use markdown, bullets, asterisks, backticks, headers, or any formatting. Write every reply as plain spoken English prose.",
    "Keep every reply to at most 3 sentences.",
    "Say numbers the way a person would speak them: 'Friday' not 'Fri', 'two forty five' not '2:45', 'twenty dollars' not '$20'."
  ]
}
```

A chat-targeted VersionDefinition fragment:

```json
{
  "role": "Customer support agent for ExampleCo.",
  "instructions": [
    "Use light markdown formatting when it helps readability."
  ]
}
```

If a single VersionDefinition must serve both channels, do **not** branch on modality in instruction prose — the agent has no runtime voice/digital signal. Use channel-neutral spoken phrasing instead (works in chat too, even without markdown):

```json
{
  "instructions": [
    "Never use markdown, bullets, asterisks, backticks, headers, or any other formatting; write every reply as plain spoken English prose.",
    "Keep every reply to at most 3 sentences.",
    "Say numbers the way a person would speak them — 'Friday' not 'Fri', 'two forty five' not '2:45', 'twenty dollars' not '$20'."
  ]
}
```

For genuinely different behavior per channel (e.g. read confirmation numbers in chat but text them on voice), publish separate VersionDefinitions — one per deployment channel.

Ava automatically appends a small set of global instructions and prepends a per-turn **language** instruction at publish/runtime. Modality (voice vs digital) is not among the injected instructions, so the author does not need to declare language or global guardrails manually, but must not assume the agent knows which channel it is on.

# Modality-branched after calling

Per-tool follow-up behavior — what the agent should say after a tool call succeeds — lives in `outputInstructions[]` on the tool. Each entry is a `{when, then}` pair; `when` must be the literal string `"True"`. There is no modality field on `outputInstructions[]` and no runtime voice/digital signal — if you need the same tool to behave differently across voice and chat, publish a separate VersionDefinition per channel rather than branching in `then` text.

A voice-only `cancelReservation` tool that suppresses the confirmation number from the spoken response and instead promises a text message:

```json
{
  "tools": [
    {
      "type": "DataAction",
      "name": "cancelReservation",
      "description": "Cancel a reservation and return a confirmation receipt.",
      "targetId": "<hedwig-data-action-id>",
      "targetName": "cancel_reservation",
      "inputs": [
        {
          "targetName": "reservationId",
          "type": "ReservationId",
          "source": "User",
          "required": true
        }
      ],
      "output": "CancellationReceipt",
      "inputInstructions": [
        "Use this tool only after the customer has confirmed they want to cancel."
      ],
      "outputInstructions": [
        {
          "when": "True",
          "then": "Tell the customer the cancellation succeeded. Do NOT read the confirmation number aloud — say you are texting it to the number on file."
        }
      ]
    }
  ]
}
```

The chat-only equivalent for the same tool reads back the confirmation number and refund amount instead:

```json
{
  "outputInstructions": [
    {
      "when": "True",
      "then": "Confirm the cancellation and display the confirmation number and refund amount."
    }
  ]
}
```

If a single VersionDefinition has to cover both channels, use channel-neutral `then` text that works in either deployment, or publish separate definitions per channel for genuinely different post-tool behavior:

```json
{
  "outputInstructions": [
    {
      "when": "True",
      "then": "Tell the customer the cancellation succeeded and that the confirmation details will be sent to the contact method on file — do not read long confirmation numbers aloud."
    }
  ]
}
```

The `CancellationReceipt` struct itself is declared once in `types[]` with `direction: "output"`; both channels share the same shape. Ava handles the result-copying semantics automatically based on the type direction, so the author does not need to mark anything `must_copy`.

### Voice conversation tips

These guidelines shape how `instructions[]`, `inputInstructions[]`, and `outputInstructions[]` should be written for voice deployments:

1. **Collect one piece of information per turn.** Don't ask for ID and PIN in the same turn. Express this as a top-level instruction such as `"Collect identifiers one at a time over voice — for example, ask for the account number first and only ask for the PIN after the account number has been confirmed."` See "Collecting multiple inputs from the user for a function call" for the broader pattern.
2. **Avoid long alphanumeric identifiers over voice.** Speech-to-text is unreliable on isolated letters and digits, so where possible redirect the user to another channel (SMS, chat, email). Encode this either as a top-level instruction or as a guarded `inputInstructions[]` entry on the affected `DataActionTool` — for example, `"If the customer needs to provide a confirmation code longer than six characters, offer to continue in chat or SMS instead of asking them to spell it aloud."`
3. **Read back key information.** A short read-back confirms what was actually heard. Express this in `instructions[]` (`"After the customer gives you an address, phone number, or email, repeat it back in the form 'I heard <value>, is that correct?' before using it in any tool call."`). You can pair this with an aliased type whose `userUtteranceSubstring: true` is set so the platform locks the value to the user's actual spoken substring.
