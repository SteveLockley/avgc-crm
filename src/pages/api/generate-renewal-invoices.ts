// API endpoint to generate invoices for members who received renewal emails
// POST /api/generate-renewal-invoices { emailType: 'dd_renewal' | 'bacs_renewal' | 'social_renewal', year?: number }
// Uses sent_emails as source of truth — only invoices members who were successfully emailed
// Skips members who already have a non-cancelled invoice for the period
// Batch processes up to 40 per request with remaining count for auto-continue
//
// DD invoices are created as 'paid' with payment + payment_line_items records,
// since DD payments are assumed to succeed. If a DD invoice is later cancelled,
// the existing cancel flow in [id].astro handles the balance adjustment.

import type { APIRoute } from 'astro';

const BATCH_SIZE = 40;

interface InvoiceLineItem {
  paymentItemId: number | null;
  description: string;
  unitPrice: number;
}

/**
 * Calculate invoice line items for a member using category-based fee lookup.
 * This matches the renewal email logic exactly:
 * - Subscription fee from payment_items where name = member.category
 * - England Golf + County for home members with CDH (not out of county)
 * - England Golf only for out-of-county members with CDH + handicap
 * - Locker fee if member has locker
 * - Social members: subscription only (no EGU/county/locker)
 */
function calculateLineItems(
  member: any,
  feeItems: Record<string, { id: number; fee: number }>,
  isSocial: boolean
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];

  // 1. Subscription fee (already joined as subscription_fee)
  if (member.subscription_fee === null || member.subscription_fee === undefined) {
    return [];
  }
  items.push({
    paymentItemId: member.subscription_item_id || null,
    description: `${member.category} subscription`,
    unitPrice: member.subscription_fee,
  });

  // Social members get subscription only
  if (isSocial) return items;

  // 2. England Golf + County fees
  const hasCDH = !!member.national_id && String(member.national_id).trim() !== '';
  const isHome = member.home_away === 'H';
  const isOutOfCounty = (member.category || '').toLowerCase().includes('out of county');
  const hasHomeHandicap = member.handicap_index !== null && member.handicap_index !== undefined;

  if (hasCDH) {
    if (isHome && !isOutOfCounty) {
      // Home member with CDH → England Golf + Northumberland County
      if (feeItems['england golf']) {
        items.push({
          paymentItemId: feeItems['england golf'].id,
          description: 'England Golf',
          unitPrice: feeItems['england golf'].fee,
        });
      }
      if (feeItems['northumberland county']) {
        items.push({
          paymentItemId: feeItems['northumberland county'].id,
          description: 'Northumberland County',
          unitPrice: feeItems['northumberland county'].fee,
        });
      }
    } else if (isOutOfCounty && hasHomeHandicap) {
      // Out of county with CDH + handicap → England Golf only
      if (feeItems['england golf']) {
        items.push({
          paymentItemId: feeItems['england golf'].id,
          description: 'England Golf',
          unitPrice: feeItems['england golf'].fee,
        });
      }
    }
  }

  // 3. Locker fee
  if (member.locker_number && String(member.locker_number).trim() !== '') {
    if (feeItems['locker']) {
      items.push({
        paymentItemId: feeItems['locker'].id,
        description: 'Locker',
        unitPrice: feeItems['locker'].fee,
      });
    }
  }

  return items;
}

/**
 * Generate the next invoice number in sequence: INV-YYYY-NNN
 */
async function getNextInvoiceNumber(db: any, year: number): Promise<string> {
  const prefix = `INV-${year}-`;
  const last = await db.prepare(
    `SELECT invoice_number FROM invoices
     WHERE invoice_number LIKE ?
     ORDER BY invoice_number DESC LIMIT 1`
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

  let body: { emailType?: string; year?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const emailType = body.emailType;
  if (!emailType || !['dd_renewal', 'bacs_renewal', 'social_renewal'].includes(emailType)) {
    return new Response(JSON.stringify({ error: 'Invalid emailType. Must be dd_renewal, bacs_renewal, or social_renewal' }), { status: 400 });
  }

  const year = body.year || new Date().getFullYear();
  const periodStart = `${year}-04-01`;
  const periodEnd = `${year + 1}-03-31`;
  const isSocial = emailType === 'social_renewal';
  const isDD = emailType === 'dd_renewal';

  // Load fee items from payment_items (England Golf, County, Locker)
  const feeItemsResult = await env.DB.prepare(
    `SELECT id, name, fee FROM payment_items WHERE category = 'Fee' AND active = 1`
  ).all();

  const feeItems: Record<string, { id: number; fee: number }> = {};
  for (const item of feeItemsResult.results || []) {
    feeItems[(item.name as string).toLowerCase()] = {
      id: item.id as number,
      fee: item.fee as number,
    };
  }

  // Find members who were sent this email type but don't yet have an invoice for this period
  const members = await env.DB.prepare(
    `SELECT m.*, p.fee as subscription_fee, p.id as subscription_item_id
     FROM sent_emails se
     INNER JOIN members m ON m.id = se.member_id
     LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
     LEFT JOIN invoices inv ON inv.member_id = m.id
       AND inv.period_start = ? AND inv.period_end = ?
       AND inv.status != 'cancelled'
     WHERE se.email_type = ? AND se.year = ? AND se.status = 'sent'
       AND inv.id IS NULL
     GROUP BY m.id
     ORDER BY m.surname, m.first_name`
  ).bind(periodStart, periodEnd, emailType, year).all();

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
    const items = calculateLineItems(member, feeItems, isSocial);

    if (items.length === 0) {
      failed++;
      errors.push(`${member.first_name} ${member.surname}: No subscription fee for category ${member.category}`);
      continue;
    }

    const total = items.reduce((sum, item) => sum + item.unitPrice, 0);

    try {
      const invoiceNumber = await getNextInvoiceNumber(env.DB, year);

      // DD invoices are created as 'paid' since payment is assumed; others as 'draft'
      const invoiceStatus = isDD ? 'paid' : 'draft';

      // Insert invoice
      const invoiceResult = await env.DB.prepare(
        `INSERT INTO invoices (invoice_number, member_id, period_start, period_end, subtotal, total, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'renewal-batch')`
      ).bind(invoiceNumber, member.id, periodStart, periodEnd, total, total, invoiceStatus).run();

      // Get the inserted invoice ID
      const invoiceId = invoiceResult.meta?.last_row_id;
      if (!invoiceId) {
        failed++;
        errors.push(`${member.first_name} ${member.surname}: Failed to get invoice ID`);
        continue;
      }

      // Insert invoice line items
      const invoiceItemIds: { itemId: number; paymentItemId: number | null; description: string; amount: number }[] = [];
      for (const item of items) {
        const itemResult = await env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, payment_item_id, description, quantity, unit_price, line_total)
           VALUES (?, ?, ?, 1, ?, ?)`
        ).bind(invoiceId, item.paymentItemId, item.description, item.unitPrice, item.unitPrice).run();

        if (isDD) {
          invoiceItemIds.push({
            itemId: itemResult.meta?.last_row_id as number,
            paymentItemId: item.paymentItemId,
            description: item.description,
            amount: item.unitPrice,
          });
        }
      }

      // For DD invoices: create payment record + payment line items + set renewal date
      if (isDD) {
        await env.DB.prepare(
          `UPDATE members SET date_renewed = ? WHERE id = ?`
        ).bind(periodStart, member.id).run();

        const paymentResult = await env.DB.prepare(
          `INSERT INTO payments (member_id, invoice_id, amount, payment_date, payment_method, payment_type, reference, notes, recorded_by)
           VALUES (?, ?, ?, ?, 'Clubwise Direct Debit', 'subscription', ?, 'Auto-recorded from DD renewal', 'renewal-batch')`
        ).bind(member.id, invoiceId, total, periodStart, invoiceNumber).run();

        const paymentId = paymentResult.meta?.last_row_id;
        if (paymentId) {
          for (const ii of invoiceItemIds) {
            await env.DB.prepare(
              `INSERT INTO payment_line_items (payment_id, invoice_item_id, payment_item_id, description, amount)
               VALUES (?, ?, ?, ?, ?)`
            ).bind(paymentId, ii.itemId, ii.paymentItemId, ii.description, ii.amount).run();
          }
        }
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
