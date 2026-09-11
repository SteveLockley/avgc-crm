// Online accounts: the Sage side.
//
// An online account row mirrors a handful of fields from its Sage contact.
// Pulling reads the contact live and overwrites the mirror; pushing proposes
// the local edits as a change set (sage-changes.ts) so they go through review,
// the test business and then live like every other write. Nothing here writes
// to Sage directly.

import { createSageClient, type SageClient } from './sage';
import { createChangeSet, type ProposedChange } from './sage-changes';

/** Fields mirrored between the CRM row and the Sage contact. */
export const MIRRORED_FIELDS = [
  'name', 'reference', 'email', 'telephone', 'mobile', 'website',
  'address_line_1', 'address_line_2', 'city', 'region', 'postal_code',
  'sage_notes', 'sage_ledger_account_id',
] as const;

export type MirroredField = typeof MIRRORED_FIELDS[number];
export type Mirror = Record<MirroredField, string | null>;

export const ACCOUNT_TYPES: Record<string, string> = {
  electricity: 'Electricity',
  gas: 'Gas',
  water: 'Water',
  oil: 'Heating oil',
  telecoms: 'Telecoms & internet',
  software: 'Software & subscriptions',
  banking: 'Banking & payments',
  insurance: 'Insurance',
  other: 'Other',
};

const s = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

// ─── Reading a Sage contact ─────────────────────────────────────────

export interface SageContactMirror {
  mirror: Mirror;
  ledgerAccountName: string | null;
  webUrl: string | null;
  sageUpdatedAt: string | null;
  isActive: boolean;
  contactTypes: string[];
}

/**
 * Picks the mirrored fields out of a full contact record (GET /contacts/{id}).
 * Sage exposes email/telephone/mobile/website both at the top level and on
 * main_contact_person; the top level is used when present.
 */
export function mirrorFromSageContact(c: any): SageContactMirror {
  const person = c?.main_contact_person || {};
  const addr = c?.main_address || {};
  const ledger = c?.default_purchase_ledger_account || null;

  // The API describes each resource with links; the "alternate" one is the
  // record in the Sage web app, which is what a person wants to click.
  let webUrl: string | null = null;
  if (Array.isArray(c?.links)) {
    const alt = c.links.find((l: any) => l?.rel === 'alternate' && typeof l?.href === 'string')
      || c.links.find((l: any) => typeof l?.href === 'string' && /text\/html/.test(l?.type || ''));
    webUrl = alt?.href ?? null;
  }

  return {
    mirror: {
      name: s(c?.name) ?? s(c?.displayed_as),
      reference: s(c?.reference),
      email: s(c?.email) ?? s(person.email),
      telephone: s(c?.telephone) ?? s(person.telephone),
      mobile: s(c?.mobile) ?? s(person.mobile),
      website: s(c?.website) ?? s(person.website),
      address_line_1: s(addr.address_line_1),
      address_line_2: s(addr.address_line_2),
      city: s(addr.city),
      region: s(addr.region),
      postal_code: s(addr.postal_code),
      sage_notes: s(c?.notes),
      sage_ledger_account_id: s(ledger?.id),
    },
    ledgerAccountName: s(ledger?.displayed_as),
    webUrl,
    sageUpdatedAt: s(c?.updated_at),
    isActive: c?.is_active !== false,
    contactTypes: Array.isArray(c?.contact_types) ? c.contact_types.map((t: any) => t?.id).filter(Boolean) : [],
  };
}

export function mirrorFromRow(row: Record<string, any>): Mirror {
  const out = {} as Mirror;
  for (const f of MIRRORED_FIELDS) out[f] = s(row[f]);
  return out;
}

/** Fields whose local value differs from what was last pulled from Sage. */
export function changedSince(pulled: Mirror | null, local: Mirror): MirroredField[] {
  return MIRRORED_FIELDS.filter(f => (pulled ? pulled[f] : null) !== local[f]);
}

// ─── Pull ────────────────────────────────────────────────────────────

export async function pullAccountFromSage(
  db: D1Database,
  env: any,
  accountId: number,
  actor: string,
): Promise<{ ok: true; name: string; changed: MirroredField[] } | { ok: false; error: string }> {
  const row = await db.prepare('SELECT * FROM online_accounts WHERE id = ?').bind(accountId).first<any>();
  if (!row) return { ok: false, error: 'Account not found' };
  if (!row.sage_contact_id) return { ok: false, error: 'This account is not linked to a Sage contact yet' };

  const client = createSageClient(env);
  const contact = await client.get<any>(`/contacts/${row.sage_contact_id}`);
  const got = mirrorFromSageContact(contact);
  const changed = changedSince(mirrorFromRow(row), got.mirror);

  await db.prepare(
    `UPDATE online_accounts SET
        name = ?, reference = ?, email = ?, telephone = ?, mobile = ?, website = ?,
        address_line_1 = ?, address_line_2 = ?, city = ?, region = ?, postal_code = ?,
        sage_notes = ?, sage_ledger_account_id = ?, sage_ledger_account_name = ?,
        sage_web_url = COALESCE(?, sage_web_url),
        sage_pulled_at = datetime('now'), sage_updated_at = ?, pulled_json = ?,
        local_changed_at = NULL,
        updated_at = datetime('now'), updated_by = ?
      WHERE id = ?`
  ).bind(
    got.mirror.name ?? row.name, got.mirror.reference, got.mirror.email, got.mirror.telephone, got.mirror.mobile, got.mirror.website,
    got.mirror.address_line_1, got.mirror.address_line_2, got.mirror.city, got.mirror.region, got.mirror.postal_code,
    got.mirror.sage_notes, got.mirror.sage_ledger_account_id, got.ledgerAccountName,
    got.webUrl,
    got.sageUpdatedAt, JSON.stringify(got.mirror),
    actor, accountId,
  ).run();

  return { ok: true, name: got.mirror.name ?? row.name, changed };
}

// ─── Push ────────────────────────────────────────────────────────────

/**
 * Builds the contact payload for the fields that differ from the last pull.
 * For an unlinked account this is a full create payload.
 */
export function buildPushPayload(row: Record<string, any>): { action: 'create' | 'update'; payload: Record<string, any>; fields: MirroredField[] } {
  const local = mirrorFromRow(row);
  const pulled: Mirror | null = row.pulled_json ? JSON.parse(row.pulled_json) : null;
  const isCreate = !row.sage_contact_id;
  const fields = isCreate ? MIRRORED_FIELDS.filter(f => local[f] !== null) : changedSince(pulled, local);

  const payload: Record<string, any> = {};
  if (isCreate) payload.contact_type_ids = ['VENDOR'];

  for (const f of ['name', 'reference', 'email', 'telephone', 'mobile', 'website'] as const) {
    if (fields.includes(f)) payload[f] = local[f] ?? '';
  }
  if (fields.includes('sage_notes')) payload.notes = local.sage_notes ?? '';
  if (fields.includes('sage_ledger_account_id') && local.sage_ledger_account_id) {
    payload.default_purchase_ledger_account_id = local.sage_ledger_account_id;
  }

  const addressFields = ['address_line_1', 'address_line_2', 'city', 'region', 'postal_code'] as const;
  if (addressFields.some(f => fields.includes(f))) {
    payload.main_address = {
      address_type_id: 'ACCOUNTS',
      address_line_1: local.address_line_1 ?? '',
      address_line_2: local.address_line_2 ?? '',
      city: local.city ?? '',
      region: local.region ?? '',
      postal_code: local.postal_code ?? '',
      country_id: 'GB',
    };
  }

  return { action: isCreate ? 'create' : 'update', payload, fields: [...fields] };
}

export async function proposeAccountPush(
  db: D1Database,
  accountId: number,
  actor: string,
): Promise<{ ok: true; setId: number; action: string; fields: MirroredField[] } | { ok: false; error: string }> {
  const row = await db.prepare('SELECT * FROM online_accounts WHERE id = ?').bind(accountId).first<any>();
  if (!row) return { ok: false, error: 'Account not found' };

  const { action, payload, fields } = buildPushPayload(row);
  if (fields.length === 0) return { ok: false, error: 'Nothing to push — the Sage contact already matches' };
  if (action === 'create' && !row.name) return { ok: false, error: 'A name is required to create the Sage contact' };

  const change: ProposedChange = {
    entity: 'contact',
    action,
    sageId: row.sage_contact_id ?? null,
    label: row.name,
    payload,
  };

  const setId = await createChangeSet(db, {
    name: `${action === 'create' ? 'Create' : 'Update'} supplier — ${row.name}`,
    description: `Proposed from the online accounts register. Fields: ${fields.join(', ')}.`,
    phase: 'online-accounts',
    createdBy: actor,
  }, [change]);

  await db.prepare(
    `UPDATE online_accounts SET last_change_set_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`
  ).bind(setId, actor, accountId).run();

  return { ok: true, setId, action, fields };
}

/**
 * After a change set is applied, the Sage contact holds what we sent; record
 * that so the row no longer shows as pending, and pick up the new id on create.
 */
export async function reconcileAppliedChangeSets(db: D1Database, env: any, actor: string): Promise<number> {
  const rows = await db.prepare(
    `SELECT a.id, a.last_change_set_id, c.action, c.sage_id, c.status AS change_status
       FROM online_accounts a
       JOIN sage_change_set cs ON cs.id = a.last_change_set_id
       JOIN sage_change c ON c.change_set_id = cs.id
      WHERE a.local_changed_at IS NOT NULL
        AND cs.status = 'applied' AND cs.target_role = 'live' AND c.status = 'applied'`
  ).all<any>();

  let n = 0;
  for (const r of rows.results || []) {
    if (r.action === 'create' && r.sage_id) {
      await db.prepare(`UPDATE online_accounts SET sage_contact_id = ? WHERE id = ?`).bind(r.sage_id, r.id).run();
    }
    const res = await pullAccountFromSage(db, env, r.id, actor);
    if (res.ok) n++;
  }
  return n;
}

// ─── Bills and payments ─────────────────────────────────────────────

export interface SupplierTotals {
  billsYtd: number;
  paymentsYtd: number;
  billsTotal: number;
  paymentsTotal: number;
  fyStart: string;
  counts: { invoices: number; creditNotes: number; contactPayments: number; otherPayments: number };
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * First day of the current financial year, from Sage's own settings.
 * financial_settings.year_end_date is the last *completed* year end, so it is
 * rolled forward until it is in the future (same logic as the dashboard).
 */
export async function getFinancialYearStart(client: SageClient, now = new Date()): Promise<string> {
  let yearEnd: Date;
  try {
    const settings = await client.getFinancialSettings() as any;
    yearEnd = new Date(settings?.year_end_date || `${now.getFullYear()}-12-31`);
    if (isNaN(yearEnd.getTime())) yearEnd = new Date(`${now.getFullYear()}-12-31`);
  } catch {
    yearEnd = new Date(`${now.getFullYear()}-12-31`);
  }
  while (yearEnd < now) yearEnd.setFullYear(yearEnd.getFullYear() + 1);
  const start = new Date(yearEnd);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  return start.toISOString().slice(0, 10);
}

/**
 * Sums a supplier's bills (purchase invoices less credit notes) and payments
 * (supplier payments and refunds, plus bank payments made directly to the
 * contact without an invoice). Pure so it can be tested without Sage.
 */
export function aggregateSupplierTotals(
  fyStart: string,
  data: { invoices: any[]; creditNotes: any[]; contactPayments: any[]; otherPayments: any[] },
): SupplierTotals {
  const out: SupplierTotals = {
    billsYtd: 0, paymentsYtd: 0, billsTotal: 0, paymentsTotal: 0, fyStart,
    counts: {
      invoices: data.invoices.length, creditNotes: data.creditNotes.length,
      contactPayments: data.contactPayments.length, otherPayments: data.otherPayments.length,
    },
  };
  const inYear = (d: unknown) => typeof d === 'string' && d >= fyStart;
  const isVoid = (i: any) => (i?.status?.id || i?.status_id || '') === 'VOID';
  const typeId = (i: any) => String(i?.transaction_type?.id || i?.transaction_type_id || '').toUpperCase();

  for (const i of data.invoices) {
    if (isVoid(i)) continue;
    const v = num(i.total_amount);
    out.billsTotal += v;
    if (inYear(i.date)) out.billsYtd += v;
  }
  for (const c of data.creditNotes) {
    if (isVoid(c)) continue;
    const v = -num(c.total_amount);
    out.billsTotal += v;
    if (inYear(c.date)) out.billsYtd += v;
  }
  for (const p of data.contactPayments) {
    // Supplier payments count; supplier refunds come back the other way.
    const t = typeId(p);
    if (t.includes('CUSTOMER')) continue;
    const v = t.includes('REFUND') ? -num(p.total_amount) : num(p.total_amount);
    out.paymentsTotal += v;
    if (inYear(p.date)) out.paymentsYtd += v;
  }
  for (const p of data.otherPayments) {
    // /other_payments returns both bank payments and bank receipts.
    const t = typeId(p);
    const v = t.includes('RECEIPT') ? -num(p.total_amount) : num(p.total_amount);
    out.paymentsTotal += v;
    if (inYear(p.date)) out.paymentsYtd += v;
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  out.billsYtd = r2(out.billsYtd); out.paymentsYtd = r2(out.paymentsYtd);
  out.billsTotal = r2(out.billsTotal); out.paymentsTotal = r2(out.paymentsTotal);
  return out;
}

export async function fetchSupplierTotals(client: SageClient, contactId: string, fyStart: string): Promise<SupplierTotals> {
  // List endpoints return only id/displayed_as unless asked for more.
  const params = { contact_id: contactId, attributes: 'all' };
  const [invoices, creditNotes, contactPayments, otherPayments] = await Promise.all([
    client.getAll('/purchase_invoices', params),
    client.getAll('/purchase_credit_notes', params),
    client.getAll('/contact_payments', params),
    client.getAll('/other_payments', params),
  ]);
  return aggregateSupplierTotals(fyStart, { invoices, creditNotes, contactPayments, otherPayments });
}

export async function refreshAccountTotals(
  db: D1Database,
  env: any,
  accountId: number,
): Promise<{ ok: true; totals: SupplierTotals } | { ok: false; error: string }> {
  const row = await db.prepare(
    'SELECT id, sage_contact_id FROM online_accounts WHERE id = ?'
  ).bind(accountId).first<{ id: number; sage_contact_id: string | null }>();
  if (!row) return { ok: false, error: 'Account not found' };
  if (!row.sage_contact_id) return { ok: false, error: 'Not linked to a Sage contact' };

  const client = createSageClient(env);
  const fyStart = await getFinancialYearStart(client);
  const totals = await fetchSupplierTotals(client, row.sage_contact_id, fyStart);

  await db.prepare(
    `UPDATE online_accounts SET bills_ytd = ?, payments_ytd = ?, bills_total = ?, payments_total = ?,
            totals_fy_start = ?, totals_synced_at = datetime('now')
      WHERE id = ?`
  ).bind(totals.billsYtd, totals.paymentsYtd, totals.billsTotal, totals.paymentsTotal, fyStart, accountId).run();

  return { ok: true, totals };
}

// ─── Contact search (for linking) ───────────────────────────────────

export interface ContactSearchHit {
  id: string;
  name: string;
  reference: string | null;
  types: string[];
  webUrl: string | null;
}

export async function searchSageContacts(env: any, query: string): Promise<ContactSearchHit[]> {
  const client = createSageClient(env);
  const res = await client.get<any>('/contacts', {
    search: query,
    attributes: 'all',
    items_per_page: '25',
  });
  return (res?.$items || []).map((c: any) => {
    const m = mirrorFromSageContact(c);
    return {
      id: c.id,
      name: c.displayed_as || c.name || '',
      reference: s(c.reference),
      types: m.contactTypes,
      webUrl: m.webUrl,
    };
  });
}
