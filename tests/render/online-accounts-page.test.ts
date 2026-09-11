import { describe, it, expect, beforeAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import Page from '../../src/pages/admin/accounts/index.astro';
import Permissions from '../../src/pages/admin/permissions.astro';

function wrapDatabase(db: Database.Database) {
  const prep = (query: string) => {
    const stmt = db.prepare(query);
    let bound: unknown[] = [];
    const api = {
      bind(...values: unknown[]) { bound = values; return api; },
      first<T>() { return (stmt.get(...bound) as T) ?? null; },
      all<T>() { return { results: stmt.all(...bound) as T[], success: true, meta: { changes: 0 } }; },
      run() { const r = stmt.run(...bound); return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    };
    return api;
  };
  return { prepare: prep, batch: async (stmts: any[]) => stmts.map(s => s.run()) };
}

let db: any;
beforeAll(() => {
  const raw = new Database(':memory:');
  for (const f of ['001_initial', '051_sage', '063_permission_groups', '064_sage_change_sets', '067_online_accounts']) {
    raw.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', `${f}.sql`), 'utf8'));
  }
  raw.prepare(`INSERT INTO sage_tokens (sage_business_id, access_token, refresh_token, token_expires_at, refresh_token_expires_at, role) VALUES ('b', 'a', 'r', '2030-01-01', '2030-01-01', 'live')`).run();
  raw.prepare(`UPDATE online_accounts SET sage_contact_id = 'c1', sage_web_url = 'https://accounts-extra.sageone.com/contacts/suppliers/1', sage_ledger_account_name = 'Electricity (7200)', bills_ytd = 1234.5, payments_ytd = 1200, bills_total = 9999, payments_total = 9000, totals_fy_start = '2026-01-01', totals_synced_at = datetime('now'), login_id_enc = 'v1:x:y' WHERE id = 1`).run();
  db = wrapDatabase(raw);
});

async function render(Component: any, email: string) {
  const container = await AstroContainer.create();
  return container.renderToString(Component, {
    request: new Request('http://localhost/admin/accounts'),
    locals: { runtime: { env: { DB: db, ACCOUNTS_VAULT_KEY: Buffer.alloc(32, 1).toString('base64') } }, user: { email, name: 'T', role: 'admin' } },
  });
}

describe('online accounts page', () => {
  it('renders for a credential holder', async () => {
    const html = await render(Page, 'steve.lockley@AlnmouthVillage.Golf');
    expect(html).toContain('TotalEnergies Gas &amp; Power Limited');
    expect(html).toContain('Open in Sage');
    expect(html).toContain('Electricity (7200)');
    expect(html).toContain('btn-secondary reveal-btn');   // holder sees Reveal
    expect(html).toContain('£1,235');                 // bills ytd, rounded
    expect(html).toContain('Login details');          // credentials section in form
    expect(html).not.toContain('v1:x:y');             // ciphertext never reaches the page
    expect(html).toContain('"canSeeCredentials":true');
  });

  it('hides credentials from everyone else', async () => {
    const html = await render(Page, 'someone@alnmouthvillage.golf');
    expect(html).toContain('Restricted');
    expect(html).not.toContain('btn-secondary reveal-btn');
    expect(html).not.toContain('name="password"');
    expect(html).toContain('"canSeeCredentials":false');
  });

  it('permissions page shows the credential group', async () => {
    const html = await render(Permissions, 'steve.lockley@AlnmouthVillage.Golf');
    expect(html).toContain('Online account credentials');
    expect(html).toContain('treasurer@alnmouthvillage.golf');
    expect(html).toContain('cred-add-btn');
  });
});
