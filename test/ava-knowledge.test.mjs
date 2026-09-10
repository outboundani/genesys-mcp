import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  md5Base64, md5Hex, validateUploadFileName, validateUploadSet, validateKnowledgeFiles, splitCards, normalizeGenerationLanguage,
  settingCompatibilityIssues, synchronizationState, selectFileUploadSource,
} from '../src/ava-knowledge.js';
import { TOOLS, WRITE_TOOLS, callTool } from '../src/tools.js';
import { GenesysError } from '../src/genesys.js';

const enc = (s) => new TextEncoder().encode(s);

// ---------- MD5 ----------

test('md5 matches known vectors (upload tickets need a base64 MD5)', () => {
  assert.equal(md5Hex(enc('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5Hex(enc('hello world')), '5eb63bbbe01eeed093cb22bb8f5acdc3');
  assert.equal(md5Hex(enc('The quick brown fox jumps over the lazy dog')), '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(md5Base64(enc('')), '1B2M2Y8AsgTpgAmY7PhCfg==');
  // > 55 bytes forces a second block.
  assert.equal(md5Hex(enc('a'.repeat(100))), '36a92cc94a9e0fa21f625f8bfb007adf');
});

// ---------- filenames ----------

test('upload filenames follow the Genesys policy and text-only formats', () => {
  assert.deepEqual(validateUploadFileName('faqs.md'), { name: 'faqs.md', extension: '.md', contentType: 'text/markdown' });
  for (const bad of ['', '.hidden.md', 'a/b.md', 'a..b.md', 'bad#name.md', 'x'.repeat(260) + '.md', 'doc.pdf']) {
    assert.throws(() => validateUploadFileName(bad), GenesysError, bad);
  }
  assert.throws(() => validateUploadSet([{ name: 'A.md', content: 'x' }, { name: 'a.md', content: 'y' }]), /Duplicate upload file name/);
  assert.throws(() => validateUploadSet([{ name: 'a.md', content: '' }]), /is empty/);
  const [f] = validateUploadSet([{ name: 'a.md', content: 'hello' }]);
  assert.equal(f.contentLength, 5);
  assert.equal(f.contentMd5Base64, md5Base64(enc('hello')));
});

// ---------- card validator ----------

const goodFile = `> Target: AVA
> Scope: outboundIQ support, US, voice

Audience: End user / Customer

Question: What does outboundIQ do?
Answer: outboundIQ is an outbound contact center optimization platform. It helps your team place compliant outbound calls, manage caller ID reputation, and see which numbers connect. You can ask the assistant about features, and a sales representative follows up on pricing. If you need a person, say so and the assistant connects you.
Notes: Pricing is handled by sales.

---

Audience: End user / Customer

Issue: I cannot reach a representative.
Symptoms: The assistant keeps answering instead of transferring.
Resolution steps: Say "I want to speak with a person". The assistant confirms and transfers you to the support queue. If the queue is closed, leave a voicemail with your name and number and a representative calls back the next business day.
Escalation: Call the main line during business hours.
`;

test('validateKnowledgeFiles passes a compliant file and reports card metadata', () => {
  const r = validateKnowledgeFiles([{ name: 'faqs.md', content: goodFile }]);
  assert.equal(r.ok, true, JSON.stringify(r.files[0].cards.map((c) => c.fails)));
  assert.equal(r.totals.cards, 2);
  assert.deepEqual(r.files[0].cards.filter((c) => c.type).map((c) => c.type), ['FAQ', 'Troubleshooting']);
  assert.equal(r.blocked, false);
});

test('validateKnowledgeFiles fails on missing audience, cross-references, missing file note, and oversize cards', () => {
  const bad = `Question: Why?
Answer: See above for details. ${'word '.repeat(420)}

---

Audience: Everyone
Task: Do the thing
Procedure: Step one, generally as needed.
`;
  const r = validateKnowledgeFiles([{ name: 'bad.md', content: bad }]);
  assert.equal(r.ok, false);
  const fails = r.files[0].cards.flatMap((c) => c.fails).join('\n') + '\n' + r.files[0].fails.join('\n');
  assert.match(fails, /missing Audience metadata/);
  assert.match(fails, /Hidden dependency/);
  assert.match(fails, /exceeds a single ~400-token chunk/);
  assert.match(fails, /Audience must be `End user \/ Customer`/);
  assert.match(fails, /missing a pre-card blockquote note/);
  const warns = r.files[0].cards.flatMap((c) => c.warns).join('\n');
  assert.match(warns, /Vague\/ambiguous wording/);
  assert.equal(validateKnowledgeFiles([{ name: 'empty.md', content: 'just prose' }]).fails[0], 'No recognized AVA cards found in the input set.');
});

test('synthetic files need the banner and Source line; non-synthetic files must not claim synthetic', () => {
  const synthetic = `> ⚠️ SYNTHETIC DEMO CONTENT — not verified facts. Generated for demonstration only.
> Target: AVA
> Scope: demo

Audience: End user / Customer
Source: SYNTHETIC (demo)

Question: Is this real?
Answer: No, this is demo content used to show how the assistant answers a question about your account in a sandbox, with enough words to count as a real card body.
`;
  assert.equal(validateKnowledgeFiles([{ name: '_SYNTHETIC.md', content: synthetic }]).ok, true);
  const leaked = goodFile.replace('Notes: Pricing is handled by sales.', 'Notes: n\nSource: SYNTHETIC (demo)');
  assert.match(validateKnowledgeFiles([{ name: 'faqs.md', content: leaked }]).files[0].fails.join(), /move synthetic content/);
});

test('splitCards strips YAML frontmatter but keeps cards', () => {
  const cards = splitCards('---\ntitle: x\n---\nQuestion: a\nAnswer: b\n\n---\n\nQuestion: c\nAnswer: d\n');
  assert.equal(cards.length, 2);
});

// ---------- language / settings / sync ----------

test('generation language normalizes like the harness and setting compatibility is strict', () => {
  assert.equal(normalizeGenerationLanguage('EN_us'), 'en-US');
  assert.equal(normalizeGenerationLanguage('zh-hant-TW'), 'zh-Hant-TW');
  assert.throws(() => normalizeGenerationLanguage(''), GenesysError);
  const ok = { sources: [{ id: 's1' }], generationSetting: { answerGeneration: true }, stateful: true };
  assert.deepEqual(settingCompatibilityIssues(ok, 's1'), []);
  assert.equal(settingCompatibilityIssues({ ...ok, sources: [{ id: 's1' }, { id: 's2' }] }, 's1').length, 1);
  assert.equal(settingCompatibilityIssues({ sources: [{ id: 's1' }], stateful: false, filter: { allOf: [{}] } }, 's1').length, 3);
  assert.deepEqual(synchronizationState({ status: 'Completed', ingestionStatus: 'Complete' }), { done: true, ok: true });
  assert.equal(synchronizationState({ status: 'InProgress' }).done, false);
  assert.match(synchronizationState({ status: 'Failed' }).reason, /status "Failed"/);
  assert.throws(() => selectFileUploadSource([{ name: 'x', type: 'Sharepoint', id: '1' }], 'x'), /not "FileUpload"/);
  assert.throws(() => selectFileUploadSource([{ name: 'x', id: '1' }, { name: 'x', id: '2' }], 'x'), /Multiple Knowledge Sources/);
});

// ---------- registry ----------

test('knowledge tools are registered and write-flagged correctly; no mock or TTS tools ship', async () => {
  const names = new Set(TOOLS.map((t) => t.name));
  for (const n of ['validate_knowledge', 'ensure_knowledge_source', 'upload_knowledge_documents', 'get_knowledge_sync', 'ensure_knowledge_setting']) assert.ok(names.has(n), n);
  for (const w of ['ensure_knowledge_source', 'upload_knowledge_documents', 'ensure_knowledge_setting']) assert.ok(WRITE_TOOLS.has(w), w);
  for (const gone of ['create_mock_data_action', 'replace_mock_responses', 'list_tts_engines']) assert.ok(!names.has(gone), `${gone} must not exist: real integrations only`);
  assert.ok(!WRITE_TOOLS.has('validate_knowledge'));
  assert.ok(!WRITE_TOOLS.has('get_knowledge_sync'));
  const r = await callTool({ configured: false }, 'validate_knowledge', { files: [{ name: 'faqs.md', content: goodFile }] });
  assert.equal(r.ok, true);
  await assert.rejects(() => callTool({ configured: false }, 'validate_knowledge', {}), /No knowledge files/);
});
