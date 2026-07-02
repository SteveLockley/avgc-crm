import type { APIRoute } from 'astro';

// Only these keys may be written via this endpoint
const ALLOWED_KEYS = new Set([
  'sage_sales_debit_account_id',
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB not configured' }, 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { key, value } = body;
  if (!key || !ALLOWED_KEYS.has(key)) {
    return json({ error: `Unknown or disallowed setting key: ${key}` }, 400);
  }

  await db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, value ?? '').run();

  return json({ ok: true });
};
