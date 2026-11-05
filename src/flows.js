// Architect flow authoring: spec validation, Archy YAML composition, and
// Mermaid rendering (for specs pre-publish, and best-effort for existing
// flows from their internal configuration JSON).
//
// Publishing goes through the flow jobs API (POST /api/v2/flows/jobs, then
// PUT the YAML to the returned presigned URL), the same pipeline Genesys'
// own CX as Code Terraform provider uses. The job validates AND publishes
// server-side; its failure messages are the validation report.
//
// YAML shapes follow Genesys' own published flows (DR blueprint, Archy
// lessons, terraform fixtures) and Architect's serializer: startUpRef points
// at a task when hours branching is used; unhandled evaluateScheduleGroup
// outputs fall through to the next task action (the jump to the main menu).

const DTMF = {
  0: 'digit_0', 1: 'digit_1', 2: 'digit_2', 3: 'digit_3', 4: 'digit_4',
  5: 'digit_5', 6: 'digit_6', 7: 'digit_7', 8: 'digit_8', 9: 'digit_9',
  '*': 'digit_star', '#': 'digit_pound',
};

export const FLOW_ACTIONS = ['transfer_to_queue', 'disconnect', 'voicemail', 'transfer_to_number', 'play_message'];

// ---------- spec validation ----------

// Spec (v2): an inbound call flow with a TTS greeting, an optional
// business-hours gate, and one DTMF menu. OR (v3) a voice_agent block in
// place of the menu: see "voice agent (Audio Connector)" below.
// {
//   name, description?, division?, language? (default en-us),
//   greeting: "TTS text",
//   hours?: {
//     schedule_group: "existing schedule group name",   // create_schedule_group first
//     closed_message: "TTS text",
//     holiday_message?: "TTS text (defaults to closed_message)",
//     closed_action?: 'disconnect' (default) | 'voicemail',
//     closed_voicemail_queue?   // required for closed_action 'voicemail'
//     closed_voicemail_greeting? // TTS played before the closed-hours voicemail
//   },
//   menu: {
//     prompt: "TTS text",
//     choices: [ { dtmf, action: 'transfer_to_queue'|'disconnect'|'voicemail'|'transfer_to_number'|'play_message',
//                  name?, queue?, number?, message?, then? ('return_to_menu'|'disconnect'),
//                  pre_transfer_message?, failure_message?, voicemail_greeting? } ]
//   }
// }
// play_message plays TTS info (an address, directions, a notice) and then
// returns to the menu (default) or disconnects.
// Voicemail targets a QUEUE (the message becomes a callback routed to that
// queue; enable voicemail on the queue for live calls). User/group voicemail
// targets are not supported yet: Genesys' validator rejects every documented
// YAML reference form for them, pending a canonical UI export to copy.
export function validateFlowSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec must be an object'] };

  const name = String(spec.name || '').trim();
  if (!name) errors.push('name is required');
  else if (name.length > 200) errors.push('name must be 200 characters or fewer');

  const voice = spec.voice_agent !== undefined;
  if (!voice && !String(spec.greeting || '').trim()) errors.push('greeting (TTS text) is required');

  const lang = spec.language || 'en-us';
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(lang)) errors.push(`language "${lang}" does not look like a language tag (e.g. en-us)`);
  // Text fields must be strings: an object would become "[object Object]" in the YAML.
  const mustBeText = (obj, keys, prefix) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && typeof obj[k] !== 'string') errors.push(`${prefix}${k} must be a string`);
    }
  };
  mustBeText(spec, ['name', 'greeting', 'description', 'division', 'language'], '');

  if (voice) {
    if (spec.menu !== undefined) errors.push('voice_agent replaces the menu: pass voice_agent OR menu, not both');
    if (spec.hours !== undefined) errors.push('hours are not supported with voice_agent yet (gate the hours in the voice agent prompt, or build a menu flow)');
    validateVoiceAgent(spec.voice_agent, errors);
    return { ok: !errors.length, errors };
  }

  if (spec.hours !== undefined) {
    const h = spec.hours;
    if (!h || typeof h !== 'object' || Array.isArray(h)) {
      errors.push('hours must be an object');
    } else {
      mustBeText(h, ['schedule_group', 'closed_message', 'holiday_message', 'closed_voicemail_queue', 'closed_voicemail_greeting'], 'hours.');
      if (!String(h.schedule_group || '').trim()) errors.push('hours.schedule_group (an existing schedule group name) is required');
      if (!String(h.closed_message || '').trim()) errors.push('hours.closed_message (TTS text) is required');
      const ca = h.closed_action || 'disconnect';
      if (!['disconnect', 'voicemail'].includes(ca)) errors.push(`hours.closed_action must be disconnect or voicemail (got "${h.closed_action}")`);
      if (ca === 'voicemail' && !String(h.closed_voicemail_queue || '').trim()) {
        errors.push('hours.closed_action "voicemail" requires closed_voicemail_queue (queue name)');
      }
    }
  }

  const menu = spec.menu;
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) {
    errors.push('menu is required');
  } else {
    mustBeText(menu, ['prompt'], 'menu.');
    if (!String(menu.prompt || '').trim()) errors.push('menu.prompt (TTS text) is required');
    const choices = menu.choices;
    if (!Array.isArray(choices) || !choices.length) {
      errors.push('menu.choices must be a non-empty array');
    } else {
      if (choices.length > 12) errors.push('menu.choices supports at most 12 choices (digits 0-9, *, #)');
      const seen = new Set();
      choices.forEach((c, i) => {
        const where = `choices[${i}]`;
        if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(`${where} must be an object`); return; }
        mustBeText(c, ['name', 'queue', 'number', 'message', 'pre_transfer_message', 'failure_message', 'voicemail_greeting'], `${where}.`);
        const key = String(c.dtmf);
        if (!(key in DTMF)) errors.push(`${where}.dtmf must be one of 0-9, *, # (got "${c.dtmf}")`);
        else if (seen.has(key)) errors.push(`${where}: duplicate dtmf "${key}"`);
        seen.add(key);
        if (!FLOW_ACTIONS.includes(c.action)) errors.push(`${where}.action must be one of ${FLOW_ACTIONS.join(', ')}`);
        if (c.action === 'transfer_to_queue' && !String(c.queue || '').trim()) {
          errors.push(`${where}: transfer_to_queue requires a queue name`);
        }
        if (c.action === 'voicemail' && !String(c.queue || '').trim()) {
          errors.push(`${where}: voicemail requires a queue name (queue voicemail; user/group targets are not supported yet)`);
        }
        if (c.action === 'transfer_to_number') {
          const num = String(c.number || '').replace(/[\s().-]/g, '');
          if (!/^\+?\d{7,15}$/.test(num)) errors.push(`${where}: transfer_to_number requires an E.164-style number (e.g. +13175550123)`);
        }
        if (c.action === 'play_message') {
          if (!String(c.message || '').trim()) errors.push(`${where}: play_message requires message (TTS text)`);
          if (c.then !== undefined && !['return_to_menu', 'disconnect'].includes(c.then)) {
            errors.push(`${where}.then must be return_to_menu or disconnect (got "${c.then}")`);
          }
        }
      });
    }
  }
  return { ok: !errors.length, errors };
}

// ---------- voice agent (Audio Connector) ----------

// voice_agent: hand the call to a third-party voice bot over Genesys' Audio
// Connector (built and verified against ElevenLabs ElevenAgents), save what
// the bot collected as participant data the human agent can see, and hand
// off to a queue when the bot says the caller wants a person.
// {
//   connector: "Audio Connector integration name",   // create_voice_connector
//   agent_id: "the bot's id (ElevenLabs agent id)",   // becomes the Connector ID
//   name?: "action label",
//   inputs?: { session_variable: "literal text" },     // dynamic variables for the bot
//   pass_caller_number?: true,                         // sends caller_number = the caller's ANI
//   outputs?: ["transfer_to", "caller_name", ...],     // the bot's output session variables
//   handoff?: { queue, when?: output name, message?, failure_message? },
//   fallback?: "handoff" | "disconnect"                // when the bot fails (default: handoff if a queue is set)
// }
// Shapes copied from Architect's own export of a published Call Audio
// Connector action: session variables sit on the action, the integration is a
// key holding connectorId + outputs + failureOutputs, and output variables are
// only filled on the success path (after the bot ends the session cleanly).
export const VOICE_IDENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FALSEY = ['', 'false', 'False', 'FALSE', 'no', 'No', 'NO', 'none', 'None', 'null'];

function validateVoiceAgent(va, errors) {
  if (!va || typeof va !== 'object' || Array.isArray(va)) { errors.push('voice_agent must be an object'); return; }
  for (const k of ['connector', 'agent_id', 'name']) {
    if (va[k] !== undefined && typeof va[k] !== 'string') errors.push(`voice_agent.${k} must be a string`);
  }
  if (!String(va.connector || '').trim()) errors.push('voice_agent.connector (an Audio Connector integration name, see list_voice_connectors / create_voice_connector) is required');
  const agentId = String(va.agent_id || '').trim();
  if (!agentId) errors.push('voice_agent.agent_id (the bot id, e.g. the ElevenLabs agent id) is required');
  else if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId)) errors.push(`voice_agent.agent_id "${agentId}" should be a plain id (letters, digits, _ or -)`);
  if (va.pass_caller_number !== undefined && typeof va.pass_caller_number !== 'boolean') errors.push('voice_agent.pass_caller_number must be true or false');
  if (va.inputs !== undefined) {
    if (!va.inputs || typeof va.inputs !== 'object' || Array.isArray(va.inputs)) errors.push('voice_agent.inputs must be an object of { name: "text" }');
    else {
      for (const [k, v] of Object.entries(va.inputs)) {
        if (!VOICE_IDENT_RE.test(k)) errors.push(`voice_agent.inputs: "${k}" is not a valid variable name (letters, digits, _; start with a letter)`);
        if (typeof v !== 'string') errors.push(`voice_agent.inputs.${k} must be a string`);
      }
      if (Object.keys(va.inputs).length > 20) errors.push('voice_agent.inputs supports at most 20 variables');
    }
  }
  const outputs = va.outputs === undefined ? [] : va.outputs;
  if (!Array.isArray(outputs)) errors.push('voice_agent.outputs must be an array of output variable names');
  else {
    if (outputs.length > 20) errors.push('voice_agent.outputs supports at most 20 variables');
    const seen = new Set();
    outputs.forEach((o, i) => {
      if (typeof o !== 'string' || !VOICE_IDENT_RE.test(o)) errors.push(`voice_agent.outputs[${i}] "${o}" is not a valid variable name (letters, digits, _; start with a letter)`);
      else if (seen.has(o)) errors.push(`voice_agent.outputs: duplicate "${o}"`);
      seen.add(o);
    });
  }
  if (va.handoff !== undefined) {
    const h = va.handoff;
    if (!h || typeof h !== 'object' || Array.isArray(h)) errors.push('voice_agent.handoff must be an object');
    else {
      for (const k of ['queue', 'when', 'message', 'failure_message']) {
        if (h[k] !== undefined && typeof h[k] !== 'string') errors.push(`voice_agent.handoff.${k} must be a string`);
      }
      if (!String(h.queue || '').trim()) errors.push('voice_agent.handoff.queue (an existing queue name) is required');
      if (Array.isArray(outputs)) {
        if (!outputs.length) errors.push('voice_agent.handoff needs at least one output to decide on (e.g. outputs: ["transfer_to"])');
        else if (h.when !== undefined && !outputs.includes(h.when)) errors.push(`voice_agent.handoff.when "${h.when}" must be one of the outputs (${outputs.join(', ')})`);
      }
    }
  }
  if (va.fallback !== undefined && !['handoff', 'disconnect'].includes(va.fallback)) errors.push('voice_agent.fallback must be handoff or disconnect');
  if (va.fallback === 'handoff' && !va.handoff) errors.push('voice_agent.fallback "handoff" needs voice_agent.handoff.queue');
}

// The output the handoff decision reads: handoff.when, else transfer_to if
// present, else the first output.
export function handoffOutput(va) {
  const outs = va.outputs || [];
  return va.handoff?.when || (outs.includes('transfer_to') ? 'transfer_to' : outs[0]);
}

const flowVar = (o) => `Flow.ai_${o}`;
const attrName = (o) => `AI ${o.replace(/_/g, ' ')}`;

function voiceAgentYaml(spec, push) {
  const va = spec.voice_agent;
  const outputs = va.outputs || [];
  const inputs = { ...(va.pass_caller_number === false ? {} : { caller_number: null }), ...(va.inputs || {}) };
  const handoff = va.handoff;
  const fallback = va.fallback || (handoff ? 'handoff' : 'disconnect');
  const when = handoff ? handoffOutput(va) : null;

  push(1, 'startUpRef: "/inboundCall/tasks/task[voiceAgent]"');
  push(1, 'initialGreeting:');
  if (String(spec.greeting || '').trim()) push(2, `tts: ${yq(spec.greeting)}`);
  // The bot usually speaks first: a 100 ms silent greeting keeps the publish
  // warning-free ("main sequence has no audio set") without talking over it.
  else push(2, `exp: ${yq('AudioPlaybackOptions(ToAudioBlank(100), false)')}`);
  if (outputs.length) {
    push(1, 'variables:');
    for (const o of outputs) {
      push(2, '- stringVariable:');
      push(4, `name: ${flowVar(o)}`);
      push(4, 'initialValue:');
      push(5, 'noValue: true');
    }
  }
  push(1, 'tasks:');
  push(2, '- task:');
  push(4, 'name: Voice Agent');
  push(4, 'refId: voiceAgent');
  push(4, 'actions:');
  push(5, '- callAudioConnector:');
  push(7, `name: ${yq(va.name || 'Voice agent')}`);
  const inputNames = Object.keys(inputs);
  if (inputNames.length) {
    push(7, 'sessionVariables:');
    for (const k of inputNames) {
      push(8, '- sessionVariable:');
      push(10, 'name:');
      push(11, `lit: ${yq(k)}`);
      push(10, 'value:');
      if (inputs[k] === null) push(11, 'exp: ToString(Call.Ani)');
      else push(11, `lit: ${yq(inputs[k])}`);
    }
  }
  if (outputs.length) {
    push(7, 'outputSessionVariables:');
    for (const o of outputs) {
      push(8, '- outputSessionVariable:');
      push(10, 'name:');
      push(11, `lit: ${yq(o)}`);
      push(10, `variable: ${flowVar(o)}`);
    }
  }
  push(7, 'integration:');
  push(8, `${yq(va.connector)}:`);
  push(9, 'connectorId:');
  push(10, `lit: ${yq(va.agent_id)}`);
  push(9, 'outputs:');
  push(10, 'success:');
  push(11, 'actions:');
  if (outputs.length) {
    push(12, '- setParticipantData:');
    push(14, 'name: Save what the voice agent learned');
    push(14, 'attributes:');
    for (const o of outputs) {
      push(15, '- attribute:');
      push(17, 'name:');
      push(18, `lit: ${yq(attrName(o))}`);
      push(17, 'value:');
      push(18, `exp: ${yq(`If(IsSet(${flowVar(o)}), ${flowVar(o)}, "")`)}`);
    }
  }
  if (handoff) {
    const v = flowVar(when);
    const cond = [`IsSet(${v})`, ...FALSEY.map((f) => `${v} != "${f}"`)].join(' and ');
    push(12, '- decision:');
    push(14, `name: ${yq(`Caller wants a person? (${when})`)}`);
    push(14, 'condition:');
    push(15, `exp: ${yq(cond)}`);
    push(14, 'outputs:');
    push(15, '"yes":');
    push(16, 'actions:');
    push(17, '- jumpToTask:');
    push(19, 'name: Hand off to a person');
    push(19, 'targetTaskRef: "/inboundCall/tasks/task[handoff]"');
  }
  if (!outputs.length && !handoff) {
    // Nothing to do on success: Archy still wants the path to have an action.
    push(12, '- disconnect:');
    push(14, 'name: Voice agent finished');
  }
  push(10, 'failure:');
  push(11, 'actions:');
  push(12, '- setParticipantData:');
  push(14, 'name: Save the voice agent error');
  push(14, 'attributes:');
  push(15, '- attribute:');
  push(17, 'name:');
  push(18, `lit: ${yq('AI error')}`);
  push(17, 'value:');
  push(18, `exp: ${yq('If(IsSet(Task.voiceAgentErrorType), Task.voiceAgentErrorType, "unknown")')}`);
  if (fallback === 'handoff') {
    push(12, '- jumpToTask:');
    push(14, 'name: Fall back to a person');
    push(14, 'targetTaskRef: "/inboundCall/tasks/task[handoff]"');
  }
  push(9, 'failureOutputs:');
  push(10, 'errorType:');
  push(11, 'var: Task.voiceAgentErrorType');
  push(10, 'errorMessage:');
  push(11, 'var: Task.voiceAgentErrorMessage');
  push(5, '- disconnect:');
  push(7, 'name: End call');
  if (handoff) {
    push(2, '- task:');
    push(4, 'name: Hand Off');
    push(4, 'refId: handoff');
    push(4, 'actions:');
    push(5, '- transferToAcd:');
    push(7, `name: ${yq(`Transfer to ${handoff.queue}`)}`);
    push(7, 'targetQueue:');
    push(8, 'lit:');
    push(9, `name: ${yq(handoff.queue)}`);
    push(7, 'preTransferAudio:');
    push(8, `tts: ${yq(handoff.message || 'Connecting you now.')}`);
    push(7, 'failureTransferAudio:');
    push(8, `tts: ${yq(handoff.failure_message || "Sorry, we can't connect you right now. Please try again later.")}`);
    push(5, '- disconnect:');
    push(7, 'name: Disconnect after failed transfer');
  }
}

function voiceAgentMermaid(spec, L) {
  const va = spec.voice_agent;
  const outputs = va.outputs || [];
  let prev = 'start';
  if (String(spec.greeting || '').trim()) {
    L.push(`  greet["🔊 ${mLabel(spec.greeting)}"]`);
    L.push('  start --> greet');
    prev = 'greet';
  }
  L.push(`  va[["🎙️ ${mLabel(va.name || 'Voice agent', 40)}<br/>${mLabel(va.connector, 30)} · ${mLabel(va.agent_id, 30)}"]]`);
  L.push(`  ${prev} --> va`);
  let after = 'va';
  if (outputs.length) {
    L.push(`  pd["📝 Saved for the agent: ${mLabel(outputs.join(', '), 70)}"]`);
    L.push('  va -->|conversation ends| pd');
    after = 'pd';
  }
  L.push('  bye(("👋 end"))');
  const fallback = va.fallback || (va.handoff ? 'handoff' : 'disconnect');
  if (va.handoff) {
    L.push(`  dec{"Caller wants a person?<br/>(${mLabel(handoffOutput(va), 30)})"}`);
    L.push(`  ${after} --> dec`);
    L.push(`  q[["🎧 Queue: ${mLabel(va.handoff.queue, 40)}"]]`);
    L.push('  dec -->|yes| q');
    L.push('  dec -->|no| bye');
  } else {
    L.push(`  ${after} --> bye`);
  }
  L.push(fallback === 'handoff' ? '  va -.->|agent unavailable| q' : '  va -.->|agent unavailable| bye');
}

// ---------- Archy YAML composition ----------

// Single-quoted YAML scalar: safe for arbitrary text, quotes doubled.
function yq(s) {
  return `'${String(s).replace(/[\r\n\t]+/g, ' ').replace(/'/g, "''")}'`;
}

// Text destined for INSIDE an Architect expression string ("..."): strip the
// characters that would break the expression.
function expText(s) {
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/["\\]/g, "'");
}

const cleanNumber = (n) => String(n).replace(/[\s().-]/g, '');

const choiceName = (c) => {
  if (c.name) return c.name;
  switch (c.action) {
    case 'disconnect': return 'Disconnect';
    case 'voicemail': return 'Leave a Voicemail';
    case 'transfer_to_number': return `Call ${cleanNumber(c.number)}`;
    case 'play_message': return 'Information';
    default: return `Transfer to ${c.queue}`;
  }
};

export function specToArchyYaml(spec) {
  const L = [];
  const push = (indent, text) => L.push('  '.repeat(indent) + text);
  const hours = spec.hours;

  // A voicemail destination block, shared by the menu-choice and task-action
  // forms. `base` is the indent of the "destination:" line. Queue target
  // only: it is the shape Genesys' own flows publish, and the only one their
  // validator accepts from YAML today.
  const pushVoicemailDestination = (base, { queue, greeting }) => {
    push(base, 'destination:');
    push(base + 1, 'queue:');
    push(base + 2, 'targetQueue:');
    push(base + 3, 'lit:');
    push(base + 4, `name: ${yq(queue)}`);
    // Queue voicemail becomes a callback interaction; default the callback
    // number to the caller's ANI (Architect's own default), and always set a
    // greeting so publishes stay warning-free.
    push(base + 2, 'callbackNumber:');
    push(base + 3, 'exp: ToPhoneNumber(Call.Ani)');
    push(base + 2, 'voicemailGreeting:');
    // Quote the whole expression with yq, so an apostrophe in the greeting
    // ("We'll call you back") cannot end the single-quoted YAML scalar early.
    push(base + 3, `exp: ${yq(`AudioPlaybackOptions(ToAudioTTS("${expText(greeting || 'Please leave your name, number, and a short message after the tone.')}"), false)`)}`);
  };

  // Pre/failure transfer audio with friendly defaults: without them every
  // publish carries "no audio set" validation warnings.
  const pushTransferAudio = (base, pre, failure) => {
    push(base, 'preTransferAudio:');
    push(base + 1, `tts: ${yq(pre || 'One moment please.')}`);
    push(base, 'failureTransferAudio:');
    push(base + 1, `tts: ${yq(failure || "Sorry, we can't complete that transfer right now. Please try again later.")}`);
  };

  push(0, 'inboundCall:');
  push(1, `name: ${yq(spec.name)}`);
  if (spec.description) push(1, `description: ${yq(spec.description)}`);
  if (spec.division) push(1, `division: ${yq(spec.division)}`);
  push(1, `defaultLanguage: ${yq(spec.language || 'en-us')}`); // quoted: "no" or "on" are booleans to a YAML 1.1 parser
  if (spec.voice_agent) {
    voiceAgentYaml(spec, push);
    return L.join('\n') + '\n';
  }
  push(1, hours ? 'startUpRef: "/inboundCall/tasks/task[checkHours]"' : 'startUpRef: ./menus/menu[mainMenu]');
  push(1, 'initialGreeting:');
  push(2, `tts: ${yq(spec.greeting)}`);

  if (hours) {
    const closedTerminal = (base) => {
      if ((hours.closed_action || 'disconnect') === 'voicemail') {
        push(base, '- transferToVoicemail:');
        push(base + 2, 'name: Closed Voicemail');
        pushTransferAudio(base + 2, 'Transferring you to voicemail.', hours.closed_message);
        pushVoicemailDestination(base + 2, {
          queue: hours.closed_voicemail_queue,
          greeting: hours.closed_voicemail_greeting,
        });
      } else {
        push(base, '- disconnect:');
        push(base + 2, 'name: Disconnect');
      }
    };
    push(1, 'tasks:');
    push(2, '- task:');
    push(4, 'name: Check Hours');
    push(4, 'refId: checkHours');
    push(4, 'actions:');
    push(5, '- evaluateScheduleGroup:');
    push(7, 'name: Evaluate Schedule Group');
    push(7, 'inServiceSchedules:');
    push(8, 'noValue: true');
    push(7, 'evaluate:');
    push(8, 'now: true');
    push(7, 'scheduleGroup:');
    push(8, 'lit:');
    push(9, `name: ${yq(hours.schedule_group)}`);
    push(7, 'emergencyGroup:');
    push(8, 'noValue: true');
    push(7, 'outputs:');
    // Open falls through to the jumpToMenu action below.
    push(8, 'closed:');
    push(9, 'actions:');
    push(10, '- playAudio:');
    push(12, 'name: Closed Message');
    push(12, 'audio:');
    push(13, `tts: ${yq(hours.closed_message)}`);
    closedTerminal(10);
    push(8, 'holiday:');
    push(9, 'actions:');
    push(10, '- playAudio:');
    push(12, 'name: Holiday Message');
    push(12, 'audio:');
    push(13, `tts: ${yq(hours.holiday_message || hours.closed_message)}`);
    closedTerminal(10);
    push(5, '- jumpToMenu:');
    push(7, 'name: Go to main menu');
    push(7, 'targetMenuRef: "/inboundCall/menus/menu[mainMenu]"');
  }

  push(1, 'menus:');
  push(2, '- menu:');
  push(4, 'name: Main Menu');
  push(4, 'refId: mainMenu');
  push(4, 'audio:');
  push(5, `tts: ${yq(spec.menu.prompt)}`);
  push(4, 'choices:');
  for (const c of spec.menu.choices) {
    const dtmf = DTMF[String(c.dtmf)];
    if (c.action === 'disconnect') {
      push(5, '- menuDisconnect:');
      push(7, `name: ${yq(choiceName(c))}`);
      push(7, `dtmf: ${dtmf}`);
      continue;
    }
    if (c.action === 'play_message') {
      // An inline task choice: play the info message, then return to the
      // menu (default) or disconnect.
      push(5, '- menuTask:');
      push(7, `name: ${yq(choiceName(c))}`);
      push(7, `dtmf: ${dtmf}`);
      push(7, 'task:');
      push(8, 'actions:');
      push(9, '- playAudio:');
      push(11, 'name: Info Message');
      push(11, 'audio:');
      push(12, `tts: ${yq(c.message)}`);
      if ((c.then || 'return_to_menu') === 'disconnect') {
        push(9, '- disconnect:');
        push(11, 'name: Disconnect');
      } else {
        push(9, '- previousMenu:');
        push(11, 'name: Return to Menu');
      }
      continue;
    }
    const kind = c.action === 'voicemail' ? 'menuTransferToVoicemail'
      : c.action === 'transfer_to_number' ? 'menuTransferToNumber'
      : 'menuTransferToAcd';
    push(5, `- ${kind}:`);
    push(7, `name: ${yq(choiceName(c))}`);
    push(7, `dtmf: ${dtmf}`);
    pushTransferAudio(7, c.pre_transfer_message, c.failure_message);
    if (c.action === 'transfer_to_queue') {
      push(7, 'targetQueue:');
      push(8, 'lit:');
      push(9, `name: ${yq(c.queue)}`);
    } else if (c.action === 'voicemail') {
      pushVoicemailDestination(7, { queue: c.queue, greeting: c.voicemail_greeting });
    } else {
      push(7, 'targetNumber:');
      push(8, `lit: ${yq(cleanNumber(c.number))}`);
      push(7, 'connectTimeout:');
      push(8, 'noValue: true');
    }
  }
  return L.join('\n') + '\n';
}

// ---------- Mermaid rendering ----------

function mLabel(s, max = 60) {
  const t = String(s).replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function choiceNode(id, c) {
  if (c.action === 'disconnect') return `  ${id}(("👋 ${mLabel(choiceName(c), 30)}"))`;
  if (c.action === 'voicemail') return `  ${id}[["📬 ${mLabel(choiceName(c), 40)}"]]`;
  if (c.action === 'transfer_to_number') return `  ${id}[["☎️ ${mLabel(choiceName(c), 40)}"]]`;
  if (c.action === 'play_message') return `  ${id}["🔈 ${mLabel(c.message, 45)}"]`;
  return `  ${id}[["🎧 Queue: ${mLabel(c.queue, 40)}"]]`;
}

export function specToMermaid(spec) {
  const L = ['flowchart TD'];
  L.push(`  start(["📞 ${mLabel(spec.name)}"])`);
  if (spec.voice_agent) {
    voiceAgentMermaid(spec, L);
    return L.join('\n');
  }
  L.push(`  greet["🔊 ${mLabel(spec.greeting)}"]`);
  L.push('  start --> greet');
  let menuFrom = 'greet';
  if (spec.hours) {
    const h = spec.hours;
    L.push(`  hrs{"🕐 ${mLabel(h.schedule_group, 40)}"}`);
    L.push('  greet --> hrs');
    L.push(`  closedmsg["🔊 ${mLabel(h.closed_message)}"]`);
    L.push('  hrs -->|closed / holiday| closedmsg');
    if ((h.closed_action || 'disconnect') === 'voicemail') {
      L.push(`  closedend[["📬 ${mLabel(h.closed_voicemail_queue, 35)} voicemail"]]`);
    } else {
      L.push('  closedend(("👋 end"))');
    }
    L.push('  closedmsg --> closedend');
    L.push('  hrs -->|open| menu');
    menuFrom = null;
  }
  L.push(`  menu{"${mLabel(spec.menu.prompt)}"}`);
  if (menuFrom) L.push(`  ${menuFrom} --> menu`);
  spec.menu.choices.forEach((c, i) => {
    const id = `c${i}`;
    L.push(choiceNode(id, c));
    L.push(`  menu -->|${c.dtmf}| ${id}`);
    if (c.action === 'play_message' && (c.then || 'return_to_menu') === 'return_to_menu') {
      L.push(`  ${id} -.-> menu`);
    }
  });
  return L.join('\n');
}

// Best-effort renderer for EXISTING flows from /latestconfiguration JSON.
// That format is internal and undocumented; menus and their choices render
// faithfully, other sequence types render as generic nodes. Good enough to
// see a flow's shape in chat; not a round-trip tool.
export function configToMermaid(cfg) {
  const L = ['flowchart TD'];
  const seqs = cfg.flowSequenceItemList || [];
  L.push(`  start(["📞 ${mLabel(cfg.name || 'Flow')}"])`);

  const greeting = extractTts(cfg.initialPrompts) || extractTts(cfg.initialGreeting);
  let prev = 'start';
  if (greeting) {
    L.push(`  greet["🔊 ${mLabel(greeting)}"]`);
    L.push('  start --> greet');
    prev = 'greet';
  }

  if (!seqs.length) L.push(`  empty["(no sequences in configuration)"]`);
  seqs.forEach((seq, si) => {
    const sid = `s${si}`;
    const isStart = seq.id === cfg.initialSequence;
    if (seq.__type === 'Menu') {
      const prompt = extractTts(seq.prompts);
      L.push(`  ${sid}{"${mLabel(prompt || seq.name || 'Menu')}"}`);
      (seq.menuChoiceList || []).forEach((ch, ci) => {
        const cid = `${sid}c${ci}`;
        const t = ch.action?.__type || '';
        const label = ch.name || ch.action?.name || t.replace(/Action$/, '');
        if (/Disconnect/i.test(t)) L.push(`  ${cid}(("👋 ${mLabel(label, 30)}"))`);
        else if (/Voicemail/i.test(t)) L.push(`  ${cid}[["📬 ${mLabel(label, 40)}"]]`);
        else if (/Number/i.test(t)) L.push(`  ${cid}[["☎️ ${mLabel(label, 40)}"]]`);
        else if (/Transfer/i.test(t)) L.push(`  ${cid}[["🎧 ${mLabel(label, 40)}"]]`);
        else L.push(`  ${cid}["${mLabel(label, 40)}"]`);
        const key = ch.digit ?? ch.dtmf ?? '';
        L.push(`  ${sid} -->|${key === '' ? '?' : key}| ${cid}`);
      });
    } else if (seq.__type === 'Task' || /Task/i.test(seq.__type || '')) {
      const raw = JSON.stringify(seq);
      const hasSchedule = raw.includes('ScheduleGroup');
      if (/AudioConnector/.test(raw)) {
        L.push(`  ${sid}[["🎙️ ${mLabel(seq.name || 'Voice agent', 50)} (Audio Connector)"]]`);
        if (isStart) L.push(`  ${prev} --> ${sid}`);
        return;
      }
      L.push(`  ${sid}${hasSchedule ? `{"🕐 ${mLabel(seq.name || 'Check Hours', 40)}"}` : `["${mLabel(seq.name || 'Task', 50)}"]`}`);
    } else {
      L.push(`  ${sid}["${mLabel(`${seq.name || seq.__type || 'Step'}`, 50)}"]`);
    }
    if (isStart) L.push(`  ${prev} --> ${sid}`);
  });
  return L.join('\n');
}

// Pull the first TTS string out of an internal prompt/expression subtree.
function extractTts(node) {
  if (!node) return '';
  const m = JSON.stringify(node).match(/ToAudioTTS\(\\"((?:[^"\\]|\\[^"])*)\\"\)/);
  return m ? m[1].replace(/\\\\/g, '\\') : '';
}
