// Vendor the Genesys Cloud AVA skills (purecloudlabs/genesys-ava-skills, MIT)
// into this repo and regenerate src/ava-playbooks.js, the module the Worker
// serves through the ava_playbook tool.
//
//   node scripts/vendor-ava-skills.mjs            # latest GitHub release
//   node scripts/vendor-ava-skills.mjs v1.5.1     # a specific release tag
//   node scripts/vendor-ava-skills.mjs --from path/to/ava_skills-x.y.z-py3-none-any.whl
//
// Zero dependencies: the wheel is a zip, read with a minimal central-directory
// parser + zlib. Re-run whenever Genesys ships a new release; commit the diff
// under vendor/ and the regenerated src/ava-playbooks.js.

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = join(ROOT, 'vendor', 'genesys-ava-skills');
const OUT_MODULE = join(ROOT, 'src', 'ava-playbooks.js');
const REPO = 'purecloudlabs/genesys-ava-skills';

// ---------- minimal zip reader ----------

function readZip(buf) {
  // Locate the end-of-central-directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    // Local header: skip its own name/extra to reach the data.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- fetch the wheel ----------

async function fetchRelease(tag) {
  const url = tag
    ? `https://api.github.com/repos/${REPO}/releases/tags/${tag}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetch(url, { headers: { 'User-Agent': 'genesys-mcp-vendor', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub release lookup failed: HTTP ${res.status}`);
  const rel = await res.json();
  const asset = (rel.assets || []).find((a) => /^ava_skills-.*\.whl$/.test(a.name))
    || (rel.assets || []).find((a) => /^ava_mcp-.*\.whl$/.test(a.name));
  if (!asset) throw new Error(`Release ${rel.tag_name} has no ava_skills/ava_mcp wheel asset`);
  const whl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'genesys-mcp-vendor' } });
  if (!whl.ok) throw new Error(`Wheel download failed: HTTP ${whl.status}`);
  return { tag: rel.tag_name, publishedAt: rel.published_at, assetName: asset.name, buf: Buffer.from(await whl.arrayBuffer()) };
}

// ---------- main ----------

const args = process.argv.slice(2);
let source;
if (args[0] === '--from') {
  const file = args[1];
  source = { tag: `local:${file}`, publishedAt: null, assetName: file, buf: readFileSync(file) };
} else {
  source = await fetchRelease(args[0]);
}

const entries = readZip(source.buf);
// Skills live at .../skills/ava_skills/<skill>/(SKILL.md|references/*.md) in both wheels.
const skillFiles = entries.filter((e) => /(^|\/)skills\/ava_skills\/[^/]+\/(SKILL\.md|references\/[^/]+\.md)$/.test(e.name));
if (!skillFiles.length) throw new Error('No skill files found in the wheel');
const license = entries.find((e) => /(^|\/)LICENSE$/.test(e.name) || /licenses\/LICENSE$/.test(e.name));

rmSync(VENDOR_DIR, { recursive: true, force: true });
mkdirSync(VENDOR_DIR, { recursive: true });

const skills = {};
let version = null;
for (const f of skillFiles) {
  const rel = f.name.replace(/^.*skills\/ava_skills\//, '');
  const [skill, ...rest] = rel.split('/');
  const text = f.data.toString('utf8');
  const dest = join(VENDOR_DIR, skill, ...rest);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text);
  skills[skill] ??= { skill: null, references: {} };
  if (rest[0] === 'SKILL.md') {
    skills[skill].skill = text;
    version ??= (text.match(/^\s*version:\s*([\w.-]+)/m) || [])[1] || null;
  } else {
    skills[skill].references[rest[1].replace(/\.md$/, '')] = text;
  }
}
let licenseText = license ? license.data.toString('utf8') : null;
if (!licenseText) {
  // The skills-only wheel ships without its LICENSE; take it from the repo.
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/LICENSE`, { headers: { 'User-Agent': 'genesys-mcp-vendor' } });
  if (res.ok) licenseText = await res.text();
}
if (licenseText) writeFileSync(join(VENDOR_DIR, 'LICENSE'), licenseText);
writeFileSync(join(VENDOR_DIR, 'NOTICE.md'), `# Vendored: Genesys Cloud AVA skills

Source: https://github.com/${REPO} (MIT License, Genesys Cloud Services, Inc.)
Release: ${source.tag}${source.publishedAt ? ` (published ${source.publishedAt})` : ''}
Asset: ${source.assetName}
Skills version (from SKILL.md metadata): ${version || 'unknown'}

These files are copied verbatim. genesys-mcp serves them through its
ava_playbook tool so the AVA lifecycle (design, knowledge, build, test,
evaluate, critique) works from any MCP client, including Claude Desktop,
without a local IDE install. Re-vendor with: node scripts/vendor-ava-skills.mjs
`);

const header = `// GENERATED by scripts/vendor-ava-skills.mjs - do not edit by hand.
// Genesys Cloud AVA skills, vendored verbatim from https://github.com/${REPO}
// (MIT License, Genesys Cloud Services, Inc.). Release ${source.tag}, skills
// version ${version || 'unknown'}. See vendor/genesys-ava-skills/NOTICE.md.

export const AVA_SKILLS_VERSION = ${JSON.stringify(version || 'unknown')};
export const AVA_SKILLS_RELEASE = ${JSON.stringify(source.tag)};
export const AVA_SKILLS_SOURCE = ${JSON.stringify(`https://github.com/${REPO}`)};

export const AVA_SKILLS = ${JSON.stringify(skills, null, 1)};
`;
writeFileSync(OUT_MODULE, header);

const refCount = Object.values(skills).reduce((n, s) => n + Object.keys(s.references).length, 0);
console.log(`Vendored ${Object.keys(skills).length} skills + ${refCount} reference files from ${source.tag} (skills ${version}) -> ${OUT_MODULE}`);
if (!existsSync(join(VENDOR_DIR, 'LICENSE'))) console.warn('warning: no LICENSE file found in the wheel');
