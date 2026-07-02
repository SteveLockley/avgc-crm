import type { APIRoute } from 'astro';

// GET  /api/result-pdfs          → list all, newest first
// POST /api/result-pdfs          → { title, url } → create record
// DELETE /api/result-pdfs?id=X   → delete record

export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });

  const result = await db.prepare(
    `SELECT id, title, url, uploaded_at FROM result_pdfs ORDER BY uploaded_at DESC`
  ).all();

  return new Response(JSON.stringify({ results: result.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });
  if (!(locals as any).user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json() as { title?: string; url?: string };
  if (!body.title || !body.url) {
    return new Response(JSON.stringify({ error: 'title and url are required' }), { status: 400 });
  }

  await db.prepare(
    `INSERT INTO result_pdfs (title, url, uploaded_by) VALUES (?, ?, ?)`
  ).bind(body.title.trim(), body.url, (locals as any).user.email).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ url, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });
  if (!(locals as any).user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });

  await db.prepare(`DELETE FROM result_pdfs WHERE id = ?`).bind(id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
