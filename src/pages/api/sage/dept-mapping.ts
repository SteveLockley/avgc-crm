import type { APIRoute } from 'astro';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB not configured' }, 500);

  const result = await db.prepare(`SELECT * FROM dept_sage_mapping ORDER BY dept_pattern`).all();
  return json(result.results || []);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB not configured' }, 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { deptPattern, sageAccountId, sageAccountName, enabled = 1 } = body;

  if (!deptPattern?.trim() || !sageAccountId?.trim()) {
    return json({ error: 'deptPattern and sageAccountId are required' }, 400);
  }

  await db.prepare(`
    INSERT INTO dept_sage_mapping (dept_pattern, sage_ledger_account_id, sage_ledger_account_name, enabled)
    VALUES (?, ?, ?, ?)
  `).bind(deptPattern.trim(), sageAccountId.trim(), sageAccountName ?? null, enabled ? 1 : 0).run();

  const row = await db.prepare(`SELECT * FROM dept_sage_mapping WHERE rowid = last_insert_rowid()`).first();
  return json(row, 201);
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB not configured' }, 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { id, enabled } = body;
  if (id == null) return json({ error: 'id is required' }, 400);

  await db.prepare(`UPDATE dept_sage_mapping SET enabled = ? WHERE id = ?`)
    .bind(enabled ? 1 : 0, id).run();

  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB not configured' }, 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { id } = body;
  if (!id) return json({ error: 'id is required' }, 400);

  await db.prepare(`DELETE FROM dept_sage_mapping WHERE id = ?`).bind(id).run();
  return json({ ok: true });
};
