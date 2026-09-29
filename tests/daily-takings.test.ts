/**
 * Daily takings — the pure parts (VAT split, receipt building, comparison,
 * Sage payload) against figures taken from real 2026 till receipts, plus the
 * API's settings and mapping actions against a SQLite-backed D1 shim.
 * No network.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import {
  splitVat, buildReceipt, compareDay, normaliseSageReceipt, isTillReceipt, matchMapping,
  toSagePayload, validateReceipt, nominalFromName, dateRange, addDays, DEFAULT_MAPPINGS,
} from '../src/lib/daily-takings';
import { POST } from '../src/pages/api/sage/daily-takings';

// ─── VAT split ───────────────────────────────────────────────────────

describe('splitVat', () => {
  // gross → (net, VAT) exactly as keyed in Sage on 2026-09-20 and 2026-02-05
  it.each([
    [587.38, 489.48, 97.90],
    [663.91, 553.26, 110.65],
    [10.00, 8.33, 1.67],
    [154.40, 128.67, 25.73],
    [141.00, 117.50, 23.50],
    [96.57, 80.48, 16.09],     // exact half-penny: 8047.5p rounds up like Sage
    [0.01, 0.01, 0.00],
  ])('standard rate %s → net %s VAT %s', (gross, net, tax) => {
    expect(splitVat(gross, 'GB_STANDARD')).toEqual({ net, tax });
  });

  it('exempt and no-VAT lines carry no VAT', () => {
    expect(splitVat(235, 'GB_EXEMPT')).toEqual({ net: 235, tax: 0 });
    expect(splitVat(50, 'GB_NO_TAX')).toEqual({ net: 50, tax: 0 });
    expect(splitVat(50, 'GB_ZERO')).toEqual({ net: 50, tax: 0 });
  });

  it('lower rate uses 5%', () => {
    expect(splitVat(105, 'GB_LOWER')).toEqual({ net: 100, tax: 5 });
  });

  it('net + VAT always equals gross', () => {
    for (let p = 1; p < 5000; p += 7) {
      const gross = p / 100;
      const { net, tax } = splitVat(gross, 'GB_STANDARD');
      expect(Math.round((net + tax) * 100)).toBe(p);
    }
  });
});

// ─── Building the receipt ────────────────────────────────────────────

const DAY = [
  { name: 'Bar Sales', quantity: 120, value: 587.38 },
  { name: 'Food Sales', quantity: 80, value: 663.91 },
  { name: 'Buggies', quantity: 1, value: 10 },
  { name: 'Coffee Machine', quantity: 60, value: 154.4 },
  { name: 'Merchandise', quantity: 3, value: 141 },
  { name: 'Visitors Fees', quantity: 0, value: 0 },
  { name: 'Memberships', quantity: 0, value: 0 },
];

describe('buildReceipt', () => {
  it('produces one line per budget head with VAT split, skipping zero departments', () => {
    const r = buildReceipt('2026-09-20', DAY, DEFAULT_MAPPINGS);
    expect(r.reference).toBe('2026-09-20');
    expect(r.bank_nominal).toBe(1230);
    expect(r.unmapped).toEqual([]);
    expect(r.lines.map(l => l.nominal_code)).toEqual([4000, 4010, 4020, 4050, 4070]);
    expect(r.total).toBe(1556.69);
    const bar = r.lines[0];
    expect(bar).toMatchObject({ ledger_name: 'Bar Sales (4000)', tax_rate_id: 'GB_STANDARD', total: 587.38, net: 489.48, tax: 97.9 });
    expect(r.tax).toBe(97.9 + 110.65 + 1.67 + 25.73 + 23.5);
  });

  it('rolls Memberships and Social Memberships into one exempt 4030 line', () => {
    const r = buildReceipt('2026-05-01', [
      { name: 'Memberships', quantity: 1, value: 400.5 },
      { name: 'Social Memberships', quantity: 1, value: 50 },
    ], DEFAULT_MAPPINGS);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ nominal_code: 4030, tax_rate_id: 'GB_EXEMPT', total: 450.5, net: 450.5, tax: 0, departments: ['Memberships', 'Social Memberships'] });
  });

  it('flags departments with sales that have no mapping', () => {
    const r = buildReceipt('2026-09-20', [...DAY, { name: 'Pro Shop Lessons', quantity: 1, value: 30 }], DEFAULT_MAPPINGS);
    expect(r.unmapped).toEqual([{ name: 'Pro Shop Lessons', quantity: 1, value: 30 }]);
    expect(r.total).toBe(1556.69);   // unmapped money is not silently posted elsewhere
    expect(validateReceipt(r)).toContain('unmapped departments');
  });

  it('matches exact names before "contains" patterns, longest pattern winning', () => {
    const maps = [
      { dept_pattern: 'Bar', nominal_code: 4000, ledger_name: 'Bar', tax_rate_id: 'GB_STANDARD', enabled: 1 },
      { dept_pattern: 'Bar Sales - Soft', nominal_code: 4005, ledger_name: 'Soft', tax_rate_id: 'GB_LOWER', enabled: 1 },
      { dept_pattern: 'disabled', nominal_code: 4999, ledger_name: 'x', tax_rate_id: 'GB_NO_TAX', enabled: 0 },
    ];
    expect(matchMapping('bar', maps)?.nominal_code).toBe(4000);
    expect(matchMapping('Bar Sales - Soft Drinks', maps)?.nominal_code).toBe(4005);
    expect(matchMapping('Bar Sales', maps)?.nominal_code).toBe(4000);
    expect(matchMapping('disabled', maps)).toBeNull();
  });
});

// ─── What Sage holds ─────────────────────────────────────────────────

// Trimmed copy of the real 2026-09-20 till receipt
const SAGE_RAW = {
  id: 'abc123', displayed_as: '2026-09-20', date: '2026-09-20', reference: '', created_at: '2026-09-26T14:57:40Z',
  transaction_type: { id: 'OTHER_RECEIPT' }, editable: true, deletable: true,
  bank_account: { id: 'bank1', displayed_as: 'Money In Till (1230)' },
  total_amount: '1556.69',
  payment_lines: [
    { ledger_account: { displayed_as: 'Bar Sales (4000)' }, tax_rate: { id: 'GB_STANDARD' }, net_amount: '489.48', tax_amount: '97.9', total_amount: '587.38' },
    { ledger_account: { displayed_as: 'Food Sales (4010)' }, tax_rate: { id: 'GB_STANDARD' }, net_amount: '553.26', tax_amount: '110.65', total_amount: '663.91' },
    { ledger_account: { displayed_as: 'Buggies (4050)' }, tax_rate: { id: 'GB_STANDARD' }, net_amount: '8.33', tax_amount: '1.67', total_amount: '10.0' },
    { ledger_account: { displayed_as: 'Coffee Machine Sales (4020)' }, tax_rate: { id: 'GB_STANDARD' }, net_amount: '128.67', tax_amount: '25.73', total_amount: '154.4' },
    { ledger_account: { displayed_as: 'Merchandise sales (4070)' }, tax_rate: { id: 'GB_STANDARD' }, net_amount: '117.5', tax_amount: '23.5', total_amount: '141.0' },
  ],
};

describe('normaliseSageReceipt / isTillReceipt', () => {
  it('reads nominal codes and amounts', () => {
    const r = normaliseSageReceipt(SAGE_RAW);
    expect(r.total).toBe(1556.69);
    expect(r.lines[0]).toEqual({ nominal_code: 4000, ledger_name: 'Bar Sales (4000)', tax_rate_id: 'GB_STANDARD', net: 489.48, tax: 97.9, total: 587.38 });
    expect(nominalFromName('NAT WEST  AVGC (1270)')).toBe(1270);
    expect(nominalFromName('no code')).toBeNull();
  });
  it('recognises till receipts by bank nominal and type', () => {
    expect(isTillReceipt(SAGE_RAW, 1230)).toBe(true);
    expect(isTillReceipt(SAGE_RAW, 1200)).toBe(false);
    expect(isTillReceipt({ ...SAGE_RAW, transaction_type: { id: 'OTHER_PAYMENT' } }, 1230)).toBe(false);
  });
});

// ─── Comparing ───────────────────────────────────────────────────────

describe('compareDay', () => {
  const proposed = buildReceipt('2026-09-20', DAY, DEFAULT_MAPPINGS);

  it('matches the real manual entry line for line', () => {
    const c = compareDay(proposed, [normaliseSageReceipt(SAGE_RAW)]);
    expect(c.status).toBe('match');
    expect(c.delta).toBe(0);
    expect(c.diffs.every(d => d.issues.length === 0)).toBe(true);
  });

  it('reports a wrong VAT code even when the gross agrees (the 2026-07-03 green fees case)', () => {
    const p = buildReceipt('2026-07-03', [{ name: 'Visitors Fees', quantity: 4, value: 170 }], DEFAULT_MAPPINGS);
    const sage = normaliseSageReceipt({ ...SAGE_RAW, date: '2026-07-03', total_amount: '170.0', payment_lines: [
      { ledger_account: { displayed_as: 'Visiting Green Fees (4040)' }, tax_rate: { id: 'GB_STANDARD' }, net_amount: '141.67', tax_amount: '28.33', total_amount: '170.0' },
    ] });
    const c = compareDay(p, [sage]);
    expect(c.status).toBe('mismatch');
    expect(c.delta).toBe(0);
    expect(c.diffs[0].issues.join(' ')).toMatch(/VAT code GB_STANDARD \(expected GB_EXEMPT\)/);
    expect(c.diffs[0].issues.join(' ')).toMatch(/VAT split differs/);
  });

  it('reports a gross difference on one head (the week 25 coffee case)', () => {
    const sage = normaliseSageReceipt({ ...SAGE_RAW, payment_lines: SAGE_RAW.payment_lines.map(l =>
      l.ledger_account.displayed_as.startsWith('Coffee') ? { ...l, total_amount: '204.4', net_amount: '170.33', tax_amount: '34.07' } : l), total_amount: '1606.69' });
    const c = compareDay(proposed, [sage]);
    expect(c.status).toBe('mismatch');
    expect(c.delta).toBe(-50);
    expect(c.diffs.find(d => d.nominal_code === 4020)?.issues[0]).toBe('gross differs by -50.00');
  });

  it('classifies the empty cases', () => {
    expect(compareDay(proposed, []).status).toBe('missing_in_sage');
    const nothing = buildReceipt('2026-01-06', [], DEFAULT_MAPPINGS);
    expect(compareDay(nothing, []).status).toBe('no_sales');
    expect(compareDay(nothing, [normaliseSageReceipt(SAGE_RAW)]).status).toBe('sage_only');
    const unmapped = buildReceipt('2026-09-20', [{ name: 'Mystery', quantity: 1, value: 5 }], DEFAULT_MAPPINGS);
    expect(compareDay(unmapped, []).status).toBe('unmapped');
  });

  it('never calls two Sage entries a match (the 2026-06-21 duplicate penny)', () => {
    const penny = normaliseSageReceipt({ ...SAGE_RAW, id: 'p', total_amount: '0.01', payment_lines: [
      { ledger_account: { displayed_as: 'Merchandise sales (4070)' }, tax_rate: { id: 'GB_STANDARD' }, net_amount: '0.01', tax_amount: '0.0', total_amount: '0.01' },
    ] });
    const c = compareDay(proposed, [normaliseSageReceipt(SAGE_RAW), penny]);
    expect(c.status).toBe('mismatch');
    expect(c.entries).toBe(2);
    expect(c.notes[0]).toMatch(/2 till receipts/);
  });
});

// ─── Sage payload ────────────────────────────────────────────────────

describe('toSagePayload', () => {
  it('builds an Other Receipt into the till with one VAT-coded line per head', () => {
    const r = buildReceipt('2026-09-20', DAY, DEFAULT_MAPPINGS);
    const p = toSagePayload(r, { bank_account_id: 'bank1', ledger: { 4000: 'L0', 4010: 'L1', 4020: 'L2', 4050: 'L5', 4070: 'L7' } });
    expect(p.other_payment).toMatchObject({
      transaction_type_id: 'OTHER_RECEIPT', bank_account_id: 'bank1', date: '2026-09-20', reference: '2026-09-20', total_amount: '1556.69',
    });
    expect(p.other_payment.payment_lines[0]).toEqual({
      ledger_account_id: 'L0', details: 'TouchOffice: Bar Sales', tax_rate_id: 'GB_STANDARD',
      net_amount: '489.48', tax_amount: '97.90', total_amount: '587.38',
    });
    expect(validateReceipt(r)).toEqual([]);
  });
});

describe('dates', () => {
  it('ranges and arithmetic are inclusive and UTC-safe', () => {
    expect(dateRange('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);   // DST change weekend
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

// ─── API: settings and mapping (no network) ──────────────────────────

function wrapDatabase(db: Database.Database) {
  const prep = (query: string) => {
    const stmt = db.prepare(query);
    let bound: unknown[] = [];
    const api = {
      bind(...values: unknown[]) { bound = values; return api; },
      async first<T>() { return (stmt.get(...bound) as T) ?? null; },
      async all<T>() { return { results: stmt.all(...bound) as T[], success: true, meta: { changes: 0 } }; },
      async run() { const r = stmt.run(...bound); return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    };
    return api;
  };
  return { prepare: prep };
}

let db: ReturnType<typeof wrapDatabase>;

function call(body: unknown, opts: { user?: boolean; bearer?: string } = { user: true }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const request = new Request('http://localhost/api/sage/daily-takings', { method: 'POST', headers, body: JSON.stringify(body) });
  const locals: any = { runtime: { env: { DB: db, CRON_SECRET: 's3cret' } } };
  if (opts.user) locals.user = { email: 'steve@alnmouthvillage.golf', name: 'Steve', role: 'admin' };
  return POST({ request, locals } as any).then(async (res: Response) => ({ status: res.status, json: await res.json() as any }));
}

beforeAll(() => {
  const raw = new Database(':memory:');
  raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial.sql'), 'utf8'));
  raw.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`);
  raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '069_daily_takings.sql'), 'utf8'));
  db = wrapDatabase(raw);
});

describe('daily takings API', () => {
  it('seeds the nine budget heads', async () => {
    const r = await call({ action: 'mapping', op: 'toggle', id: 999, enabled: 1 });
    expect(r.status).toBe(200);
    expect(r.json.mappings.map((m: any) => m.dept_pattern)).toEqual([
      'Bar Sales', 'Food Sales', 'Coffee Machine', 'Memberships', 'Social Memberships', 'Visitors Fees', 'Buggies', 'Lockers', 'Merchandise',
    ]);
  });

  it('refuses live mode without a go-live date, then accepts it', async () => {
    expect((await call({ action: 'config', mode: 'live' })).status).toBe(400);
    const r = await call({ action: 'config', mode: 'live', live_from: '2026-10-01', bank_nominal: 1230 });
    expect(r.status).toBe(200);
    expect(r.json.config).toEqual({ bank_nominal: 1230, mode: 'live', live_from: '2026-10-01' });
    expect((await call({ action: 'config', bank_nominal: 4000 })).status).toBe(400);
  });

  it('validates mapping rows and rejects duplicates', async () => {
    expect((await call({ action: 'mapping', op: 'add', dept_pattern: 'Bar Sales', nominal_code: 4000, tax_rate_id: 'GB_STANDARD' })).status).toBe(409);
    expect((await call({ action: 'mapping', op: 'add', dept_pattern: 'Soft Drinks', nominal_code: 4005, tax_rate_id: 'GB_HALF' })).status).toBe(400);
    const r = await call({ action: 'mapping', op: 'add', dept_pattern: 'Soft Drinks', nominal_code: 4005, ledger_name: 'Bar sales - Soft drinks (4005)', tax_rate_id: 'GB_LOWER' });
    expect(r.status).toBe(200);
    expect(r.json.mappings).toHaveLength(10);
  });

  it('guards posting to live: confirmation phrase and go-live date, before touching any network', async () => {
    expect((await call({ action: 'post', date: '2026-09-20', role: 'live' })).json.error).toMatch(/POST TO LIVE/);
    expect((await call({ action: 'post', date: '2026-09-20', role: 'live', confirm: 'POST TO LIVE' })).json.error).toMatch(/before the go-live date/);
    expect((await call({ action: 'post', date: '2099-01-01', role: 'test' })).json.error).toMatch(/completed days/);
  });

  it('lets the scheduled caller in with the bearer, but only for cron and check', async () => {
    vi.stubEnv('DEV', false);   // no dev fallback identity: behave as deployed
    try {
      expect((await call({ action: 'config', mode: 'dry_run' }, { bearer: 's3cret' })).status).toBe(403);
      expect((await call({ action: 'config', mode: 'dry_run' }, { bearer: 'wrong' })).status).toBe(403);
      expect((await call({ action: 'config', mode: 'dry_run' }, { user: false })).status).toBe(403);
      expect((await call({ action: 'check', dates: [] }, { bearer: 's3cret' })).status).toBe(400);   // authorised, then validated
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
