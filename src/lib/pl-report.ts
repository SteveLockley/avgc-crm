// Monthly Income & Expenditure (cash based) summary — derived from Sage trial balance.
// A top summary (Income / Cost of Sales / Wages / Other Expenses / Surplus) plus
// four department sections: Clubhouse, Membership, Course and Other. Every income
// and expense line belongs to exactly one section, so the four section subtotals
// add up to the summary's Surplus /(Deficit).

import { createSageClient } from './sage';

export interface PLLine {
  label: string;
  thisYear: number;
  lastYear: number;
  variancePct: number | null;
}

export interface PLReportData {
  periodEnd: string;       // 'YYYY-MM-DD', last day of the reporting month
  periodLabel: string;     // '1 Jan - 31 May 26'
  runDate: string;         // ISO timestamp when computed
  income: {
    clubhouseSales: PLLine;
    membership: PLLine;
    otherIncome: PLLine;
    total: PLLine;
  };
  costOfSales: PLLine;
  wages: PLLine;
  otherExpenses: PLLine;
  totalExpenses: PLLine;
  netProfit: PLLine;
  clubhouse: {
    sales: PLLine;
    purchases: PLLine;
    wages: PLLine;
    subtotal: PLLine;
  };
  membership: {
    subscriptions: PLLine;
    subtotal: PLLine;
  };
  course: {
    wages: PLLine;
    maintenance: PLLine;
    subtotal: PLLine;
  };
  other: {
    otherIncome: PLLine;
    utilities: PLLine;
    otherOverheads: PLLine;
    subtotal: PLLine;
  };
  /** Shape used by snapshots generated before the Membership/Other split. */
  otherCosts?: {
    utilities: PLLine;
    otherOverheads: PLLine;
  };
}

// Nominal code groupings, keyed by the 4-digit Sage code found in `displayed_as`
// (e.g. "Bar Sales (4000)"). Any income/expense code not listed here falls back
// to "Other Income" / "Other Overheads" respectively.
const CLUBHOUSE_SALES_CODES = new Set([4000, 4010, 4020, 4040, 4050, 4060, 4070]); // Bar, Food, Coffee Machine, Visiting Green Fees, Buggies, Locker, Merchandise
const MEMBERSHIP_CODES      = new Set([4030]);                              // Members Subscription
const COST_OF_SALES_CODES   = new Set([5000, 5020, 5065]);                  // Bar, Food, Merchandise purchases
const WAGES_CODES           = new Set([7000, 7010]);                        // Clubhouse Wages, Course Wages
const COURSE_MAINT_CODES    = new Set([7400]);                              // Course Maintenance
const UTILITIES_CODES       = new Set([7110, 7200, 7210]);                  // Water Rates, Electricity, Gas & Oil

function extractCode(displayedAs: string): number | null {
  const m = displayedAs?.match(/\((\d+)\)\s*$/);
  return m ? parseInt(m[1]) : null;
}

function accountType(code: number): 'income' | 'expense' | null {
  if (code >= 4000 && code < 5000) return 'income';
  if (code >= 5000 && code < 9000) return 'expense';
  if (code === 9999) return 'expense'; // Suspense — the club's accountant folds this into Other Overheads
  return null;
}

// credit - debit for income accounts, debit - credit for expense accounts —
// both conventions yield a positive number for a normal-direction balance.
function lineValue(item: any, type: 'income' | 'expense'): number {
  const credit = parseFloat(item.credit) || 0;
  const debit = parseFloat(item.debit) || 0;
  return type === 'income' ? credit - debit : debit - credit;
}

function sumByCodes(items: any[], codes: Set<number>, type: 'income' | 'expense'): number {
  return items
    .filter(i => { const c = extractCode(i.displayed_as); return c !== null && codes.has(c) && accountType(c) === type; })
    .reduce((s, i) => s + lineValue(i, type), 0);
}

function sumFallback(items: any[], excludeCodes: Set<number>, type: 'income' | 'expense'): number {
  return items
    .filter(i => {
      const c = extractCode(i.displayed_as);
      return c !== null && accountType(c) === type && !excludeCodes.has(c);
    })
    .reduce((s, i) => s + lineValue(i, type), 0);
}

function variancePct(thisYear: number, lastYear: number): number | null {
  if (!lastYear) return null;
  return Math.round(((thisYear - lastYear) / Math.abs(lastYear)) * 100);
}

function line(label: string, thisYear: number, lastYear: number): PLLine {
  return { label, thisYear, lastYear, variancePct: variancePct(thisYear, lastYear) };
}

/** Last day of the given 'YYYY-MM' month, as 'YYYY-MM-DD'. */
export function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  return d.toISOString().slice(0, 10);
}

function formatPeriodLabel(periodEnd: string): string {
  const d = new Date(periodEnd + 'T00:00:00Z');
  const day = d.getUTCDate();
  const month = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const yy = String(d.getUTCFullYear()).slice(2);
  return `1 Jan - ${day} ${month} ${yy}`;
}

function priorYearSameDate(periodEnd: string): string {
  const d = new Date(periodEnd + 'T00:00:00Z');
  const year = d.getUTCFullYear() - 1;
  // Handle 29 Feb on a non-leap prior year by falling back to 28 Feb.
  const candidate = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));
  if (candidate.getUTCMonth() !== d.getUTCMonth()) {
    candidate.setUTCDate(0); // roll back to last day of the intended month
  }
  return candidate.toISOString().slice(0, 10);
}

export async function computePLReport(
  env: { SAGE_CLIENT_ID?: string; SAGE_CLIENT_SECRET?: string; DB: any },
  periodEnd: string // 'YYYY-MM-DD'
): Promise<PLReportData> {
  const thisYearStart = `${periodEnd.slice(0, 4)}-01-01`;
  const lastYearEnd = priorYearSameDate(periodEnd);
  const lastYearStart = `${lastYearEnd.slice(0, 4)}-01-01`;

  const client = createSageClient(env as any);
  const [tbThisRaw, tbLastRaw] = await Promise.all([
    client.getTrialBalance(thisYearStart, periodEnd) as Promise<any>,
    client.getTrialBalance(lastYearStart, lastYearEnd) as Promise<any>,
  ]);

  const tbThis: any[] = tbThisRaw?.ledger_accounts ?? [];
  const tbLast: any[] = tbLastRaw?.ledger_accounts ?? [];

  function build(items: any[]) {
    const clubhouseSales = sumByCodes(items, CLUBHOUSE_SALES_CODES, 'income');
    const membership     = sumByCodes(items, MEMBERSHIP_CODES, 'income');
    const otherIncome    = sumFallback(items, new Set([...CLUBHOUSE_SALES_CODES, ...MEMBERSHIP_CODES]), 'income');
    const totalIncome    = clubhouseSales + membership + otherIncome;

    const costOfSales    = sumByCodes(items, COST_OF_SALES_CODES, 'expense');
    const wages           = sumByCodes(items, WAGES_CODES, 'expense');
    const courseMaint     = sumByCodes(items, COURSE_MAINT_CODES, 'expense');
    const utilities        = sumByCodes(items, UTILITIES_CODES, 'expense');
    const otherOverheads   = sumFallback(items, new Set([...COST_OF_SALES_CODES, ...WAGES_CODES, ...COURSE_MAINT_CODES, ...UTILITIES_CODES]), 'expense');
    const otherExpenses    = courseMaint + utilities + otherOverheads;
    const totalExpenses    = wages + otherExpenses;
    const netProfit        = totalIncome - costOfSales - totalExpenses;

    const clubhouseWages   = sumByCodes(items, new Set([7000]), 'expense');
    const courseWages      = sumByCodes(items, new Set([7010]), 'expense');
    // Section subtotals. Between them these cover every income and expense line
    // exactly once, so clubhouse + membership + course + other === netProfit.
    const clubhouseSubtotal  = clubhouseSales - costOfSales - clubhouseWages;
    const membershipSubtotal = membership;
    const courseSubtotal     = -(courseWages + courseMaint);
    const otherSubtotal      = otherIncome - utilities - otherOverheads;

    return {
      clubhouseSales, membership, otherIncome, totalIncome,
      costOfSales, wages, otherExpenses, totalExpenses, netProfit,
      clubhouseWages, courseWages, courseMaint, utilities, otherOverheads,
      clubhouseSubtotal, membershipSubtotal, courseSubtotal, otherSubtotal,
    };
  }

  const t = build(tbThis);
  const l = build(tbLast);

  return {
    periodEnd,
    periodLabel: formatPeriodLabel(periodEnd),
    runDate: new Date().toISOString(),
    income: {
      clubhouseSales: line('Clubhouse Sales', t.clubhouseSales, l.clubhouseSales),
      membership: line('Membership', t.membership, l.membership),
      otherIncome: line('Other Income', t.otherIncome, l.otherIncome),
      total: line('Total Income', t.totalIncome, l.totalIncome),
    },
    costOfSales: line('Cost of Sales', t.costOfSales, l.costOfSales),
    wages: line('Wages', t.wages, l.wages),
    otherExpenses: line('Other Expenses', t.otherExpenses, l.otherExpenses),
    totalExpenses: line('Total Expenses', t.totalExpenses, l.totalExpenses),
    netProfit: line('Surplus /(Deficit)', t.netProfit, l.netProfit),
    clubhouse: {
      sales: line('Clubhouse Sales', t.clubhouseSales, l.clubhouseSales),
      purchases: line('Clubhouse Purchases', t.costOfSales, l.costOfSales),
      wages: line('Clubhouse Wages', t.clubhouseWages, l.clubhouseWages),
      subtotal: line('Clubhouse Total', t.clubhouseSubtotal, l.clubhouseSubtotal),
    },
    membership: {
      subscriptions: line('Members Subscriptions', t.membership, l.membership),
      subtotal: line('Membership Total', t.membershipSubtotal, l.membershipSubtotal),
    },
    course: {
      wages: line('Course Wages', t.courseWages, l.courseWages),
      maintenance: line('Course Maintenance', t.courseMaint, l.courseMaint),
      subtotal: line('Course Total', t.courseSubtotal, l.courseSubtotal),
    },
    other: {
      otherIncome: line('Other Income', t.otherIncome, l.otherIncome),
      utilities: line('Utilities', t.utilities, l.utilities),
      otherOverheads: line('Other Overheads', t.otherOverheads, l.otherOverheads),
      subtotal: line('Other Total', t.otherSubtotal, l.otherSubtotal),
    },
  };
}
