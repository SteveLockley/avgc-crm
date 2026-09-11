/**
 * Online accounts API — runs the real route handler against a SQLite-backed D1
 * shim with the real migrations applied. Sage is not involved: everything here
 * is local (save, credentials, permission gate, push proposal, delete).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { POST } from '../src/pages/api/admin/online-accounts';
import { POST as PERMS } from '../src/pages/api/admin/permissions';

// Strict D1 shim: SQL errors throw (so a bad statement fails the test) and
// last_row_id is reported like D1 does.
function wrapDatabase(db: Database.Database) {
  const prep = (query: string) => {
    const stmt = db.prepare(query);
    let bound: unknown[] = [];
    const api = {
      bind(...values: unknown[]) { bound = values; return api; },
      first<T>() { return (stmt.get(...bound) as T) ?? null; },
      all<T>() { return { results: stmt.all(...bound) as T[], success: true, meta: { changes: 0 } }; },
      run() {
        const r = stmt.run(...bound);
        return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
      },
    };
    return api;
  };
  return {
    prepare: prep,
    batch: async (stmts: any[]) => stmts.map(s => s.run()),
  };
}

const KEY = Buffer.alloc(32, 3).toString('base64');
let db: ReturnType<typeof wrapDatabase>;
let raw: Database.Database;

function call(handler: any, actor: string, body: unknown) {
  const request = new Request('http://localhost/api/admin/online-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const locals = { runtime: { env: { DB: db, ACCOUNTS_VAULT_KEY: KEY } }, user: { email: actor, name: 'x', role: 'admin' } };
  return handler({ request, locals } as any).then(async (res: Response) => ({ status: res.status, json: await res.json() as any }));
}

beforeAll(() => {
  raw = new Database(':memory:');
  for (const f of ['001_initial', '051_sage', '063_permission_groups', '064_sage_change_sets', '067_online_accounts']) {
    raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', `${f}.sql`), 'utf8'));
  }
  db = wrapDatabase(raw);
});

const STEVE = 'steve.lockley@AlnmouthVillage.Golf';   // mixed case, as Access returns it
const OTHER = 'someone.else@alnmouthvillage.golf';

describe('online accounts API', () => {
  let id: number;

  it('seeds the energy suppliers and the credential holders', () => {
    const names = raw.prepare('SELECT name FROM online_accounts ORDER BY name').all().map((r: any) => r.name);
    expect(names).toEqual(['Corona Energy', 'Crown Gas & Power', 'TotalEnergies Gas & Power Limited']);
    const holders = raw.prepare('SELECT email FROM admin_permission_groups ORDER BY email').all().map((r: any) => r.email);
    expect(holders).toContain('steve.lockley@alnmouthvillage.golf');
    expect(holders).toContain('treasurer@alnmouthvillage.golf');
  });

  it('creates an account with credentials for a holder', async () => {
    const r = await call(POST, STEVE, {
      action: 'save',
      account: { name: 'Anglian Water', account_type: 'water', description: 'Clubhouse water', login_url: 'https://my.anglianwater.co.uk/', reference: 'AW-1' },
      credentials: { login_id: 'clubhouse@avgc', password: 'Tr0ub4dor&3' },
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    id = r.json.id;
    const row = raw.prepare('SELECT * FROM online_accounts WHERE id = ?').get(id) as any;
    expect(row.login_id_enc).toMatch(/^v1:/);
    expect(row.password_enc).toMatch(/^v1:/);
    expect(row.password_enc).not.toContain('Tr0ub4dor');
    expect(row.credentials_updated_by).toBe(STEVE);
  });

  it('refuses credentials from a non-holder but lets them edit the rest', async () => {
    const denied = await call(POST, OTHER, {
      action: 'save', account: { id, name: 'Anglian Water', account_type: 'water' }, credentials: { login_id: 'x', password: 'y' },
    });
    expect(denied.status).toBe(403);

    const ok = await call(POST, OTHER, {
      action: 'save', account: { id, name: 'Anglian Water', account_type: 'water', description: 'Clubhouse and greenkeepers water' },
    });
    expect(ok.status).toBe(200);
    const row = raw.prepare('SELECT description, login_id_enc FROM online_accounts WHERE id = ?').get(id) as any;
    expect(row.description).toBe('Clubhouse and greenkeepers water');
    expect(row.login_id_enc).toMatch(/^v1:/);          // untouched
  });

  it('reveals only to holders and logs it', async () => {
    const denied = await call(POST, OTHER, { action: 'reveal', id });
    expect(denied.status).toBe(403);

    const r = await call(POST, STEVE, { action: 'reveal', id });
    expect(r.status).toBe(200);
    expect(r.json.login_id).toBe('clubhouse@avgc');
    expect(r.json.password).toBe('Tr0ub4dor&3');

    const log = raw.prepare(`SELECT user_email, action FROM audit_log WHERE action = 'online_account_credentials_revealed'`).all() as any[];
    expect(log).toHaveLength(1);
    expect(log[0].user_email).toBe(STEVE);
  });

  it('keeps the stored password when only the login id is resent', async () => {
    const r = await call(POST, STEVE, {
      action: 'save', account: { id, name: 'Anglian Water', account_type: 'water' }, credentials: { login_id: 'newlogin' },
    });
    expect(r.status).toBe(200);
    const rev = await call(POST, STEVE, { action: 'reveal', id });
    expect(rev.json.login_id).toBe('newlogin');
    expect(rev.json.password).toBe('Tr0ub4dor&3');
  });

  it('proposes a create change set for an unlinked account', async () => {
    const r = await call(POST, STEVE, { action: 'push', id });
    expect(r.status).toBe(200);
    expect(r.json.action).toBe('create');
    const change = raw.prepare('SELECT * FROM sage_change WHERE change_set_id = ?').get(r.json.setId) as any;
    expect(change.action).toBe('create');
    const payload = JSON.parse(change.payload_json);
    expect(payload.name).toBe('Anglian Water');
    expect(payload.contact_type_ids).toEqual(['VENDOR']);
    expect(payload.reference).toBe('AW-1');
    const row = raw.prepare('SELECT last_change_set_id FROM online_accounts WHERE id = ?').get(id) as any;
    expect(row.last_change_set_id).toBe(r.json.setId);
  });

  it('marks mirrored edits as pending only when they differ from the last pull', async () => {
    // Simulate a linked, freshly pulled row.
    const pulled = { name: 'Anglian Water', reference: 'AW-1', email: null, telephone: null, mobile: null, website: null,
      address_line_1: null, address_line_2: null, city: null, region: null, postal_code: null, sage_notes: null, sage_ledger_account_id: null };
    raw.prepare(`UPDATE online_accounts SET sage_contact_id = 'sage-1', pulled_json = ?, local_changed_at = NULL, email = NULL, telephone = NULL, mobile = NULL, website = NULL WHERE id = ?`)
      .run(JSON.stringify(pulled), id);

    const same = await call(POST, STEVE, { action: 'save', account: { id, name: 'Anglian Water', account_type: 'water', reference: 'AW-1', description: 'local only change' } });
    expect(same.json.pending).toBe(false);
    expect((raw.prepare('SELECT local_changed_at FROM online_accounts WHERE id = ?').get(id) as any).local_changed_at).toBeNull();

    const diff = await call(POST, STEVE, { action: 'save', account: { id, name: 'Anglian Water', account_type: 'water', reference: 'AW-1', email: 'bills@anglianwater.co.uk' } });
    expect(diff.json.pending).toBe(true);
    expect((raw.prepare('SELECT local_changed_at FROM online_accounts WHERE id = ?').get(id) as any).local_changed_at).not.toBeNull();

    const push = await call(POST, STEVE, { action: 'push', id });
    expect(push.json.action).toBe('update');
    expect(push.json.fields).toEqual(['email']);
    const change = raw.prepare('SELECT payload_json, sage_id FROM sage_change WHERE change_set_id = ?').get(push.json.setId) as any;
    expect(JSON.parse(change.payload_json)).toEqual({ email: 'bills@anglianwater.co.uk' });
    expect(change.sage_id).toBe('sage-1');
  });

  it('deletes and logs', async () => {
    const r = await call(POST, OTHER, { action: 'delete', id });
    expect(r.status).toBe(200);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM online_accounts WHERE id = ?').get(id)).toEqual({ n: 0 });
  });
});

describe('credential group administration', () => {
  it('lets a holder add and remove, but not remove themselves', async () => {
    const add = await call(PERMS, STEVE, { action: 'set-admin-group', groupKey: 'account_credentials', email: 'New.Person@AlnmouthVillage.Golf', value: true });
    expect(add.status).toBe(200);
    expect(raw.prepare(`SELECT email FROM admin_permission_groups WHERE email = 'new.person@alnmouthvillage.golf'`).get()).toBeTruthy();

    const self = await call(PERMS, STEVE, { action: 'set-admin-group', groupKey: 'account_credentials', email: STEVE, value: false });
    expect(self.status).toBe(400);

    const rm = await call(PERMS, STEVE, { action: 'set-admin-group', groupKey: 'account_credentials', email: 'new.person@alnmouthvillage.golf', value: false });
    expect(rm.status).toBe(200);
    expect(raw.prepare(`SELECT email FROM admin_permission_groups WHERE email = 'new.person@alnmouthvillage.golf'`).get()).toBeFalsy();
  });
});
