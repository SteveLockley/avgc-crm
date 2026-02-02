import { defineMiddleware } from 'astro:middleware';

// Public routes that don't require any authentication
const publicRoutes = [
  '/',
  '/course',
  '/visitors',
  '/membership',
  '/clubhouse',
  '/contact',
  '/news',
  '/faq',
  '/book',
];

// Routes that start with these prefixes are public
const publicPrefixes = [
  '/news/',
  '/api/faq',
];

// Member routes (require magic link auth)
const memberPrefixes = [
  '/members',
];

// Admin routes (require Cloudflare Access)
const adminPrefixes = [
  '/admin',
];

function isPublicRoute(pathname: string): boolean {
  // Exact match
  if (publicRoutes.includes(pathname)) {
    return true;
  }
  // Prefix match
  return publicPrefixes.some(prefix => pathname.startsWith(prefix));
}

function isMemberRoute(pathname: string): boolean {
  // Login and verify pages are accessible without auth
  if (pathname === '/members/login' || pathname.startsWith('/members/verify/')) {
    return false; // These should be public
  }
  return memberPrefixes.some(prefix => pathname.startsWith(prefix));
}

function isAdminRoute(pathname: string): boolean {
  return adminPrefixes.some(prefix => pathname.startsWith(prefix));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Skip for static assets
  if (pathname.startsWith('/_') || pathname.includes('.')) {
    return next();
  }

  // Public routes - no auth required
  if (isPublicRoute(pathname)) {
    return next();
  }

  // Member login/verify pages - no auth required
  if (pathname === '/members/login' || pathname.startsWith('/members/verify/')) {
    return next();
  }

  // Member protected routes - check magic link session
  if (isMemberRoute(pathname)) {
    const sessionToken = context.cookies.get('avgc_member_session')?.value;

    if (!sessionToken) {
      // Redirect to login
      return context.redirect('/members/login');
    }

    // Validate session
    try {
      const db = context.locals.runtime?.env?.DB;
      if (db) {
        const session = await db.prepare(
          `SELECT ms.*, m.id as member_id, m.first_name, m.surname, m.email
           FROM member_sessions ms
           JOIN members m ON ms.member_id = m.id
           WHERE ms.session_token = ? AND ms.expires_at > datetime('now')`
        ).bind(sessionToken).first();

        if (!session) {
          // Invalid or expired session
          context.cookies.delete('avgc_member_session', { path: '/' });
          return context.redirect('/members/login');
        }

        // Update last_used timestamp
        await db.prepare(
          `UPDATE member_sessions SET last_used = datetime('now') WHERE session_token = ?`
        ).bind(sessionToken).run();

        // Add member to locals
        context.locals.member = {
          id: session.member_id,
          firstName: session.first_name,
          surname: session.surname,
          email: session.email,
        };
      }
    } catch (e) {
      // Database error - allow access but no member data
      console.error('Error validating member session:', e);
    }

    return next();
  }

  // Admin routes - require Cloudflare Access
  if (isAdminRoute(pathname)) {
    // Try multiple ways to get the Cloudflare Access user
    let cfEmail = context.request.headers.get('Cf-Access-Authenticated-User-Email');

    // If header not found, try to decode from JWT
    if (!cfEmail) {
      const jwt = context.request.headers.get('Cf-Access-Jwt-Assertion');
      if (jwt) {
        try {
          // Decode JWT payload (middle part)
          const parts = jwt.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            cfEmail = payload.email;
          }
        } catch (e) {
          // JWT decode failed
        }
      }
    }

    if (!cfEmail) {
      // In development, allow access with a default user
      if (import.meta.env.DEV) {
        context.locals.user = {
          email: 'dev@alnmouthvillage.golf',
          name: 'Developer',
          role: 'admin'
        };
        return next();
      }

      return new Response('Unauthorized - Cloudflare Access required', { status: 401 });
    }

    // Extract name from email (before @) and format it
    const namePart = cfEmail.split('@')[0];
    const name = namePart
      .split('.')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');

    // Add user to locals from Cloudflare Access
    context.locals.user = {
      email: cfEmail,
      name: name,
      role: 'admin' // All authenticated users are admins
    };

    return next();
  }

  // Redirect old /login path to admin
  if (pathname === '/login') {
    return context.redirect('/admin');
  }

  // Redirect /logout to admin logout
  if (pathname === '/logout') {
    // Clear any session cookies
    context.cookies.delete('avgc_member_session', { path: '/' });
    return context.redirect('/');
  }

  // Default: allow access (for any unmatched routes)
  return next();
});
