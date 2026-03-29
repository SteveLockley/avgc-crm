import type { APIRoute } from 'astro';
import { isGoogleConfigured, updateGoogleSpecialHours } from '../../lib/google-business';

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;

  if (!db) {
    return json({ success: false, error: 'Database unavailable' }, 500);
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const rows = await db.prepare(
      `SELECT * FROM google_special_hours WHERE date >= ? ORDER BY date ASC`
    ).bind(today).all();
    return json({ success: true, entries: rows.results || [] });
  } catch (e: any) {
    return json({ success: false, error: e.message }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;

  if (!db) {
    return json({ success: false, error: 'Database unavailable' }, 500);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const action = body.action;

  if (action === 'add') {
    if (!body.date) {
      return json({ success: false, error: 'Date is required' }, 400);
    }
    try {
      await db.prepare(
        `INSERT INTO google_special_hours (date, open_time, close_time, is_closed, label) VALUES (?, ?, ?, ?, ?)`
      ).bind(
        body.date,
        body.openTime || null,
        body.closeTime || null,
        body.isClosed ? 1 : 0,
        body.label || null
      ).run();
      return json({ success: true });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  if (action === 'delete') {
    if (!body.id) {
      return json({ success: false, error: 'ID is required' }, 400);
    }
    try {
      await db.prepare(`DELETE FROM google_special_hours WHERE id = ?`).bind(body.id).run();
      return json({ success: true });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  if (action === 'push') {
    if (!isGoogleConfigured(env)) {
      return json({ success: false, error: 'Google Business Profile not configured' }, 400);
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const rows = await db.prepare(
        `SELECT * FROM google_special_hours WHERE date >= ? ORDER BY date ASC`
      ).bind(today).all();

      const entries = (rows.results || []).map((r: any) => ({
        date: r.date,
        open_time: r.open_time,
        close_time: r.close_time,
        is_closed: !!r.is_closed,
      }));

      const result = await updateGoogleSpecialHours(env, entries);

      try {
        await db.prepare(
          `INSERT INTO google_sync_log (action, status, error_message) VALUES (?, ?, ?)`
        ).bind('push_special_hours', result.success ? 'success' : 'error', result.error || `${entries.length} entries pushed`).run();
      } catch {}

      return json(result, result.success ? 200 : 500);
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  return json({ success: false, error: 'Invalid action. Use add, delete, or push.' }, 400);
};

function json(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
