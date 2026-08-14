// Lightweight member list for autocomplete — returns id, name only
// Filtered to Senior (55+) members for NGU courtesy tee times use case
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });

  const result = await db.prepare(
    `SELECT id, first_name, surname
     FROM members
     WHERE age_group = 'Senior'
       AND gender = 'M'
       AND deleted_at IS NULL
     ORDER BY surname, first_name`
  ).all();

  return new Response(JSON.stringify({ members: result.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
