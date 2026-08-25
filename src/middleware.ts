import { defineMiddleware } from 'astro:middleware';
import { verifyAccessJwt } from './lib/access-auth';

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

// Committee portal (member session plus the committee flag)
const committeePrefixes = [
  '/committee',
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

// API routes that must stay reachable without an admin session: the public
// site, the member portal, and OAuth/webhook callbacks. Everything else under
// /api is admin-only, so a new endpoint is closed by default rather than open.
const openApiPrefixes = [
  '/api/faq',                 // public FAQ search
  '/api/contact',             // public contact form
  '/api/member-auth',         // member login, registration, password reset
  '/api/member-invoices',     // member portal, checks its own session
  '/api/document/',           // document delivery
  '/api/image/',              // image delivery
  '/api/result-pdfs',         // published results
  '/api/msb/',                // MasterScoreboard results feed
  '/api/google-hours',        // opening hours shown on the public site
  '/api/google-profile',
  '/api/google-special-hours',
  '/api/dojo-payment',        // payment provider callback
  '/api/sage/callback',       // Sage OAuth redirect target — cannot require a session
];

function isAdminApiRoute(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  return !openApiPrefixes.some(prefix => pathname.startsWith(prefix));
}

function isCommitteeRoute(pathname: string): boolean {
  return committeePrefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}

type SessionStatus = 'ok' | 'none' | 'invalid' | 'error';

// Resolve a member session and attach the member (with committee flag) to locals.
async function loadMemberSession(context: any): Promise<SessionStatus> {
  const sessionToken = context.cookies.get('avgc_member_session')?.value;
  if (!sessionToken) return 'none';

  try {
    const db = context.locals.runtime?.env?.DB;
    if (!db) return 'error';

    const session = await db.prepare(
      `SELECT ms.session_token, m.id as member_id, m.first_name, m.surname, m.email, m.is_committee
         FROM member_sessions ms
         JOIN members m ON ms.member_id = m.id
        WHERE ms.session_token = ? AND ms.expires_at > datetime('now') AND m.deleted_at IS NULL`
    ).bind(sessionToken).first();

    if (!session) {
      context.cookies.delete('avgc_member_session', { path: '/' });
      return 'invalid';
    }

    await db.prepare(
      `UPDATE member_sessions SET last_used = datetime('now') WHERE session_token = ?`
    ).bind(sessionToken).run();

    context.locals.member = {
      id: session.member_id,
      firstName: session.first_name,
      surname: session.surname,
      email: session.email,
      isCommittee: session.is_committee === 1,
    };
    return 'ok';
  } catch (e) {
    console.error('Error validating member session:', e);
    return 'error';
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Skip for static assets. API paths are never treated as assets, so a dot in
  // the path cannot be used to slip past the admin gate below.
  if (!pathname.startsWith('/api/') && (pathname.startsWith('/_') || pathname.includes('.'))) {
    return next();
  }

  // Identity from Cloudflare Access. The token's signature is verified against
  // the team's public keys before it is trusted — decoding the payload alone
  // proves nothing, since anyone can craft a token with any email in it.
  if (!context.locals.user) {
    const candidates = [
      context.request.headers.get('Cf-Access-Jwt-Assertion'),
      context.cookies.get('CF_Authorization')?.value,
      context.cookies.get('avgc_admin_token')?.value,
    ];

    const env = context.locals.runtime?.env as any;
    let identity = null;
    for (const token of candidates) {
      if (!token) continue;
      identity = await verifyAccessJwt(token, {
        teamDomain: env?.CF_ACCESS_TEAM_DOMAIN,
        aud: env?.CF_ACCESS_AUD,
      });
      if (identity) break;
    }

    if (identity) {
      const namePart = identity.email.split('@')[0];
      const name = namePart
        .split('.')
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
      context.locals.user = { email: identity.email, name, role: 'admin' };

      // Carry the verified token across subdomains so the admin links work on
      // www too. It is re-verified on every request, so the cookie grants
      // nothing on its own.
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

  // Admin-only API routes. These are not covered by Cloudflare Access on the
  // www hostname, and several of them carry no auth check of their own, so the
  // gate has to live here.
  if (isAdminApiRoute(pathname)) {
    if (!context.locals.user && !import.meta.env.DEV) {
      return new Response(JSON.stringify({ error: 'Not authorised' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return next();
  }

  // Public routes - no auth required
  if (isPublicRoute(pathname)) {
    return next();
  }

  // Member login/verify/reset pages - no auth required
  if (pathname === '/members/login' || pathname.startsWith('/members/verify/') || pathname.startsWith('/members/reset-password/')) {
    return next();
  }

  // Committee portal - member session plus the committee flag (admins bypass)
  if (isCommitteeRoute(pathname)) {
    if (context.locals.user) {
      await loadMemberSession(context); // admins see it too; load member data if they have a session
      return next();
    }

    const status = await loadMemberSession(context);
    if (status === 'none' || status === 'invalid') {
      return context.redirect('/members/login?next=' + encodeURIComponent(pathname));
    }
    if (status === 'error') {
      return new Response('The committee portal is temporarily unavailable.', { status: 503 });
    }
    if (!context.locals.member?.isCommittee) {
      return context.redirect('/members');
    }

    return next();
  }

  // Member protected routes - check session (admins bypass)
  if (isMemberRoute(pathname)) {
    // Admins authenticated via Cloudflare Access can access member pages directly
    if (context.locals.user) {
      return next();
    }

    const status = await loadMemberSession(context);
    if (status === 'none' || status === 'invalid') {
      return context.redirect('/members/login');
    }

    // Database error - allow access but no member data (unchanged behaviour)
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

      // Already on the Access-protected host and still unauthenticated: Access
      // let the request through but the token did not verify. Redirecting here
      // would loop, so say so instead.
      if (context.url.hostname === 'crm.alnmouthvillage.golf') {
        return new Response(
          'Signed in to Cloudflare Access, but the access token could not be verified. '
          + 'Sign out at /cdn-cgi/access/logout and sign in again; if it persists the '
          + 'Access application audience may have changed.',
          { status: 403, headers: { 'Content-Type': 'text/plain' } },
        );
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
