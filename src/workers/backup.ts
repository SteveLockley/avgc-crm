/**
 * D1 Database Backup Worker
 * Exports the database and uploads to SharePoint weekly
 */

interface Env {
  DB: D1Database;
  BACKUP_TENANT_ID: string;
  BACKUP_CLIENT_ID: string;
  BACKUP_CLIENT_SECRET: string;
}

const SHAREPOINT_SITE = 'alnmouthvillagegolf.sharepoint.com';
const SHAREPOINT_SITE_PATH = '/sites/IT';
const BACKUP_FOLDER = '/Backups';

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(performBackup(env));
  },

  // Allow manual trigger via HTTP for testing
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/backup' && request.method === 'POST') {
      // Check for authorization header for manual triggers
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response('Unauthorized', { status: 401 });
      }

      try {
        const result = await performBackup(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function performBackup(env: Env): Promise<{ success: boolean; filename: string; size: number }> {
  console.log('Starting database backup...');

  // 1. Export database tables
  const backupData = await exportDatabase(env.DB);

  // 2. Get Microsoft Graph access token
  const accessToken = await getMicrosoftAccessToken(env);

  // 3. Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `avgc-backup-${timestamp}.json`;

  // 4. Upload to SharePoint
  await uploadToSharePoint(accessToken, filename, backupData);

  console.log(`Backup completed: ${filename}`);

  return {
    success: true,
    filename,
    size: new Blob([backupData]).size
  };
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

async function getMicrosoftAccessToken(env: Env): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${env.BACKUP_TENANT_ID}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.BACKUP_CLIENT_ID,
      client_secret: env.BACKUP_CLIENT_SECRET,
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

async function uploadToSharePoint(accessToken: string, filename: string, content: string): Promise<void> {
  // First, get the site ID
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:${SHAREPOINT_SITE_PATH}`;

  const siteResponse = await fetch(siteUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!siteResponse.ok) {
    const error = await siteResponse.text();
    throw new Error(`Failed to get SharePoint site: ${error}`);
  }

  const siteData = await siteResponse.json() as { id: string };
  const siteId = siteData.id;

  // Upload file to the Backups folder in the default document library
  // Using the simple upload endpoint (for files < 4MB)
  const uploadPath = `${BACKUP_FOLDER}/${filename}`.replace(/^\//, '');
  const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${uploadPath}:/content`;

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
