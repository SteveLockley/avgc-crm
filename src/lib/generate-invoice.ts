// Shared invoice generation logic used by renewal email endpoints
// Creates an invoice (with line items) for a member when a renewal notice is sent.
// DD invoices are created as 'paid' with payment + payment_line_items records.
// BACS/Social invoices are created as 'draft'.

interface InvoiceLineItem {
  paymentItemId: number | null;
  description: string;
  unitPrice: number;
}

/**
 * Calculate invoice line items for a member using category-based fee lookup.
 * - Subscription fee from payment_items where name = member.category
 * - England Golf + County for home members with CDH (not out of county)
 * - England Golf only for out-of-county HOME members with CDH + handicap
 *   (Away out-of-county members pay EGU at their home club)
 * - Locker fee if member has locker
 * - Social members: subscription only (no EGU/county/locker)
 */
export function calculateLineItems(
  member: any,
  feeItems: Record<string, { id: number; fee: number }>,
  isSocial: boolean
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];

  if (member.subscription_fee === null || member.subscription_fee === undefined) {
    return [];
  }
  items.push({
    paymentItemId: member.subscription_item_id || null,
    description: `${member.category} subscription`,
    unitPrice: member.subscription_fee,
  });

  if (isSocial) return items;

  const hasCDH = !!member.national_id && String(member.national_id).trim() !== '';
  const isHome = member.home_away === 'H';
  const isOutOfCounty = (member.category || '').toLowerCase().includes('out of county');
  const hasHomeHandicap = member.handicap_index !== null && member.handicap_index !== undefined;

  if (hasCDH) {
    if (isHome && !isOutOfCounty) {
      if (feeItems['england golf']) {
        items.push({ paymentItemId: feeItems['england golf'].id, description: 'England Golf', unitPrice: feeItems['england golf'].fee });
      }
      if (feeItems['northumberland county']) {
        items.push({ paymentItemId: feeItems['northumberland county'].id, description: 'Northumberland County', unitPrice: feeItems['northumberland county'].fee });
      }
    } else if (isOutOfCounty && isHome && hasHomeHandicap) {
      if (feeItems['england golf']) {
        items.push({ paymentItemId: feeItems['england golf'].id, description: 'England Golf', unitPrice: feeItems['england golf'].fee });
      }
    }
  }

  if (member.locker_number && String(member.locker_number).trim() !== '') {
    if (feeItems['locker']) {
      items.push({ paymentItemId: feeItems['locker'].id, description: 'Locker', unitPrice: feeItems['locker'].fee });
    }
  }

  return items;
}

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

/**
 * Load fee items from payment_items table (England Golf, County, Locker etc.)
 */
export async function loadFeeItems(db: any): Promise<Record<string, { id: number; fee: number }>> {
  const result = await db.prepare(
    `SELECT id, name, fee FROM payment_items WHERE category = 'Fee' AND active = 1`
  ).all();

  const feeItems: Record<string, { id: number; fee: number }> = {};
  for (const item of result.results || []) {
    feeItems[(item.name as string).toLowerCase()] = {
      id: item.id as number,
      fee: item.fee as number,
    };
  }
  return feeItems;
}

/**
 * Generate an invoice for a member after a renewal notice is sent.
 * Skips if member already has a non-cancelled invoice for the period.
 *
 * @param db - D1 database binding
 * @param member - Member row (must include subscription_fee, subscription_item_id, and member fields)
 * @param feeItems - Fee items lookup from loadFeeItems()
 * @param options - { year, isDD, isSocial }
 * @returns { success: true, invoiceNumber } or { success: false, error }
 */
export async function generateInvoiceForMember(
  db: any,
  member: any,
  feeItems: Record<string, { id: number; fee: number }>,
  options: { year: number; isDD: boolean; isSocial: boolean; periodStart?: string; periodEnd?: string }
): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  const { year, isDD, isSocial } = options;
  const periodStart = options.periodStart || `${year}-04-01`;
  const periodEnd = options.periodEnd || `${year + 1}-03-31`;

  // Check for existing non-cancelled invoice
  const existing = await db.prepare(
    `SELECT id FROM invoices WHERE member_id = ? AND period_start = ? AND period_end = ? AND status != 'cancelled' LIMIT 1`
  ).bind(member.id, periodStart, periodEnd).first();

  if (existing) {
    return { success: true, invoiceNumber: 'already_exists' };
  }

  const items = calculateLineItems(member, feeItems, isSocial);
  if (items.length === 0) {
    return { success: false, error: `No subscription fee for category ${member.category}` };
  }

  const total = items.reduce((sum, item) => sum + item.unitPrice, 0);

  try {
    const invoiceNumber = await getNextInvoiceNumber(db, year);
    const invoiceStatus = isDD ? 'paid' : 'draft';

    const invoiceResult = await db.prepare(
      `INSERT INTO invoices (invoice_number, member_id, period_start, period_end, subtotal, total, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'renewal-batch')`
    ).bind(invoiceNumber, member.id, periodStart, periodEnd, total, total, invoiceStatus).run();

    const invoiceId = invoiceResult.meta?.last_row_id;
    if (!invoiceId) {
      return { success: false, error: 'Failed to get invoice ID' };
    }

    const invoiceItemIds: { itemId: number; paymentItemId: number | null; description: string; amount: number }[] = [];
    for (const item of items) {
      const itemResult = await db.prepare(
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

    // For non-DD (draft) invoices: add total to account balance as outstanding
    if (!isDD) {
      await db.prepare(
        `UPDATE members SET account_balance = account_balance + ? WHERE id = ?`
      ).bind(total, member.id).run();
    }

    // For DD invoices: create payment record + payment line items + set renewal/expires/paid dates
    if (isDD) {
      await db.prepare(
        `UPDATE members SET date_renewed = ?, date_expires = ?, date_subscription_paid = ? WHERE id = ?`
      ).bind(periodStart, periodEnd, periodStart, member.id).run();

      const paymentResult = await db.prepare(
        `INSERT INTO payments (member_id, invoice_id, amount, payment_date, payment_method, payment_type, reference, notes, recorded_by)
         VALUES (?, ?, ?, ?, 'Clubwise Direct Debit', 'subscription', ?, 'Auto-recorded from DD renewal', 'renewal-batch')`
      ).bind(member.id, invoiceId, total, periodStart, invoiceNumber).run();

      const paymentId = paymentResult.meta?.last_row_id;
      if (paymentId) {
        for (const ii of invoiceItemIds) {
          await db.prepare(
            `INSERT INTO payment_line_items (payment_id, invoice_item_id, payment_item_id, description, amount)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(paymentId, ii.itemId, ii.paymentItemId, ii.description, ii.amount).run();
        }
      }
    }

    return { success: true, invoiceNumber };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}
