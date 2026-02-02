import type { APIRoute } from 'astro';
import { requestMagicLink, invalidateSession } from '../../lib/member-auth';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const db = locals.runtime?.env?.DB;
  const env = locals.runtime?.env;

  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: 'Database unavailable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { action, email } = body;

    if (action === 'request-link') {
      if (!email) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const baseUrl = new URL(request.url).origin;
      const result = await requestMagicLink(email, db, env, baseUrl);

      // Always return success to prevent email enumeration
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'logout') {
      const sessionToken = cookies.get('avgc_member_session')?.value;

      if (sessionToken) {
        await invalidateSession(sessionToken, db);
        cookies.delete('avgc_member_session', { path: '/' });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Member auth API error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
