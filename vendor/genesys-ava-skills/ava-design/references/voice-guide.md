# Voice-Mode Best Practices

Apply these when the role specifies voice as a response mode.

## TTS Formatting

- No special characters: avoid `*`, `#`, `@`, `/`, `|`, `<`, `>` in agent responses
- Spell out abbreviations: "order number" not "ORD #", "dollar amount" not "$amt"
- Natural sentence structure — TTS reads punctuation differently than chat
- No markdown (bold, italic, bullets) — meaningless in voice
- Use natural sentence structure for lists instead of bullet points

## Shape Text for TTS — Don't Control Audio

The agent generates text; the TTS engine converts it to audio. Do not instruct the agent to control audio properties directly — shape the text so TTS produces better speech.

Anti-patterns (don't work):

- "Speak slowly when reading numbers" — the agent cannot control speech rate
- "Add a pause after the account number" — the agent cannot insert pauses
- "Use a friendly voice" — the agent cannot change voice characteristics

Instead, shape the text:

- Separate digits with spaces: "1 2 3 4 5" reads more clearly than "12345"
- Put important values in their own short sentence (creates a natural pause)
- Use punctuation strategically — periods create longer pauses than commas

## Confirmation Loops

- Always read back critical information: "Just to confirm, your order number is 1-2-3-4-5. Is that correct?"
- Use phonetic disambiguation for confusing characters: "B as in Bravo, D as in Delta"
- Do NOT use yes/no confirmation before extracting a must-copy value — if the user says "yes" the value is not in the latest utterance and extraction fails

## 3-Point Limit per Turn

- Voice users cannot scroll back — limit each agent turn to 3 key points maximum
- Break longer information into follow-up turns: "I have three things to share. First..."
- If more information is needed, ask if the caller wants to continue

## ASR Error Handling

- If the caller's input is unclear, ask them to rephrase rather than guessing
- Provide alternatives: "You can also spell it out letter by letter"
- Don't blame the user: "Let me make sure I have that right" — not "You weren't clear"

### Partial Input Handling

ASR may deliver partial inputs. Instead of apologizing or saying "I didn't hear you," confirm what was heard and ask for the rest.

Pattern:

- Caller provides partial value → confirm what was received, ask for remaining
- Do NOT apologize repeatedly or say you didn't hear them
- Do NOT ask them to repeat the entire value from the beginning

Example:

- Caller: "My code is 2 4 5"
- Agent: "I heard 2 4 5 so far. What are the remaining digits?"
- Caller: "6 6 5 7 8"
- Agent: "I have the full code as 2 4 5 6 6 5 7 8. Is that correct?"

### Rephrasing on Confusion

When the caller doesn't respond as expected, rephrase your question — do not repeat the exact same words. Approach the topic differently or provide examples.

## Event Messages for Voice

- Keep short and conversational
- No special characters
- Escalation: "Let me connect you with someone who can help. Please stay on the line."
- UserExit: "Thank you for calling. Have a great day!"
- Guardrail warning: "I can only help with [domain]. Is there something else I can assist with?"

## Voice-Friendly Formatting

When generating content for voice responses, apply these translations:

| Written form | Voice-friendly form |
| --- | --- |
| Hyphens in ranges (2-3 days) | "2 to 3 days" |
| Dates (01/27) | "January twenty-seventh" |
| Currency ($25) | "twenty-five dollars" |
| Abbreviations (e.g., SR, ID) | Full words ("for example", "service request", "identifier") |
| Special characters (@, #, &) | Spelled out ("at", "number", "and") |

Do not assume punctuation sounds the same across TTS engines. Test with the production TTS engine and voice — not only in text preview.

## Localization for Voice

When non-English or multi-language support is detected:

- Consider formality conventions (formal vs. informal address)
- Adjust currency and date spoken formats for the locale
- Account for gendered language if the TTS voice requires agreement
- Test each supported language separately — guidelines that work in English voice may not work the same in other languages

## Instructions to Add for Voice Agents

When voice mode is detected, suggest adding these instructions:

1. "Keep all responses to 3 key points or fewer per turn."
2. "Spell out all numbers, dates, and codes for clarity."
3. "After providing critical information, pause and ask if the caller understood."
4. "If the caller's input is unclear, ask them to repeat it rather than guessing."
5. "Never use markdown formatting, bullet points, or special characters in responses."
6. "When presenting options, number them ('Option one... Option two...') for easy selection."
