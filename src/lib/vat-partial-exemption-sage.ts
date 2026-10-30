// Fetches one period's figures from Sage for the partial exemption calculation.
// Read-only. Takes a plain `get` function so the CRM (SageClient) and local
// scripts (a token from D1) can both use it.

import {
  bucketOtherPayments, isMoneyIn, reconcile, reviewPoints,
  type Bucket, type Reconciliation, type ReviewPoint, type SageOtherPayment, type SageTrialBalanceRow,
} from './vat-partial-exemption';

export type SageGet = (path: string, params: Record<string, string>) => Promise<any>;

export interface VatPayment { date: string; amount: number; reference: string; bank: string }

export interface PeriodData {
  from: string;
  to: string;
  buckets: Bucket[];
  reconciliation: Reconciliation;
  review: ReviewPoint[];
  vatPayments: VatPayment[];
  counts: { receipts: number; payments: number };
  fetchedAt: string;
}

// Sage's proxy gives up after 27 seconds; 200 records a page with every
// attribute can exceed that, 50 a page does not.
const PAGE_SIZE = 50;
const RETRYABLE = /\((429|500|502|503|504)\)|\b(429|500|502|503|504)\b.*(Timeout|timed out)/i;

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i >= attempts || !RETRYABLE.test(String(e?.message ?? e))) throw e;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

async function getAllPages(get: SageGet, path: string, params: Record<string, string>): Promise<any[]> {
  const items: any[] = [];
  for (let page = 1; page <= 40; page++) {
    const data = await withRetry(() => get(path, { ...params, items_per_page: String(PAGE_SIZE), page: String(page) }));
    items.push(...(data?.$items ?? []));
    if (!data?.$next) break;
  }
  return items;
}

export async function fetchPeriodData(get: SageGet, from: string, to: string): Promise<PeriodData> {
  // Unfiltered, /other_payments returns receipts, payments and their refunds together.
  const records: SageOtherPayment[] & any[] = await getAllPages(get, '/other_payments', { from_date: from, to_date: to, attributes: 'all' });
  const tbRaw = await withRetry(() => get('/trial_balance', { from_date: from, to_date: to }));
  const tb: SageTrialBalanceRow[] = tbRaw?.ledger_accounts ?? [];

  const receipts = records.filter(r => isMoneyIn(r));
  const payments = records.filter(r => !isMoneyIn(r));
  const buckets = bucketOtherPayments(records);
  const reconciliation = reconcile(buckets, tb);

  const vatPayments: VatPayment[] = [];
  for (const p of payments) {
    for (const l of p.payment_lines ?? []) {
      if (/\(2202\)\s*$/.test(l.ledger_account?.displayed_as ?? '')) {
        vatPayments.push({
          date: p.date, amount: Number(l.net_amount) || 0,
          reference: p.reference ?? '', bank: p.bank_account?.displayed_as ?? '',
        });
      }
    }
  }

  return {
    from, to, buckets, reconciliation,
    review: reviewPoints(buckets, reconciliation),
    vatPayments,
    counts: { receipts: receipts.length, payments: payments.length },
    fetchedAt: new Date().toISOString(),
  };
}
