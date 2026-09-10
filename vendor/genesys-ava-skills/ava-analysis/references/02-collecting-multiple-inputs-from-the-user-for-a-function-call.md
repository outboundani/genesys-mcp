# 2 Collecting multiple inputs from the user for a function call

Many customer-service tasks are conversational forms: collect N fields in order, validate each one, confirm the ones that matter, present a summary, and submit.

In a VersionDefinition, a form is built from four pieces:

1. **Form name** — a short phrase every instruction references to scope its effect (e.g., "sign up for a new account form"). The form name is load-bearing — pick one and use it verbatim in every instruction.
2. **Field types** — entries in `types[]` representing the data to collect. Atomic fields are aliased types; composite fields are object struct types whose properties reference those aliases.
3. **Submit tool** — a `DataActionTool` in `tools[]` that is called after all fields are collected and confirmed.
4. **Workflow instructions** — plain strings in the top-level `instructions[]` array that control ordering, confirmation, validation, and early termination.

The trigger and workflow instructions belong in the VersionDefinition's `instructions[]` array. Tool-specific guidance (for example, "do not call this tool until X") may also live in the submit tool's `inputInstructions[]`.

The instructions and examples below assume a chat-based agent. For voice agent specifics, reference §5 Developing an agent for voice.

```json
{
  "instructions": [
    "Begin the 'sign up for a new account' form when the user wants to register a new user account.",
    "To complete the sign up for a new account form, you must complete the following in order:\n\n1. You must collect the following field(s) from the user: first name, date of birth, ZIP code.\n\n2. You must ask for a final confirmation of all the fields.\n\n3. You must call the register_user tool with the collected fields.",
    "The user may exit the sign up for a new account form whenever they indicate they don't want to continue."
  ]
}
```

## Defining fields

An **atomic field** is a single value — a first name, a ZIP code, a year. Define each one as an aliased type in `types[]` with `direction: "input"` and `userUtteranceSubstring: true`. The platform uses these two flags to require that the value was copied verbatim from a user utterance:

```json
{
  "types": [
    {
      "name": "FirstName",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "First name captured verbatim from the user's message."
    },
    {
      "name": "ZipCode",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "A 5 digit US ZIP code captured verbatim from the user's message."
    }
  ]
}
```

A **composite field** bundles atomic fields the agent treats as one top-level field — for example, a date of birth made of year + month + day. Each sub-field is its own aliased type (same pattern as `FirstName` above), and the composite is an object struct type whose properties reference those aliases:

```json
{
  "types": [
    {
      "name": "Year",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "4 digit year string 'YYYY'."
    },
    {
      "name": "Month",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "The two-digit month string 'MM'."
    },
    {
      "name": "Day",
      "type": "string",
      "direction": "input",
      "userUtteranceSubstring": true,
      "description": "The two-digit day string 'DD'."
    },
    {
      "name": "DateOfBirth",
      "type": "object",
      "description": "Date of birth as three separate numeric strings.",
      "properties": [
        { "name": "year", "type": "Year", "required": true },
        { "name": "month", "type": "Month", "required": true },
        { "name": "day", "type": "Day", "required": true }
      ]
    }
  ]
}
```

The composite struct has **no `direction: "output"`** — it is constructed by the agent from collected sub-fields and passed into the submit tool as a `User`-sourced parameter. Do not give it `direction: "output"`: that flag means "values of this type must come from a tool return," and no tool returns the composite. The platform accepts the configuration at publish time, but at runtime the agent cannot satisfy the type requirement and loops trying to call the submit tool.

> **Note:** Data Action tool inputs only support primitive types. Passing a composite or struct type directly as a tool input may fail at publish time or runtime. Flatten composite fields into separate primitive inputs on the submit tool instead — for example, pass `year`, `month`, and `day` as three separate `User`-sourced parameters rather than a single `DateOfBirth` struct.

Author note: you do not declare anything like `must_copy` or `extra_field_behavior` on these types. The platform computes those automatically — `userUtteranceSubstring: true` on the atomic aliases is enough to enforce verbatim capture, and the composite struct inherits the verbatim guarantee through its sub-field references.

## Ordering, confirmation, and validation

Three instruction patterns control the form's conversational behavior. All three live as plain strings in the top-level `instructions[]` array.

### Field ordering

The single most important instruction. Use this phrasing, adapted to your field names. For composite fields, add a sub-field ordering instruction:

```json
{
  "instructions": [
    "When in the sign up for a new account form, you must collect the fields one at a time in the following order: first name, date of birth, ZIP code. If the user gives them to you all at once, or in unexpected groupings, or completely out of order, that is fine. Always perform any confirmation that is immediately necessary in the order they gave the information (but only confirm one item at a time). Then proceed to ask for remaining fields according to this order.",
    "When collecting a date of birth, tell the user you're going to collect their date of birth and to start could you please have the year. After obtaining the year, ask for the month, and then after obtaining the month ask for the day."
  ]
}
```

### Confirmation

Three layers, each opt-in per field:

- **Per-field confirm** — echo the field and ask "is that right?" immediately after receiving it. Use for fields where a wrong value causes an irreversible action or a bad experience (names, account numbers).
- **Per-field skip-confirm** — accept silently unless the value violates a constraint. Use for fields the user can easily verify in the final summary (year, day).
- **Composite confirm** — after all sub-fields are collected, present the full value and ask for confirmation before moving on.

Every atomic field must appear in exactly one of the two per-field lists — confirm or skip-confirm. Always state both lists explicitly; leaving a field out of both, or stating only one, produces inconsistent per-field behavior across runs.

```json
{
  "instructions": [
    "When in the sign up for a new account form before any final confirmation, you must ask for confirmation for each of these fields individually immediately after receiving them: first name, (date of birth) month.",
    "Whenever any of these fields are given, immediately begin to confirm them one at a time in the order they were given.",
    "Do not ask to verify any of these fields individually after receiving them unless they seem incorrect or violate a constraint: (date of birth) year, (date of birth) day, ZIP code.",
    "For the date of birth, after you have collected year, month, day, confirm the complete date of birth with the user before proceeding to other fields. Do this regardless of whether there is a final form-level confirmation later."
  ]
}
```

### Final form confirmation

Before the submit tool fires, present a structured summary and wait for explicit approval. The "do NOT call on the same turn" clause guards against the agent presenting the summary and submitting in one turn:

```json
{
  "instructions": [
    "When asking for the final confirmation in the sign up for a new account form, present all collected field values as a bulleted list. After listing all fields, ask the user if they want to proceed. Do NOT call register_user on the same turn you present this summary — wait for the user to explicitly confirm."
  ]
}
```

### Validation

State the constraint on the atomic field and what to do when the user's input violates it. Prefer asking the user to double-check rather than asserting they are wrong — they may have mistyped, and the soft correction reads better if the value was actually correct:

```json
{
  "instructions": [
    "The ZIP code field should be a 5 digit string. If the user provides a ZIP code with more or less than 5 digits, ask them to double-check and provide a revised value. Do not proceed to the next field until you have a valid ZIP code."
  ]
}
```

Back the instruction with a server-side check on the submit tool. The instruction is what the agent reads before calling; the raised error is the safety net. Carry a reason on the error so the agent can paraphrase the specific problem back to the user — not just "something was invalid."

Define the error as an error type in `types[]`, the success payload as an object struct, and the submit tool itself as a `DataActionTool` whose `errors[]` references the error type:

```json
{
  "types": [
    {
      "name": "RegistrationFailure",
      "type": "DataActionHttpError",
      "statusCodes": [400, 422],
      "defaultInstruction": "Tell the user that the registration could not be completed and ask them to double-check the value they just provided.",
      "description": "Raised when the backend rejects one or more submitted fields."
    },
    {
      "name": "RegistrationConfirmation",
      "type": "object",
      "direction": "output",
      "description": "Returned on successful registration.",
      "properties": [
        { "name": "customer_id", "type": "string", "required": true },
        { "name": "name_display", "type": "string", "required": true }
      ]
    }
  ],
  "tools": [
    {
      "type": "DataAction",
      "name": "register_user",
      "description": "Submit the sign up for a new account form.",
      "inputs": [
        { "targetName": "first_name", "type": "FirstName", "source": "User", "required": true },
        { "targetName": "year", "type": "Year", "source": "User", "required": true },
        { "targetName": "month", "type": "Month", "source": "User", "required": true },
        { "targetName": "day", "type": "Day", "source": "User", "required": true },
        { "targetName": "zip_code", "type": "ZipCode", "source": "User", "required": true }
      ],
      "output": "RegistrationConfirmation",
      "errors": [
        { "type": "RegistrationFailure" }
      ],
      "inputInstructions": [
        "Only call this tool after the user has explicitly confirmed all collected fields in the final summary."
      ],
      "outputInstructions": []
    }
  ]
}
```

The agent can still treat `DateOfBirth` as one conversational field for collection and confirmation, but the Data Action input surface is flattened to primitive parameters (`year`, `month`, `day`).

The guidance below is for the **Data Action author** — the person implementing the service that the Data Action tool calls — not for the AVA author shaping the VersionDefinition.

When the Data Action backend (the service the Data Action calls — not AVA itself) rejects a field (for example, a 5-digit ZIP check fails), respond with an HTTP status that matches one of the error type's `statusCodes` and return a body whose `user_message` describes the specific problem (e.g. `"The ZIP code was not 5 digits. Ask the user to double-check and provide a revised ZIP code."`). The platform binds the response to `RegistrationFailure` automatically and surfaces the message to the agent so it can paraphrase the reason back to the user.

If a field needs normalization — trimming whitespace, canonicalizing case, turning "nine four one oh three" into 94103 — do that inside the Data Action backend handler after capture, not in the AVA type definition. The aliased type's job is to prove the value came from the user; the Data Action cleans it up.

### Display formatting vs function-call formatting

Composite fields often look different in conversation than in the function call — a date of birth should read as "January 15th, 2025" when confirmed but arrive as `{"year": "2025", "month": "01", "day": "15"}` in the tool arguments. Add an instruction for each direction:

```json
{
  "instructions": [
    "For the sign up for a new account form, the user may format the date of birth however they wish. Ignore all formatting and when passing values in tool calls, use only raw values for each component ('YYYY' for year, 'MM' for month, 'DD' for day). Always present the date of birth as Month Day, Year (e.g., 'Month DDth, YYYY') when confirming or referencing it in conversation."
  ]
}
```

The same pattern applies to atomic fields where the human-friendly form differs from the canonical value. A phone number is a good example — the user may type it in any format, but the tool call expects 10 digits. State the canonical shape, tolerate the common input formats, and ask the user to double-check on violation:

```json
{
  "instructions": [
    "The contact phone number field is a 10 digit US phone number. The user may provide it in any format — '(XXX) XXX-XXXX', 'XXX-XXX-XXXX', 'XXXXXXXXXX', or with spaces or dots between groups. Strip all non-digit characters when passing the value in a tool call. If, after stripping, the value is not exactly 10 digits, ask the user to double-check and provide a revised phone number. Always present the phone number as '(XXX) XXX-XXXX' when confirming or referencing it in conversation."
  ]
}
```
