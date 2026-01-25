import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Skip for static assets
  if (pathname.startsWith('/_') || pathname.includes('.')) {
    return next();
  }

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

  // Redirect /login to home since we use Cloudflare Access now
  if (pathname === '/login') {
    return context.redirect('/');
  }

  return next();
});
