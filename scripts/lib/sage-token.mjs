// Sage access token for local scripts, from the connection stored in D1
// (same approach as scripts/weekly-receipts-report.mjs). Refreshing rotates the
// refresh token, so the new one is written straight back.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SAGE_API = 'https://api.accounting.sage.com/v3.1';

export function loadDevVars() {
  const file = path.join(REPO, '.dev.vars');
  const out = { ...process.env };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m && !(m[1] in process.env)) out[m[1]] = m[2];
  }
  return out;
}

export function d1(sql) {
  const raw = execSync(
    `npx wrangler d1 execute alnmouth-golf-db --remote --json --command=${JSON.stringify(sql)} 2>/dev/null`,
    { encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(raw)[0].results;
}

export async function getSageToken(role = 'live') {
  const vars = loadDevVars();
  const row = d1(`SELECT * FROM sage_tokens WHERE role='${role}' ORDER BY id LIMIT 1`)[0];
  if (!row) throw new Error(`No Sage connection stored for role "${role}"`);
  if (Date.now() < new Date(row.token_expires_at).getTime() - 60000) return row.access_token;

  const res = await fetch('https://oauth.accounting.sage.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: row.refresh_token,
      client_id: vars.SAGE_CLIENT_ID, client_secret: vars.SAGE_CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Sage token refresh failed: ${await res.text()}`);
  const td = await res.json();
  const exp = new Date(Date.now() + td.expires_in * 1000).toISOString();
  const rexp = new Date(Date.now() + (td.refresh_token_expires_in || 2678400) * 1000).toISOString();
  const q = s => s.replace(/'/g, "''");
  d1(`UPDATE sage_tokens SET access_token='${q(td.access_token)}', refresh_token='${q(td.refresh_token)}', token_expires_at='${exp}', refresh_token_expires_at='${rexp}', updated_at=datetime('now') WHERE id=${row.id}`);
  return td.access_token;
}

export async function sageGetAll(token, apiPath, params = {}) {
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const url = new URL(`${SAGE_API}${apiPath}`);
    url.searchParams.set('items_per_page', '200');
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Sage GET ${apiPath} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    items.push(...(data.$items ?? []));
    if (!data.$next) break;
  }
  return items;
}
