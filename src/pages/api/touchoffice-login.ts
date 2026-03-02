import type { APIRoute } from 'astro';

const LOGIN_URL = 'https://www.touchoffice.net/auth/login';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any).runtime?.env;
    const db = env?.DB;

    if (!db) {
      return json({ error: 'Database not available.' }, 500);
    }

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return json({ error: 'Username and password are required.' }, 400);
    }

    // First GET the login page to get a fresh session cookie
    const loginPageRes = await fetch(LOGIN_URL, { redirect: 'manual' });
    const pageCookies = loginPageRes.headers.get('set-cookie') || '';
    const sessionMatch = pageCookies.match(/icrtouch_connect_login_id=([^;]+)/);
    const initialSession = sessionMatch ? sessionMatch[1] : '';

    if (!initialSession) {
      return json({ error: 'Could not get initial session from TouchOffice.' }, 500);
    }

    // POST login credentials with the session cookie
    const formBody = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&submit-login=`;

    const loginRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `icrtouch_connect_login_id=${initialSession}`,
      },
      redirect: 'manual',
    body: formBody,
    });

    // A successful login typically redirects (302) to the dashboard
    // A failed login returns 200 with the login form again
    const status = loginRes.status;
    const resCookies = loginRes.headers.get('set-cookie') || '';
    const newSessionMatch = resCookies.match(/icrtouch_connect_login_id=([^;]+)/);
    const newSession = newSessionMatch ? newSessionMatch[1] : initialSession;

    // Check if login succeeded by looking for redirect
    if (status === 302 || status === 301 || status === 303) {
      // Success — store the session in D1
      await db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('touchoffice_session', ?, datetime('now'))`
      ).bind(newSession).run();

      return json({ success: true, message: 'Logged in to TouchOffice successfully.' });
    }

    // Check if we got redirected to a non-login page (some servers return 200 with meta redirect)
    const responseHtml = await loginRes.text();

    // If response contains login form, credentials were wrong
    if (responseHtml.includes('name="submit-login"') || responseHtml.includes('id="login"')) {
      // Check for error message
      const errorMatch = responseHtml.match(/info-message[^>]*>([^<]+)/);
      const errorMsg = errorMatch ? errorMatch[1].trim() : 'Invalid username or password.';
      return json({ error: errorMsg || 'Invalid username or password.' }, 401);
    }

    // If we got a non-login page back, login probably succeeded
    await db.prepare(
      `INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('touchoffice_session', ?, datetime('now'))`
    ).bind(newSession).run();

    return json({ success: true, message: 'Logged in to TouchOffice successfully.' });

  } catch (err: any) {
    return json({ error: err.message || 'Login failed.' }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
