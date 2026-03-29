/**
 * Image proxy — serves images stored in SharePoint via Microsoft Graph API.
 * GET /api/image/{itemId}
 * Returns the image binary with correct content-type, cacheable for 7 days.
 */

import type { APIContext } from 'astro';

const SHAREPOINT_SITE = 'alnmouthvillagegolf.sharepoint.com';
const SHAREPOINT_SITE_PATH = '/sites/IT';

async function getAccessToken(env: any): Promise<string> {
  const response = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.AZURE_CLIENT_ID,
        client_secret: env.AZURE_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  );
  if (!response.ok) throw new Error('Auth failed');
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function getSiteId(accessToken: string): Promise<string> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:${SHAREPOINT_SITE_PATH}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error('Site not found');
  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function GET({ params, locals }: APIContext) {
  const env = locals.runtime.env;
  const itemId = params.id;

  if (!itemId) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const accessToken = await getAccessToken(env);
    const siteId = await getSiteId(accessToken);

    // Get the file content
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/content`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      return new Response('Image not found', { status: 404 });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const body = await response.arrayBuffer();

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800', // 7 days
      },
    });
  } catch {
    return new Response('Failed to load image', { status: 500 });
  }
}
