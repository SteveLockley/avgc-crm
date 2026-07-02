import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const excludeId = parseInt(url.searchParams.get('exclude') || '0') || null;
  const excludeLinked = url.searchParams.get('exclude_linked') === '1';

  if (q.length < 2) {
    return new Response(JSON.stringify({ members: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pattern = `%${q}%`;
  const results = await db.prepare(
    `SELECT m.id, m.first_name, m.surname, m.category,
            COALESCE(p1.fee, p2.fee, 0) as subscription_fee,
            COALESCE(p1.id, p2.id) as subscription_item_id
     FROM members m
     LEFT JOIN payment_items p1
       ON p1.name = m.category AND p1.category = 'Subscription' AND p1.active = 1
     LEFT JOIN payment_items p2
       ON p2.category = 'Subscription' AND p2.active = 1
       AND p2.name = TRIM(SUBSTR(m.category, 1,
           CASE WHEN INSTR(m.category, '(') > 0
                THEN INSTR(m.category, '(') - 1
                ELSE LENGTH(m.category) END))
     WHERE (m.first_name LIKE ? OR m.surname LIKE ? OR (m.first_name || ' ' || m.surname) LIKE ?)
       AND (? IS NULL OR m.id != ?)
       AND (? = 0 OR m.family_payer_id IS NULL)
     ORDER BY m.surname, m.first_name
     LIMIT 10`
  ).bind(pattern, pattern, pattern, excludeId, excludeId, excludeLinked ? 1 : 0).all();

  return new Response(JSON.stringify({ members: results.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
