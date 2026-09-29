// Daily takings: TouchOffice department totals → one Sage "Other Receipt" per
// trading day into the till bank account, VAT itemised per budget head.
//
// This reproduces what the bookkeeper has keyed by hand all year (verified
// against every 2026 till receipt: gross per budget head matches TouchOffice
// to the penny in 32 of 38 weeks, and the VAT split is net = round(gross / 1.2)).
//
// Flow for a day:  fetch TouchOffice → build the receipt → fetch what Sage
// already holds → compare → store the dry run.  Posting is a separate step
// that re-runs the check first and refuses a day Sage already has.
//
// The pure functions (splitVat, buildReceipt, compareDay, normaliseSageReceipt)
// take plain data so they can be unit-tested and driven from a local script.

import {
  ensureSession, fetchHomepage, parseHomepageTables, type DepartmentSale,
} from './touchoffice';
import { createSageClient, type SageClient, type SageRole } from './sage';

// ─── Reference data ──────────────────────────────────────────────────

export const TAX_RATES: Record<string, { name: string; pct: number }> = {
  GB_STANDARD: { name: 'Standard 20%', pct: 20 },
  GB_LOWER:    { name: 'Lower rate 5%', pct: 5 },
  GB_ZERO:     { name: 'Zero rated', pct: 0 },
  GB_EXEMPT:   { name: 'Exempt', pct: 0 },
  GB_NO_TAX:   { name: 'No VAT', pct: 0 },
};

export const DEFAULT_BANK_NOMINAL = 1230;   // Money In Till
export const OTHER_RECEIPT_PAYMENT_METHOD = 'CREDIT_DEBIT';   // as the manual entries carry

export type Mode = 'dry_run' | 'test' | 'live';

export interface DeptMapping {
  id?: number;
  dept_pattern: string;
  nominal_code: number;
  ledger_name: string | null;
  tax_rate_id: string;
  enabled: number;
  sort_order?: number;
}

/** Same rows as the seed in migration 069, for the local script and tests. */
export const DEFAULT_MAPPINGS: DeptMapping[] = [
  { dept_pattern: 'Bar Sales',          nominal_code: 4000, ledger_name: 'Bar Sales (4000)',            tax_rate_id: 'GB_STANDARD', enabled: 1, sort_order: 10 },
  { dept_pattern: 'Food Sales',         nominal_code: 4010, ledger_name: 'Food Sales (4010)',           tax_rate_id: 'GB_STANDARD', enabled: 1, sort_order: 20 },
  { dept_pattern: 'Coffee Machine',     nominal_code: 4020, ledger_name: 'Coffee Machine Sales (4020)', tax_rate_id: 'GB_STANDARD', enabled: 1, sort_order: 30 },
  { dept_pattern: 'Memberships',        nominal_code: 4030, ledger_name: 'Members Subscription (4030)', tax_rate_id: 'GB_EXEMPT',   enabled: 1, sort_order: 40 },
  { dept_pattern: 'Social Memberships', nominal_code: 4030, ledger_name: 'Members Subscription (4030)', tax_rate_id: 'GB_EXEMPT',   enabled: 1, sort_order: 41 },
  { dept_pattern: 'Visitors Fees',      nominal_code: 4040, ledger_name: 'Visiting Green Fees (4040)',  tax_rate_id: 'GB_EXEMPT',   enabled: 1, sort_order: 50 },
  { dept_pattern: 'Buggies',            nominal_code: 4050, ledger_name: 'Buggies (4050)',              tax_rate_id: 'GB_STANDARD', enabled: 1, sort_order: 60 },
  { dept_pattern: 'Lockers',            nominal_code: 4060, ledger_name: 'Locker Sales (4060)',         tax_rate_id: 'GB_STANDARD', enabled: 1, sort_order: 70 },
  { dept_pattern: 'Merchandise',        nominal_code: 4070, ledger_name: 'Merchandise sales (4070)',    tax_rate_id: 'GB_STANDARD', enabled: 1, sort_order: 80 },
];

export interface Config {
  bank_nominal: number;
  mode: Mode;
  live_from: string | null;   // YYYY-MM-DD; live posting refused for earlier dates
}

// ─── Money helpers ───────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;
}

/**
 * Split a VAT-inclusive total the way the manual entries do: net is the
 * rounded ex-VAT figure and VAT is whatever is left, so net + VAT always
 * equals the gross. Matches 1240 of 1245 standard-rated lines keyed in 2026;
 * the other five were keying errors.
 */
export function splitVat(total: number, taxRateId: string): { net: number; tax: number } {
  const pct = TAX_RATES[taxRateId]?.pct ?? 0;
  const gross = round2(total);
  if (!pct) return { net: gross, tax: 0 };
  // Integer pence so an exact half (e.g. £96.57 → 8047.5p net) rounds up like
  // Sage does, instead of falling foul of floating-point (80.4749…).
  const pence = Math.round(gross * 100);
  const netPence = Math.round((pence * 100) / (100 + pct));
  const net = netPence / 100;
  return { net, tax: round2(gross - net) };
}

// ─── Building the receipt ────────────────────────────────────────────

export interface ProposedLine {
  nominal_code: number;
  ledger_name: string;
  tax_rate_id: string;
  departments: string[];   // TouchOffice departments rolled into this line
  total: number;
  net: number;
  tax: number;
}

export interface ProposedReceipt {
  date: string;              // YYYY-MM-DD
  reference: string;         // the date, so Sage displays it exactly like the manual entries
  bank_nominal: number;
  total: number;
  net: number;
  tax: number;
  lines: ProposedLine[];
  unmapped: DepartmentSale[]; // non-zero departments with no mapping — blocks posting
}

/** Exact (case-insensitive) match first, then longest "contains" pattern. */
export function matchMapping(deptName: string, mappings: DeptMapping[]): DeptMapping | null {
  const name = deptName.trim().toLowerCase();
  const enabled = mappings.filter(m => m.enabled);
  const exact = enabled.find(m => m.dept_pattern.trim().toLowerCase() === name);
  if (exact) return exact;
  const contains = enabled
    .filter(m => name.includes(m.dept_pattern.trim().toLowerCase()))
    .sort((a, b) => b.dept_pattern.length - a.dept_pattern.length);
  return contains[0] ?? null;
}

export function buildReceipt(
  date: string,
  departments: DepartmentSale[],
  mappings: DeptMapping[],
  bankNominal = DEFAULT_BANK_NOMINAL,
): ProposedReceipt {
  const groups = new Map<string, ProposedLine>();
  const unmapped: DepartmentSale[] = [];

  for (const dept of departments) {
    if (!dept.value) continue;                    // nothing sold under this head today
    const m = matchMapping(dept.name, mappings);
    if (!m) { unmapped.push(dept); continue; }
    const key = `${m.nominal_code}|${m.tax_rate_id}`;
    const line = groups.get(key) ?? {
      nominal_code: m.nominal_code,
      ledger_name: m.ledger_name ?? `(${m.nominal_code})`,
      tax_rate_id: m.tax_rate_id,
      departments: [],
      total: 0, net: 0, tax: 0,
    };
    line.departments.push(dept.name);
    line.total = round2(line.total + dept.value);
    groups.set(key, line);
  }

  const lines = [...groups.values()]
    .filter(l => l.total !== 0)
    .sort((a, b) => a.nominal_code - b.nominal_code || a.tax_rate_id.localeCompare(b.tax_rate_id));

  for (const l of lines) {
    const { net, tax } = splitVat(l.total, l.tax_rate_id);
    l.net = net; l.tax = tax;
  }

  const total = round2(lines.reduce((s, l) => s + l.total, 0));
  return {
    date,
    reference: date,
    bank_nominal: bankNominal,
    total,
    net: round2(lines.reduce((s, l) => s + l.net, 0)),
    tax: round2(lines.reduce((s, l) => s + l.tax, 0)),
    lines,
    unmapped,
  };
}

// ─── What Sage already holds ─────────────────────────────────────────

export interface SageReceiptLine {
  nominal_code: number | null;
  ledger_name: string;
  tax_rate_id: string;
  net: number;
  tax: number;
  total: number;
}

export interface SageTillReceipt {
  id: string;
  date: string;
  reference: string;
  displayed_as: string;
  bank: string;
  total: number;
  created_at: string;
  editable: boolean;
  deletable: boolean;
  lines: SageReceiptLine[];
}

/** "Bar Sales (4000)" → 4000 */
export function nominalFromName(name: string | null | undefined): number | null {
  const m = /\((\d{3,5})\)\s*$/.exec(name ?? '');
  return m ? Number(m[1]) : null;
}

export function normaliseSageReceipt(raw: any): SageTillReceipt {
  return {
    id: raw.id,
    date: raw.date,
    reference: raw.reference ?? '',
    displayed_as: raw.displayed_as ?? '',
    bank: raw.bank_account?.displayed_as ?? '',
    total: Number(raw.total_amount ?? 0),
    created_at: raw.created_at ?? '',
    editable: !!raw.editable,
    deletable: !!raw.deletable,
    lines: (raw.payment_lines ?? []).map((l: any) => ({
      nominal_code: nominalFromName(l.ledger_account?.displayed_as),
      ledger_name: l.ledger_account?.displayed_as ?? '',
      tax_rate_id: l.tax_rate?.id ?? '',
      net: Number(l.net_amount ?? 0),
      tax: Number(l.tax_amount ?? 0),
      total: Number(l.total_amount ?? 0),
    })),
  };
}

export function isTillReceipt(raw: any, bankNominal: number): boolean {
  return raw?.transaction_type?.id === 'OTHER_RECEIPT'
    && nominalFromName(raw?.bank_account?.displayed_as) === bankNominal;
}

// ─── Comparing ───────────────────────────────────────────────────────

export type DayStatus =
  | 'match'            // Sage holds exactly what we would post
  | 'mismatch'         // Sage holds something different for the day
  | 'missing_in_sage'  // TouchOffice had sales, Sage has nothing — the day to post
  | 'sage_only'        // Sage has a receipt but TouchOffice shows no sales
  | 'no_sales'         // nothing either side (e.g. closed)
  | 'unmapped'         // a department with sales has no budget head — fix mapping first
  | 'error';

export interface LineDiff {
  nominal_code: number | null;
  ledger_name: string;
  proposed_total: number; sage_total: number;
  proposed_net: number;   sage_net: number;
  proposed_tax: number;   sage_tax: number;
  proposed_rate: string | null; sage_rate: string | null;
  issues: string[];       // empty when the line agrees
}

export interface DayComparison {
  status: DayStatus;
  proposed_total: number;
  sage_total: number;
  delta: number;           // proposed − sage
  entries: number;         // till receipts Sage holds for the day
  diffs: LineDiff[];
  notes: string[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

export function compareDay(proposed: ProposedReceipt, existing: SageTillReceipt[]): DayComparison {
  const notes: string[] = [];
  const sageTotal = round2(existing.reduce((s, e) => s + e.total, 0));

  // Aggregate Sage lines by nominal code across every till receipt for the day.
  const sageBy = new Map<string, { name: string; net: number; tax: number; total: number; rates: Set<string> }>();
  for (const e of existing) {
    for (const l of e.lines) {
      const key = String(l.nominal_code ?? l.ledger_name);
      const g = sageBy.get(key) ?? { name: l.ledger_name, net: 0, tax: 0, total: 0, rates: new Set<string>() };
      g.net = round2(g.net + l.net); g.tax = round2(g.tax + l.tax); g.total = round2(g.total + l.total);
      if (l.tax_rate_id) g.rates.add(l.tax_rate_id);
      sageBy.set(key, g);
    }
  }
  const propBy = new Map<string, ProposedLine>();
  for (const l of proposed.lines) propBy.set(String(l.nominal_code), l);

  const keys = [...new Set([...propBy.keys(), ...sageBy.keys()])]
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));

  const diffs: LineDiff[] = keys.map(k => {
    const p = propBy.get(k);
    const s = sageBy.get(k);
    const issues: string[] = [];
    const sageRate = s ? [...s.rates].join('+') : null;
    if (p && !s) issues.push('missing in Sage');
    if (!p && s) issues.push('not in TouchOffice');
    if (p && s) {
      if (!near(p.total, s.total)) issues.push(`gross differs by ${round2(p.total - s.total).toFixed(2)}`);
      if (s.rates.size > 1) issues.push('mixed VAT rates in Sage');
      else if (sageRate && sageRate !== p.tax_rate_id) issues.push(`VAT code ${sageRate} (expected ${p.tax_rate_id})`);
      if (!near(p.net, s.net) || !near(p.tax, s.tax)) issues.push(`VAT split differs (Sage VAT ${s.tax.toFixed(2)} vs ${p.tax.toFixed(2)})`);
    }
    return {
      nominal_code: Number(k) || null,
      ledger_name: p?.ledger_name ?? s?.name ?? k,
      proposed_total: p?.total ?? 0, sage_total: s?.total ?? 0,
      proposed_net: p?.net ?? 0,     sage_net: s?.net ?? 0,
      proposed_tax: p?.tax ?? 0,     sage_tax: s?.tax ?? 0,
      proposed_rate: p?.tax_rate_id ?? null, sage_rate: sageRate,
      issues,
    };
  });

  if (existing.length > 1) notes.push(`${existing.length} till receipts in Sage for this day`);
  for (const e of existing) {
    if (e.reference && e.reference !== proposed.date) notes.push(`Sage reference "${e.reference}"`);
  }
  if (proposed.unmapped.length) {
    notes.push('Unmapped: ' + proposed.unmapped.map(u => `${u.name} £${u.value.toFixed(2)}`).join(', '));
  }

  let status: DayStatus;
  if (proposed.unmapped.length) status = 'unmapped';
  else if (proposed.total === 0 && existing.length === 0) status = 'no_sales';
  else if (existing.length === 0) status = 'missing_in_sage';
  else if (proposed.total === 0) status = 'sage_only';
  else if (diffs.every(d => d.issues.length === 0) && existing.length === 1) status = 'match';
  else status = 'mismatch';

  return {
    status,
    proposed_total: proposed.total,
    sage_total: sageTotal,
    delta: round2(proposed.total - sageTotal),
    entries: existing.length,
    diffs,
    notes,
  };
}

// ─── Dates ───────────────────────────────────────────────────────────

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function toTouchOfficeDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's date in the club's timezone. */
export function todayInLondon(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ─── Fetching ────────────────────────────────────────────────────────

/** Department totals for one day from the TouchOffice homepage widget (2 requests). */
export async function fetchTouchOfficeDay(db: any, env: any, date: string): Promise<DepartmentSale[]> {
  const { session } = await ensureSession(db, env);
  const d = toTouchOfficeDate(date);
  const html = await fetchHomepage(session, d, d, ['departmentSalesTotal']);
  if (html.includes('name="submit-login"')) throw new Error('TouchOffice session expired during fetch');
  return parseHomepageTables(html).departments;
}

/** Till receipts Sage already holds for the day (one request, full records). */
export async function fetchSageTillReceipts(client: SageClient, date: string, bankNominal: number): Promise<SageTillReceipt[]> {
  const res = await client.get<{ $items: any[] }>('/other_payments', {
    from_date: date, to_date: date,
    transaction_type_id: 'OTHER_RECEIPT',
    attributes: 'all',
    items_per_page: '200',
  });
  return (res.$items ?? [])
    .filter(r => r.date === date && isTillReceipt(r, bankNominal))
    .map(normaliseSageReceipt);
}

// ─── Config and mappings from D1 ─────────────────────────────────────

export async function loadConfig(db: any): Promise<Config> {
  const rows = await db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN ('daily_takings_bank_nominal', 'daily_takings_mode', 'daily_takings_live_from')`
  ).all();
  const map: Record<string, string> = {};
  for (const r of (rows.results ?? []) as Array<{ key: string; value: string }>) map[r.key] = r.value;
  const mode = map.daily_takings_mode;
  return {
    bank_nominal: Number(map.daily_takings_bank_nominal) || DEFAULT_BANK_NOMINAL,
    mode: mode === 'live' || mode === 'test' ? mode : 'dry_run',
    live_from: isIsoDate(map.daily_takings_live_from) ? map.daily_takings_live_from : null,
  };
}

export async function saveConfig(db: any, patch: Partial<Config>): Promise<void> {
  const put = (key: string, value: string) => db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
  if (patch.bank_nominal !== undefined) await put('daily_takings_bank_nominal', String(patch.bank_nominal));
  if (patch.mode !== undefined) await put('daily_takings_mode', patch.mode);
  if (patch.live_from !== undefined) await put('daily_takings_live_from', patch.live_from ?? '');
}

export async function loadMappings(db: any, enabledOnly = false): Promise<DeptMapping[]> {
  const rows = await db.prepare(
    `SELECT * FROM daily_takings_mapping ${enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY sort_order, dept_pattern`
  ).all();
  return (rows.results ?? []) as DeptMapping[];
}

// ─── The stored dry run ──────────────────────────────────────────────

export interface DayRow {
  takings_date: string;
  touchoffice_json: string | null;
  proposed_json: string | null;
  proposed_total: number | null;
  sage_json: string | null;
  sage_total: number | null;
  comparison: DayStatus | null;
  diff_json: string | null;
  checked_at: string | null;
  check_role: SageRole | null;
  test_sage_id: string | null;
  test_posted_at: string | null;
  live_sage_id: string | null;
  live_posted_at: string | null;
  posted_by: string | null;
  error: string | null;
  notes: string | null;
}

export interface CheckResult {
  date: string;
  departments: DepartmentSale[];
  proposed: ProposedReceipt;
  existing: SageTillReceipt[];
  comparison: DayComparison;
}

/**
 * Dry run for one day: fetch both sides, compare, store. Never writes to Sage.
 * `role` is the Sage business compared against (live by default — that is where
 * the manual entries are).
 */
export async function checkDay(db: any, env: any, date: string, role: SageRole = 'live'): Promise<CheckResult> {
  if (!isIsoDate(date)) throw new Error(`Bad date ${date}`);
  const [config, mappings] = await Promise.all([loadConfig(db), loadMappings(db, true)]);

  let departments: DepartmentSale[];
  try {
    departments = await fetchTouchOfficeDay(db, env, date);
  } catch (e: any) {
    await upsertError(db, date, `TouchOffice: ${e?.message ?? e}`);
    throw e;
  }
  const proposed = buildReceipt(date, departments, mappings, config.bank_nominal);

  let existing: SageTillReceipt[];
  try {
    const client = createSageClient(env, { role });
    existing = await fetchSageTillReceipts(client, date, config.bank_nominal);
  } catch (e: any) {
    await upsertError(db, date, `Sage (${role}): ${e?.message ?? e}`);
    throw e;
  }

  const comparison = compareDay(proposed, existing);

  await db.prepare(`
    INSERT INTO daily_takings (takings_date, touchoffice_json, proposed_json, proposed_total, sage_json, sage_total,
                               comparison, diff_json, checked_at, check_role, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, NULL, datetime('now'))
    ON CONFLICT(takings_date) DO UPDATE SET
      touchoffice_json = excluded.touchoffice_json,
      proposed_json    = excluded.proposed_json,
      proposed_total   = excluded.proposed_total,
      sage_json        = excluded.sage_json,
      sage_total       = excluded.sage_total,
      comparison       = excluded.comparison,
      diff_json        = excluded.diff_json,
      checked_at       = excluded.checked_at,
      check_role       = excluded.check_role,
      error            = NULL,
      updated_at       = datetime('now')
  `).bind(
    date, JSON.stringify(departments), JSON.stringify(proposed), proposed.total,
    JSON.stringify(existing), comparison.sage_total, comparison.status, JSON.stringify(comparison), role,
  ).run();

  return { date, departments, proposed, existing, comparison };
}

async function upsertError(db: any, date: string, message: string): Promise<void> {
  await db.prepare(`
    INSERT INTO daily_takings (takings_date, comparison, error, checked_at, updated_at)
    VALUES (?, 'error', ?, datetime('now'), datetime('now'))
    ON CONFLICT(takings_date) DO UPDATE SET
      comparison = 'error', error = excluded.error, checked_at = excluded.checked_at, updated_at = datetime('now')
  `).bind(date, message.slice(0, 1000)).run();
}

// ─── Posting ─────────────────────────────────────────────────────────

export interface SageIds {
  bank_account_id: string;
  ledger: Record<number, string>;   // nominal → ledger account id
}

/** Resolve nominal codes to ids in the target business (2 requests). */
export async function resolveSageIds(client: SageClient, receipt: ProposedReceipt): Promise<SageIds> {
  const [ledgerAccounts, bankAccounts] = await Promise.all([
    client.getAll<any>('/ledger_accounts'),
    client.getAll<any>('/bank_accounts'),
  ]);
  const ledger: Record<number, string> = {};
  for (const a of ledgerAccounts) {
    const n = Number(a.nominal_code ?? nominalFromName(a.displayed_as));
    if (n) ledger[n] = a.id;
  }
  const bank = bankAccounts.find((b: any) => nominalFromName(b.displayed_as) === receipt.bank_nominal
    || Number(b.nominal_code) === receipt.bank_nominal);
  if (!bank) throw new Error(`No bank account with nominal ${receipt.bank_nominal} in the ${client.role} business`);
  const missing = receipt.lines.map(l => l.nominal_code).filter(n => !ledger[n]);
  if (missing.length) throw new Error(`Ledger accounts missing in the ${client.role} business: ${missing.join(', ')}`);
  return { bank_account_id: bank.id, ledger };
}

export function toSagePayload(receipt: ProposedReceipt, ids: SageIds) {
  return {
    other_payment: {
      transaction_type_id: 'OTHER_RECEIPT',
      bank_account_id: ids.bank_account_id,
      payment_method_id: OTHER_RECEIPT_PAYMENT_METHOD,
      date: receipt.date,
      reference: receipt.reference,
      total_amount: receipt.total.toFixed(2),
      payment_lines: receipt.lines.map(l => ({
        ledger_account_id: ids.ledger[l.nominal_code],
        details: `TouchOffice: ${l.departments.join(', ')}`,
        tax_rate_id: l.tax_rate_id,
        net_amount: l.net.toFixed(2),
        tax_amount: l.tax.toFixed(2),
        total_amount: l.total.toFixed(2),
      })),
    },
  };
}

/** Sanity checks before anything is sent. */
export function validateReceipt(receipt: ProposedReceipt): string[] {
  const problems: string[] = [];
  if (!isIsoDate(receipt.date)) problems.push('bad date');
  if (receipt.unmapped.length) problems.push('unmapped departments');
  if (receipt.lines.length === 0) problems.push('no lines');
  if (receipt.total <= 0) problems.push('total is not positive');
  const sum = round2(receipt.lines.reduce((s, l) => s + l.total, 0));
  if (!near(sum, receipt.total)) problems.push('lines do not sum to total');
  for (const l of receipt.lines) {
    if (!near(l.net + l.tax, l.total)) problems.push(`${l.ledger_name}: net + VAT ≠ gross`);
    if (!TAX_RATES[l.tax_rate_id]) problems.push(`${l.ledger_name}: unknown tax rate ${l.tax_rate_id}`);
  }
  return problems;
}

export interface PostResult {
  sage_id: string;
  role: SageRole;
  total: number;
  raw: any;
}

/**
 * Create the Other Receipt in the given business. The only write-enabled Sage
 * client outside the change-set engine. Caller has already re-checked the day
 * and confirmed Sage holds nothing for it.
 */
export async function postReceipt(env: any, role: SageRole, receipt: ProposedReceipt): Promise<PostResult> {
  const problems = validateReceipt(receipt);
  if (problems.length) throw new Error('Receipt not valid: ' + problems.join('; '));

  const reader = createSageClient(env, { role });
  const ids = await resolveSageIds(reader, receipt);
  const payload = toSagePayload(receipt, ids);

  const writer = createSageClient(env, { role, allowWrites: true });
  const raw = await writer.post<any>('/other_payments', payload);
  const sageId = raw?.id;
  if (!sageId) throw new Error('Sage did not return an id for the new receipt');
  const posted = Number(raw?.total_amount ?? receipt.total);
  if (!near(posted, receipt.total)) {
    throw new Error(`Sage recorded ${posted.toFixed(2)} but ${receipt.total.toFixed(2)} was sent (id ${sageId})`);
  }
  return { sage_id: sageId, role, total: posted, raw };
}

/** Remove a receipt we created (Sage refuses if it is reconciled or on a VAT return). */
export async function deleteReceipt(env: any, role: SageRole, sageId: string): Promise<void> {
  const writer = createSageClient(env, { role, allowWrites: true });
  await writer.delete(`/other_payments/${sageId}`);
}
