import type { APIRoute } from 'astro';

/**
 * Sage notification webhook endpoint
 * Sage sends POST requests here when data changes in the connected business.
 * We don't use these yet but the URL is required during app registration.
 */
export const POST: APIRoute = async ({ request }) => {
  // Log the notification for future use
  try {
    const body = await request.text();
    console.log('Sage notification received:', body);
  } catch (e) {
    // ignore
  }

  // Always return 200 so Sage doesn't retry
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
