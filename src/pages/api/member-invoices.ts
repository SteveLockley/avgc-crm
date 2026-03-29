import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  const memberId = url.searchParams.get('member_id');
  const exclude = url.searchParams.get('exclude');

  if (!memberId) {
    return new Response(JSON.stringify({ error: 'member_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = locals.runtime.env.DB;

  let query = `SELECT id, invoice_number, status, total, period_start
               FROM invoices
               WHERE member_id = ?`;
  const params: (string | number)[] = [parseInt(memberId)];

  if (exclude) {
    query += ` AND id != ?`;
    params.push(parseInt(exclude));
  }

  query += ` ORDER BY created_at DESC LIMIT 10`;

  try {
    const result = await db.prepare(query).bind(...params).all();

    return new Response(JSON.stringify({ invoices: result.results || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
