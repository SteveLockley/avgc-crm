import type { APIRoute } from 'astro';
import { createSageClient } from '@/lib/sage';

/**
 * Generic Sage API explorer endpoint
 * GET /api/sage/explore?endpoint=/ledger_accounts&page=1&items_per_page=20
 *
 * Returns raw Sage API responses for analysis
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime?.env;
  if (!env?.DB || !env?.SAGE_CLIENT_ID || !env?.SAGE_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: 'Sage not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint) {
    return new Response(JSON.stringify({ error: 'Missing endpoint parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const client = createSageClient(env);

    // Pass through any additional query params (except 'endpoint')
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      if (k !== 'endpoint') params[k] = v;
    });

    const data = await client.get(endpoint, Object.keys(params).length > 0 ? params : undefined);

    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    if (err.message === 'NO_SAGE_CONNECTION') {
      return new Response(JSON.stringify({ error: 'Not connected to Sage. Please authorize first.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
