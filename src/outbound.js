// Outbound vocabulary: pure helpers for composing Genesys Cloud outbound API
// bodies (attempt limits, callable time sets, contact lists) and for rendering
// a campaign cadence as a Mermaid diagram. No network calls here - tools.js
// resolves names and drives the API.

import { GenesysError } from './genesys.js';

export const DIALING_MODES = ['preview', 'progressive', 'predictive', 'agentless'];

// User-facing snake_case recall reasons -> API recallEntries keys.
export const RECALL_KEYS = {
  busy: 'busy',
  no_answer: 'noAnswer',
  answering_machine: 'answeringMachine',
  disconnect: 'disconnect',
  fax: 'fax',
};

// Genesys time-slot day numbering: 1 = Monday ... 7 = Sunday.
const DAY_NUM = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Phone column types are capitalized in the API ("Cell", "Home", ...).
const PHONE_TYPES = { cell: 'Cell', home: 'Home', work: 'Work', voice: 'Voice', other: 'Other' };

export function composeAttemptLimits(a) {
  if (!a.name) throw new GenesysError('name is required', 400);
  const body = {
    name: a.name,
    maxAttemptsPerContact: a.max_attempts_per_contact ?? 3,
    timeZoneId: a.time_zone || 'America/New_York',
  };
  if (a.max_attempts_per_number) body.maxAttemptsPerNumber = a.max_attempts_per_number;
  if (a.reset_period) body.resetPeriod = a.reset_period;
  const recalls = Object.entries(a.recalls || {});
  if (recalls.length) {
    body.recallEntries = {};
    for (const [reason, r] of recalls) {
      const key = RECALL_KEYS[reason];
      if (!key) throw new GenesysError(`Unknown recall reason "${reason}" - use: ${Object.keys(RECALL_KEYS).join(', ')}`, 400);
      body.recallEntries[key] = {
        nbrAttempts: r.attempts ?? 1,
        minutesBetweenAttempts: r.minutes_between ?? 60,
      };
    }
  }
  return body;
}

export function composeCallableTimeSet(a) {
  if (!a.name) throw new GenesysError('name is required', 400);
  if (!Array.isArray(a.windows) || !a.windows.length) {
    throw new GenesysError('windows must be a non-empty array of { days, start_time, end_time, time_zone? }', 400);
  }
  const byTz = new Map();
  for (const w of a.windows) {
    if (!HHMM.test(w.start_time || '') || !HHMM.test(w.end_time || '')) {
      throw new GenesysError('window start_time/end_time must be 24h HH:MM (e.g. "09:00")', 400);
    }
    const days = (w.days || []).map((d) => {
      const n = DAY_NUM[String(d).toUpperCase()];
      if (!n) throw new GenesysError(`Unknown day "${d}" - use two-letter codes: MO TU WE TH FR SA SU`, 400);
      return n;
    });
    if (!days.length) throw new GenesysError('each window needs at least one day', 400);
    const tz = w.time_zone || 'America/New_York';
    if (!byTz.has(tz)) byTz.set(tz, []);
    byTz.get(tz).push(...days.map((day) => ({ day, startTime: `${w.start_time}:00`, stopTime: `${w.end_time}:00` })));
  }
  return {
    name: a.name,
    callableTimes: [...byTz].map(([timeZoneId, timeSlots]) => ({ timeZoneId, timeSlots })),
  };
}

export function composeContactList(a) {
  if (!a.name) throw new GenesysError('name is required', 400);
  const columns = a.columns || [];
  if (!columns.length) throw new GenesysError('columns must be a non-empty array of column names', 400);
  const phoneCols = a.phone_columns || [];
  if (!phoneCols.length) throw new GenesysError('phone_columns must name at least one column that holds phone numbers', 400);
  if (a.zip_column && a.time_zone_column) {
    throw new GenesysError('Pick ONE compliance mechanism: zip_column (automatic time zone mapping) or time_zone_column (for callable time sets)', 400);
  }
  if (a.time_zone_column && !columns.includes(a.time_zone_column)) {
    throw new GenesysError(`time zone column "${a.time_zone_column}" is not in columns`, 400);
  }
  const body = {
    name: a.name,
    columnNames: columns,
    phoneColumns: phoneCols.map((pc) => {
      const col = typeof pc === 'string' ? pc : pc.column;
      if (!columns.includes(col)) throw new GenesysError(`phone column "${col}" is not in columns`, 400);
      const raw = String((typeof pc === 'string' ? '' : pc.type) || 'cell').toLowerCase();
      return {
        columnName: col,
        type: PHONE_TYPES[raw] || raw.charAt(0).toUpperCase() + raw.slice(1),
        // Time zone columns cannot be added after a list is created, so wire
        // them at create time when callable time sets are the plan.
        ...(a.time_zone_column ? { callableTimeColumn: a.time_zone_column } : {}),
      };
    }),
  };
  if (a.zip_column) {
    if (!columns.includes(a.zip_column)) throw new GenesysError(`zip column "${a.zip_column}" is not in columns`, 400);
    body.zipCodeColumnName = a.zip_column;
    // A zip column is almost always there FOR local-time compliance mapping.
    if (a.automatic_time_zone_mapping !== false) body.automaticTimeZoneMapping = true;
  }
  return body;
}

// ---------- Mermaid rendering ----------

function mLabel(s, max = 60) {
  const t = String(s).replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// steps: [{ name, dialingMode, queue, contactList, listSize, attemptLimits,
//           timeSet, dncLists }] in dialing order. sequenceName null renders a
// single campaign without the cadence root node.
export function cadenceToMermaid(sequenceName, status, steps) {
  const L = ['flowchart TD'];
  let prev = null;
  if (sequenceName) {
    L.push(`  seq(["🔁 cadence: ${mLabel(sequenceName, 44)}${status ? ` (${status})` : ''}"])`);
    prev = 'seq';
  }
  steps.forEach((s, i) => {
    const id = `w${i}`;
    const lines = [`${steps.length > 1 ? `${i + 1}. ` : ''}📣 ${mLabel(s.name, 40)}`];
    lines.push(`${s.dialingMode || '?'} dial → 🎧 ${mLabel(s.queue || 'no queue', 30)}`);
    if (s.contactList) lines.push(`📇 ${mLabel(s.contactList, 32)}${s.listSize != null ? ` (${s.listSize} contacts)` : ''}`);
    if (s.attemptLimits) lines.push(`🔂 ${mLabel(s.attemptLimits, 38)}`);
    if (s.timeSet) lines.push(`🕐 ${mLabel(s.timeSet, 38)}`);
    if (s.dncLists?.length) lines.push(`🚫 ${mLabel(s.dncLists.join(', '), 36)}`);
    L.push(`  ${id}["${lines.join('<br/>')}"]`);
    if (prev) L.push(`  ${prev} --> ${id}`);
    prev = id;
  });
  L.push('  done(("✅ cadence complete"))');
  if (prev) L.push(`  ${prev} --> done`);
  return L.join('\n');
}
