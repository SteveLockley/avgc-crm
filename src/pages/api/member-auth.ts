import type { APIRoute } from 'astro';
import {
  authenticateWithPassword,
  requestRegistration,
  verifyRegistration,
  requestPasswordReset,
  resetPassword,
  changePassword,
  invalidateSession
} from '../../lib/member-auth';

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
    const { action } = body;

    // --- Login ---
    if (action === 'login') {
      const { email, password } = body;
      if (!email || !password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email and password are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const result = await authenticateWithPassword(email, password, db);

      if (result.success && result.sessionToken) {
        cookies.set('avgc_member_session', result.sessionToken, {
          httpOnly: true,
          secure: import.meta.env.PROD,
          sameSite: 'strict',
          path: '/',
          maxAge: 365 * 24 * 60 * 60
        });
      }

      return new Response(
        JSON.stringify({ success: result.success, error: result.error }),
        { status: result.success ? 200 : 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // --- Register ---
    if (action === 'register') {
      const { email, password } = body;
      if (!email || !password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email and password are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (password.length < 8) {
        return new Response(
          JSON.stringify({ success: false, error: 'Password must be at least 8 characters.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const baseUrl = new URL(request.url).origin;
      const result = await requestRegistration(email, password, db, env, baseUrl);

      return new Response(
        JSON.stringify({ success: result.success, error: result.error }),
        { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // --- Verify Registration ---
    if (action === 'verify-registration') {
      const { token } = body;
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: 'Token is required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const result = await verifyRegistration(token, db);

      if (result.success && result.sessionToken) {
        cookies.set('avgc_member_session', result.sessionToken, {
          httpOnly: true,
          secure: import.meta.env.PROD,
          sameSite: 'strict',
          path: '/',
          maxAge: 365 * 24 * 60 * 60
        });
      }

      return new Response(
        JSON.stringify({ success: result.success, error: result.error }),
        { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // --- Forgot Password ---
    if (action === 'forgot-password') {
      const { email } = body;
      if (!email) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email is required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const baseUrl = new URL(request.url).origin;
      const result = await requestPasswordReset(email, db, env, baseUrl);

      // Always return success to prevent email enumeration
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // --- Reset Password ---
    if (action === 'reset-password') {
      const { token, password } = body;
      if (!token || !password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Token and new password are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (password.length < 8) {
        return new Response(
          JSON.stringify({ success: false, error: 'Password must be at least 8 characters.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const result = await resetPassword(token, password, db);

      return new Response(
        JSON.stringify({ success: result.success, error: result.error }),
        { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // --- Change Password (authenticated) ---
    if (action === 'change-password') {
      const { currentPassword, newPassword } = body;
      const member = locals.member;

      if (!member?.id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Not authenticated.' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (!currentPassword || !newPassword) {
        return new Response(
          JSON.stringify({ success: false, error: 'Current and new passwords are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (newPassword.length < 8) {
        return new Response(
          JSON.stringify({ success: false, error: 'New password must be at least 8 characters.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const result = await changePassword(member.id, currentPassword, newPassword, db);

      return new Response(
        JSON.stringify({ success: result.success, error: result.error }),
        { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // --- Logout ---
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
