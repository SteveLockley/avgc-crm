import type { APIRoute } from 'astro';
import { getAuthorizationUrl } from '@/lib/sage';

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const env = locals.runtime?.env;
  if (!env?.SAGE_CLIENT_ID || !env?.SAGE_REDIRECT_URI) {
    return new Response(JSON.stringify({ error: 'Sage credentials not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ?role=test connects a trial business alongside the live one, so changes can
  // be rehearsed before they touch the club's real accounts.
  const role = url.searchParams.get('role') === 'test' ? 'test' : 'live';

  // Random state for CSRF protection, with the target role carried alongside it
  // so the callback knows which slot to store the tokens in.
  const state = `${role}.${crypto.randomUUID()}`;

  const authUrl = getAuthorizationUrl(env.SAGE_CLIENT_ID.trim(), env.SAGE_REDIRECT_URI.trim(), state);
  return redirect(authUrl);
};
