/**
 * Document Upload API Endpoint
 * Uploads files to SharePoint, converts Office docs to PDF, creates sharing links
 */

import type { APIContext } from 'astro';

const SHAREPOINT_SITE = 'alnmouthvillagegolf.sharepoint.com';
const SHAREPOINT_SITE_PATH = '/sites/IT';
const DOCUMENTS_FOLDER = '/Club Documents';

const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.xlsm',
  '.ppt', '.pptx', '.ppsx', '.pps',
  '.odt', '.ods', '.odp', '.rtf'
]);

function isPdf(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf');
}

function isOfficeDoc(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return OFFICE_EXTENSIONS.has(ext);
}

function formatDateForFilename(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function generateFilename(category: string, title: string, dateStr: string): string {
  if (category === 'AGM') {
    return `AGM Minutes - ${formatDateForFilename(dateStr)}.pdf`;
  } else if (category === 'Committee') {
    return `Committee Minutes - ${formatDateForFilename(dateStr)}.pdf`;
  } else {
    // General: use the provided title, sanitise for filesystem
    const sanitised = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    return `${sanitised}.pdf`;
  }
}

async function getMicrosoftAccessToken(env: any): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.AZURE_CLIENT_ID,
      client_secret: env.AZURE_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

async function getSharePointSiteId(accessToken: string): Promise<string> {
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:${SHAREPOINT_SITE_PATH}`;
  const response = await fetch(siteUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to find SharePoint site (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { id: string };
  return data.id;
}

async function uploadFileToSharePoint(
  accessToken: string,
  siteId: string,
  folderPath: string,
  filename: string,
  content: ArrayBuffer,
  contentType: string
): Promise<{ id: string; webUrl: string }> {
  const uploadPath = `${folderPath}/${filename}`.replace(/^\//, '');
  const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${uploadPath}:/content`;

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': contentType,
    },
    body: content,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload to SharePoint: ${error}`);
  }

  const data = await response.json() as { id: string; webUrl: string };
  return { id: data.id, webUrl: data.webUrl };
}

async function convertToPdf(
  accessToken: string,
  siteId: string,
  itemId: string
): Promise<ArrayBuffer> {
  const convertUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/content?format=pdf`;

  const response = await fetch(convertUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to convert to PDF: ${error}`);
  }

  return response.arrayBuffer();
}

async function deleteSharePointItem(
  accessToken: string,
  siteId: string,
  itemId: string
): Promise<void> {
  const deleteUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}`;

  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 204) {
    console.error('Failed to delete original file:', await response.text());
  }
}

async function createSharingLink(
  accessToken: string,
  siteId: string,
  itemId: string
): Promise<string> {
  const linkUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/createLink`;

  const response = await fetch(linkUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'view',
      scope: 'anonymous',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn('Could not create anonymous sharing link:', errorText);
    // Fall back: try organization scope
    const orgResponse = await fetch(linkUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'view',
        scope: 'organization',
      }),
    });

    if (orgResponse.ok) {
      const orgData = await orgResponse.json() as { link: { webUrl: string } };
      return orgData.link.webUrl;
    }

    // Last resort: return the item's webUrl
    console.warn('Falling back to item webUrl');
    return '';
  }

  const data = await response.json() as { link: { webUrl: string } };
  return data.link.webUrl;
}

export async function POST({ locals, request }: APIContext) {
  const env = locals.runtime.env;

  // Verify admin auth
  if (!locals.user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const category = formData.get('category')?.toString() || '';
    const title = formData.get('title')?.toString() || '';
    const documentDate = formData.get('document_date')?.toString() || '';

    if (!file || !category || !documentDate) {
      return new Response(JSON.stringify({ error: 'File, category, and date are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (category === 'General' && !title) {
      return new Response(JSON.stringify({ error: 'Title is required for General documents' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const originalFilename = file.name;
    const targetFilename = generateFilename(category, title, documentDate);
    const folderPath = `${DOCUMENTS_FOLDER}/${category}`;

    console.log(`Uploading document: ${originalFilename} → ${folderPath}/${targetFilename}`);

    // Get Microsoft Graph token
    const accessToken = await getMicrosoftAccessToken(env);
    const siteId = await getSharePointSiteId(accessToken);

    const fileBuffer = await file.arrayBuffer();
    let finalItemId: string;
    let finalWebUrl: string;

    if (isPdf(originalFilename)) {
      // Direct PDF upload with the target filename
      const result = await uploadFileToSharePoint(
        accessToken, siteId, folderPath, targetFilename,
        fileBuffer, 'application/pdf'
      );
      finalItemId = result.id;
      finalWebUrl = result.webUrl;
    } else if (isOfficeDoc(originalFilename)) {
      // Upload original Office file first (with original extension for conversion)
      const tempFilename = `_temp_${Date.now()}_${originalFilename}`;
      const uploadResult = await uploadFileToSharePoint(
        accessToken, siteId, folderPath, tempFilename,
        fileBuffer, file.type || 'application/octet-stream'
      );

      // Convert to PDF
      console.log('Converting to PDF...');
      const pdfBuffer = await convertToPdf(accessToken, siteId, uploadResult.id);

      // Upload the PDF with the target filename
      const pdfResult = await uploadFileToSharePoint(
        accessToken, siteId, folderPath, targetFilename,
        pdfBuffer, 'application/pdf'
      );
      finalItemId = pdfResult.id;
      finalWebUrl = pdfResult.webUrl;

      // Delete the temporary original file
      await deleteSharePointItem(accessToken, siteId, uploadResult.id);
      console.log('Original Office file deleted, PDF saved.');
    } else {
      return new Response(JSON.stringify({
        error: `Unsupported file type: ${originalFilename}. Please upload a PDF or Microsoft Office document.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create sharing link
    const sharingUrl = await createSharingLink(accessToken, siteId, finalItemId);
    const documentUrl = sharingUrl || finalWebUrl;

    console.log(`Document uploaded successfully: ${documentUrl}`);

    return new Response(JSON.stringify({
      success: true,
      url: documentUrl,
      filename: targetFilename,
      folder: folderPath,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Upload failed:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Upload failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
