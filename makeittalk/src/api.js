// Cookie-authenticated app API consumed by the dashboard SPA.

import { json, id, now, monthKey, slugify, HttpError, readJson, clampStr } from './util.js';
import { randomToken, sha256hex, encryptJson } from './crypto.js';
import { planFor, PLANS } from './plans.js';
import { runGeneration, emit } from './engine.js';
import { runProjectTool } from './mcpserve.js';
import { ALLOWED_MODELS, DEFAULT_MODEL } from './anthropic.js';
import { exportWorker } from './exporter.js';

export async function handleApi(request, env, ctx, user, path) {
  const seg = path.split('/').filter(Boolean); // ['api','projects',':id',...]

  if (path === '/api/me' && request.method === 'GET') {
    const plan = planFor(user);
    const usage = await env.DB.prepare('SELECT generations, tool_calls FROM usage_months WHERE user_id = ? AND month = ?')
      .bind(user.id, monthKey()).first();
    const projectCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').bind(user.id).first();
    return json({
      id: user.id, email: user.email, name: user.name, role: user.role,
      plan: user.plan, plan_status: user.plan_status, verified: Boolean(user.verified_at),
      limits: plan,
      usage: {
        projects: projectCount?.n || 0,
        generations: usage?.generations || 0,
        tool_calls: usage?.tool_calls || 0,
      },
    });
  }

  if (path === '/api/projects' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, name, slug, source_url, goal, status, error, allow_delete, created_at, updated_at,
              mcp_key_hint, cred_fields, creds_enc != '' AS has_creds,
              CASE WHEN manifest = '' THEN 0 ELSE 1 END AS has_manifest,
              CASE WHEN manifest = '' THEN 0 ELSE json_array_length(manifest, '$.tools') END AS tool_count
       FROM projects WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(user.id).all();
    return json({ projects: results.map(projectSummary) });
  }

  if (path === '/api/projects' && request.method === 'POST') {
    requireVerified(user, env);
    const plan = planFor(user);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').bind(user.id).first();
    if ((count?.n || 0) >= plan.projects) {
      throw new HttpError(402, `The ${plan.label} plan allows ${plan.projects} project${plan.projects === 1 ? '' : 's'}. Upgrade to add more.`);
    }
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 60);
    if (name.length < 2) throw new HttpError(400, 'Give the project a name (2+ characters).');
    const sourceUrl = String(body.source_url || '').trim().slice(0, 500);
    const sourceText = String(body.source_text || '').slice(0, 200000);
    if (!sourceUrl && sourceText.length < 200) {
      throw new HttpError(400, 'Provide a docs link, or paste at least a few paragraphs of API documentation.');
    }

    let slug = slugify(name);
    const clash = await env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first();
    if (clash) slug = `${slug}-${randomToken(2)}`;

    const projectId = id('p');
    const mcpKey = `mit_${randomToken(24)}`;
    await env.DB.prepare(
      `INSERT INTO projects (id, user_id, name, slug, source_url, source_text, goal, status, model, mcp_key_hash, mcp_key_hint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`
    ).bind(
      projectId, user.id, name, slug, sourceUrl, sourceUrl ? '' : sourceText,
      String(body.goal || '').slice(0, 1000), DEFAULT_MODEL,
      await sha256hex(mcpKey), `mit_...${mcpKey.slice(-4)}`, now(), now()
    ).run();
    await emit(env, projectId, 'created', 'ok', `Project created. MCP endpoint reserved at /mcp/${slug}`);
    return json({ id: projectId, slug, mcp_key: mcpKey, note: 'Save the MCP key - it is shown once.' }, 201);
  }

  // ----- /api/projects/:id/... -----
  if (seg[1] === 'projects' && seg[2]) {
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .bind(seg[2], user.id).first();
    if (!project) throw new HttpError(404, 'No such project.');
    const sub = seg[3] || '';

    if (!sub && request.method === 'GET') {
      const detail = projectSummary(project);
      detail.goal = project.goal;
      detail.model = project.model;
      detail.manifest = project.manifest ? JSON.parse(project.manifest) : null;
      detail.mcp_url = `${env.APP_ORIGIN}/mcp/${project.slug}`;
      return json({ project: detail });
    }

    if (!sub && request.method === 'PATCH') {
      const body = await readJson(request);
      const fields = [];
      const binds = [];
      if (typeof body.name === 'string' && body.name.trim().length >= 2) { fields.push('name = ?'); binds.push(body.name.trim().slice(0, 60)); }
      if (typeof body.goal === 'string') { fields.push('goal = ?'); binds.push(body.goal.slice(0, 1000)); }
      if (typeof body.allow_delete === 'boolean') { fields.push('allow_delete = ?'); binds.push(body.allow_delete ? 1 : 0); }
      if (typeof body.model === 'string' && ALLOWED_MODELS.includes(body.model)) { fields.push('model = ?'); binds.push(body.model); }
      if (!fields.length) throw new HttpError(400, 'Nothing to update.');
      fields.push('updated_at = ?'); binds.push(now(), project.id);
      await env.DB.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();
      return json({ ok: true });
    }

    if (!sub && request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id).run();
      await env.DB.prepare('DELETE FROM events WHERE project_id = ?').bind(project.id).run();
      return json({ ok: true, note: `Project "${project.name}" deleted.` });
    }

    if (sub === 'generate' && request.method === 'POST') {
      requireVerified(user, env);
      if (project.status === 'generating') throw new HttpError(409, 'A generation is already running for this project.');
      const plan = planFor(user);
      const month = monthKey();
      const usage = await env.DB.prepare('SELECT generations FROM usage_months WHERE user_id = ? AND month = ?')
        .bind(user.id, month).first();
      if ((usage?.generations || 0) >= plan.generations_per_month) {
        throw new HttpError(402, `The ${plan.label} plan allows ${plan.generations_per_month} generations per month. Upgrade for more.`);
      }
      const body = await readJson(request);
      if (typeof body.source_url === 'string' && body.source_url.trim()) {
        await env.DB.prepare('UPDATE projects SET source_url = ? WHERE id = ?')
          .bind(body.source_url.trim().slice(0, 500), project.id).run();
      }
      if (typeof body.goal === 'string') {
        await env.DB.prepare('UPDATE projects SET goal = ? WHERE id = ?').bind(body.goal.slice(0, 1000), project.id).run();
      }
      await env.DB.prepare(
        `INSERT INTO usage_months (user_id, month, generations) VALUES (?, ?, 1)
         ON CONFLICT(user_id, month) DO UPDATE SET generations = generations + 1`
      ).bind(user.id, month).run();
      await env.DB.prepare("UPDATE projects SET status = 'generating', error = '', updated_at = ? WHERE id = ?")
        .bind(now(), project.id).run();
      await emit(env, project.id, 'queued', 'info', 'Generation started');
      ctx.waitUntil(runGeneration(env, project.id));
      return json({ ok: true, status: 'generating' });
    }

    if (sub === 'events' && request.method === 'GET') {
      const after = parseInt(new URL(request.url).searchParams.get('after') || '0', 10) || 0;
      const { results } = await env.DB.prepare(
        'SELECT id, ts, stage, level, message, meta FROM events WHERE project_id = ? AND id > ? ORDER BY id ASC LIMIT 200'
      ).bind(project.id, after).all();
      const fresh = await env.DB.prepare('SELECT status, error FROM projects WHERE id = ?').bind(project.id).first();
      return json({ events: results, status: fresh.status, error: fresh.error });
    }

    if (sub === 'credentials' && request.method === 'PUT') {
      const body = await readJson(request);
      const values = body.values && typeof body.values === 'object' ? body.values : {};
      const clean = {};
      for (const [k, v] of Object.entries(values)) {
        if (/^[a-z][a-z0-9_]{0,39}$/.test(k) && typeof v === 'string' && v.length && v.length <= 4000) clean[k] = v;
      }
      if (!Object.keys(clean).length) throw new HttpError(400, 'No credential values provided.');
      await env.DB.prepare('UPDATE projects SET creds_enc = ?, updated_at = ? WHERE id = ?')
        .bind(await encryptJson(env.ENCRYPTION_KEY, clean), now(), project.id).run();
      await emit(env, project.id, 'credentials', 'ok', `Credentials stored (${Object.keys(clean).join(', ')}) - encrypted at rest, never shown again.`);
      return json({ ok: true, stored: Object.keys(clean) });
    }

    if (sub === 'credentials' && request.method === 'DELETE') {
      await env.DB.prepare("UPDATE projects SET creds_enc = '', updated_at = ? WHERE id = ?").bind(now(), project.id).run();
      return json({ ok: true, note: 'Credentials wiped.' });
    }

    if (sub === 'rotate-key' && request.method === 'POST') {
      const mcpKey = `mit_${randomToken(24)}`;
      await env.DB.prepare('UPDATE projects SET mcp_key_hash = ?, mcp_key_hint = ?, updated_at = ? WHERE id = ?')
        .bind(await sha256hex(mcpKey), `mit_...${mcpKey.slice(-4)}`, now(), project.id).run();
      await emit(env, project.id, 'key', 'ok', 'MCP key rotated - previous key and OAuth tokens are now invalid.');
      return json({ mcp_key: mcpKey, note: 'Save it - shown once. Reconnect your MCP clients with the new key.' });
    }

    if (sub === 'try' && request.method === 'POST') {
      if (project.status !== 'ready') throw new HttpError(409, 'Generate the MCP first.');
      const body = await readJson(request);
      const result = await runProjectTool(env, project, String(body.tool || ''), body.arguments || {});
      return json({ result: clampStr(result.content?.[0]?.text || '', 60000), isError: Boolean(result.isError) });
    }

    if (sub === 'export' && request.method === 'GET') {
      const plan = planFor(user);
      if (!plan.export) throw new HttpError(402, 'Code export is a pro feature - upgrade to download your server as a standalone Worker.');
      if (project.status !== 'ready' || !project.manifest) throw new HttpError(409, 'Generate the MCP first.');
      const code = exportWorker(project, JSON.parse(project.manifest));
      return new Response(code, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Disposition': `attachment; filename="${project.slug}-mcp-worker.js"`,
        },
      });
    }
  }

  throw new HttpError(404, 'No such API route.');
}

function requireVerified(user, env) {
  if (env.RESEND_API_KEY && !user.verified_at) {
    throw new HttpError(403, 'Verify your email first - check your inbox for the link.');
  }
}

function projectSummary(p) {
  const hasManifest = p.has_manifest !== undefined ? Boolean(p.has_manifest) : Boolean(p.manifest && p.manifest !== '');
  return {
    id: p.id, name: p.name, slug: p.slug, source_url: p.source_url, status: p.status,
    error: p.error, allow_delete: Boolean(p.allow_delete), created_at: p.created_at,
    updated_at: p.updated_at, mcp_key_hint: p.mcp_key_hint,
    has_creds: p.has_creds !== undefined ? Boolean(p.has_creds) : Boolean(p.creds_enc && p.creds_enc !== ''),
    has_manifest: hasManifest,
    cred_fields: p.cred_fields ? JSON.parse(p.cred_fields) : [],
    tool_count: p.tool_count !== undefined
      ? (p.tool_count || 0)
      : (hasManifest ? (JSON.parse(p.manifest).tools?.length || 0) : 0),
  };
}
