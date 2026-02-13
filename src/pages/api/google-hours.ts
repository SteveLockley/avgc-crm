import type { APIRoute } from 'astro';
import { getHoursBySeason, getCurrentSeason, type Season } from '../../lib/opening-hours';
import { updateGoogleBusinessHours, isGoogleConfigured } from '../../lib/google-business';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;

  if (!db) {
    return json({ success: false, error: 'Database unavailable' }, 500);
  }

  // Auth: either Cloudflare Access (admin) or CRON_SECRET bearer token
  const isAdmin = !!(locals as any).user?.email;
  const authHeader = request.headers.get('Authorization');
  const cronSecret = env.CRON_SECRET;

  if (!isAdmin && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (!isGoogleConfigured(env)) {
    return json({ success: false, error: 'Google Business Profile not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, and GOOGLE_LOCATION_ID as Cloudflare secrets.' }, 400);
  }

  // Parse optional body
  let force = false;
  let season: Season = getCurrentSeason();
  try {
    const body = await request.json();
    if (body.season === 'Winter' || body.season === 'Summer') {
      season = body.season;
    }
    if (body.force) {
      force = true;
    }
  } catch {}

  // Check if season changed since last successful push (skip if same and not forced)
  if (!force) {
    try {
      const lastSync = await db.prepare(
        `SELECT season FROM google_sync_log WHERE status = 'success' ORDER BY created_at DESC LIMIT 1`
      ).first<{ season: string }>();

      if (lastSync?.season === season) {
        return json({ success: true, message: 'Season unchanged since last push, skipped' });
      }
    } catch {}
  }

  // Get hours and push to Google
  const hours = await getHoursBySeason(db, season);
  const result = await updateGoogleBusinessHours(hours, env);

  // Log the attempt
  try {
    await db.prepare(
      `INSERT INTO google_sync_log (action, season, status, error_message) VALUES (?, ?, ?, ?)`
    ).bind('push_hours', season, result.success ? 'success' : 'error', result.error || null).run();
  } catch (e) {
    console.error('Failed to log Google sync:', e);
  }

  return json(result, result.success ? 200 : 500);
};

function json(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
