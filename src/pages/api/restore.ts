/**
 * Database Restore API Endpoint
 * Lists backups from SharePoint and restores selected backup
 */

import type { APIContext } from 'astro';

const SHAREPOINT_SITE = 'alnmouthvillagegolf.sharepoint.com';
const SHAREPOINT_SITE_PATH = '/sites/IT';
const BACKUP_FOLDER = '/Backups';

const RESTORE_ADMINS = ['admin@alnmouthvillage.golf', 'steve.lockley@alnmouthvillage.golf'];

export async function GET({ locals }: APIContext) {
  const env = locals.runtime.env;
  const userEmail = locals.user?.email?.toLowerCase() || '';

  if (!RESTORE_ADMINS.includes(userEmail)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const accessToken = await getMicrosoftAccessToken(env);
    const backups = await listBackups(accessToken);

    return new Response(JSON.stringify({ backups }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to list backups'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function POST({ locals, request }: APIContext) {
  const env = locals.runtime.env;
  const db = env.DB;
  const userEmail = locals.user?.email?.toLowerCase() || '';

  if (!RESTORE_ADMINS.includes(userEmail)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json() as { filename: string; confirm?: boolean };
    const { filename, confirm } = body;

    if (!filename) {
      return new Response(JSON.stringify({ error: 'Filename required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const accessToken = await getMicrosoftAccessToken(env);

    // Download the backup file
    const backupContent = await downloadBackup(accessToken, filename);
    const backup = JSON.parse(backupContent);

    // If not confirmed, return preview
    if (!confirm) {
      const preview: Record<string, number> = {};
      for (const [table, rows] of Object.entries(backup.data)) {
        if (Array.isArray(rows)) {
          preview[table] = rows.length;
        }
      }

      return new Response(JSON.stringify({
        preview: true,
        filename,
        exportedAt: backup.metadata?.exportedAt,
        tables: preview,
        totalRows: Object.values(preview).reduce((a, b) => a + b, 0)
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Perform restore
    console.log('Starting restore from:', filename);

    // Tables to restore in order (respecting foreign keys)
    // First, tables with no dependencies, then tables that reference them
    const tableOrder = [
      'invoice_settings',
      'payment_items',
      'members',
      'invoices',
      'invoice_items',
      'payments',
      'payment_line_items',
      'subscription_history',
      'audit_log'
    ];

    let restored = 0;
    const results: Record<string, { deleted: number; inserted: number }> = {};

    // Process tables in order
    for (const table of tableOrder) {
      if (!backup.data[table] || !Array.isArray(backup.data[table])) continue;

      const rows = backup.data[table];
      if (rows.length === 0) continue;

      try {
        // Delete existing data
        const deleteResult = await db.prepare(`DELETE FROM "${table}"`).run();
        const deleted = deleteResult.meta.changes || 0;

        // Insert new data
        let inserted = 0;
        for (const row of rows) {
          const columns = Object.keys(row).filter(k => row[k] !== null);
          const values = columns.map(k => row[k]);
          const placeholders = columns.map(() => '?').join(', ');

          try {
            await db.prepare(
              `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
            ).bind(...values).run();
            inserted++;
          } catch (e) {
            console.error(`Error inserting into ${table}:`, e);
          }
        }

        results[table] = { deleted, inserted };
        restored += inserted;
        console.log(`Restored ${table}: ${deleted} deleted, ${inserted} inserted`);
      } catch (e) {
        console.error(`Error restoring ${table}:`, e);
        results[table] = { deleted: 0, inserted: 0 };
      }
    }

    // Also restore any tables not in the predefined order
    for (const [table, rows] of Object.entries(backup.data)) {
      if (tableOrder.includes(table)) continue;
      if (!Array.isArray(rows) || rows.length === 0) continue;

      try {
        const deleteResult = await db.prepare(`DELETE FROM "${table}"`).run();
        const deleted = deleteResult.meta.changes || 0;

        let inserted = 0;
        for (const row of rows) {
          const columns = Object.keys(row).filter(k => row[k] !== null);
          const values = columns.map(k => row[k]);
          const placeholders = columns.map(() => '?').join(', ');

          try {
            await db.prepare(
              `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
            ).bind(...values).run();
            inserted++;
          } catch (e) {
            console.error(`Error inserting into ${table}:`, e);
          }
        }

        results[table] = { deleted, inserted };
        restored += inserted;
      } catch (e) {
        console.error(`Error restoring ${table}:`, e);
      }
    }

    // Log the restore action
    await db.prepare(
      `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
       VALUES (?, 'restore', 'database', ?, ?)`
    ).bind(
      userEmail,
      filename,
      JSON.stringify({ results, totalRestored: restored })
    ).run();

    return new Response(JSON.stringify({
      success: true,
      filename,
      totalRestored: restored,
      results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Restore failed:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Restore failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
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
    throw new Error('Failed to get access token');
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

async function listBackups(accessToken: string): Promise<Array<{ name: string; size: number; modified: string }>> {
  // Get site ID
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:${SHAREPOINT_SITE_PATH}`;
  const siteResponse = await fetch(siteUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!siteResponse.ok) {
    throw new Error('Failed to access SharePoint site');
  }

  const siteData = await siteResponse.json() as { id: string };

  // List files in Backups folder
  const folderPath = BACKUP_FOLDER.replace(/^\//, '');
  const listUrl = `https://graph.microsoft.com/v1.0/sites/${siteData.id}/drive/root:/${folderPath}:/children?$orderby=lastModifiedDateTime desc&$top=20`;

  const listResponse = await fetch(listUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!listResponse.ok) {
    const error = await listResponse.text();
    throw new Error(`Failed to list backups: ${error}`);
  }

  const listData = await listResponse.json() as { value: Array<{ name: string; size: number; lastModifiedDateTime: string }> };

  return (listData.value || [])
    .filter(f => f.name.endsWith('.json'))
    .map(f => ({
      name: f.name,
      size: f.size,
      modified: f.lastModifiedDateTime
    }));
}

async function downloadBackup(accessToken: string, filename: string): Promise<string> {
  // Get site ID
  const siteUrl = `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE}:${SHAREPOINT_SITE_PATH}`;
  const siteResponse = await fetch(siteUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!siteResponse.ok) {
    throw new Error('Failed to access SharePoint site');
  }

  const siteData = await siteResponse.json() as { id: string };

  // Download file
  const filePath = `${BACKUP_FOLDER}/${filename}`.replace(/^\//, '');
  const downloadUrl = `https://graph.microsoft.com/v1.0/sites/${siteData.id}/drive/root:/${filePath}:/content`;

  const downloadResponse = await fetch(downloadUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!downloadResponse.ok) {
    throw new Error(`Failed to download backup: ${filename}`);
  }

  return await downloadResponse.text();
}
