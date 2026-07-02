import type { APIRoute } from 'astro';
import { createSageClient } from '@/lib/sage';

/**
 * Sync Sage data into local cache tables for analysis
 * POST /api/sage/sync?type=all|ledger_accounts|bank_accounts|contacts|tax_rates
 */
export const POST: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime?.env;
  const db = env?.DB;
  if (!db || !env?.SAGE_CLIENT_ID || !env?.SAGE_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const syncType = url.searchParams.get('type') || 'all';

  // D1 rejects undefined — coerce any undefined value to null
  const n = (v: any): any => v ?? null;

  try {
    const client = createSageClient(env);
    const results: Record<string, number> = {};

    // Ledger Accounts
    if (syncType === 'all' || syncType === 'ledger_accounts') {
      const accounts = await client.getLedgerAccounts();
      for (const a of accounts) {
        await db.prepare(`
          INSERT INTO sage_ledger_accounts (id, nominal_code, name, displayed_as, ledger_account_type, ledger_account_group, tax_rate_id, balance, is_visible_in_banking, is_visible_in_expenses, is_visible_in_journals, is_visible_in_other_payments, is_visible_in_other_receipts, is_visible_in_reporting, is_visible_in_sales, raw_json, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            nominal_code=excluded.nominal_code, name=excluded.name, displayed_as=excluded.displayed_as,
            ledger_account_type=excluded.ledger_account_type, ledger_account_group=excluded.ledger_account_group,
            tax_rate_id=excluded.tax_rate_id, balance=excluded.balance,
            is_visible_in_banking=excluded.is_visible_in_banking, is_visible_in_expenses=excluded.is_visible_in_expenses,
            is_visible_in_journals=excluded.is_visible_in_journals, is_visible_in_other_payments=excluded.is_visible_in_other_payments,
            is_visible_in_other_receipts=excluded.is_visible_in_other_receipts, is_visible_in_reporting=excluded.is_visible_in_reporting,
            is_visible_in_sales=excluded.is_visible_in_sales, raw_json=excluded.raw_json, last_synced=datetime('now')
        `).bind(
          n(a.id), n(a.nominal_code), n(a.name), n(a.displayed_as),
          n(a.ledger_account_type?.id ?? a.ledger_account_type),
          n(a.ledger_account_group?.id ?? a.ledger_account_group?.displayed_as ?? a.ledger_account_group),
          n(a.tax_rate?.id),
          n(a.balance != null ? String(a.balance) : null),
          a.visible_in_banking ? 1 : 0,
          a.visible_in_expenses ? 1 : 0,
          a.visible_in_journals ? 1 : 0,
          a.visible_in_other_payments ? 1 : 0,
          a.visible_in_other_receipts ? 1 : 0,
          a.visible_in_reporting ? 1 : 0,
          a.visible_in_sales ? 1 : 0,
          JSON.stringify(a),
        ).run();
      }
      results.ledger_accounts = accounts.length;
    }

    // Bank Accounts
    if (syncType === 'all' || syncType === 'bank_accounts') {
      const banks = await client.getBankAccounts();
      for (const b of banks) {
        await db.prepare(`
          INSERT INTO sage_bank_accounts (id, displayed_as, nominal_code, account_name, account_number, sort_code, balance, bank_account_type, raw_json, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            displayed_as=excluded.displayed_as, nominal_code=excluded.nominal_code,
            account_name=excluded.account_name, account_number=excluded.account_number,
            sort_code=excluded.sort_code, balance=excluded.balance,
            bank_account_type=excluded.bank_account_type, raw_json=excluded.raw_json, last_synced=datetime('now')
        `).bind(
          n(b.id), n(b.displayed_as), n(b.nominal_code),
          n(b.bank_account_details?.account_name),
          n(b.bank_account_details?.account_number),
          n(b.bank_account_details?.sort_code),
          n(b.balance != null ? String(b.balance) : null),
          n(b.bank_account_type?.id ?? b.bank_account_type),
          JSON.stringify(b),
        ).run();
      }
      results.bank_accounts = banks.length;
    }

    // Contacts
    if (syncType === 'all' || syncType === 'contacts') {
      const contacts = await client.getContacts();
      for (const c of contacts) {
        await db.prepare(`
          INSERT INTO sage_contacts (id, displayed_as, name, contact_type, email, reference, balance, raw_json, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            displayed_as=excluded.displayed_as, name=excluded.name,
            contact_type=excluded.contact_type, email=excluded.email,
            reference=excluded.reference, balance=excluded.balance,
            raw_json=excluded.raw_json, last_synced=datetime('now')
        `).bind(
          n(c.id), n(c.displayed_as), n(c.name),
          n(Array.isArray(c.contact_types) ? c.contact_types.map((t: any) => t.id).join(',') : null),
          n(c.email),
          n(c.reference),
          n(c.balance != null ? String(c.balance) : null),
          JSON.stringify(c),
        ).run();
      }
      results.contacts = contacts.length;
    }

    // Tax Rates
    if (syncType === 'all' || syncType === 'tax_rates') {
      const rates = await client.getTaxRates();
      for (const t of rates) {
        await db.prepare(`
          INSERT INTO sage_tax_rates (id, displayed_as, name, percentage, is_visible, raw_json, last_synced)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            displayed_as=excluded.displayed_as, name=excluded.name,
            percentage=excluded.percentage, is_visible=excluded.is_visible,
            raw_json=excluded.raw_json, last_synced=datetime('now')
        `).bind(
          n(t.id), n(t.displayed_as), n(t.name),
          t.percentage ?? 0,
          t.is_visible ? 1 : 0,
          JSON.stringify(t),
        ).run();
      }
      results.tax_rates = rates.length;
    }

    await db.prepare(`
      INSERT INTO audit_log (action, entity_type, details) VALUES ('sage_sync', 'sage', ?)
    `).bind(JSON.stringify(results)).run();

    return new Response(JSON.stringify({ success: true, synced: results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    if (err.message === 'NO_SAGE_CONNECTION') {
      return new Response(JSON.stringify({ error: 'Not connected to Sage' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
