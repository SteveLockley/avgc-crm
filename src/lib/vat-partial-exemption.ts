// VAT partial exemption — quarterly de minimis calculation.
//
// Pure code: no Sage, no database, no DOM. The finance page runs it in the
// browser, the local script in Node, and the tests directly, so all three give
// the same answer. Sage access lives in vat-partial-exemption-sage.ts.
//
// The method follows the club's Q1 and Q2 2026 working papers:
//   • Supplies are receipts (the club is on cash accounting), classified by the
//     tax rate the club has applied in Sage, net of refunds.
//   • Input tax is attributed by ledger account: bar, food, merchandise and
//     buggy costs to taxable supplies; course costs to exempt supplies;
//     everything else is residual.
//   • Residual input tax is split by the values-based standard method
//     (VAT Regulations 1995 reg 101), recovery percentage rounded up.
//   • The three de minimis tests of VAT Notice 706 section 11 decide whether
//     the exempt input tax is recoverable anyway.

// ─── Types ───────────────────────────────────────────────────────────

export type Side = 'supply' | 'input';
export type SupplyClass = 'taxable' | 'exempt' | 'outside_scope' | 'incidental';
export type InputClass = 'taxable' | 'exempt' | 'residual' | 'excluded';

/** Receipts and payments summed by ledger account and Sage tax rate. */
export interface Bucket {
  /** Nominal code as a number (Sage shows both "0020" and "20" for the same account). */
  code: number;
  account: string;
  rate: string;          // Sage tax rate id, e.g. GB_STANDARD
  side: Side;
  /** Positive in the account's normal direction: income received, or cost paid. Net of refunds. */
  net: number;
  tax: number;
  lines: number;
}

export interface SupplyRow {
  account: string;
  code: number;
  rate: string;
  rateLabel: string;
  classification: SupplyClass;
  net: number;
  tax: number;
}

export interface InputRow {
  account: string;
  code: number;
  attribution: InputClass;
  net: number;
  tax: number;
}

export interface DeMinimisTest {
  key: 'simplified_1' | 'simplified_2' | 'standard';
  name: string;
  description: string;
  amount: number;
  amountLimit: number;
  share: number;          // percentage
  shareLabel: string;
  shareLimit: number;     // percentage
  pass: boolean;
}

export interface PartialExemptionResult {
  from: string;
  to: string;
  months: number;
  supplies: {
    rows: SupplyRow[];
    taxable: number;
    exempt: number;
    total: number;          // taxable + exempt — the standard method denominator
    outsideScope: number;
    incidental: number;
    outputTax: number;
    exemptPct: number;
  };
  inputs: {
    rows: InputRow[];
    taxable: number;        // input tax directly attributable to taxable supplies
    exempt: number;         // input tax directly attributable to exempt supplies
    residual: number;
    total: number;
    excludedNet: number;    // payments to HMRC etc., left out
  };
  method: {
    rawPct: number;
    recoveryPct: number;
    roundedUp: boolean;
    residualRecoverable: number;
    residualExempt: number;
  };
  exemptInputTax: number;
  exemptInputPct: number;
  deMinimis: {
    monthlyLimit: number;
    limit: number;
    tests: DeMinimisTest[];
    passed: boolean;
  };
  recoverable: number;
  restriction: number;
  vat: {
    outputTax: number;
    inputTax: number;
    unrestrictedPayable: number;
    adjustment: number;     // negative: the partial exemption adjustment to Box 4
    box4: number;
    payable: number;        // Box 5
  };
}

// ─── Rules ───────────────────────────────────────────────────────────

export const DE_MINIMIS_MONTHLY = 625;
/** Reg 101(4): round the recovery percentage up unless residual input tax averages over £400,000 a month. */
export const ROUND_UP_CEILING_MONTHLY = 400_000;

export const RULES = {
  /** Income left out of the standard method as outside the scope of VAT. */
  outsideScopeIncome: new Set([4900, 4910, 4950, 4999]),     // sundry income, donations, government grant
  /** Incidental financial income, which reg 101(3) excludes. */
  incidentalIncome: new Set([4970]),                         // bank interest
  /** Income coded "No VAT" that is an exempt supply rather than outside the scope. */
  noVatExemptIncome: new Set([4940]),                        // rental income — exempt supply of land
  /** Costs consumed wholly in making taxable supplies. */
  taxableInputs: new Set([5000, 5005, 5020, 5065, 7801]),    // bar, food, merchandise purchases; buggy costs
  /** Costs of the golf course — the asset through which the exempt sporting supplies are made. */
  exemptInputs: new Set([7010, 7300, 7400, 7820]),           // course wages, match expenses, course maintenance, cottage
  /** Not supplies to the club at all. */
  excludedInputs: new Set([2200, 2201, 2202]),               // VAT accounts — paying or receiving HMRC
  /** Wages carry no VAT; any input tax here is a coding error. */
  wagesAccounts: new Set([7000, 7010, 7020, 7030]),
};

export const ATTRIBUTION_TEXT: Record<Exclude<InputClass, 'excluded'>, string> = {
  taxable: 'Bar, food and merchandise purchases, and buggy costs. These are consumed wholly in making the club\'s taxable supplies.',
  exempt: 'Course maintenance, course wages, match expenses and cottage expenses. The golf course is the asset through which the exempt sporting supplies are made.',
  residual: 'Clubhouse and general overheads that support taxable and exempt activity together, such as utilities, cleaning, repairs, IT, professional fees, rent and plant.',
};

/**
 * Items where the coding the club uses is a judgement a reviewer may want to
 * revisit. Shown only when the account carries input tax in the period.
 */
export const JUDGEMENT_NOTES: Record<number, string> = {
  7100: 'Rent is treated as residual. If the rent is for land the course stands on, its input tax is attributable to exempt supplies instead.',
  20: 'Plant and machinery is treated as residual. Machinery used only on the course would be attributable to exempt supplies.',
  7801: 'Buggy costs are treated as attributable to taxable supplies because buggy hire is standard-rated.',
};

const RATE_LABELS: Record<string, string> = {
  GB_STANDARD: 'Standard', GB_ZERO: 'Zero rated', GB_LOWER: 'Lower 5%',
  GB_EXEMPT: 'Exempt', GB_NO_TAX: 'No VAT',
};

export function rateLabel(rate: string): string {
  return RATE_LABELS[rate] ?? rate.replace(/^GB_/, '').replace(/_/g, ' ').toLowerCase();
}

// ─── Helpers ─────────────────────────────────────────────────────────

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "Members Subscription (4030)" → 4030; "Plant and Machinery - Cost (0020)" → 20. */
export function codeOf(displayedAs: string | null | undefined): number | null {
  const m = displayedAs?.match(/\((\d+)\)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

export function sideOf(code: number): Side {
  return code >= 4000 && code < 5000 ? 'supply' : 'input';
}

export function classifySupply(code: number, rate: string): SupplyClass {
  if (RULES.incidentalIncome.has(code)) return 'incidental';
  if (RULES.outsideScopeIncome.has(code)) return 'outside_scope';
  if (rate === 'GB_EXEMPT') return 'exempt';
  if (rate === 'GB_NO_TAX') return RULES.noVatExemptIncome.has(code) ? 'exempt' : 'outside_scope';
  return 'taxable';
}

export function attributeInput(code: number): InputClass {
  if (RULES.excludedInputs.has(code)) return 'excluded';
  if (RULES.taxableInputs.has(code)) return 'taxable';
  if (RULES.exemptInputs.has(code)) return 'exempt';
  return 'residual';
}

// ─── Bucketing Sage receipts and payments ────────────────────────────

/** The parts of a Sage other_payment (receipt or payment) the calculation reads. */
export interface SageOtherPayment {
  transaction_type?: { id?: string } | null;
  payment_lines?: Array<{
    ledger_account?: { displayed_as?: string } | null;
    tax_rate?: { id?: string } | null;
    net_amount?: string | number | null;
    tax_amount?: string | number | null;
  }> | null;
}

/** Money in: a receipt, or the refund of a payment (Sage uses this for supplier refunds and some subscriptions). */
const MONEY_IN = new Set(['OTHER_RECEIPT', 'OTHER_PAYMENT_REFUND']);

export function isMoneyIn(rec: SageOtherPayment): boolean {
  return MONEY_IN.has(rec.transaction_type?.id ?? '');
}

/** Sum receipt and payment lines by account and tax rate, signed so refunds reduce the total. */
export function bucketOtherPayments(records: SageOtherPayment[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const rec of records) {
    const isReceipt = isMoneyIn(rec);
    for (const line of rec.payment_lines ?? []) {
      const account = line.ledger_account?.displayed_as ?? 'Unknown account';
      const code = codeOf(account);
      if (code === null) continue;
      const rate = line.tax_rate?.id ?? 'GB_NO_TAX';
      const side = sideOf(code);
      // Income is received on receipts; a payment against income is a refund.
      // Costs are paid on payments; a receipt against a cost is a refund.
      const sign = (side === 'supply') === isReceipt ? 1 : -1;
      const key = `${code}|${rate}`;
      const b = map.get(key) ?? { code, account, rate, side, net: 0, tax: 0, lines: 0 };
      b.net += sign * (Number(line.net_amount) || 0);
      b.tax += sign * (Number(line.tax_amount) || 0);
      b.lines += 1;
      map.set(key, b);
    }
  }
  return [...map.values()].map(b => ({ ...b, net: round2(b.net), tax: round2(b.tax) }));
}

/** Combine buckets from several periods (e.g. the quarters of a partial exemption year). */
export function mergeBuckets(...sets: Bucket[][]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const set of sets) {
    for (const b of set) {
      const key = `${b.code}|${b.rate}`;
      const m = map.get(key);
      if (m) { m.net = round2(m.net + b.net); m.tax = round2(m.tax + b.tax); m.lines += b.lines; }
      else map.set(key, { ...b });
    }
  }
  return [...map.values()];
}

// ─── The calculation ─────────────────────────────────────────────────

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

export function recoveryPercentage(taxable: number, total: number, residual: number, months: number) {
  if (total <= 0) return { rawPct: 100, recoveryPct: 100, roundedUp: false };
  const rawPct = (taxable / total) * 100;
  const roundUp = residual / Math.max(months, 1) <= ROUND_UP_CEILING_MONTHLY;
  // Trim float noise first so an exact 60% stays 60 rather than rounding up to 61.
  const recoveryPct = roundUp ? Math.ceil(Math.round(rawPct * 1e6) / 1e6) : round2(rawPct);
  return { rawPct, recoveryPct: Math.min(100, Math.max(0, recoveryPct)), roundedUp: roundUp };
}

export function computePartialExemption(buckets: Bucket[], from: string, to: string): PartialExemptionResult {
  const months = monthsBetween(from, to);

  // Supplies
  const supplyRows: SupplyRow[] = buckets
    .filter(b => b.side === 'supply' && (b.net !== 0 || b.tax !== 0))
    .map(b => ({
      account: b.account, code: b.code, rate: b.rate, rateLabel: rateLabel(b.rate),
      classification: classifySupply(b.code, b.rate), net: b.net, tax: b.tax,
    }))
    .sort((a, b) => b.net - a.net);
  const sumSupply = (c: SupplyClass) => round2(supplyRows.filter(r => r.classification === c).reduce((s, r) => s + r.net, 0));
  const taxableSupplies = sumSupply('taxable');
  const exemptSupplies = sumSupply('exempt');
  const totalSupplies = round2(taxableSupplies + exemptSupplies);
  const outputTax = round2(supplyRows.reduce((s, r) => s + r.tax, 0));

  // Input tax, one row per account
  const byAccount = new Map<number, InputRow>();
  for (const b of buckets.filter(x => x.side === 'input')) {
    const row = byAccount.get(b.code) ?? { account: b.account, code: b.code, attribution: attributeInput(b.code), net: 0, tax: 0 };
    row.net = round2(row.net + b.net);
    row.tax = round2(row.tax + b.tax);
    byAccount.set(b.code, row);
  }
  const inputRows = [...byAccount.values()]
    .filter(r => r.net !== 0 || r.tax !== 0)
    .sort((a, b) => b.tax - a.tax || b.net - a.net);
  const counted = inputRows.filter(r => r.attribution !== 'excluded');
  const sumInput = (c: InputClass) => round2(counted.filter(r => r.attribution === c).reduce((s, r) => s + r.tax, 0));
  const taxableInput = sumInput('taxable');
  const exemptInput = sumInput('exempt');
  const residualInput = sumInput('residual');
  const totalInput = round2(taxableInput + exemptInput + residualInput);
  const excludedNet = round2(inputRows.filter(r => r.attribution === 'excluded').reduce((s, r) => s + r.net, 0));

  // Standard method
  const pct = recoveryPercentage(taxableSupplies, totalSupplies, residualInput, months);
  const residualRecoverable = round2(residualInput * pct.recoveryPct / 100);
  const residualExempt = round2(residualInput - residualRecoverable);
  const exemptInputTax = round2(exemptInput + residualExempt);

  // De minimis
  const limit = DE_MINIMIS_MONTHLY * months;
  const exemptPct = totalSupplies > 0 ? (exemptSupplies / totalSupplies) * 100 : 0;
  const exemptInputPct = totalInput > 0 ? (exemptInputTax / totalInput) * 100 : 0;
  const notTaxableDirect = round2(totalInput - taxableInput);
  const tests: DeMinimisTest[] = [
    {
      key: 'simplified_1', name: 'Simplified Test One',
      description: 'Total input tax for the period, and exempt supplies as a share of total supplies',
      amount: totalInput, amountLimit: limit, share: exemptPct, shareLabel: 'of supplies', shareLimit: 50,
      pass: totalInput <= limit && exemptPct <= 50,
    },
    {
      key: 'simplified_2', name: 'Simplified Test Two',
      description: 'Total input tax less input tax directly attributable to taxable supplies, and exempt supplies as a share of total supplies',
      amount: notTaxableDirect, amountLimit: limit, share: exemptPct, shareLabel: 'of supplies', shareLimit: 50,
      pass: notTaxableDirect <= limit && exemptPct <= 50,
    },
    {
      key: 'standard', name: 'The de minimis limit',
      description: 'Input tax attributable to exempt supplies (direct plus the exempt share of residual), and that figure as a share of total input tax',
      amount: exemptInputTax, amountLimit: limit, share: exemptInputPct, shareLabel: 'of input tax', shareLimit: 50,
      pass: exemptInputTax <= limit && exemptInputPct <= 50,
    },
  ];
  const passed = tests.some(t => t.pass);

  const restriction = passed ? 0 : exemptInputTax;
  const recoverable = round2(totalInput - restriction);
  const unrestrictedPayable = round2(outputTax - totalInput);

  return {
    from, to, months,
    supplies: {
      rows: supplyRows, taxable: taxableSupplies, exempt: exemptSupplies, total: totalSupplies,
      outsideScope: sumSupply('outside_scope'), incidental: sumSupply('incidental'), outputTax, exemptPct,
    },
    inputs: { rows: inputRows, taxable: taxableInput, exempt: exemptInput, residual: residualInput, total: totalInput, excludedNet },
    method: { ...pct, residualRecoverable, residualExempt },
    exemptInputTax, exemptInputPct,
    deMinimis: { monthlyLimit: DE_MINIMIS_MONTHLY, limit, tests, passed },
    recoverable, restriction,
    vat: {
      outputTax, inputTax: totalInput, unrestrictedPayable,
      adjustment: -restriction, box4: recoverable, payable: round2(outputTax - recoverable),
    },
  };
}

// ─── Trial balance reconciliation and review points ──────────────────

/** A trial balance row as Sage returns it from /trial_balance. */
export interface SageTrialBalanceRow {
  displayed_as: string;
  debit?: string | number;
  credit?: string | number;
  closing_balance?: { debit?: string | number; credit?: string | number } | null;
}

export interface ReconciliationRow {
  account: string;
  code: number;
  fromLines: number;      // debit-positive
  trialBalance: number;   // debit-positive movement
  difference: number;
}

export interface Reconciliation {
  rows: ReconciliationRow[];          // every P&L and fixed asset account with activity
  differences: ReconciliationRow[];
  agrees: boolean;
  vatOnSales: { fromLines: number; trialBalance: number };     // credit-positive
  vatOnPurchases: { fromLines: number; trialBalance: number }; // debit-positive
  vatLiabilityClosing: number | null;                           // credit-positive (owed to HMRC)
}

const num = (v: unknown) => Number(v) || 0;

/** Check the receipts and payments used account by account against Sage's own trial balance movements. */
export function reconcile(buckets: Bucket[], tb: SageTrialBalanceRow[]): Reconciliation {
  const lines = new Map<number, { account: string; debit: number }>();
  for (const b of buckets) {
    const debit = b.side === 'supply' ? -b.net : b.net;
    const cur = lines.get(b.code) ?? { account: b.account, debit: 0 };
    cur.debit += debit;
    lines.set(b.code, cur);
  }
  const tbByCode = new Map<number, { account: string; debit: number; closing: number }>();
  for (const r of tb) {
    const code = codeOf(r.displayed_as);
    if (code === null) continue;
    const cur = tbByCode.get(code) ?? { account: r.displayed_as, debit: 0, closing: 0 };
    cur.debit += num(r.debit) - num(r.credit);
    cur.closing += num(r.closing_balance?.debit) - num(r.closing_balance?.credit);
    tbByCode.set(code, cur);
  }
  const inScope = (code: number) => code >= 4000 || code < 1000;   // P&L and fixed asset cost accounts
  const codes = new Set([...lines.keys(), ...tbByCode.keys()].filter(inScope));
  const rows: ReconciliationRow[] = [...codes].sort((a, b) => a - b).map(code => {
    const fromLines = round2(lines.get(code)?.debit ?? 0);
    const trialBalance = round2(tbByCode.get(code)?.debit ?? 0);
    return { account: lines.get(code)?.account ?? tbByCode.get(code)!.account, code, fromLines, trialBalance, difference: round2(trialBalance - fromLines) };
  }).filter(r => r.fromLines !== 0 || r.trialBalance !== 0);
  const differences = rows.filter(r => Math.abs(r.difference) >= 0.01);

  const outputTax = round2(buckets.filter(b => b.side === 'supply').reduce((s, b) => s + b.tax, 0));
  const inputTax = round2(buckets.filter(b => b.side === 'input' && !RULES.excludedInputs.has(b.code)).reduce((s, b) => s + b.tax, 0));
  const liability = tbByCode.get(2202);
  return {
    rows, differences, agrees: differences.length === 0,
    vatOnSales: { fromLines: outputTax, trialBalance: round2(-(tbByCode.get(2200)?.debit ?? 0)) },
    vatOnPurchases: { fromLines: inputTax, trialBalance: round2(tbByCode.get(2201)?.debit ?? 0) },
    vatLiabilityClosing: liability ? round2(-liability.closing) : null,
  };
}

export interface ReviewPoint { level: 'warn' | 'info'; text: string }

const gbp = (n: number) => '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Things a reviewer should look at before the figures go into a return. */
export function reviewPoints(buckets: Bucket[], rec: Reconciliation | null): ReviewPoint[] {
  const out: ReviewPoint[] = [];
  if (rec) {
    for (const d of rec.differences) {
      out.push({ level: 'warn', text: `${d.account}: Sage's trial balance moved ${gbp(d.trialBalance)} but receipts and payments account for ${gbp(d.fromLines)}. Something other than a receipt or payment, such as a journal, an invoice or a VAT return adjustment, touches this account and is not in the calculation.` });
    }
    const sales = rec.vatOnSales, purchases = rec.vatOnPurchases;
    if (Math.abs(sales.fromLines - sales.trialBalance) >= 0.01 || Math.abs(purchases.fromLines - purchases.trialBalance) >= 0.01) {
      out.push({ level: 'info', text: `VAT on Sales and VAT on Purchases in the trial balance (${gbp(sales.trialBalance)} and ${gbp(purchases.trialBalance)}) differ from the receipts and payments (${gbp(sales.fromLines)} and ${gbp(purchases.fromLines)}). This is expected once the return has been submitted, because Sage then moves the balances to VAT Liability. Otherwise a journal has been posted to a VAT account.` });
    }
    if (rec.vatLiabilityClosing !== null && rec.vatLiabilityClosing < -1) {
      out.push({ level: 'warn', text: `VAT Liability (2202) ends the period ${gbp(rec.vatLiabilityClosing)} in debit, meaning Sage shows more paid to HMRC than was owed. Check whether a VAT payment has been recorded twice.` });
    }
  }
  for (const b of buckets) {
    if (b.side === 'input' && RULES.wagesAccounts.has(b.code) && Math.abs(b.tax) >= 0.01) {
      out.push({ level: 'warn', text: `${gbp(b.tax)} of input tax is coded to ${b.account}. Wages carry no VAT, so this looks miscoded.` });
    }
    if (b.side === 'supply' && b.rate === 'GB_NO_TAX' && !RULES.noVatExemptIncome.has(b.code) && !RULES.outsideScopeIncome.has(b.code) && !RULES.incidentalIncome.has(b.code) && b.net !== 0) {
      out.push({ level: 'info', text: `${gbp(b.net)} of ${b.account} is coded "No VAT" and is treated as outside the scope. If it is a supply, recode it as standard, zero-rated or exempt.` });
    }
  }
  const taxByCode = new Map<number, number>();
  for (const b of buckets) if (b.side === 'input') taxByCode.set(b.code, (taxByCode.get(b.code) ?? 0) + b.tax);
  for (const [code, note] of Object.entries(JUDGEMENT_NOTES)) {
    const tax = taxByCode.get(Number(code)) ?? 0;
    if (Math.abs(tax) >= 0.01) out.push({ level: 'info', text: `${note} Input tax ${gbp(tax)}.` });
  }
  return out;
}

// ─── VAT quarters and the partial exemption year ─────────────────────

export interface VatPeriod { from: string; to: string; label: string; key: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1-based

/** The club's VAT quarters end in March, June, September and December. */
export function vatQuarter(year: number, q: 1 | 2 | 3 | 4): VatPeriod {
  const m1 = (q - 1) * 3 + 1, m3 = m1 + 2;
  return {
    from: `${year}-${pad(m1)}-01`,
    to: `${year}-${pad(m3)}-${pad(lastDay(year, m3))}`,
    label: `${MONTHS[m1 - 1]}–${MONTHS[m3 - 1]} ${year}`,
    key: `${year}-Q${q}`,
  };
}

export function quarterContaining(isoDate: string): VatPeriod {
  const [y, m] = isoDate.split('-').map(Number);
  return vatQuarter(y, (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4);
}

export function previousQuarter(p: VatPeriod): VatPeriod {
  const [y, m] = p.from.split('-').map(Number);
  return m === 1 ? vatQuarter(y - 1, 4) : quarterContaining(`${y}-${pad(m - 3)}-01`);
}

/** The latest quarter that has ended on or before `today`. */
export function lastCompletedQuarter(today: string): VatPeriod {
  return previousQuarter(quarterContaining(today));
}

/** HMRC's deadline: one calendar month and seven days after the period ends. */
export function returnDueDate(p: VatPeriod): string {
  // Quarters end on a month end, so "one month later" is the end of the next month (30 Jun → 7 Aug).
  const [y, m] = p.to.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const d = new Date(Date.UTC(ny, nm - 1, lastDay(ny, nm)));
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * The partial exemption tax year runs to the end of the VAT period ending in
 * March, April or May — for this club, 1 April to 31 March. Returns the quarters
 * of that year up to and including `p`.
 */
export function partialExemptionYearTo(p: VatPeriod): VatPeriod[] {
  const [y, m] = p.from.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const quarters: VatPeriod[] = [];
  let q = vatQuarter(startYear, 2);
  while (q.from <= p.from) {
    quarters.push(q);
    const [qy, qm] = q.from.split('-').map(Number);
    q = qm === 10 ? vatQuarter(qy + 1, 1) : quarterContaining(`${qy}-${pad(qm + 3)}-01`);
  }
  return quarters;
}
