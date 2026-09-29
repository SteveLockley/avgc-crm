// Fires the daily takings run in the CRM once a day. All the logic lives in
// the CRM (src/pages/api/sage/daily-takings.ts); this only makes the call.

interface Env {
  TARGET_URL: string;
  CRON_SECRET: string;
}

async function run(env: Env): Promise<Response> {
  const res = await fetch(env.TARGET_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CRON_SECRET}`,
      'Content-Type': 'application/json',
      'User-Agent': 'avgc-daily-takings-cron',
    },
    body: JSON.stringify({ action: 'cron' }),
  });
  const text = await res.text();
  console.log(`daily takings cron → ${res.status}: ${text.slice(0, 2000)}`);
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(env));
  },

  // Manual trigger for testing: GET /run with the same bearer.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/run') return new Response('avgc-daily-takings-cron', { status: 200 });
    if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    return run(env);
  },
};
