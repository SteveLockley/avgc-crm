import type { APIRoute } from 'astro';
import { isGoogleConfigured, getGoogleBusinessProfile, updateGoogleBusinessInfo } from '../../lib/google-business';

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;

  if (!isGoogleConfigured(env)) {
    return json({ success: false, error: 'Google Business Profile not configured' }, 400);
  }

  const result = await getGoogleBusinessProfile(env);

  // Log test connection
  if (db) {
    try {
      await db.prepare(
        `INSERT INTO google_sync_log (action, status, error_message) VALUES (?, ?, ?)`
      ).bind('test_connection', result.success ? 'success' : 'error', result.error || null).run();
    } catch {}
  }

  return json(result, result.success ? 200 : 500);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;

  if (!isGoogleConfigured(env)) {
    return json({ success: false, error: 'Google Business Profile not configured' }, 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const info: { description?: string; primaryPhone?: string; websiteUri?: string } = {};
  if (body.description !== undefined) info.description = body.description;
  if (body.primaryPhone !== undefined) info.primaryPhone = body.primaryPhone;
  if (body.websiteUri !== undefined) info.websiteUri = body.websiteUri;

  const result = await updateGoogleBusinessInfo(env, info);

  if (db) {
    try {
      const fields = Object.keys(info).join(', ');
      await db.prepare(
        `INSERT INTO google_sync_log (action, status, error_message) VALUES (?, ?, ?)`
      ).bind('update_info', result.success ? 'success' : 'error', result.error || `Updated: ${fields}`).run();
    } catch {}
  }

  return json(result, result.success ? 200 : 500);
};

function json(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
