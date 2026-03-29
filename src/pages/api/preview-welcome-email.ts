import type { APIRoute } from 'astro';
import { generateWelcomeEmail } from '../../lib/welcome-email';

export const GET: APIRoute = async () => {
  const html = generateWelcomeEmail({
    first_name: 'John',
    surname: 'Smith',
    pin: '0042',
  });

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
