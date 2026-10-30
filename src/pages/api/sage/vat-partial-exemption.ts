import type { APIRoute } from 'astro';
import { createSageClient } from '@/lib/sage';
import { fetchPeriodData } from '@/lib/vat-partial-exemption-sage';
import { monthsBetween } from '@/lib/vat-partial-exemption';

/**
 * GET /api/sage/vat-partial-exemption?from=2026-07-01&to=2026-09-30
 *
 * Read-only. Returns one period's receipts and payments from Sage, summed by
 * ledger account and tax rate, with the trial balance reconciliation and review
 * points. The finance page runs the calculation itself from these figures, so a
 * partial exemption year is built by calling this once per quarter.
 *
 * At most three months per call: about ten Sage requests a quarter, well inside
 * the Workers subrequest limit.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function isMonthStart(d: string) { return ISO.test(d) && d.endsWith('-01'); }
function isMonthEnd(d: string) {
  if (!ISO.test(d)) return false;
  const next = new Date(d + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB || !env?.SAGE_CLIENT_ID || !env?.SAGE_CLIENT_SECRET) return json({ error: 'Sage is not configured.' }, 500);

  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!isMonthStart(from) || !isMonthEnd(to) || to < from) {
    return json({ error: 'from must be the first day of a month and to the last day of a month.' }, 400);
  }
  if (monthsBetween(from, to) > 3) return json({ error: 'Ask for one VAT quarter at a time.' }, 400);

  try {
    const client = createSageClient(env);
    const data = await fetchPeriodData((path, params) => client.get(path, params), from, to);
    return json(data);
  } catch (err: any) {
    if (err?.message === 'NO_SAGE_CONNECTION') return json({ error: 'The CRM is not connected to Sage. Connect it from the Sage pages first.' }, 401);
    console.error('VAT partial exemption fetch failed:', err);
    return json({ error: err?.message ?? 'Sage request failed.' }, 502);
  }
};
