/**
 * Upload images/documents for use in member emails.
 * Uploads to SharePoint /Club Documents/Email Assets/ and returns a sharing URL.
 * Images are uploaded as-is; Office docs are converted to PDF.
 */

import type { APIContext } from 'astro';

const SHAREPOINT_SITE = 'alnmouthvillagegolf.sharepoint.com';
const SHAREPOINT_SITE_PATH = '/sites/IT';
const UPLOAD_FOLDER = '/Club Documents/Email Assets';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.xlsm',
  '.ppt', '.pptx', '.ppsx', '.pps',
  '.odt', '.ods', '.odp', '.rtf',
]);

function getExtension(filename: string): string {
  return filename.toLowerCase().slice(filename.lastIndexOf('.'));
}

async function getMicrosoftAccessToken(env: any): Promise<string> {
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
  if (!response.ok) throw new Error(`Failed to get access token: ${await response.text()}`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function getSharePointSiteId(accessToken: string): Promise<string> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:${SHAREPOINT_SITE_PATH}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`Failed to find SharePoint site: ${await response.text()}`);
  const data = (await response.json()) as { id: string };
  return data.id;
}

async function uploadFile(
  accessToken: string,
  siteId: string,
  folder: string,
  filename: string,
  content: ArrayBuffer,
  contentType: string
): Promise<{ id: string; webUrl: string }> {
  const path = `${folder}/${filename}`.replace(/^\//, '');
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${path}:/content`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentType },
      body: content,
    }
  );
  if (!response.ok) throw new Error(`Failed to upload: ${await response.text()}`);
  const data = (await response.json()) as { id: string; webUrl: string };
  return { id: data.id, webUrl: data.webUrl };
}

async function convertToPdf(accessToken: string, siteId: string, itemId: string): Promise<ArrayBuffer> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/content?format=pdf`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`Failed to convert to PDF: ${await response.text()}`);
  return response.arrayBuffer();
}

async function deleteItem(accessToken: string, siteId: string, itemId: string): Promise<void> {
  await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}


async function createSharingLink(accessToken: string, siteId: string, itemId: string): Promise<string> {
  const linkUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/createLink`;

  const response = await fetch(linkUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
  });

  if (response.ok) {
    const data = (await response.json()) as { link: { webUrl: string } };
    return data.link.webUrl;
  }

  // Fall back to organization scope
  const orgResponse = await fetch(linkUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'view', scope: 'organization' }),
  });

  if (orgResponse.ok) {
    const data = (await orgResponse.json()) as { link: { webUrl: string } };
    return data.link.webUrl;
  }

  return '';
}

export async function POST({ locals, request }: APIContext) {
  const env = locals.runtime.env;

  if (!locals.user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ext = getExtension(file.name);
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const isOffice = OFFICE_EXTENSIONS.has(ext);
    const isPdf = ext === '.pdf';

    if (!isImage && !isOffice && !isPdf) {
      return new Response(
        JSON.stringify({
          error: `Unsupported file type: ${ext}. Use images (jpg, png, gif, webp) or documents (pdf, docx, xlsx, pptx).`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate a unique-ish filename to avoid collisions
    const timestamp = Date.now();
    const sanitised = file.name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-');
    const targetFilename = isImage || isPdf
      ? `${timestamp}_${sanitised}`
      : `${timestamp}_${sanitised.replace(/\.[^.]+$/, '.pdf')}`;

    const accessToken = await getMicrosoftAccessToken(env);
    const siteId = await getSharePointSiteId(accessToken);
    const fileBuffer = await file.arrayBuffer();

    let finalItemId: string;
    let finalWebUrl: string;

    if (isImage || isPdf) {
      // Upload directly
      const result = await uploadFile(
        accessToken, siteId, UPLOAD_FOLDER, targetFilename,
        fileBuffer, file.type || 'application/octet-stream'
      );
      finalItemId = result.id;
      finalWebUrl = result.webUrl;
    } else {
      // Office doc: upload temp → convert to PDF → upload PDF → delete temp
      const tempFilename = `_temp_${timestamp}_${file.name}`;
      const uploadResult = await uploadFile(
        accessToken, siteId, UPLOAD_FOLDER, tempFilename,
        fileBuffer, file.type || 'application/octet-stream'
      );
      const pdfBuffer = await convertToPdf(accessToken, siteId, uploadResult.id);
      const pdfResult = await uploadFile(
        accessToken, siteId, UPLOAD_FOLDER, targetFilename,
        pdfBuffer, 'application/pdf'
      );
      finalItemId = pdfResult.id;
      finalWebUrl = pdfResult.webUrl;
      await deleteItem(accessToken, siteId, uploadResult.id);
    }

    // Use public domain proxy URLs — the CRM domain is behind Cloudflare Access so
    // SharePoint sharing links and direct URLs won't be accessible to email recipients.
    const url = isImage
      ? `https://www.alnmouthvillage.golf/api/image/${finalItemId}`
      : `https://www.alnmouthvillage.golf/api/document/${finalItemId}`;

    return new Response(
      JSON.stringify({ success: true, url, imageUrl: url, filename: targetFilename, isImage }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Email asset upload failed:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Upload failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
