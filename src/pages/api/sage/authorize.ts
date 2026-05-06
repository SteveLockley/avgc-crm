import type { APIRoute } from 'astro';
import { getAuthorizationUrl } from '@/lib/sage';

export const GET: APIRoute = async ({ locals, redirect }) => {
  const env = locals.runtime?.env;
  if (!env?.SAGE_CLIENT_ID || !env?.SAGE_REDIRECT_URI) {
    return new Response(JSON.stringify({ error: 'Sage credentials not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate a random state parameter for CSRF protection
  const state = crypto.randomUUID();

  const url = getAuthorizationUrl(env.SAGE_CLIENT_ID.trim(), env.SAGE_REDIRECT_URI.trim(), state);
  return redirect(url);
};
