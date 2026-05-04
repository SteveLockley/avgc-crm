// API for courtesy tee time bookings
// GET  /api/courtesy-tee-times          → all slots with player names
// POST /api/courtesy-tee-times          → update a slot { id, player1_id, player2_id, player3_id, player4_id, notes }

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });

  const result = await db.prepare(`
    SELECT t.*,
      m1.first_name || ' ' || m1.surname AS player1_name,
      m2.first_name || ' ' || m2.surname AS player2_name,
      m3.first_name || ' ' || m3.surname AS player3_name,
      m4.first_name || ' ' || m4.surname AS player4_name
    FROM courtesy_tee_times t
    LEFT JOIN members m1 ON m1.id = t.player1_id
    LEFT JOIN members m2 ON m2.id = t.player2_id
    LEFT JOIN members m3 ON m3.id = t.player3_id
    LEFT JOIN members m4 ON m4.id = t.player4_id
    ORDER BY t.tee_time, t.course
  `).all();

  return new Response(JSON.stringify({ slots: result.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { id, player1_id, player2_id, player3_id, player4_id, notes } = body;
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });

  const toInt = (v: any) => (v !== null && v !== undefined && v !== '' ? parseInt(v) || null : null);

  await db.prepare(`
    UPDATE courtesy_tee_times
    SET player1_id = ?, player2_id = ?, player3_id = ?, player4_id = ?,
        notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(toInt(player1_id), toInt(player2_id), toInt(player3_id), toInt(player4_id),
          notes || null, id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
