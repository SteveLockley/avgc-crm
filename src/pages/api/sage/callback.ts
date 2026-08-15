import type { APIRoute } from 'astro';
import { exchangeCodeForTokens } from '@/lib/sage';

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const env = locals.runtime?.env;
  const db = env?.DB;

  if (!env?.SAGE_CLIENT_ID || !env?.SAGE_CLIENT_SECRET || !env?.SAGE_REDIRECT_URI || !db) {
    return new Response('Sage not configured', { status: 500 });
  }

  // Extract code from raw URL to avoid URLSearchParams treating + as space
  // (Sage auth codes may contain + characters which must be preserved exactly)
  // Extract code from raw URL to avoid URLSearchParams treating + as space
  const rawCodeMatch = url.search.match(/[?&]code=([^&]+)/);
  const code = rawCodeMatch ? decodeURIComponent(rawCodeMatch[1]) : null;
  const error = url.searchParams.get('error');

  // authorize.ts prefixes the state with the target role.
  const role = (url.searchParams.get('state') || '').startsWith('test.') ? 'test' : 'live';

  if (error) {
    return new Response(`Sage authorization failed: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response('No authorization code received', { status: 400 });
  }

  try {
    // Exchange code for tokens (code expires in 60 seconds, single use)
    const tokens = await exchangeCodeForTokens(
      code,
      env.SAGE_CLIENT_ID.trim(),
      env.SAGE_CLIENT_SECRET.trim(),
      env.SAGE_REDIRECT_URI.trim(),
    );

    // Fetch business info using the new access token
    const bizRes = await fetch('https://api.accounting.sage.com/v3.1/businesses', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const bizData = await bizRes.json() as any;
    const businesses = bizData.$items || [bizData];
    const biz = businesses[0] || {};

    // Upsert the token row
    // Guard against connecting the live business into the test slot (or the
    // reverse), which would point rehearsal writes at the club's real accounts.
    const clash = await db.prepare(
      'SELECT role, sage_business_name FROM sage_tokens WHERE sage_business_id = ?'
    ).bind(biz.id || 'default').first() as any;
    if (clash && clash.role !== role) {
      return new Response(
        `This business ("${clash.sage_business_name}") is already connected as the ${clash.role} business. ` +
        `Connect a different business as ${role}, or disconnect the existing one first.`,
        { status: 409 },
      );
    }

    await db.prepare(`
      INSERT INTO sage_tokens (sage_business_id, sage_business_name, access_token, refresh_token, token_expires_at, refresh_token_expires_at, resource_owner_id, scope, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'readonly', ?)
      ON CONFLICT(sage_business_id) DO UPDATE SET
        sage_business_name = excluded.sage_business_name,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        refresh_token_expires_at = excluded.refresh_token_expires_at,
        resource_owner_id = excluded.resource_owner_id,
        role = excluded.role,
        updated_at = datetime('now')
    `).bind(
      biz.id || 'default',
      biz.displayed_as || biz.name || 'Unknown',
      tokens.access_token,
      tokens.refresh_token,
      tokens.token_expires_at,
      tokens.refresh_token_expires_at,
      tokens.resource_owner_id || null,
      role,
    ).run();

    // Log the connection
    await db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, details)
      VALUES ('sage_connected', 'sage_business', ?, ?)
    `).bind(biz.id || 'default', JSON.stringify({ name: biz.displayed_as, role })).run();

    return redirect(role === 'test' ? '/admin/sage/changes' : '/admin/sage');
  } catch (err: any) {
    return new Response(`Token exchange failed: ${err.message}`, { status: 500 });
  }
};
