import type { APIRoute } from 'astro';
import { CAPABILITIES, adminHasCapability } from '@/lib/permissions';
import { encryptSecret, decryptSecret, isVaultConfigured } from '@/lib/vault';
import {
  ACCOUNT_TYPES, MIRRORED_FIELDS, mirrorFromRow, changedSince,
  pullAccountFromSage, proposeAccountPush, refreshAccountTotals, searchSageContacts,
  reconcileAppliedChangeSets,
} from '@/lib/online-accounts';

/**
 * Online accounts register.
 * POST /api/admin/online-accounts
 *   { action: 'save', account: {...}, credentials?: { login_id, password } }
 *   { action: 'delete', id }
 *   { action: 'reveal', id }                       — decrypts credentials (accounts.credentials only)
 *   { action: 'search-contacts', q }               — live search of Sage contacts, for linking
 *   { action: 'link', id, sageContactId }          — link to a Sage contact and pull it
 *   { action: 'unlink', id }
 *   { action: 'pull', id }                         — Sage -> CRM
 *   { action: 'push', id }                         — CRM -> Sage, as a change set for review
 *   { action: 'refresh-totals', id }               — bills & payments from Sage
 *   { action: 'reconcile' }                        — pick up change sets applied to live
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env as any;
  const db: D1Database | undefined = env?.DB;
  if (!db) return json({ error: 'Not configured' }, 500);

  const user = locals.user;
  if (!user && !import.meta.env.DEV) return json({ error: 'Not authorised' }, 403);
  const actor = user?.email || 'dev@alnmouthvillage.golf';

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = String(body?.action || '');
  const id = Number(body?.id) || 0;
  const canSeeCredentials = () => adminHasCapability(db, actor, CAPABILITIES.ACCOUNT_CREDENTIALS);

  try {
    // ── Save ────────────────────────────────────────────────────────
    if (action === 'save') {
      const a = body.account || {};
      const name = str(a.name);
      if (!name) return json({ error: 'A name is required' }, 400);
      const accountId = Number(a.id) || 0;

      const existing = accountId
        ? await db.prepare('SELECT * FROM online_accounts WHERE id = ?').bind(accountId).first<any>()
        : null;
      if (accountId && !existing) return json({ error: 'Account not found' }, 404);
      const accountType = ACCOUNT_TYPES[a.account_type] ? String(a.account_type)
        : (existing?.account_type || 'other');

      // Credentials only travel when the caller may see them; otherwise the
      // stored values are left exactly as they are.
      let credSql = '';
      const credBinds: any[] = [];
      if (body.credentials && typeof body.credentials === 'object') {
        if (!(await canSeeCredentials())) return json({ error: 'You do not have access to account credentials' }, 403);
        if (!isVaultConfigured(env)) return json({ error: 'ACCOUNTS_VAULT_KEY is not set, so credentials cannot be stored' }, 500);
        const loginId = str(body.credentials.login_id);
        const password = typeof body.credentials.password === 'string' ? body.credentials.password : null;
        // An untouched password field comes through as undefined: keep what is stored.
        const loginEnc = loginId ? await encryptSecret(env, loginId) : null;
        credSql += ', login_id_enc = ?';
        credBinds.push(loginEnc);
        if (password !== null) {
          credSql += ', password_enc = ?';
          credBinds.push(password === '' ? null : await encryptSecret(env, password));
        }
        credSql += `, credentials_updated_at = datetime('now'), credentials_updated_by = ?`;
        credBinds.push(actor);
      }

      // Keys absent from the request keep their stored value; an empty string
      // clears. The edit form sends every field, but a partial save must not
      // silently blank the rest.
      const has = (k: string) => Object.prototype.hasOwnProperty.call(a, k);
      const pick = (k: string): string | null => has(k) ? str(a[k]) : (existing ? str(existing[k]) : null);
      const mirrored: Record<string, string | null> = {};
      for (const f of MIRRORED_FIELDS) mirrored[f] = pick(f);
      mirrored.name = name;
      const description = pick('description');
      const loginUrl = pick('login_url');
      const notes = pick('notes');
      const active = has('active')
        ? (a.active === false || a.active === 0 || a.active === '0' ? 0 : 1)
        : (existing ? (existing.active ? 1 : 0) : 1);

      // Ledger account name comes from the cache so the list can sort on it
      // without a join, and stays right even if the cache is refreshed later.
      let ledgerName: string | null = existing?.sage_ledger_account_name ?? null;
      if (mirrored.sage_ledger_account_id !== (existing?.sage_ledger_account_id ?? null)) {
        ledgerName = null;
        if (mirrored.sage_ledger_account_id) {
          const la = await db.prepare('SELECT displayed_as FROM sage_ledger_accounts WHERE id = ?')
            .bind(mirrored.sage_ledger_account_id).first<{ displayed_as: string }>();
          ledgerName = la?.displayed_as ?? str(a.sage_ledger_account_name);
        }
      }

      // A mirrored field that now differs from what Sage last gave us marks the
      // row as having local changes to push.
      const pulled = existing?.pulled_json ? JSON.parse(existing.pulled_json) : null;
      const localMirror = mirrorFromRow(mirrored);
      const pending = existing?.sage_contact_id
        ? changedSince(pulled, localMirror).length > 0
        : true;

      const common = [
        name, accountType, description, loginUrl, notes, active,
        mirrored.reference, mirrored.email, mirrored.telephone, mirrored.mobile, mirrored.website,
        mirrored.address_line_1, mirrored.address_line_2, mirrored.city, mirrored.region, mirrored.postal_code,
        mirrored.sage_notes, mirrored.sage_ledger_account_id, ledgerName,
      ];

      if (existing) {
        await db.prepare(
          `UPDATE online_accounts SET
              name = ?, account_type = ?, description = ?, login_url = ?, notes = ?, active = ?,
              reference = ?, email = ?, telephone = ?, mobile = ?, website = ?,
              address_line_1 = ?, address_line_2 = ?, city = ?, region = ?, postal_code = ?,
              sage_notes = ?, sage_ledger_account_id = ?, sage_ledger_account_name = ?,
              local_changed_at = CASE WHEN ? THEN COALESCE(local_changed_at, datetime('now')) ELSE NULL END,
              updated_at = datetime('now'), updated_by = ?${credSql}
            WHERE id = ?`
        ).bind(...common, pending ? 1 : 0, actor, ...credBinds, accountId).run();
        return json({ ok: true, id: accountId, pending });
      }

      const res = await db.prepare(
        `INSERT INTO online_accounts (
            name, account_type, description, login_url, notes, active,
            reference, email, telephone, mobile, website,
            address_line_1, address_line_2, city, region, postal_code,
            sage_notes, sage_ledger_account_id, sage_ledger_account_name,
            local_changed_at, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
      ).bind(...common, actor, actor).run();
      const newId = res.meta.last_row_id as number;

      if (credSql) {
        await db.prepare(`UPDATE online_accounts SET updated_at = updated_at${credSql} WHERE id = ?`)
          .bind(...credBinds, newId).run();
      }
      return json({ ok: true, id: newId, pending: true });
    }

    // ── Delete ──────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!id) return json({ error: 'id is required' }, 400);
      const row = await db.prepare('SELECT name FROM online_accounts WHERE id = ?').bind(id).first<{ name: string }>();
      if (!row) return json({ error: 'Account not found' }, 404);
      await db.prepare('DELETE FROM online_accounts WHERE id = ?').bind(id).run();
      await audit(db, actor, 'online_account_deleted', id, { name: row.name });
      return json({ ok: true });
    }

    // ── Reveal credentials ──────────────────────────────────────────
    if (action === 'reveal') {
      if (!id) return json({ error: 'id is required' }, 400);
      if (!(await canSeeCredentials())) return json({ error: 'You do not have access to account credentials' }, 403);
      const row = await db.prepare(
        'SELECT name, login_id_enc, password_enc, credentials_updated_at, credentials_updated_by FROM online_accounts WHERE id = ?'
      ).bind(id).first<any>();
      if (!row) return json({ error: 'Account not found' }, 404);
      if (!row.login_id_enc && !row.password_enc) {
        return json({ ok: true, login_id: null, password: null, updated_at: null, updated_by: null });
      }
      if (!isVaultConfigured(env)) return json({ error: 'ACCOUNTS_VAULT_KEY is not set, so credentials cannot be read' }, 500);

      const loginId = row.login_id_enc ? await decryptSecret(env, row.login_id_enc) : null;
      const password = row.password_enc ? await decryptSecret(env, row.password_enc) : null;
      await audit(db, actor, 'online_account_credentials_revealed', id, { name: row.name });
      return json({
        ok: true, login_id: loginId, password,
        updated_at: row.credentials_updated_at, updated_by: row.credentials_updated_by,
      });
    }

    // ── Sage: search, link, unlink ──────────────────────────────────
    if (action === 'search-contacts') {
      const q = str(body.q);
      if (!q || q.length < 2) return json({ ok: true, hits: [] });
      const hits = await searchSageContacts(env, q);
      return json({ ok: true, hits });
    }

    if (action === 'link') {
      if (!id) return json({ error: 'id is required' }, 400);
      const sageContactId = str(body.sageContactId);
      if (!sageContactId) return json({ error: 'sageContactId is required' }, 400);
      const clash = await db.prepare(
        'SELECT id, name FROM online_accounts WHERE sage_contact_id = ? AND id != ?'
      ).bind(sageContactId, id).first<{ id: number; name: string }>();
      if (clash) return json({ error: `That Sage contact is already linked to "${clash.name}"` }, 409);

      await db.prepare(
        `UPDATE online_accounts SET sage_contact_id = ?, pulled_json = NULL, sage_web_url = NULL,
                bills_ytd = NULL, payments_ytd = NULL, bills_total = NULL, payments_total = NULL, totals_synced_at = NULL,
                updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`
      ).bind(sageContactId, actor, id).run();

      const pulled = await pullAccountFromSage(db, env, id, actor);
      if (!pulled.ok) return json({ error: pulled.error }, 502);
      const totals = await refreshAccountTotals(db, env, id);
      return json({ ok: true, name: pulled.name, totals: totals.ok ? totals.totals : null, totalsError: totals.ok ? null : totals.error });
    }

    if (action === 'unlink') {
      if (!id) return json({ error: 'id is required' }, 400);
      await db.prepare(
        `UPDATE online_accounts SET sage_contact_id = NULL, sage_web_url = NULL, pulled_json = NULL, sage_pulled_at = NULL,
                sage_updated_at = NULL, local_changed_at = NULL, last_change_set_id = NULL,
                bills_ytd = NULL, payments_ytd = NULL, bills_total = NULL, payments_total = NULL, totals_synced_at = NULL,
                updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`
      ).bind(actor, id).run();
      return json({ ok: true });
    }

    // ── Sage: pull / push / totals ──────────────────────────────────
    if (action === 'pull') {
      if (!id) return json({ error: 'id is required' }, 400);
      const res = await pullAccountFromSage(db, env, id, actor);
      return json(res, res.ok ? 200 : 400);
    }

    if (action === 'push') {
      if (!id) return json({ error: 'id is required' }, 400);
      const res = await proposeAccountPush(db, id, actor);
      return json(res, res.ok ? 200 : 400);
    }

    if (action === 'refresh-totals') {
      if (!id) return json({ error: 'id is required' }, 400);
      const res = await refreshAccountTotals(db, env, id);
      return json(res, res.ok ? 200 : 400);
    }

    if (action === 'reconcile') {
      const n = await reconcileAppliedChangeSets(db, env, actor);
      return json({ ok: true, reconciled: n });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === 'NO_SAGE_CONNECTION') return json({ error: 'Not connected to Sage — connect it from Finance → Sage Changes' }, 401);
    if (msg === 'VAULT_NOT_CONFIGURED') return json({ error: 'ACCOUNTS_VAULT_KEY is not set' }, 500);
    return json({ error: msg.slice(0, 800) }, 500);
  }
};

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

async function audit(db: D1Database, actor: string, action: string, entityId: number, details: unknown) {
  await db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details) VALUES (?, ?, 'online_account', ?, ?)`
  ).bind(actor, action, entityId, JSON.stringify(details)).run();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
