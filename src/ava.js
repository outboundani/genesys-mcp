// Agentic Virtual Agent (AVA) vocabulary: pure helpers with no network calls.
//
// This ports the deterministic parts of Genesys' own AVA harness
// (purecloudlabs/genesys-ava-skills, MIT) so the AVA lifecycle - design,
// knowledge, build, test, evaluate, critique - runs from a hosted MCP server:
//   - definition normalization + pre-flight checks (the build skill's L/T/N rules)
//   - Layer 1 trajectory validation and the versioned scoring rubric
//   - scorecard + critique Markdown renderers
//   - the scripted-attempt conversation loop (given a send-turn callback)
//   - an Architect bot-flow composer that calls the AVA
//   - the lifecycle workspace (KV-backed) that replaces the IDE's .ava-lifecycle/ folder
// ava-tools.js wires these to the Genesys API; ava-playbooks.js carries the
// vendored skills verbatim.

import { GenesysError } from './genesys.js';

// ---------- naming ----------

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || 'ava';
}

const PRIMITIVES = new Set(['string', 'number', 'boolean', 'integer']);
const RESERVED_KEYWORDS = new Set(['Boolean', 'Dynamic', 'Integer', 'List', 'Map', 'None', 'Number', 'String', 'Unknown', 'type', 'dict', 'tuple', 'list']);
const CANONICAL_MOCK_ERROR_CODES = new Set(['bad.request', 'invalid.value', 'not.found', 'resource.not.found', 'forbidden', 'unauthorized', 'conflict', 'too.many.requests', 'rate.limit.exceeded', 'server.internal.error', 'service.unavailable']);
const EVENT_TYPES = { userexit: 'UserExit', escalation: 'Escalation', guardrails: 'Guardrails' };

// ---------- definition normalization ----------

// Accepts the shapes an author (or the design skill) produces and returns the
// public API's AgenticVirtualAgentVersionDefinition. Tolerated inputs:
//   instructions as strings or {content} objects; guardrails as a flat array
//   of {rule|instruction, enabled}, {rules:[...]}, or {custom:[...]}; events as
//   a typed array or a {userExit, escalation, guardrails} object; tools with
//   targetId/targetName or target:{id,name}; pre/outcomeInstructions strings;
//   outputInstructions as strings or {when, then}; channel strings in types
//   (dropped); configuration -> settings. Pure and idempotent.
export function normalizeDefinition(input) {
  if (!input || typeof input !== 'object') throw new GenesysError('definition must be an object', 400);
  const def = {};
  // Workspace bookkeeping (_meta, _stored_at, ...) and design-only fields never
  // reach the API.
  for (const [k, v] of Object.entries(input)) if (!k.startsWith('_')) def[k] = v;
  delete def.name;
  delete def.testCases;
  delete def.context_variables;

  def.instructions = (def.instructions || []).map((i) => (typeof i === 'string' ? i : String(i?.content ?? i?.text ?? '')))
    .filter((s) => s.trim());

  if (Array.isArray(def.guardrails)) def.guardrails = { custom: def.guardrails };
  else if (def.guardrails && Array.isArray(def.guardrails.rules)) def.guardrails = { custom: def.guardrails.rules };
  if (def.guardrails?.custom) {
    def.guardrails = {
      custom: def.guardrails.custom.map((g) => (typeof g === 'string' ? { instruction: g, enabled: true } : {
        instruction: g.instruction ?? g.rule ?? g.text ?? '',
        enabled: g.enabled !== false,
      })).filter((g) => g.instruction),
    };
  } else if (def.guardrails == null) {
    delete def.guardrails;
  }

  if (def.events && !Array.isArray(def.events)) {
    const ev = def.events;
    def.events = Object.entries(ev).map(([k, v]) => {
      const type = EVENT_TYPES[k.toLowerCase()] || k;
      return { ...(v || {}), type };
    });
  }
  if (Array.isArray(def.events)) {
    def.events = def.events.map((e) => {
      const out = { ...e, type: EVENT_TYPES[String(e.type || '').toLowerCase()] || e.type };
      if (out.type === 'Guardrails') {
        if (out.warningMessage && !out.message) { out.message = out.warningMessage; }
        if (out.thresholdCrossedMessage && !out.violationThresholdCrossedMessage) out.violationThresholdCrossedMessage = out.thresholdCrossedMessage;
        if (out.violationThreshold == null) out.violationThreshold = 3;
      }
      delete out.warningMessage; delete out.thresholdCrossedMessage;
      return out;
    });
  }

  def.tools = (def.tools || []).map((t) => {
    const tool = { ...t };
    if (!tool.target && (tool.targetId || tool.targetName)) {
      tool.target = { id: tool.targetId, name: tool.targetName };
    }
    delete tool.targetId; delete tool.targetName;
    if (typeof tool.preInstructions === 'string') tool.inputInstructions = [tool.preInstructions];
    delete tool.preInstructions;
    if (typeof tool.inputInstructions === 'string') tool.inputInstructions = [tool.inputInstructions];
    if (typeof tool.outcomeInstructions === 'string') tool.outputInstructions = [{ when: 'True', then: tool.outcomeInstructions }];
    delete tool.outcomeInstructions;
    if (typeof tool.outputInstructions === 'string') tool.outputInstructions = [tool.outputInstructions];
    if (Array.isArray(tool.outputInstructions)) {
      tool.outputInstructions = tool.outputInstructions.map((o) => {
        if (typeof o === 'string') return { type: 'Python', when: 'True', then: o };
        const out = { ...o };
        if (out.when == null) out.when = 'True';
        if (!out.type) out.type = typeof out.when === 'string' ? 'Python' : 'Structured';
        return out;
      });
    }
    if (Array.isArray(tool.inputVariables) && !tool.inputs) {
      tool.inputs = tool.inputVariables.map((v) => ({
        targetName: v.targetName || v.name, type: v.type || 'string', source: v.source || 'User', required: v.required !== false,
      }));
    }
    delete tool.inputVariables;
    if (Array.isArray(tool.inputs)) {
      tool.inputs = tool.inputs.map((i) => {
        const inp = { ...i };
        if (!inp.targetName && inp.name) inp.targetName = inp.name;
        delete inp.name;
        if (inp.fallback_to_user !== undefined) { inp.fallbackToUser = inp.fallback_to_user; delete inp.fallback_to_user; }
        return inp;
      });
    }
    return tool;
  });

  def.types = (def.types || []).filter((t) => t && typeof t === 'object').map((t) => {
    const ty = { ...t };
    if (ty.user_utterance_substring !== undefined) { ty.userUtteranceSubstring = ty.user_utterance_substring; delete ty.user_utterance_substring; }
    if (ty.status_codes !== undefined) { ty.statusCodes = ty.status_codes; delete ty.status_codes; }
    if (ty.default_instruction !== undefined) { ty.defaultInstruction = ty.default_instruction; delete ty.default_instruction; }
    return ty;
  });

  if (def.configuration && !def.settings) def.settings = def.configuration;
  delete def.configuration;
  if (def.settings?.comfort_statement) {
    def.settings = { comfortStatement: def.settings.comfort_statement };
  }
  return def;
}

// ---------- pre-flight (the build skill's deterministic checks) ----------

export function preflightDefinition(def) {
  const errors = [];
  const warnings = [];
  const block = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!String(def.role || '').trim()) block('role is required (a brief description of the agent\'s capabilities)');
  if (!Array.isArray(def.instructions) || !def.instructions.length) block('instructions must contain at least one instruction');
  if (!Array.isArray(def.events) || !def.events.length) warn('no events configured (UserExit, Escalation, Guardrails messages); the platform will use defaults');

  const types = def.types || [];
  const typeByName = new Map(types.map((t) => [t.name, t]));
  const outputTypes = new Set(types.filter((t) => String(t.direction || '').toLowerCase() === 'output').map((t) => t.name));
  const inputTypes = new Set(types.filter((t) => String(t.direction || '').toLowerCase() === 'input').map((t) => t.name));
  const inputData = types.find((t) => t.name === 'InputData');
  const startContextTypes = new Set((inputData?.properties || []).map((p) => p.type));

  // N2: enum values are identifiers.
  for (const t of types) {
    if (Array.isArray(t.enum) && (t.type === 'string' || !t.type)) {
      for (const v of t.enum) {
        if (typeof v === 'string' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
          block(`Enum type '${t.name}' has invalid value '${v}'. Enum values must be valid identifiers (PascalCase, no spaces or special characters).`);
        }
      }
    }
    if (t.name !== 'InputData' && t.name !== 'OutputData' && Array.isArray(t.properties)) {
      for (const p of t.properties) {
        if (RESERVED_KEYWORDS.has(p.name)) warn(`Type '${t.name}' property '${p.name}' is a reserved keyword; the publish job may reject it. Omit it from the type.`);
      }
    }
  }

  // Start Context (InputData) checks: L14, T7a, T7b, L13.
  if (inputData) {
    if (inputData.description) block("Start Context 'InputData' has a reserved `description` field. Remove it; descriptions belong on the per-property alias types.");
    if (!Array.isArray(inputData.properties) || !inputData.properties.length) block("Start Context 'InputData' must declare properties.");
    for (const p of inputData.properties || []) {
      if (p.required === true) block(`Start Context property '${p.name}' has required: true, which is always rejected. Remove it.`);
      if (PRIMITIVES.has(p.type)) {
        block(`Start Context property '${p.name}' references a bare primitive. Create a named alias type (e.g. CustomerId of type string) and reference it.`);
      } else {
        const ref = typeByName.get(p.type);
        if (ref && Array.isArray(ref.enum)) block(`Start Context property '${p.name}' references enum type '${p.type}'. Enums are not allowed in Start Context; use a plain string alias.`);
        if (ref && ref.type && !PRIMITIVES.has(ref.type)) block(`Start Context property '${p.name}' type '${p.type}' must alias a bare primitive (string/integer/number/boolean).`);
      }
      const n = String(p.name || '');
      const reasons = [];
      if (!/^[a-z0-9_]+$/.test(n)) reasons.push('only lowercase letters, digits, and underscores');
      if (!n.includes('_')) reasons.push('must contain at least one underscore');
      if (/^_|_$/.test(n)) reasons.push('cannot start or end with an underscore');
      if (/^\d|\d$/.test(n)) reasons.push('cannot start or end with a digit');
      if (n.includes('__')) reasons.push('no consecutive underscores');
      if (n.split('_').some((seg) => seg.length < 2)) reasons.push('every underscore-separated segment needs at least 2 characters');
      if (reasons.length) block(`Start Context property name '${n}' is invalid: ${reasons.join('; ')}. Use snake_case like customer_id.`);
    }
  }

  for (const tool of def.tools || []) {
    const tn = tool.name || '(unnamed tool)';
    if (!tool.target?.id || !tool.target?.name) block(`Tool '${tn}' needs a target {id, name} (the DataAction / KnowledgeSetting / KnowledgeBase it calls).`);
    if (!tool.description) warn(`Tool '${tn}' has no description; the agent decides when to call a tool from its description.`);
    // T8: output type declared with direction output.
    if (tool.output) {
      const ot = typeByName.get(tool.output);
      if (!ot) block(`Tool '${tn}' references output type '${tool.output}' which is not declared in types[].`);
      else if (String(ot.direction || '').toLowerCase() !== 'output') block(`Tool '${tn}' output type '${tool.output}' is missing direction: "output".`);
    }
    for (const inp of tool.inputs || []) {
      const iname = inp.targetName || '(unnamed input)';
      const src = inp.source;
      if (src === 'ToolOutput') {
        // L5
        if (PRIMITIVES.has(inp.type)) block(`Tool '${tn}' input '${iname}' has type "${inp.type}" with source ToolOutput. The type must be the producer's output type name (e.g. AccountResult), not the primitive type of the mapped field.`);
        else if (!outputTypes.has(inp.type)) block(`Tool '${tn}' input '${iname}' references type '${inp.type}' which is not declared with direction: "output".`);
        if (!Array.isArray(inp.mapping) || inp.mapping.length < 2) block(`Tool '${tn}' input '${iname}' (source ToolOutput) needs mapping: ["OutputTypeName", "field"].`);
        else if (inp.mapping[0] !== inp.type) warn(`Tool '${tn}' input '${iname}': mapping[0] ("${inp.mapping[0]}") should equal type ("${inp.type}").`);
      } else if (src === 'User') {
        // L11
        if (PRIMITIVES.has(inp.type)) block(`Tool '${tn}' input '${iname}' has type "${inp.type}" with source User. Create a named type with direction: "input" and reference it instead.`);
        else if (!inputTypes.has(inp.type)) block(`Tool '${tn}' input '${iname}' references type '${inp.type}' which is not declared with direction: "input".`);
      } else if (src === 'External') {
        // L15
        if (inp.required === true && inp.fallbackToUser !== true) block(`External required input '${iname}' on tool '${tn}' must set fallbackToUser: true.`);
        if (PRIMITIVES.has(inp.type)) block(`External input '${iname}' on tool '${tn}' has bare primitive type "${inp.type}". Reference a named type declared as a property on the InputData (Start Context) object.`);
        else if (!startContextTypes.has(inp.type)) block(`External input '${iname}' type '${inp.type}' is not declared as a Start Context property. Add a property on InputData referencing that type.`);
        const ref = typeByName.get(inp.type);
        if (ref?.userUtteranceSubstring === true && inp.fallbackToUser !== true) block(`External input '${iname}' references a userUtteranceSubstring type without fallbackToUser: true.`);
      }
      if (inp.fallbackToUser === true && src !== 'External') block(`fallbackToUser is only valid on source: "External" inputs; input '${iname}' on tool '${tn}' has source '${src}'.`);
    }
    for (const o of tool.outputInstructions || []) {
      if (o.type === 'Python' && typeof o.when === 'string' && o.when !== 'True' && !/^lambda\b/.test(o.when)) {
        warn(`Tool '${tn}' outputInstructions.when "${o.when}" is neither "True" nor a lambda; the publish job rejects natural-language conditions. Move the condition into the then text.`);
      }
    }
    // L10: mock error codes.
    for (const m of tool.mocks || tool.mock_responses || []) {
      const code = m?.error?.code;
      if (code && m.error.status == null && !CANONICAL_MOCK_ERROR_CODES.has(code)) {
        warn(`Mock error code '${code}' is not canonical and no error.status is set; it will silently resolve to HTTP 400.`);
      }
    }
  }
  return { ok: !errors.length, errors, warnings };
}

// ---------- Layer 1: deterministic trajectory validation ----------

function subsequenceInOrder(expected, actual) {
  let pos = 0;
  for (const name of expected) {
    const idx = actual.indexOf(name, pos);
    if (idx < 0) return false;
    pos = idx + 1;
  }
  return true;
}

export function validateTrajectory(reference = [], actualToolCalls = [], guardrailEvents = []) {
  const expectedNames = reference.map((r) => r.tool);
  const actualNames = actualToolCalls.map((c) => c.name);
  const matched = [];
  const paramMismatches = [];
  for (const ref of reference) {
    const cand = actualToolCalls.find((c) => c.name === ref.tool);
    if (!cand) continue;
    matched.push(ref.tool);
    const mode = ref.match || 'exact';
    const input = cand.input || {};
    for (const [key, value] of Object.entries(ref.params || {})) {
      const ok = mode === 'presence' ? key in input : JSON.stringify(input[key]) === JSON.stringify(value);
      if (!ok) paramMismatches.push({ tool: ref.tool, param: key, expected: value, actual: input[key], mode });
    }
  }
  const missing = expectedNames.filter((n) => !actualNames.includes(n));
  const unexpected = [...new Set(actualNames.filter((n) => !expectedNames.includes(n)))];
  const ordered = reference.filter((r) => r.order != null).sort((a, b) => a.order - b.order).map((r) => r.tool);
  const orderOk = subsequenceInOrder(ordered, actualNames);
  const violations = guardrailEvents.filter((g) => g && g.violated);
  return {
    coverage: expectedNames.length ? matched.length / expectedNames.length : 1,
    matchedTools: matched,
    missingTools: missing,
    unexpectedTools: unexpected,
    orderOk,
    paramMismatches,
    guardrailViolations: violations,
  };
}

// ---------- scoring (versioned rubric, ported verbatim) ----------

export const RUBRIC_VERSION = '1.0';
export const DIMENSION_WEIGHTS = { goal: 0.35, tool_use: 0.25, guardrail: 0.25, responseMatch: 0.10, tone_format: 0.05 };
export const PASS_THRESHOLD = 0.6;
export const DEFAULT_SUCCESS_THRESHOLD = 0.8;
const VALID_VERDICTS = new Set(['pass', 'fail', 'uncertain']);
export const RUBRIC_DIMENSIONS = ['goal', 'tool_use', 'guardrail', 'tone_format'];
const LAYER2_DIMENSIONS = new Set(RUBRIC_DIMENSIONS);
const RESPONSE_MATCH_DIMENSIONS = new Set(['responseMatch', 'response_match']);
// Per the evaluate playbook: only unobservable runs are infrastructure errors.
// A conversation that hits max_turns is a real, scored FAIL; turns_exhausted
// (the script ran out while the agent was still talking) is scored on its
// merits by the judge.
const FAILURE_ENDED = new Set(['error', 'infraError', 'time_budget']);
const NOT_PASSED_ENDED = new Set(['max_turns']);

const clamp = (v) => Math.max(0, Math.min(1, v));
const round3 = (v) => Math.round(v * 1000) / 1000;
const passRate = (list) => (list.length ? list.filter(Boolean).length / list.length : 1);

export function scoreAttempt(layer1 = {}, verdicts = []) {
  const byDim = Object.fromEntries(Object.keys(DIMENSION_WEIGHTS).map((d) => [d, []]));
  for (const v of verdicts) {
    const dim = v?.dimension === 'response_match' ? 'responseMatch' : v?.dimension;
    if (dim in byDim) byDim[dim].push(v.verdict === 'pass');
  }
  const coverage = layer1.coverage ?? 1;
  const orderOk = layer1.orderOk ?? layer1.order_ok ?? true;
  const violations = layer1.guardrailViolations ?? layer1.guardrail_violations ?? [];
  const dimensionScores = {};
  for (const dim of Object.keys(DIMENSION_WEIGHTS)) {
    const rate = passRate(byDim[dim]);
    let score;
    if (dim === 'tool_use') score = 0.5 * rate + 0.5 * (0.5 * coverage + 0.5 * (orderOk ? 1 : 0));
    else if (dim === 'guardrail') score = Math.min(rate, violations.length ? 0 : 1);
    else score = rate;
    dimensionScores[dim] = round3(clamp(score));
  }
  const pass = Object.values(dimensionScores).every((s) => s >= PASS_THRESHOLD);
  const weightedScore = round3(clamp(Object.entries(DIMENSION_WEIGHTS).reduce((sum, [d, w]) => sum + dimensionScores[d] * w, 0)));
  return { rubricVersion: RUBRIC_VERSION, dimensionScores, weightedScore, pass };
}

export function scoreScenario(attemptResults, threshold, totalAttempts) {
  const passed = attemptResults.filter((a) => a.pass).length;
  const denominator = totalAttempts ?? attemptResults.length;
  const rate = denominator ? passed / denominator : 0;
  return { attempts: denominator, passed, successRate: round3(rate), threshold, verdict: rate >= threshold ? 'pass' : 'fail' };
}

function attemptScoringStatus(attempt) {
  const layer2 = attempt.layer2;
  const responseMatch = attempt.responseMatch ?? attempt.response_match ?? [];
  // A run that never produced a judgeable transcript is the infra error, not
  // the missing judgment.
  if (FAILURE_ENDED.has(attempt.ended)) return ['infraError', `ended_${attempt.ended}`];
  if (layer2 == null) return ['infraError', 'layer2_not_judged'];
  if (!Array.isArray(layer2)) return ['infraError', 'unparseable_layer2_verdicts'];
  if (!layer2.length) return ['infraError', 'missing_layer2_verdicts'];
  // A verdict whose dimension is not in the rubric would be silently dropped
  // by the scorer (an empty dimension scores 1.0), so it is an unparseable
  // verdict, not a pass.
  for (const [list, code, pendingCode, dims] of [[layer2, 'unparseable_layer2_verdicts', 'layer2_not_judged', LAYER2_DIMENSIONS], [responseMatch, 'unparseable_response_match_verdicts', 'response_match_not_judged', RESPONSE_MATCH_DIMENSIONS]]) {
    if (!Array.isArray(list)) return ['infraError', code];
    for (const v of list) {
      if (v?.verdict === 'pending') return ['infraError', pendingCode];
      if (!v || typeof v !== 'object' || !VALID_VERDICTS.has(v.verdict) || !dims.has(v.dimension)) return ['infraError', code];
    }
  }
  return ['scored', null];
}

// perScenario: [{ testCaseId, name, threshold?, attempts: [{ attempt, ended, layer1, layer2, responseMatch }] }]
export function computeScorecard({ runId, agentId, version, perScenario, defaultThreshold = DEFAULT_SUCCESS_THRESHOLD }) {
  const results = [];
  let passed = 0, failed = 0, infraError = 0;
  for (const scenario of perScenario) {
    const threshold = scenario.threshold ?? defaultThreshold;
    const all = scenario.attempts || [];
    const scored = [];
    const passing = [];
    let hasInfra = false;
    for (const attempt of all) {
      const record = {
        attempt: attempt.attempt, ended: attempt.ended, layer1: attempt.layer1 || {}, layer2: attempt.layer2,
        responseMatch: attempt.responseMatch ?? attempt.response_match ?? [],
      };
      const [status, code] = attemptScoringStatus(attempt);
      if (status === 'infraError') {
        record.status = 'infraError'; record.error = code; hasInfra = true; scored.push(record); continue;
      }
      const s = scoreAttempt(record.layer1, [...record.layer2, ...record.responseMatch]);
      const pass = s.pass && !NOT_PASSED_ENDED.has(record.ended);
      Object.assign(record, { dimensionScores: s.dimensionScores, weightedScore: s.weightedScore, pass, status: 'scored', ...(s.pass && !pass ? { note: `ended=${record.ended}: recorded as not passed per the evaluate playbook` } : {}) });
      scored.push(record);
      passing.push({ ...s, pass });
    }
    const sc = scoreScenario(passing, threshold, all.length);
    const allScoredPassed = passing.length > 0 && passing.every((a) => a.pass);
    let classification;
    if (!passing.length && hasInfra) classification = 'infraError';
    else if (hasInfra && allScoredPassed && sc.verdict === 'fail') classification = 'infraError';
    else classification = sc.verdict === 'pass' ? 'pass' : 'fail';
    results.push({ testCaseId: scenario.testCaseId, name: scenario.name, successRate: sc.successRate, threshold: sc.threshold, verdict: sc.verdict, classification, attempts: scored });
    if (classification === 'infraError') infraError++; else if (classification === 'pass') passed++; else failed++;
  }
  return {
    run_id: runId,
    metadata: { created_at: new Date().toISOString(), created_by: 'genesys-mcp scorecard', rubricVersion: RUBRIC_VERSION },
    agentId, version,
    scoringFormula: { dimensionWeights: DIMENSION_WEIGHTS, passThreshold: PASS_THRESHOLD },
    summary: { total: perScenario.length, passed, failed, infraError },
    perScenario: results,
  };
}

const DIM_LABELS = { goal: 'Goal', tool_use: 'Tool Use', guardrail: 'Guardrail', responseMatch: 'Response Match', tone_format: 'Tone/Format' };
const fmtScore = (v) => (v == null ? '-' : v.toFixed(2));
const verdictLabel = (v) => ({ pass: 'PASS', fail: 'FAIL', infraError: 'INFRA ERROR' }[v] || String(v));

export function scorecardMarkdown(sc) {
  const s = sc.summary || {};
  const overall = s.infraError && !s.passed && !s.failed ? 'INFRA ERROR' : s.failed ? 'FAIL' : s.passed && !s.infraError ? 'PASS' : 'MIXED';
  const weights = Object.entries(sc.scoringFormula?.dimensionWeights || {}).map(([k, v]) => `${k}=${v}`).join(', ');
  const L = [
    '# AVA Evaluation Scorecard', '',
    `**Agent:** \`${sc.agentId}\` v\`${sc.version}\`  **Run:** \`${sc.run_id}\`  **Rubric:** \`${sc.metadata?.rubricVersion}\``,
    `**Generated:** ${sc.metadata?.created_at || '-'}`, '',
    `**Overall:** ${overall}. Scenarios PASS ${s.passed || 0} / FAIL ${s.failed || 0} / INFRA ${s.infraError || 0} (total ${s.total || 0})`, '',
    `**Scoring formula:** weights ${weights}, pass threshold ${sc.scoringFormula?.passThreshold ?? '-'}`, '', '---', '',
  ];
  const dims = Object.keys(DIM_LABELS);
  if (!sc.perScenario?.length) L.push('_No scenarios in this run._');
  for (const sn of sc.perScenario || []) {
    L.push(`## ${sn.name || sn.testCaseId}: ${verdictLabel(sn.classification || sn.verdict)}`, '');
    L.push(`\`testCaseId\`: \`${sn.testCaseId}\``, '');
    L.push(`successRate **${fmtScore(sn.successRate)}** vs threshold **${fmtScore(sn.threshold)}**`, '');
    if (sn.attempts?.length) {
      const header = ['Attempt', 'Ended', 'Status', ...dims.map((d) => DIM_LABELS[d]), 'Weighted', 'Pass'];
      L.push(`| ${header.join(' | ')} |`, `|${'---|'.repeat(header.length)}`);
      for (const a of sn.attempts) {
        const ds = a.dimensionScores || {};
        const row = [a.attempt ?? '-', a.ended ?? '-', a.status === 'infraError' ? `infraError (${a.error})` : a.status || '-',
          ...dims.map((d) => fmtScore(ds[d])), fmtScore(a.weightedScore), a.pass == null ? '-' : a.pass ? 'yes' : 'no'];
        L.push(`| ${row.join(' | ')} |`);
      }
    } else L.push('_No attempts recorded._');
    L.push('', '---', '');
  }
  return L.join('\n').trimEnd() + '\n';
}

// ---------- critique report Markdown ----------

const OVERALL = { errors: 'Fix errors first', warnings: 'Needs work', clean: 'Ready to publish' };

export function critiqueMarkdown(report) {
  const errors = report.errors || [], warnings = report.warnings || [], info = report.info || [], positives = report.positives || [];
  const overall = report.overall || (errors.length ? OVERALL.errors : warnings.length ? OVERALL.warnings : OVERALL.clean);
  const title = report.metadata?.agent_name || report.metadata?.agentName || report.target || 'AVA';
  const L = [`# AVA Analysis Report: ${title}`, '', `*Generated: ${report.generated_at || new Date().toISOString()}*  `, `*Target: \`${report.target || '-'}\`*`, ''];
  L.push(`> **${overall}**. ${errors.length} errors, ${warnings.length} warnings, ${info.length} info, ${positives.length} praise`, '');
  const meta = report.metadata;
  if (meta) {
    const rows = [];
    if (meta.agentId) rows.push(['Agent ID', `\`${meta.agentId}\``]);
    if (meta.version_id || meta.version) rows.push(['Version', meta.version_id || meta.version]);
    if (meta.channel) rows.push(['Channel', meta.channel]);
    if (meta.analysis_scope) rows.push(['Scope', meta.analysis_scope]);
    if (meta.stats) rows.push(['Tools / Types / Guardrails / Instructions', `${meta.stats.tool_count ?? '-'} / ${meta.stats.type_count ?? '-'} / ${meta.stats.guardrail_count ?? '-'} / ${meta.stats.instruction_count ?? '-'}`]);
    if (rows.length) { L.push('| Field | Value |', '|-------|-------|', ...rows.map(([k, v]) => `| ${k} | ${v} |`), ''); }
  }
  if (report.summary) {
    L.push('## Executive Summary', '', report.summary.prose || '', '');
    if (report.summary.top_priorities?.length) {
      L.push('**Top priorities:**', '', ...report.summary.top_priorities.map((p, i) => `${i + 1}. ${p}`), '');
    }
    if (report.summary.estimated_total_minutes != null) L.push(`**Estimated total effort:** ~${report.summary.estimated_total_minutes} min`, '');
  }
  const section = (heading, findings, severity) => {
    L.push(`## ${heading}`, '');
    if (!findings.length) { L.push('_None._', ''); return; }
    for (const f of findings) {
      const cat = f.category || 'General';
      L.push(`### [${cat}] ${f.finding || f.title || ''}`, '');
      const badges = [`**Severity:** ${f.severity || severity}`];
      if (f.confidence) badges.push(`**Confidence:** ${f.confidence}`);
      if (f.effort) badges.push(`**Effort:** ${f.effort}`);
      L.push(badges.join(' | '), '');
      if (f.affected_entities?.length) {
        L.push(`**Affected:** ${f.affected_entities.map((e) => `\`${e.jsonPath || (e.name ? `${e.kind}:${e.name}` : e.index != null ? `${e.kind}[${e.index}]` : e.kind)}\``).join(', ')}`, '');
      }
      if (f.evidence) L.push('**Evidence:**', '', '```', String(f.evidence), '```', '');
      if (f.fix) L.push(`**Fix:** ${f.fix}`, '');
      if (f.source) {
        const srcs = (Array.isArray(f.source) ? f.source : [f.source]).map((s) => (typeof s === 'string' ? s : [s.document, s.section && `section ${s.section}`, s.anti_pattern_id && `AP:${s.anti_pattern_id}`].filter(Boolean).join(' / ')));
        L.push(`*Source: ${srcs.join(', ')}*`, '');
      }
      L.push('---', '');
    }
  };
  section('Errors (must fix before publishing)', errors, 'error');
  section('Warnings (should fix)', warnings, 'warning');
  section('Info (consider improving)', info, 'info');
  section('Praise (working well)', positives, 'info');
  if (report.change_suggestions?.length) {
    L.push('## Change Suggestions', '', '| # | Priority | Suggestion | Category | Effort |', '|---|----------|-----------|----------|--------|');
    for (const s of [...report.change_suggestions].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))) {
      L.push(`| ${s.id || '-'} | ${s.priority ?? '-'} | ${String(s.text || '').replace(/\|/g, '\\|')} | ${s.category || '-'} | ${s.effort || '-'} |`);
    }
    L.push('');
  }
  if (report.test_coverage) {
    const c = report.test_coverage;
    L.push('## Test Coverage', '', `**Status:** ${c.has_existing_tests ? 'Existing tests found' : 'No existing tests'}`, '');
    if (c.gaps?.length) L.push('**Gaps:**', '', ...c.gaps.map((g) => `- ${g}`), '');
  }
  return { markdown: L.join('\n').trimEnd() + '\n', overall, counts: { errors: errors.length, warnings: warnings.length, info: info.length, positives: positives.length } };
}

// ---------- chat turns (Cicero public API shapes) ----------

export function buildTurnRequest({ text, previousTurnId, version }) {
  const inputEvent = text == null
    ? { type: 'NoOp', mode: 'Text' }
    : { type: 'UserInput', mode: 'Text', alternatives: [{ transcript: { text: String(text), confidence: 1 } }] };
  const req = { inputEvent };
  if (previousTurnId) req.previousTurn = { id: previousTurnId };
  if (version) req.version = String(version);
  return req;
}

export const TERMINAL_ACTIONS = new Set(['Exit', 'Disconnect']);

export function summarizeTurn(turn) {
  const segments = turn?.prompts?.text?.segments || [];
  const nextAction = turn?.nextAction?.type || 'WaitForInput';
  return {
    turnId: turn?.id,
    agentText: segments.map((s) => s.text || '').join(' ').trim(),
    toolCalls: turn?.events?.toolCalls || [],
    toolResults: turn?.events?.toolResults || [],
    guardrails: turn?.events?.guardrails || null,
    errors: turn?.events?.errors || [],
    nextAction,
    isTerminal: TERMINAL_ACTIONS.has(nextAction),
  };
}

// Merge a NoOp continuation turn into the running aggregate (mutates `agg`).
export function mergeTurn(agg, cont) {
  agg.prompts = agg.prompts || { text: { segments: [] } };
  agg.prompts.text = agg.prompts.text || { segments: [] };
  agg.prompts.text.segments.push(...(cont?.prompts?.text?.segments || []));
  agg.events = agg.events || { toolCalls: [], toolResults: [], errors: [] };
  agg.events.toolCalls = [...(agg.events.toolCalls || []), ...(cont?.events?.toolCalls || [])];
  agg.events.toolResults = [...(agg.events.toolResults || []), ...(cont?.events?.toolResults || [])];
  agg.events.errors = [...(agg.events.errors || []), ...(cont?.events?.errors || [])];
  if (cont?.events?.guardrails) agg.events.guardrails = cont.events.guardrails;
  agg.id = cont.id;
  agg.nextAction = cont.nextAction;
  agg.previousTurn = cont.previousTurn;
  return agg;
}

// Cost projection from the evaluate skill: sum(attempts x (max_turns + 2)).
export function projectEvalCalls(scenarios) {
  return scenarios.reduce((n, s) => {
    const x = s.x_eval || s;
    return n + (x.attempts ?? 1) * ((x.max_turns ?? 10) + 2);
  }, 0);
}

// Run ONE scripted attempt: every turn in `turns` must be fixed_user or
// fixed_agent (actor turns need the host LLM and are driven turn by turn with
// the chat tools instead). `startSession()` returns the greeting summary;
// `sendTurn(text, previousTurnId)` returns a turn summary. Pure given those.
// `deadline` (ms epoch) bounds the wall clock so a tool call stays inside the
// MCP client's timeout; an attempt cut short ends with 'time_budget'.
export async function runScriptedAttempt({ turns, maxTurns = 10, referenceTrajectory = [], deadline = Infinity }, { startSession, sendTurn }) {
  const transcript = [];
  const toolCalls = [];
  const toolResults = [];
  const guardrailEvents = [];
  const responseMatch = [];
  let ended = 'turns_exhausted';
  const greeting = await startSession();
  // Everything the judge needs: agent text, tool calls AND their results,
  // guardrail events, errors, and an explicit marker when a turn was cut off.
  const record = (summary) => {
    if (summary.agentText) transcript.push({ role: 'agent', text: summary.agentText });
    for (const tc of summary.toolCalls || []) toolCalls.push({ name: tc.name, input: tc.input || {}, output: tc.output ?? '' });
    for (const tr of summary.toolResults || []) {
      toolResults.push({ name: tr.name, output: tr.output ?? '', ...(tr.error ? { error: tr.error } : {}) });
      transcript.push({ role: 'tool', text: `${tr.name}: ${typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output ?? '')}${tr.error ? ` (error: ${tr.error})` : ''}`.slice(0, 1000) });
    }
    if (summary.guardrails) guardrailEvents.push(summary.guardrails);
    if (summary.errors?.length) transcript.push({ role: 'system', text: `errors: ${JSON.stringify(summary.errors).slice(0, 500)}` });
    if (summary.truncated) transcript.push({ role: 'system', text: 'agent turn truncated: the tool time budget ran out while the agent was still working' });
    return Boolean(summary.truncated);
  };
  let previousTurnId = greeting.turnId;
  let lastAgentText = greeting.agentText;
  let userTurns = 0;
  let terminal = greeting.isTerminal;
  let truncated = record(greeting);
  for (const turn of turns) {
    if (turn.source === 'fixed_agent') {
      // An expectation about the agent's LAST reply, so it is recorded even
      // when that reply ended the conversation (the goodbye case) or was cut
      // off. Judged by the host model (semantic match); 'pending' keeps the
      // scorecard honest if someone scores before judging.
      responseMatch.push({ id: `rm-${responseMatch.length + 1}`, dimension: 'responseMatch', expected: turn.text, actual: lastAgentText, verdict: 'pending', reason: truncated ? 'the actual reply was cut off by the time budget; judge what was captured' : 'judge semantic equivalence of actual vs expected, then set verdict pass/fail' });
      continue;
    }
    if (truncated) { ended = 'time_budget'; break; }
    if (terminal) { ended = 'terminal'; break; }
    if (turn.source !== 'fixed_user') {
      transcript.push({ role: 'system', text: `turn source "${turn.source}" cannot run server-side; drive it with ava_chat_send` });
      ended = 'error';
      break;
    }
    if (userTurns >= maxTurns) { ended = 'max_turns'; break; }
    if (Date.now() > deadline) { ended = 'time_budget'; transcript.push({ role: 'system', text: 'stopped: tool time budget reached before the script finished' }); break; }
    transcript.push({ role: 'user', text: turn.text });
    userTurns++;
    let summary;
    try { summary = await sendTurn(turn.text, previousTurnId); } catch (e) {
      transcript.push({ role: 'system', text: `turn error: ${e.message}` });
      ended = 'error';
      break;
    }
    truncated = record(summary);
    previousTurnId = summary.turnId;
    lastAgentText = summary.agentText;
    terminal = summary.isTerminal;
    if (truncated) ended = 'time_budget';
    else if (terminal) ended = 'terminal';
  }
  // ended vocabulary (playbook): terminal | turns_exhausted | max_turns | error | time_budget.
  // turns_exhausted = the script ran out with the agent still waiting; the
  // judge decides whether the goal condition was met.
  const layer1 = validateTrajectory(referenceTrajectory, toolCalls, guardrailEvents);
  return { ended, transcript, toolCalls, toolResults, guardrailEvents, responseMatch, layer1, lastTurnId: previousTurnId };
}

// ---------- Architect bot flow that calls the AVA ----------

function yq(s) {
  return `'${String(s).replace(/[\r\n\t]+/g, ' ').replace(/'/g, "''")}'`;
}
function expText(s) {
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/["\\]/g, "'");
}
// A MakeCommunication(...) expression as a single-quoted YAML scalar, so
// apostrophes in the copy ("I'm") cannot break the YAML.
const comm = (text) => yq(`MakeCommunication("${expText(text)}")`);

export function validateAvaBotFlowSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec must be an object'] };
  if (!String(spec.name || '').trim()) errors.push('name is required');
  if (!String(spec.ava || spec.ava_name || '').trim()) errors.push('ava (the published agentic virtual agent\'s name) is required');
  const lang = spec.language || 'en-us';
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(lang)) errors.push(`language "${lang}" does not look like a language tag (e.g. en-us)`);
  for (const [k, v] of Object.entries(spec.inputs || {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(k)) errors.push(`inputs key "${k}" must be a Start Context property name (snake_case: lowercase letters, digits, underscores)`);
    if (v && typeof v === 'object' && !('lit' in v) && !('exp' in v) && !('noValue' in v)) errors.push(`inputs.${k} must be a literal string or { lit } / { exp } / { noValue }`);
  }
  for (const [k, v] of Object.entries(spec.outputs || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(k)) errors.push(`outputs key "${k}" must be an End Context property name (letters, digits, underscores, dots)`);
    if (!/^(Flow\.)?[A-Za-z_][A-Za-z0-9_]*$/.test(String(v || ''))) errors.push(`outputs.${k} must name a flow variable like Flow.resolution (letters, digits, underscores)`);
  }
  return { ok: !errors.length, errors };
}

// Spec: { name, description?, division?, language?, ava (published AVA name),
//   inputs?: { start_context_prop: "literal" | { lit } | { exp } | { noValue } },
//   outputs?: { end_context_prop: "Flow.varName" },
//   greeting?: TTS said before the agent starts (default none),
//   failure_message?, timeout_message?, escalation_message? }
// The bot flow exits back to the calling flow when the agent finishes; the
// inbound flow decides what happens next (transfer, disconnect).
export function avaBotFlowToArchyYaml(spec) {
  const L = [];
  const push = (n, t) => L.push('  '.repeat(n) + t);
  const lang = spec.language || 'en-us';
  const avaName = spec.ava || spec.ava_name;
  const failure = spec.failure_message || 'Sorry, something went wrong on our end. Let me get you to someone who can help.';
  const timeout = spec.timeout_message || failure;
  const outputs = spec.outputs || {};
  const inputs = spec.inputs || {};

  push(0, 'botFlow:');
  push(1, `name: ${yq(spec.name)}`);
  if (spec.description) push(1, `description: ${yq(spec.description)}`);
  if (spec.division) push(1, `division: ${yq(spec.division)}`);
  push(1, 'startUpRef: "/botFlow/bots/bot[main]"');
  push(1, `defaultLanguage: ${lang}`);
  push(1, 'supportedLanguages:');
  push(2, `${lang}:`);
  push(3, 'defaultLanguageSkill:');
  push(4, 'noValue: true');
  push(3, 'speechToText:');
  push(4, 'engine:');
  push(5, 'name: Genesys Enhanced v2');
  push(5, 'defaultEngine: true');
  push(1, 'variables:');
  push(2, '- stringVariable:');
  push(4, 'name: Flow.exitReason');
  push(4, 'initialValue:');
  push(5, 'noValue: true');
  push(4, 'isInput: false');
  push(4, 'isOutput: true');
  const outVars = new Set();
  for (const v of Object.values(outputs)) {
    const name = String(v).startsWith('Flow.') ? String(v) : `Flow.${v}`;
    if (name === 'Flow.exitReason' || outVars.has(name)) continue;
    outVars.add(name);
    push(2, '- stringVariable:');
    push(4, `name: ${name}`);
    push(4, 'initialValue:');
    push(5, 'noValue: true');
    push(4, 'isInput: false');
    push(4, 'isOutput: true');
  }
  // Without an action-default processing prompt Architect flags a warning on
  // every publish; Genesys' own exports use the system "processing" prompt.
  push(1, 'settingsActionDefaults:');
  push(2, 'callGuide:');
  push(3, 'voiceProcessingPrompt:');
  push(4, 'exp: MakeCommunication(PromptSystem.processing_keyboard)');
  push(1, 'settingsErrorHandling:');
  push(2, 'errorHandling:');
  push(3, 'exit:');
  push(4, 'none: true');
  push(2, 'enableAgentEscalation:');
  push(3, 'lit: true');
  push(2, 'errorEventHandover:');
  push(3, `exp: ${comm(failure)}`);
  push(2, 'agentEscalationConfirmation:');
  push(3, `exp: ${comm(spec.escalation_confirmation || 'You would like to speak with a person. Is that right?')}`);
  push(2, 'agentEscalationHandover:');
  push(3, `exp: ${comm(spec.escalation_message || 'One moment while I connect you.')}`);
  push(2, 'recognitionFailureEventHandover:');
  push(3, `exp: ${comm(spec.recognition_failure_message || "I'm having trouble understanding. Let me get you to someone who can help.")}`);
  push(2, 'recognitionFailureEventHandling:');
  push(3, 'exit:');
  push(4, 'none: true');
  push(2, 'agentEscalationHandling:');
  push(3, 'exit:');
  push(4, 'none: true');
  push(1, 'settingsBotFlow:');
  push(2, 'voiceProcessingPrompt:');
  push(3, 'noValue: true');
  push(2, 'virtualAgentEnabled: true');
  push(1, 'settingsVirtualAgent:');
  push(2, 'summarization:');
  push(3, 'lit: false');
  push(2, 'assignWrapupCodes:');
  push(3, 'lit: false');
  push(1, 'bots:');
  push(2, '- bot:');
  push(4, 'name: Main');
  push(4, 'refId: main');
  push(4, 'actions:');
  if (spec.greeting) {
    push(5, '- communicate:');
    push(7, 'name: Greeting');
    push(7, 'communication:');
    push(8, `exp: ${comm(spec.greeting)}`);
  }
  push(5, '- callAgenticVirtualAgent:');
  push(7, `name: ${yq(`Call ${avaName}`)}`);
  push(7, 'agenticVirtualAgent:');
  push(8, `${yq(avaName)}:`);
  push(9, 'ver_latestPublished:');
  const inputEntries = Object.entries(inputs);
  if (inputEntries.length) {
    push(10, 'inputs:');
    for (const [k, v] of inputEntries) {
      push(11, `${k}:`);
      if (v == null || (typeof v === 'object' && 'noValue' in v)) push(12, 'noValue: true');
      else if (typeof v === 'object' && 'exp' in v) push(12, `exp: ${yq(v.exp)}`);
      else push(12, `lit: ${yq(typeof v === 'object' ? v.lit : v)}`);
    }
  }
  const outputEntries = Object.entries(outputs);
  if (outputEntries.length) {
    push(10, 'outputs:');
    for (const [k, v] of outputEntries) {
      push(11, `${k}:`);
      push(12, `var: ${String(v).startsWith('Flow.') ? v : `Flow.${v}`}`);
    }
  }
  push(10, 'exitReason:');
  push(11, 'var: Flow.exitReason');
  push(7, 'outputs:');
  push(8, 'success:');
  push(9, 'actions:');
  push(10, '- exitBotFlow:');
  push(12, 'name: Exit Bot Flow');
  push(8, 'failure:');
  push(9, 'actions:');
  push(10, '- communicate:');
  push(12, 'name: Failure Message');
  push(12, 'communication:');
  push(13, `exp: ${comm(failure)}`);
  push(10, '- exitBotFlow:');
  push(12, 'name: Exit Bot Flow');
  push(8, 'timeout:');
  push(9, 'actions:');
  push(10, '- communicate:');
  push(12, 'name: Timeout Message');
  push(12, 'communication:');
  push(13, `exp: ${comm(timeout)}`);
  push(10, '- exitBotFlow:');
  push(12, 'name: Exit Bot Flow');
  return L.join('\n') + '\n';
}

export function avaBotFlowToMermaid(spec) {
  const m = (s, max = 50) => { const t = String(s).replace(/"/g, "'"); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
  const L = ['flowchart TD'];
  L.push(`  start(["🤖 ${m(spec.name)}"])`);
  let prev = 'start';
  if (spec.greeting) { L.push(`  greet["🔊 ${m(spec.greeting)}"]`); L.push('  start --> greet'); prev = 'greet'; }
  L.push(`  ava[["🧠 AVA: ${m(spec.ava || spec.ava_name, 40)} (latest published)"]]`);
  L.push(`  ${prev} --> ava`);
  const inputs = Object.keys(spec.inputs || {});
  if (inputs.length) L.push(`  ctx["📥 start context: ${m(inputs.join(', '), 45)}"]`, '  ctx -.-> ava');
  L.push('  ok(("↩️ exit to caller"))', '  ava -->|success / user exit / escalation| ok');
  L.push(`  fail["🔊 ${m(spec.failure_message || 'failure message', 40)}"]`, '  ava -->|failure / timeout| fail', '  fail --> ok');
  return L.join('\n');
}

// ---------- lifecycle workspace (replaces the IDE's .ava-lifecycle/ folder) ----------

export const WORKSPACE_KINDS = ['design', 'agent', 'test_case', 'test_set', 'attempt', 'scorecard', 'critique', 'knowledge', 'knowledge_sources', 'note'];
const SINGLETON_KINDS = new Set(['design', 'agent', 'knowledge_sources']);
const PREFIX = 'ava:ws:';
const INDEX_KEY = 'ava:index';

// In-memory stand-in so tests and the local smoke script work without KV.
export class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(key, type) { const v = this.map.get(key); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; }
  async put(key, value) { this.map.set(key, value); }
  async list({ prefix = '' } = {}) { return { keys: [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; }
}

export class AvaWorkspace {
  constructor(kv) { this.kv = kv || new MemoryKV(); }

  static key(slug, kind, id) {
    return `${PREFIX}${slug}:${kind}${SINGLETON_KINDS.has(kind) ? '' : `:${id}`}`;
  }

  static check(slug, kind, id) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug || '')) throw new GenesysError(`slug must be kebab-case (got "${slug}")`, 400);
    if (!WORKSPACE_KINDS.includes(kind)) throw new GenesysError(`kind must be one of ${WORKSPACE_KINDS.join(', ')}`, 400);
    if (!SINGLETON_KINDS.has(kind) && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(id || '')) {
      throw new GenesysError(`id is required for kind "${kind}" (letters, digits, dot, dash, underscore, slash)`, 400);
    }
  }

  async index() {
    return (await this.kv.get(INDEX_KEY, 'json')) || { avas: [] };
  }

  // Merge only defined, non-null values so re-saving a design without _meta
  // cannot wipe the agent_id / version the build stage recorded. This is a
  // read-modify-write on one shared key: two writes in the same instant can
  // drop a patch (KV has no transactions). The index is a convenience view;
  // the per-slug artifacts remain the source of truth.
  async touchIndex(slug, patch) {
    const idx = await this.index();
    let entry = idx.avas.find((a) => a.slug === slug);
    if (!entry) { entry = { slug }; idx.avas.push(entry); }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) entry[k] = v;
    entry.last_updated = new Date().toISOString();
    await this.kv.put(INDEX_KEY, JSON.stringify(idx));
    return entry;
  }

  // Shallow-merge `patch` into an existing artifact (creates it if absent).
  async merge(slug, kind, id, patch) {
    const current = (await this.get(slug, kind, id)) || {};
    return this.put(slug, kind, id, { ...current, ...patch });
  }

  async get(slug, kind, id) {
    AvaWorkspace.check(slug, kind, id);
    return this.kv.get(AvaWorkspace.key(slug, kind, id), 'json');
  }

  async put(slug, kind, id, data) {
    AvaWorkspace.check(slug, kind, id);
    const stored = { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : { value: data }) };
    stored._stored_at = new Date().toISOString();
    await this.kv.put(AvaWorkspace.key(slug, kind, id), JSON.stringify(stored));
    if (kind === 'design') {
      const meta = stored._meta || {};
      await this.touchIndex(slug, {
        name: stored.name || meta.name, agent_id: meta.agent_id, gc_version: meta.gc_version,
        local_status: meta.local_status || 'design-complete',
      });
    } else if (kind === 'agent') {
      await this.touchIndex(slug, {
        name: stored.agent_name, agent_id: stored._meta?.agent_id ?? stored.agent_id,
        gc_version: stored.version ?? stored._meta?.gc_version, local_status: stored.publish_status === 'ProductionReady' ? 'published' : 'test-ready',
      });
    }
    return { key: AvaWorkspace.key(slug, kind, id), stored_at: stored._stored_at };
  }

  async list(slug, kind) {
    const prefix = slug ? `${PREFIX}${slug}:${kind ? `${kind}${SINGLETON_KINDS.has(kind) ? '' : ':'}` : ''}` : PREFIX;
    const out = [];
    let cursor;
    for (let i = 0; i < 20; i++) {
      const page = await this.kv.list({ prefix, cursor });
      for (const k of page.keys) {
        const rest = k.name.slice(PREFIX.length);
        const [s, kd, ...idParts] = rest.split(':');
        out.push({ slug: s, kind: kd, id: idParts.length ? idParts.join(':') : undefined, key: k.name });
      }
      if (page.list_complete || !page.cursor) break;
      cursor = page.cursor;
    }
    return out;
  }
}
