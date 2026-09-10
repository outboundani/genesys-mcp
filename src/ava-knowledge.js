// Knowledge Fabric (FileUpload sources + Knowledge Settings) for AVAs, ported
// from Genesys' AVA harness (purecloudlabs/genesys-ava-skills, MIT):
//   - the Markdown card validator (chunk size, card templates, audience line,
//     vague wording, hidden cross-references)
//   - upload filename hardening
//   - ensure-source / synchronize-upload-complete-wait / ensure-setting
// Files come from the AVA workspace (kind "knowledge") or inline content, not
// a local disk; text formats only (Markdown, text, CSV, HTML).

import { GenesysError } from './genesys.js';

// ---------- MD5 (Workers have no MD5 in WebCrypto; the upload ticket needs one) ----------

function md5Bytes(bytes) {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return out;
}

export function md5Base64(bytes) {
  return btoa(String.fromCharCode(...md5Bytes(bytes)));
}

export function md5Hex(bytes) {
  return [...md5Bytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- filenames (text formats only in a hosted server) ----------

export const MIME_TYPES = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.html': 'text/html' };
const DISALLOWED = /[\\{^}%`\]"<>[~#|]/;
const CONTROL = /[\u0000-\u001f\u007f]/;
export const MAX_UPLOAD_FILES = 500;

export function validateUploadFileName(name) {
  const n = String(name || '').normalize('NFC');
  if (!n.trim()) throw new GenesysError('Knowledge file name cannot be empty.', 400);
  if (/[/\\]/.test(n)) throw new GenesysError(`Knowledge file name contains a path separator: ${n}`, 400);
  if (n.startsWith('.')) throw new GenesysError(`Knowledge file name must not start with a dot: ${n}`, 400);
  if (n.includes('..')) throw new GenesysError(`Knowledge file name must not contain "..": ${n}`, 400);
  if (CONTROL.test(n)) throw new GenesysError(`Knowledge file name contains control characters: ${n}`, 400);
  if (DISALLOWED.test(n)) throw new GenesysError(`Knowledge file name contains a Genesys-disallowed character: ${n}`, 400);
  if (n.length > 255) throw new GenesysError(`Knowledge file name exceeds 255 characters: ${n}`, 400);
  const ext = (n.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!MIME_TYPES[ext]) throw new GenesysError(`Unsupported knowledge file type "${ext || 'none'}" for ${n}. This server uploads text formats: ${Object.keys(MIME_TYPES).join(', ')} (PDF/Word must be uploaded in Admin > Knowledge).`, 400);
  return { name: n, extension: ext, contentType: MIME_TYPES[ext] };
}

export function validateUploadSet(files) {
  if (!files.length) throw new GenesysError('At least one knowledge file is required.', 400);
  if (files.length > MAX_UPLOAD_FILES) throw new GenesysError(`A synchronization can contain at most ${MAX_UPLOAD_FILES} files.`, 400);
  const seen = new Map();
  return files.map((f) => {
    const meta = validateUploadFileName(f.name);
    const key = meta.name.toLowerCase();
    if (seen.has(key)) throw new GenesysError(`Duplicate upload file name "${meta.name}" conflicts with "${seen.get(key)}". Synchronization file names must be unique.`, 400);
    seen.set(key, meta.name);
    const bytes = new TextEncoder().encode(String(f.content ?? ''));
    if (!bytes.length) throw new GenesysError(`Knowledge file "${meta.name}" is empty.`, 400);
    return { ...meta, content: String(f.content ?? ''), bytes, contentLength: bytes.length, contentMd5Base64: md5Base64(bytes) };
  });
}

// ---------- Markdown card validator (ported rule for rule) ----------

const TOKENS_PER_WORD = 1.33;
const CANONICAL_AUDIENCE = 'End user / Customer';
const SYNTHETIC_SOURCE = 'SYNTHETIC (demo)';
const SYNTHETIC_BANNER = '> ⚠️ SYNTHETIC DEMO CONTENT — not verified facts. Generated for demonstration only.';
const WARN_MAX_WORDS = 300, FAIL_MAX_WORDS = 400, WARN_MIN_WORDS = 20;
const TYPE_LABELS = {
  SOP: [['task', 'procedure'], ['purpose', 'role', 'prerequisites', 'outcome', 'exceptions']],
  FAQ: [['question', 'answer'], ['notes']],
  Troubleshooting: [['issue', 'resolution steps'], ['symptoms', 'possible causes', 'escalation']],
  Configuration: [['task', 'procedure', 'validation'], ['purpose', 'prerequisites', 'rollback']],
  Policy: [['scope', 'rule'], ['policy title', 'conditions', 'examples', 'references']],
  Conceptual: [['concept', 'definition'], ['key points', 'important distinctions', 'example']],
};
const VAGUE = [/\bif necessary\b/i, /\bas necessary\b/i, /\bif needed\b/i, /\bas needed\b/i, /\buse your judge?ment\b/i, /\bas appropriate\b/i, /\bwhenever possible\b/i, /\bwhere necessary\b/i, /\breasonable (period|amount|time)\b/i, /\bgenerally\b/i, /\bnormally\b/i, /\bmost regions\b/i, /\bsome (customers|regions|limitations|cases)\b/i, /\bmight need to\b/i, /\bmay need to\b/i, /\bdepending on the situation\b/i, /\band so on\b/i, /\bvarious factors\b/i, /\bif anything (looks|seems)\b/i, /\bsomething goes wrong\b/i, /\bin accordance with applicable law\b/i];
const CROSSREF = [/\bsee above\b/i, /\bsee below\b/i, /\bas (mentioned|described|noted) (above|below|earlier)\b/i, /\bas stated above\b/i, /\brefer to the (section|table) above\b/i];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelRe = (label) => new RegExp(`^\\s*#{0,6}\\s*[*_>\\s]*${escapeRe(label)}\\b[^:\\n]{0,40}:`, 'im');
const hasLabel = (text, label) => labelRe(label).test(text);
const AUDIENCE_RE = /^\s*(?:>\s*)?Audience\s*:\s*(.*?)\s*$/gim;
const SOURCE_RE = /^\s*(?:>\s*)?Source\s*:\s*(.*?)\s*$/gim;
const TARGET_RE = /\bTarget\s*:\s*AVA\b/i;
const SCOPE_RE = /\bScope\s*:\s*\S/i;

function detectType(text) {
  const h = (l) => hasLabel(text, l);
  if (h('question') && h('answer')) return 'FAQ';
  if (h('issue') && (h('symptoms') || h('resolution steps') || h('resolution'))) return 'Troubleshooting';
  if (h('policy title') || (h('scope') && h('rule'))) return 'Policy';
  if (h('concept') && h('definition')) return 'Conceptual';
  if (h('task') && h('validation')) return 'Configuration';
  if (h('task') && (h('procedure') || h('outcome'))) return 'SOP';
  return null;
}
const wordCount = (text) => (text.replace(/[|#>*_`]/g, ' ').match(/[A-Za-z0-9$%/.-]+/g) || []).length;
function findPatterns(text, patterns) {
  const out = [];
  const seen = new Set();
  for (const p of patterns) {
    for (const m of text.matchAll(new RegExp(p.source, 'gi'))) {
      const k = m[0].trim().toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(m[0].trim()); }
    }
  }
  return out;
}
const hasTable = (text) => text.split('\n').some((l) => l.trim().startsWith('|') && (l.match(/\|/g) || []).length >= 2);
const values = (text, re) => [...text.matchAll(re)].map((m) => m[1].trim());
const normAudience = (v) => v.split(/\s+/).join(' ').replace(/\s*\/\s*/g, '/').toLowerCase();

function stripFrontmatter(content) {
  const lines = content.replace(/^﻿/, '').split(/(?<=\n)/);
  if (!lines.length || lines[0].trim() !== '---') return lines.join('');
  for (let i = 1; i < Math.min(lines.length, 101); i++) {
    if (lines[i].trim() !== '---') continue;
    const block = lines.slice(1, i).map((l) => l.trim()).filter(Boolean);
    const yamlKey = block.some((l) => /^[A-Za-z][A-Za-z0-9_-]*\s*:/.test(l));
    const cardField = block.some((l) => /^(task|purpose|role|prerequisites|procedure|outcome|exceptions|question|answer|notes|issue|symptoms|possible causes|resolution|resolution steps|escalation|validation|rollback|policy title|scope|rule|conditions|examples|references|concept|definition|key points|important distinctions|example)\s*:/i.test(l));
    const md = block.some((l) => /^(#|>|```)/.test(l));
    if (yamlKey && !cardField && !md) return lines.slice(i + 1).join('');
    break;
  }
  return lines.join('');
}
export function splitCards(content) {
  const parts = stripFrontmatter(content).split(/^\s*([-*_])\1{2,}\s*$/m);
  return parts.filter((p) => p != null && p.trim() && !['-', '*', '_'].includes(p.trim()));
}
function hasAvaFileNote(content) {
  let first = content.length;
  for (const label of ['question', 'issue', 'policy title', 'concept', 'task']) {
    const m = content.match(labelRe(label));
    if (m) first = Math.min(first, m.index);
  }
  const preamble = content.slice(0, first);
  const blocks = [];
  let cur = [];
  for (const line of preamble.split('\n')) {
    if (/^\s*>/.test(line)) cur.push(line.replace(/^\s*>\s?/, ''));
    else if (cur.length) { blocks.push(cur); cur = []; }
  }
  if (cur.length) blocks.push(cur);
  return blocks.some((b) => TARGET_RE.test(b.join(' ')) && SCOPE_RE.test(b.join(' ')));
}
const cardTitle = (text) => {
  for (const line of text.split('\n')) {
    const s = line.trim().replace(/^[#>*_ ]+/, '').trim();
    if (s) return s.length > 70 ? s.slice(0, 70) + '…' : s;
  }
  return '(empty)';
};

export function validateCard(text, index) {
  const r = { index, title: cardTitle(text), type: null, words: 0, tokens: 0, fails: [], warns: [], info: [] };
  const wc = wordCount(text);
  r.words = wc; r.tokens = Math.round(wc * TOKENS_PER_WORD);
  const type = detectType(text);
  r.type = type;
  if (!type) {
    if (wc > WARN_MAX_WORDS) r.warns.push(`Unstructured block of ${wc} words with no recognizable card labels; split into typed cards.`);
    else r.info.push('No card labels detected (treated as preamble/prose).');
  } else {
    const [required, recommended] = TYPE_LABELS[type];
    let missingReq = required.filter((l) => !hasLabel(text, l));
    if (missingReq.includes('resolution steps') && hasLabel(text, 'resolution')) missingReq = missingReq.filter((l) => l !== 'resolution steps');
    const missingRec = recommended.filter((l) => !hasLabel(text, l));
    if (missingReq.length) r.fails.push(`${type} card missing required label(s): ${missingReq.join(', ')}.`);
    if (missingRec.length) r.warns.push(`${type} card missing recommended label(s): ${missingRec.join(', ')}.`);
    const audiences = values(text, AUDIENCE_RE);
    if (!audiences.length) r.fails.push(`AVA card missing Audience metadata. Use \`Audience: ${CANONICAL_AUDIENCE}\`.`);
    else if (audiences.length !== 1 || normAudience(audiences[0]) !== normAudience(CANONICAL_AUDIENCE)) r.fails.push(`AVA card Audience must be \`${CANONICAL_AUDIENCE}\` (canonical form).`);
  }
  if (wc > FAIL_MAX_WORDS) r.fails.push(`${wc} words (~${r.tokens} tokens) exceeds a single ~400-token chunk. Split into smaller cards.`);
  else if (wc > WARN_MAX_WORDS) r.warns.push(`${wc} words (~${r.tokens} tokens) is over the ~300-word target; risks chunk overflow. Consider trimming or splitting.`);
  else if (type && wc < WARN_MIN_WORDS) r.warns.push(`Only ${wc} words; card looks like a stub. Ensure it is self-contained.`);
  const vague = findPatterns(text, VAGUE);
  if (vague.length) r.warns.push('Vague/ambiguous wording (replace with explicit criteria): ' + vague.slice(0, 8).map((v) => `"${v}"`).join(', '));
  const cross = findPatterns(text, CROSSREF);
  if (cross.length) r.fails.push('Hidden dependency, a cross-reference to other content: ' + cross.map((c) => `"${c}"`).join(', ') + '. Restate the essential info inside this card.');
  if (hasTable(text)) r.info.push('Contains a Markdown table; tables are not ingested reliably, so mirror critical rows in plain text.');
  return r;
}

function validateFileRules(fileName, content, results) {
  const failures = [];
  const cards = splitCards(content);
  const recognized = results.filter((r) => r.type);
  const isSynthetic = fileName === '_SYNTHETIC.md';
  if (isSynthetic) {
    const firstLine = (content.split('\n').map((l) => l.trim()).find(Boolean)) || '';
    if (firstLine !== SYNTHETIC_BANNER) failures.push(`\`_SYNTHETIC.md\` must start with the exact warning banner: ${SYNTHETIC_BANNER}`);
    cards.filter((c) => detectType(c)).forEach((card, i) => {
      const sources = values(card, SOURCE_RE);
      if (sources.length !== 1 || sources[0] !== SYNTHETIC_SOURCE) failures.push(`Synthetic card ${i} must contain exactly \`Source: ${SYNTHETIC_SOURCE}\`.`);
    });
    cards.forEach((card, i) => {
      if (detectType(card)) return;
      if (i === 0 && card.includes(SYNTHETIC_BANNER) && hasAvaFileNote(card)) {
        const ok = card.split('\n').filter((l) => l.trim()).every((line) => {
          if (!line.trimStart().startsWith('>')) return false;
          const body = line.replace(/^\s*>\s?/, '').trim();
          return line.trim() === SYNTHETIC_BANNER || TARGET_RE.test(body) || SCOPE_RE.test(body);
        });
        if (ok) return;
      }
      failures.push(`Synthetic block ${i} has no recognized card labels; every synthetic content block must use an AVA card template.`);
    });
  } else if (values(content, SOURCE_RE).some((s) => s.toLowerCase() === SYNTHETIC_SOURCE.toLowerCase())) {
    failures.push(`Non-synthetic file contains \`Source: ${SYNTHETIC_SOURCE}\`; move synthetic content to \`_SYNTHETIC.md\`.`);
  }
  if (recognized.length && !hasAvaFileNote(content)) {
    failures.push('Authored AVA card file missing a pre-card blockquote note containing `Target: AVA` and a non-empty `Scope:`.');
  }
  return failures;
}

// files: [{ name, content }]
export function validateKnowledgeFiles(files, { strict = true } = {}) {
  const report = { files: [], totals: { cards: 0, fails: 0, warns: 0 }, fails: [] };
  for (const f of files) {
    const content = String(f.content || '').replace(/^﻿/, '');
    const results = splitCards(content).map((c, i) => validateCard(c, i));
    const fileFails = validateFileRules(f.name, content, results);
    report.files.push({ name: f.name, cards: results, fails: fileFails });
    report.totals.cards += results.filter((r) => r.type).length;
    report.totals.fails += results.reduce((n, r) => n + r.fails.length, 0) + fileFails.length;
    report.totals.warns += results.reduce((n, r) => n + r.warns.length, 0);
  }
  if (!report.totals.cards) { report.fails.push('No recognized AVA cards found in the input set.'); report.totals.fails++; }
  report.ok = report.totals.fails === 0;
  report.strict = strict;
  report.blocked = strict && !report.ok;
  report.message = report.blocked ? 'Knowledge validation failed with structural FAIL findings. Fix the cards before uploading.'
    : report.ok ? 'Knowledge validation passed.' : 'Knowledge validation has warnings only (not blocked).';
  return report;
}

// ---------- language ----------

export function normalizeGenerationLanguage(value) {
  const text = String(value || '').trim();
  if (!text) throw new GenesysError('A Knowledge Configuration generation language is required (e.g. en-US).', 400);
  return text.replace(/_/g, '-').split('-').map((p, i) => {
    if (i === 0) return p.toLowerCase();
    if (p.length === 4 && /^[a-z]+$/i.test(p)) return p[0].toUpperCase() + p.slice(1).toLowerCase();
    if ((p.length === 2 && /^[a-z]+$/i.test(p)) || (p.length === 3 && /^\d+$/.test(p))) return p.toUpperCase();
    return p.toLowerCase();
  }).join('-');
}

// ---------- network: sources, synchronizations, settings ----------

const SOURCES = '/api/v2/knowledge/sources';
const SETTINGS = '/api/v2/knowledge/settings';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listKnowledgeSources(gc) {
  return (await gc.listAll(SOURCES, {}, { max: 500 })).entities;
}

export function selectFileUploadSource(sources, name) {
  const matches = sources.filter((s) => s?.name === name);
  if (matches.length > 1) throw new GenesysError(`Multiple Knowledge Sources are named "${name}". Resolve the duplicate names before continuing.`, 409);
  if (!matches.length) return null;
  const src = matches[0];
  if (src.type !== 'FileUpload') throw new GenesysError(`A Knowledge Source named "${name}" already exists but has type "${src.type || 'unknown'}", not "FileUpload".`, 409);
  return src;
}

export async function ensureFileUploadSource(gc, name) {
  const n = String(name || '').trim();
  if (!n) throw new GenesysError('Knowledge Source name is required.', 400);
  const existing = selectFileUploadSource(await listKnowledgeSources(gc), n);
  if (existing) return { name: n, id: existing.id, type: 'FileUpload', created: false, workflowStatus: 'source_ready' };
  try {
    const created = await gc.post(SOURCES, { name: n, type: 'FileUpload' });
    return { name: n, id: created.id, type: 'FileUpload', created: true, workflowStatus: 'source_ready' };
  } catch (e) {
    if (e.status === 409) {
      const recovered = selectFileUploadSource(await listKnowledgeSources(gc), n);
      if (recovered) return { name: n, id: recovered.id, type: 'FileUpload', created: true, recovered: true, workflowStatus: 'source_ready' };
    }
    if ([400, 409, 422].includes(e.status) && /(quota|limit|maximum|max).{0,60}(source|reached|exceeded)|too many knowledge/i.test(e.message)) {
      throw new GenesysError('The Knowledge Source could not be created because this org has reached the maximum number of Knowledge Sources. Reuse an existing FileUpload source (list_knowledge_assets) or delete an unused one in Admin > Knowledge.', 409);
    }
    throw e;
  }
}

export async function getSynchronization(gc, sourceId, syncId) {
  return gc.get(`${SOURCES}/${sourceId}/synchronizations/${syncId}`);
}

export function synchronizationState(sync) {
  const status = sync?.status, ingestion = sync?.ingestionStatus;
  if (['Cancelled', 'Failed'].includes(status)) return { done: true, ok: false, reason: `Genesys synchronization ended with status "${status}".` };
  if (['Failed', 'Stopped'].includes(ingestion)) return { done: true, ok: false, reason: `Genesys knowledge ingestion ended with status "${ingestion}".` };
  if (status === 'Completed' && ingestion === 'Complete') return { done: true, ok: true };
  return { done: false, ok: false };
}

// Upload text files into a FileUpload source: start sync -> upload tickets ->
// PUT bytes -> mark Completed -> poll readiness (bounded; the caller can keep
// polling with get_knowledge_sync). Never cancels after completion is attempted.
export async function uploadKnowledgeDocuments(gc, { sourceId, files, syncType, waitMs = 45000 }) {
  if (!['Incremental', 'Full'].includes(syncType)) throw new GenesysError('sync_type must be "Incremental" or "Full".', 400);
  const prepared = validateUploadSet(files);
  const mdFiles = prepared.filter((f) => f.extension === '.md');
  const validation = mdFiles.length ? validateKnowledgeFiles(mdFiles, { strict: true }) : null;
  if (validation?.blocked) return { workflowStatus: 'blocked', validation, note: validation.message };

  const sync = await gc.post(`${SOURCES}/${sourceId}/synchronizations`, { type: syncType });
  const syncId = sync.id;
  if (!syncId) throw new GenesysError('Genesys accepted the synchronization start but returned no synchronization id.', 502);
  const uploaded = [];
  let completionAttempted = false;
  try {
    for (const f of prepared) {
      const ticket = await gc.post(`${SOURCES}/${sourceId}/synchronizations/${syncId}/uploads`, {
        fileName: f.name, contentMd5: f.contentMd5Base64, contentType: f.contentType, contentLength: f.contentLength,
      });
      const url = ticket.url;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new GenesysError('Genesys did not return an HTTPS upload URL.', 502);
      const headers = {};
      for (const [k, v] of Object.entries(ticket.headers || {})) {
        if (/^(authorization|cookie|proxy-authorization)$/i.test(k)) throw new GenesysError('Genesys returned a forbidden upload header.', 502);
        headers[k] = String(v);
      }
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = f.contentType;
      let res;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(url, { method: 'PUT', headers, body: f.bytes });
        if (res.ok) break;
        if (![408, 429].includes(res.status) && res.status < 500) break;
        await sleep(500 * 2 ** attempt);
      }
      if (!res.ok) throw new GenesysError(`Knowledge file upload for "${f.name}" failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`, res.status);
      uploaded.push({ fileName: f.name, contentLength: f.contentLength, md5: md5Hex(f.bytes) });
    }
    completionAttempted = true;
    await gc.patch(`${SOURCES}/${sourceId}/synchronizations/${syncId}`, { status: 'Completed' });
  } catch (e) {
    if (!completionAttempted) {
      try { await gc.patch(`${SOURCES}/${sourceId}/synchronizations/${syncId}`, { status: 'Cancelled' }); } catch { /* best effort */ }
      return { workflowStatus: 'upload_failed', sourceId, synchronizationId: syncId, syncType, uploaded, error: e.message, validation };
    }
    return { workflowStatus: 'outcome_unknown', sourceId, synchronizationId: syncId, syncType, uploaded, failedStage: 'completion', error: e.message, validation, note: 'Completion was attempted; inspect the synchronization with get_knowledge_sync before retrying.' };
  }
  const deadline = Date.now() + waitMs;
  let last = await getSynchronization(gc, sourceId, syncId);
  let state = synchronizationState(last);
  while (!state.done && Date.now() < deadline) {
    await sleep(5000);
    last = await getSynchronization(gc, sourceId, syncId);
    state = synchronizationState(last);
  }
  const base = { sourceId, synchronizationId: syncId, syncType, uploaded, fileCount: uploaded.length, status: last.status, ingestionStatus: last.ingestionStatus, validation };
  if (state.done && state.ok) return { ...base, workflowStatus: 'upload_complete', outcome: 'success' };
  if (state.done) return { ...base, workflowStatus: 'ingestion_failed', outcome: 'failure', error: state.reason };
  return { ...base, workflowStatus: 'upload_in_progress', outcome: 'pending', note: 'Files are uploaded and the synchronization is completing. Poll get_knowledge_sync until status Completed and ingestionStatus Complete, then ensure_knowledge_setting.' };
}

// ---------- knowledge settings (configurations) ----------

const emptyFilter = (f) => !f || typeof f !== 'object' || !((Array.isArray(f.allOf) && f.allOf.length) || (Array.isArray(f.anyOfGroups) && f.anyOfGroups.length) || (Array.isArray(f.noneOf) && f.noneOf.length));

export function settingCompatibilityIssues(setting, sourceId) {
  const ids = (setting.sources || []).map((s) => s?.id).filter(Boolean);
  const issues = [];
  if (ids.length !== 1 || ids[0] !== sourceId) issues.push('it is not bound exclusively to the resolved Knowledge Source');
  if (setting.generationSetting?.answerGeneration !== true) issues.push('Answer generation is not enabled');
  if (setting.stateful !== true) issues.push('Search with context is not enabled');
  if (!emptyFilter(setting.filter)) issues.push('source filtering is configured');
  return issues;
}

const settingResult = (s, name, sourceId, flags = {}) => ({
  name, id: s.id, sourceId, created: false, patched: false, unchanged: false, ...flags,
  stateful: s.stateful === true, answerGeneration: s.generationSetting?.answerGeneration === true,
  generationLanguage: s.generationSetting?.generationLanguage, sourceFiltering: !emptyFilter(s.filter),
});

export async function ensureKnowledgeSetting(gc, { name, sourceId, generationLanguage }) {
  const n = String(name || '').trim();
  if (!n) throw new GenesysError('Knowledge Configuration name is required.', 400);
  const desired = normalizeGenerationLanguage(generationLanguage);
  const page = await gc.listAll(SETTINGS, { name: n }, { max: 200 });
  const matches = page.entities.filter((s) => s?.name === n);
  if (matches.length > 1) throw new GenesysError(`Multiple Knowledge Configurations are named "${n}". Resolve the duplicates before continuing so the AVA cannot use the wrong one.`, 409);
  if (matches.length === 1) {
    const current = await gc.get(`${SETTINGS}/${matches[0].id}`);
    const issues = settingCompatibilityIssues(current, sourceId);
    if (issues.length) throw new GenesysError(`The existing "${n}" Knowledge Configuration cannot be reused because ${issues.join('; ')}. Only its language may be changed automatically; pick a new name or correct it in Admin > Knowledge.`, 409);
    const currentLang = current.generationSetting?.generationLanguage ? normalizeGenerationLanguage(current.generationSetting.generationLanguage) : null;
    if (currentLang === desired) return settingResult(current, n, sourceId, { unchanged: true });
    const body = {
      name: current.name, sources: (current.sources || []).map((s) => ({ id: s.id })),
      generationSetting: { answerGeneration: current.generationSetting?.answerGeneration, generationLanguage: desired },
      stateful: current.stateful,
      ...(typeof current.description === 'string' ? { description: current.description } : {}),
      ...(current.filter != null ? { filter: current.filter } : {}),
    };
    await gc.patch(`${SETTINGS}/${current.id}`, body);
    const verified = await gc.get(`${SETTINGS}/${current.id}`);
    return settingResult(verified, n, sourceId, { patched: true, patchedFields: ['generationSetting.generationLanguage'] });
  }
  const created = await gc.post(SETTINGS, {
    name: n, sources: [{ id: sourceId }], generationSetting: { answerGeneration: true, generationLanguage: desired }, stateful: true,
  });
  const verified = await gc.get(`${SETTINGS}/${created.id}`);
  const issues = settingCompatibilityIssues(verified, sourceId);
  if (issues.length) throw new GenesysError(`Genesys created the Knowledge Configuration but ${issues.join('; ')}.`, 502);
  return settingResult(verified, n, sourceId, { created: true });
}
