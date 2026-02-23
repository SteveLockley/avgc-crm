// API endpoint to get subscriptions@ inbox status via Graph API
// GET /api/inbox-status
// Returns unread count, bounced count, and OWA link

import type { APIRoute } from 'astro';

const SHARED_MAILBOX = 'subscriptions@AlnmouthVillage.Golf';
const OWA_LINK = `https://outlook.office365.com/mail/`;

async function getGraphToken(env: any): Promise<string> {
  // Use ROPC if service account is configured, otherwise client credentials
  if (env.AZURE_SERVICE_USER && env.AZURE_SERVICE_PASSWORD) {
    const params = new URLSearchParams({
      client_id: env.AZURE_CLIENT_ID,
      scope: 'https://graph.microsoft.com/.default offline_access',
      username: env.AZURE_SERVICE_USER,
      password: env.AZURE_SERVICE_PASSWORD,
      grant_type: 'password',
    });
    if (env.AZURE_CLIENT_SECRET) {
      params.append('client_secret', env.AZURE_CLIENT_SECRET);
    }

    const response = await fetch(
      `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
    );
    if (!response.ok) throw new Error(`Token error: ${await response.text()}`);
    const data = await response.json();
    return data.access_token;
  }

  // Client credentials flow
  const params = new URLSearchParams({
    client_id: env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }
  );
  if (!response.ok) throw new Error(`Token error: ${await response.text()}`);
  const data = await response.json();
  return data.access_token;
}

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;

  if (!env?.AZURE_TENANT_ID || !env?.AZURE_CLIENT_ID) {
    return new Response(JSON.stringify({
      unreadCount: 0, bouncedCount: 0, owaLink: OWA_LINK,
      error: 'Email not configured',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const token = await getGraphToken(env);

    // Determine which user to query - service account reads shared mailbox
    const mailUser = env.AZURE_SERVICE_USER || SHARED_MAILBOX;

    // Get unread count from inbox
    const unreadResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${mailUser}/mailFolders/inbox?$select=unreadItemCount,totalItemCount`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    let unreadCount = 0;
    if (unreadResponse.ok) {
      const folder = await unreadResponse.json();
      unreadCount = folder.unreadItemCount || 0;
    }

    // Search for bounced/undeliverable messages
    const bounceFilter = encodeURIComponent(
      "subject eq 'Undeliverable' or startswith(subject, 'Undeliverable:') or startswith(subject, 'Delivery Status') or startswith(subject, 'Mail Delivery Failed') or startswith(subject, 'Returned mail')"
    );
    const bounceResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${mailUser}/mailFolders/inbox/messages?$filter=${bounceFilter}&$count=true&$top=1&$select=id`,
      { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } }
    );

    let bouncedCount = 0;
    if (bounceResponse.ok) {
      const bounceData = await bounceResponse.json();
      bouncedCount = bounceData['@odata.count'] || bounceData.value?.length || 0;
    }

    return new Response(JSON.stringify({
      unreadCount,
      bouncedCount,
      owaLink: OWA_LINK,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      unreadCount: 0, bouncedCount: 0, owaLink: OWA_LINK,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};
