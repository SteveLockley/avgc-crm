// API endpoint to generate standalone fee invoices for eligible members
// POST /api/generate-fee-invoices { feeType: 'locker' | 'egu' | 'county' | 'egu_county', year?: number }
// Creates invoices for members who don't already have that fee on an existing invoice for the period
// Batch processes up to 40 per request with remaining count for auto-continue

import type { APIRoute } from 'astro';

const BATCH_SIZE = 40;

type FeeType = 'locker' | 'egu' | 'county' | 'egu_county';

const FEE_CONFIG: Record<FeeType, {
  label: string;
  feeNames: string[];  // payment_items.name values (lowercase)
  memberFilter: string;
  memberBinds?: string[];
}> = {
  locker: {
    label: 'Locker',
    feeNames: ['locker'],
    memberFilter: `m.locker_number IS NOT NULL AND m.locker_number != '' AND LOWER(m.category) NOT LIKE '%social%'`,
  },
  egu: {
    label: 'England Golf',
    feeNames: ['england golf'],
    memberFilter: `m.national_id IS NOT NULL AND m.national_id != '' AND LOWER(m.category) NOT LIKE '%social%'`,
  },
  county: {
    label: 'Northumberland County',
    feeNames: ['northumberland county'],
    memberFilter: `m.national_id IS NOT NULL AND m.national_id != '' AND m.home_away = 'H' AND LOWER(m.category) NOT LIKE '%out of county%' AND LOWER(m.category) NOT LIKE '%social%'`,
  },
  egu_county: {
    label: 'EGU + County',
    feeNames: ['england golf', 'northumberland county'],
    memberFilter: `m.national_id IS NOT NULL AND m.national_id != '' AND m.home_away = 'H' AND LOWER(m.category) NOT LIKE '%out of county%' AND LOWER(m.category) NOT LIKE '%social%'`,
  },
};

async function getNextInvoiceNumber(db: any, year: number): Promise<string> {
  const prefix = `INV-${year}-`;
  const last = await db.prepare(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`
  ).bind(`${prefix}%`).first();

  let seq = 1;
  if (last?.invoice_number) {
    const parts = (last.invoice_number as string).split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { feeType?: string; year?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const feeType = body.feeType as FeeType;
  if (!feeType || !FEE_CONFIG[feeType]) {
    return new Response(JSON.stringify({ error: 'Invalid feeType' }), { status: 400 });
  }

  const config = FEE_CONFIG[feeType];
  const year = body.year || new Date().getFullYear();
  const periodStart = `${year}-04-01`;
  const periodEnd = `${year + 1}-03-31`;

  // Load fee items from payment_items
  const feeItemsResult = await env.DB.prepare(
    `SELECT id, LOWER(name) as name, fee FROM payment_items WHERE category = 'Fee' AND active = 1`
  ).all();

  const feeItems: Record<string, { id: number; fee: number }> = {};
  for (const item of feeItemsResult.results || []) {
    feeItems[item.name as string] = { id: item.id as number, fee: item.fee as number };
  }

  // Check all required fee items exist
  for (const feeName of config.feeNames) {
    if (!feeItems[feeName]) {
      return new Response(JSON.stringify({ error: `Fee item '${feeName}' not found in payment_items` }), { status: 400 });
    }
  }

  // Build payment_item_id list for duplicate check
  const feeItemIds = config.feeNames.map(n => feeItems[n].id);
  const idPlaceholders = feeItemIds.map(() => '?').join(',');

  // Find eligible members who don't already have this fee on an invoice for the period
  const members = await env.DB.prepare(
    `SELECT m.id, m.first_name, m.surname, m.email, m.category, m.default_payment_method
     FROM members m
     WHERE ${config.memberFilter}
       AND m.id NOT IN (
         SELECT DISTINCT i.member_id
         FROM invoices i
         JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE i.period_start = ? AND i.period_end = ? AND i.status != 'cancelled'
           AND ii.payment_item_id IN (${idPlaceholders})
       )
     ORDER BY m.surname, m.first_name`
  ).bind(periodStart, periodEnd, ...feeItemIds).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({
      success: true, created: 0, failed: 0, remaining: 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const totalRemaining = members.results.length;
  const batch = members.results.slice(0, BATCH_SIZE);

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of batch) {
    try {
      const invoiceNumber = await getNextInvoiceNumber(env.DB, year);
      const lineItems = config.feeNames.map(n => ({
        paymentItemId: feeItems[n].id,
        description: n.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        fee: feeItems[n].fee,
      }));

      const total = lineItems.reduce((sum, item) => sum + item.fee, 0);

      const invoiceResult = await env.DB.prepare(
        `INSERT INTO invoices (invoice_number, member_id, invoice_date, period_start, period_end, subtotal, total, status, created_by)
         VALUES (?, ?, date('now'), ?, ?, ?, ?, 'draft', 'fee-batch')`
      ).bind(invoiceNumber, member.id, periodStart, periodEnd, total, total).run();

      const invoiceId = invoiceResult.meta?.last_row_id;
      if (!invoiceId) {
        failed++;
        errors.push(`${member.first_name} ${member.surname}: Failed to get invoice ID`);
        continue;
      }

      for (const item of lineItems) {
        await env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, payment_item_id, description, quantity, unit_price, line_total)
           VALUES (?, ?, ?, 1, ?, ?)`
        ).bind(invoiceId, item.paymentItemId, item.description, item.fee, item.fee).run();
      }

      created++;
    } catch (err: any) {
      failed++;
      errors.push(`${member.first_name} ${member.surname}: ${err.message || 'Unknown error'}`);
    }
  }

  const remaining = totalRemaining - batch.length;

  return new Response(JSON.stringify({
    success: true, created, failed, remaining,
    errors: errors.length > 0 ? errors : undefined,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
