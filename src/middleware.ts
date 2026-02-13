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
  '/privacy-policy',
  '/terms',
  '/refund-policy',
];

// Routes that start with these prefixes are public
const publicPrefixes = [
  '/news/',
  '/api/faq',
];

// Member routes (require password auth)
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
  // Login, verify, and reset-password pages are accessible without auth
  if (pathname === '/members/login' || pathname.startsWith('/members/verify/') || pathname.startsWith('/members/reset-password/')) {
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

  // Opportunistic admin detection on ALL routes via CF_Authorization cookie
  // This allows layouts to show admin links when an admin is browsing any page
  if (!context.locals.user) {
    // Check Cloudflare Access headers first (present on CF Access protected paths)
    let cfEmail = context.request.headers.get('Cf-Access-Authenticated-User-Email');
    if (!cfEmail) {
      const jwt = context.request.headers.get('Cf-Access-Jwt-Assertion');
      if (jwt) {
        try {
          const parts = jwt.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            cfEmail = payload.email;
          }
        } catch (e) { /* ignore */ }
      }
    }
    // Fall back to CF_Authorization cookie (works across subdomains if cookie domain is set)
    if (!cfEmail) {
      const cfAuthCookie = context.cookies.get('CF_Authorization')?.value;
      if (cfAuthCookie) {
        try {
          const parts = cfAuthCookie.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            cfEmail = payload.email;
          }
        } catch (e) { /* ignore */ }
      }
    }
    // Also check cross-subdomain admin cookie as fallback
    if (!cfEmail) {
      const adminToken = context.cookies.get('avgc_admin_token')?.value;
      if (adminToken) {
        try {
          const parts = adminToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            cfEmail = payload.email;
          }
        } catch (e) { /* ignore invalid token */ }
      }
    }

    if (cfEmail) {
      const namePart = cfEmail.split('@')[0];
      const name = namePart
        .split('.')
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
      context.locals.user = { email: cfEmail, name, role: 'admin' };

      // Set cross-subdomain cookie so admin auth works on www subdomain too
      const cfToken = context.request.headers.get('Cf-Access-Jwt-Assertion')
        || context.cookies.get('CF_Authorization')?.value
        || context.cookies.get('avgc_admin_token')?.value;
      if (cfToken) {
        try {
          context.cookies.set('avgc_admin_token', cfToken, {
            domain: 'alnmouthvillage.golf',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'lax' as const,
            maxAge: 60 * 60 * 8, // 8 hours
          });
        } catch (e) { /* ignore cookie errors in dev */ }
      }
    }
  }

  // Public routes - no auth required
  if (isPublicRoute(pathname)) {
    return next();
  }

  // Member login/verify/reset pages - no auth required
  if (pathname === '/members/login' || pathname.startsWith('/members/verify/') || pathname.startsWith('/members/reset-password/')) {
    return next();
  }

  // Member protected routes - check session (admins bypass)
  if (isMemberRoute(pathname)) {
    // Admins authenticated via Cloudflare Access can access member pages directly
    if (context.locals.user) {
      return next();
    }

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
    if (!context.locals.user) {
      // In development, allow access with a default user
      if (import.meta.env.DEV) {
        context.locals.user = {
          email: 'dev@alnmouthvillage.golf',
          name: 'Developer',
          role: 'admin'
        };
        return next();
      }

      // Redirect to CRM subdomain where Cloudflare Access will handle Azure AD login
      const crmUrl = new URL(context.url.pathname + context.url.search, 'https://crm.alnmouthvillage.golf');
      return context.redirect(crmUrl.toString());
    }

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
