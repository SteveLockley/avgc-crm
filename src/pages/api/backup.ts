/**
 * Database Backup API Endpoint
 * Exports the database and uploads to SharePoint
 *
 * Trigger manually: POST /api/backup with Authorization header
 * Or use external cron service (e.g., cron-job.org)
 */

import type { APIContext } from 'astro';

const SHAREPOINT_SITE = 'alnmouthvillagegolf.sharepoint.com';
const SHAREPOINT_SITE_PATH = '/sites/IT';
const BACKUP_FOLDER = '/Backups';

export async function POST({ locals }: APIContext) {
  const env = locals.runtime.env;
  const db = env.DB;

  // Restrict to specific admin users only
  const BACKUP_ADMINS = ['admin@alnmouthvillage.golf', 'steve.lockley@alnmouthvillage.golf'];
  const userEmail = locals.user?.email?.toLowerCase() || '';
  const isAuthorized = BACKUP_ADMINS.includes(userEmail);

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    console.log('Starting database backup...');

    // 1. Export database tables
    const backupData = await exportDatabase(db);

    // 2. Get Microsoft Graph access token
    const accessToken = await getMicrosoftAccessToken(env);

    // 3. Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `avgc-backup-${timestamp}.json`;

    // 4. Upload to SharePoint
    await uploadToSharePoint(accessToken, filename, backupData);

    console.log(`Backup completed: ${filename}`);

    return new Response(JSON.stringify({
      success: true,
      filename,
      size: new Blob([backupData]).size,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Backup failed:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Backup failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Also allow GET for easy browser testing (still requires auth)
export async function GET(context: APIContext) {
  return POST(context);
}

async function exportDatabase(db: D1Database): Promise<string> {
  // Get all table names (excluding SQLite system tables and FTS shadow tables)
  const tablesResult = await db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '_cf_%'
    AND name NOT LIKE '%_content'
    AND name NOT LIKE '%_segments'
    AND name NOT LIKE '%_segdir'
    AND name NOT LIKE '%_docsize'
    AND name NOT LIKE '%_stat'
    AND name NOT LIKE '%_config'
    AND name NOT LIKE '%_data'
    AND name NOT LIKE '%_idx'
    ORDER BY name
  `).all();

  const tables = tablesResult.results?.map((r: any) => r.name) || [];
  const backup: Record<string, any> = {
    metadata: {
      exportedAt: new Date().toISOString(),
      tables: tables,
      version: '1.0'
    },
    data: {}
  };

  // Export each table
  for (const table of tables) {
    try {
      const data = await db.prepare(`SELECT * FROM "${table}"`).all();
      backup.data[table] = data.results || [];
      console.log(`Exported ${table}: ${backup.data[table].length} rows`);
    } catch (error) {
      console.error(`Error exporting ${table}:`, error);
      backup.data[table] = { error: error instanceof Error ? error.message : 'Export failed' };
    }
  }

  return JSON.stringify(backup, null, 2);
}

async function getMicrosoftAccessToken(env: any): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
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

  // Decode token to check permissions (JWT is base64)
  try {
    const tokenParts = data.access_token.split('.');
    const payload = JSON.parse(atob(tokenParts[1]));
    console.log('Token roles:', payload.roles);
    console.log('Token audience:', payload.aud);

    // If no roles, the app permissions aren't granted
    if (!payload.roles || payload.roles.length === 0) {
      throw new Error('No application permissions found in token. Go to Azure Portal > App registrations > Your app > API permissions > Add "Sites.ReadWrite.All" as APPLICATION permission (not Delegated) > Click "Grant admin consent"');
    }

    // Check for Sites permission
    const hasSitesPermission = payload.roles.some((r: string) => r.includes('Sites'));
    if (!hasSitesPermission) {
      throw new Error(`Token has roles [${payload.roles.join(', ')}] but no Sites permission. Add Sites.ReadWrite.All as APPLICATION permission and grant admin consent.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('permission')) {
      throw e;
    }
    console.log('Could not decode token for debugging');
  }

  console.log('Access token obtained successfully');
  return data.access_token;
}

async function uploadToSharePoint(accessToken: string, filename: string, content: string): Promise<void> {
  // First, get the site ID using the hostname and site path
  // Format: /sites/{hostname}:/sites/{sitename}
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:${SHAREPOINT_SITE_PATH}`;
  console.log('Looking up site:', siteUrl);

  const siteResponse = await fetch(siteUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!siteResponse.ok) {
    const errorText = await siteResponse.text();
    console.error('Site lookup failed:', siteResponse.status, errorText);

    // Try alternative: list all sites to help debug
    const sitesResponse = await fetch('https://graph.microsoft.com/v1.0/sites?search=*', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (sitesResponse.ok) {
      const sitesData = await sitesResponse.json() as { value: Array<{ name: string; webUrl: string }> };
      const siteNames = sitesData.value?.map(s => `${s.name}: ${s.webUrl}`).join(', ') || 'none found';
      throw new Error(`Site not found. Available sites: ${siteNames}. Check Sites.Read.All permission.`);
    }

    throw new Error(`Failed to get SharePoint site (${siteResponse.status}). Ensure Azure App has Sites.Read.All and Sites.ReadWrite.All permissions.`);
  }

  const siteData = await siteResponse.json() as { id: string };
  const siteId = siteData.id;
  console.log('Found site ID:', siteId);

  // Upload file to the Backups folder in the default document library
  const uploadPath = `${BACKUP_FOLDER}/${filename}`.replace(/^\//, '');
  const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${uploadPath}:/content`;
  console.log('Uploading to:', uploadPath);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: content,
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Failed to upload to SharePoint: ${error}`);
  }

  console.log(`File uploaded to SharePoint: ${uploadPath}`);
}
