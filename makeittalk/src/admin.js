// Admin API - Ryan's back office. Gated by role='admin' (see index.js).

import { json, monthKey, HttpError, readJson } from './util.js';
import { PLANS } from './plans.js';

export async function handleAdminApi(request, env, path) {
  const seg = path.split('/').filter(Boolean); // ['api','admin',...]

  if (path === '/api/admin/overview' && request.method === 'GET') {
    const month = monthKey();
    const [users, projects, ready, usage, plans] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE status = 'ready'").first(),
      env.DB.prepare('SELECT SUM(generations) AS g, SUM(tool_calls) AS t FROM usage_months WHERE month = ?').bind(month).first(),
      env.DB.prepare("SELECT plan, COUNT(*) AS n FROM users GROUP BY plan").all(),
    ]);
    const planCounts = Object.fromEntries((plans.results || []).map((r) => [r.plan, r.n]));
    const mrr = (planCounts.pro || 0) * PLANS.pro.price + (planCounts.scale || 0) * PLANS.scale.price;
    return json({
      users: users?.n || 0,
      projects: projects?.n || 0,
      ready_mcps: ready?.n || 0,
      month,
      generations_this_month: usage?.g || 0,
      tool_calls_this_month: usage?.t || 0,
      plans: planCounts,
      mrr_estimate: mrr,
    });
  }

  if (path === '/api/admin/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.plan, u.plan_status, u.verified_at, u.created_at,
              (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
              COALESCE(m.generations, 0) AS generations, COALESCE(m.tool_calls, 0) AS tool_calls
       FROM users u LEFT JOIN usage_months m ON m.user_id = u.id AND m.month = ?
       ORDER BY u.created_at DESC LIMIT 500`
    ).bind(monthKey()).all();
    return json({ users: results });
  }

  if (seg[2] === 'users' && seg[3] && request.method === 'PATCH') {
    const body = await readJson(request);
    const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(seg[3]).first();
    if (!target) throw new HttpError(404, 'No such user.');
    const fields = [];
    const binds = [];
    if (typeof body.plan === 'string' && PLANS[body.plan]) { fields.push('plan = ?'); binds.push(body.plan); }
    if (body.role === 'user' || body.role === 'admin') { fields.push('role = ?'); binds.push(body.role); }
    if (!fields.length) throw new HttpError(400, 'Nothing to update (plan or role).');
    binds.push(seg[3]);
    await env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/projects' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.name, p.slug, p.status, p.source_url, p.created_at, p.updated_at, u.email AS owner
       FROM projects p JOIN users u ON u.id = p.user_id ORDER BY p.updated_at DESC LIMIT 500`
    ).all();
    return json({ projects: results });
  }

  if (path === '/api/admin/events' && request.method === 'GET') {
    const projectId = new URL(request.url).searchParams.get('project_id') || '';
    const { results } = await env.DB.prepare(
      'SELECT id, ts, stage, level, message FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 200'
    ).bind(projectId).all();
    return json({ events: results });
  }

  throw new HttpError(404, 'No such admin route.');
}
