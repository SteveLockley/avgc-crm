/**
 * Member matching for candidate payments.
 * Matches TouchOffice receipt names/discount cards to CRM members.
 */

export type MatchStatus = 'matched' | 'no_match' | 'ambiguous' | 'card_mismatch';

export interface MatchResult {
  status: MatchStatus;
  memberId: number | null;
  memberName: string | null;
}

export interface InvoiceMatchResult {
  matches: boolean;
  invoiceId: number | null;
  invoiceTotal: number | null;
  invoiceStatus: string | null;
  /** Items on the invoice not covered by this payment */
  outstandingItems: { name: string; qty: number; amount: number }[];
  /** Items in the payment that exceed what's on the invoice (e.g., extra locker) */
  extraItems: { name: string; qty: number; amount: number }[];
  /** Family invoices included in the match (when payer covers dependants) */
  familyInvoices?: { invoiceId: number; memberId: number; memberName: string; total: number }[];
}

/**
 * Try to match a TouchOffice receipt name + discount card to a CRM member.
 * 1. Split name — last word = surname, rest = first_name
 * 2. Query members by name
 * 3. Check discount card conflicts
 * 4. Optionally store discount card on matched member
 */
export async function matchMember(
  db: any,
  memberName: string | null,
  discountCard: string | null
): Promise<MatchResult> {
  if (!memberName) {
    return { status: 'no_match', memberId: null, memberName: null };
  }

  // Split name: last word = surname, rest = first name
  const parts = memberName.trim().split(/\s+/);
  if (parts.length < 2) {
    return { status: 'no_match', memberId: null, memberName: null };
  }

  const surname = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');

  // Query members by surname (exact) and first_name (starts with)
  const results = await db.prepare(
    `SELECT id, first_name, surname, discount_card FROM members
     WHERE LOWER(surname) = LOWER(?) AND LOWER(first_name) LIKE LOWER(?)`
  ).bind(surname, `${firstName}%`).all();

  const members = results.results || [];

  if (members.length === 0) {
    return { status: 'no_match', memberId: null, memberName: null };
  }

  if (members.length > 1) {
    return { status: 'ambiguous', memberId: null, memberName: null };
  }

  // Exactly one match
  const member = members[0] as any;

  // Check discount card conflict
  if (discountCard && member.discount_card && member.discount_card !== discountCard) {
    return { status: 'card_mismatch', memberId: member.id, memberName: `${member.first_name} ${member.surname}` };
  }

  // Store discount card on member if we have one and they don't
  if (discountCard && !member.discount_card) {
    await db.prepare(
      `UPDATE members SET discount_card = ? WHERE id = ?`
    ).bind(discountCard, member.id).run();
  }

  return {
    status: 'matched',
    memberId: member.id,
    memberName: `${member.first_name} ${member.surname}`,
  };
}

/**
 * Check if a member has an outstanding invoice and compare line items.
 * Returns item-level matching: which items are covered, outstanding, or extra.
 */
export async function checkInvoiceMatch(
  db: any,
  memberId: number,
  amount: number,
  crmItems: CrmLineItem[] = []
): Promise<InvoiceMatchResult> {
  const empty: InvoiceMatchResult = {
    matches: false, invoiceId: null, invoiceTotal: null, invoiceStatus: null,
    outstandingItems: [], extraItems: [],
  };

  // Find matching invoice — prefer unpaid, but also check paid invoices
  // First try unpaid invoices (draft/sent)
  let invoice = await db.prepare(
    `SELECT id, total, status FROM invoices
     WHERE member_id = ? AND status IN ('draft', 'sent')
     ORDER BY invoice_date DESC
     LIMIT 1`
  ).bind(memberId).first<{ id: number; total: number; status: string }>();

  // If no unpaid invoice, check paid invoices (may have been manually marked)
  if (!invoice) {
    invoice = await db.prepare(
      `SELECT id, total, status FROM invoices
       WHERE member_id = ? AND status = 'paid'
       ORDER BY invoice_date DESC
       LIMIT 1`
    ).bind(memberId).first<{ id: number; total: number; status: string }>();
  }

  if (!invoice) return empty;

  // Check for family dependants (members whose family_payer_id = this member)
  const familyResult = await db.prepare(
    `SELECT m.id, m.first_name, m.surname FROM members m WHERE m.family_payer_id = ?`
  ).bind(memberId).all();
  const familyMembers = (familyResult.results || []) as { id: number; first_name: string; surname: string }[];

  // Collect all invoices: payer's own + family members'
  const allInvoices: { invoiceId: number; memberId: number; memberName: string; total: number }[] = [];
  let combinedTotal = invoice.total;

  // Get family member invoices
  for (const fm of familyMembers) {
    const famInvoice = await db.prepare(
      `SELECT id, total, status FROM invoices
       WHERE member_id = ? AND status IN ('draft', 'sent')
       ORDER BY invoice_date DESC LIMIT 1`
    ).bind(fm.id).first<{ id: number; total: number; status: string }>();
    if (famInvoice) {
      allInvoices.push({
        invoiceId: famInvoice.id,
        memberId: fm.id,
        memberName: `${fm.first_name} ${fm.surname}`,
        total: famInvoice.total,
      });
      combinedTotal += famInvoice.total;
    }
  }

  // Get invoice line items for ALL invoices (payer + family)
  const allInvoiceIds = [invoice.id, ...allInvoices.map(fi => fi.invoiceId)];
  const placeholders = allInvoiceIds.map(() => '?').join(',');
  const invoiceItemsResult = await db.prepare(
    `SELECT ii.quantity, ii.unit_price,
            COALESCE(pi.name, REPLACE(ii.description, ' subscription', '')) as name
     FROM invoice_items ii
     LEFT JOIN payment_items pi ON ii.payment_item_id = pi.id
     WHERE ii.invoice_id IN (${placeholders})`
  ).bind(...allInvoiceIds).all();
  const invoiceItems = (invoiceItemsResult.results || []) as { name: string; quantity: number; unit_price: number }[];

  // Compare payment items vs invoice items
  const outstandingItems: { name: string; qty: number; amount: number }[] = [];
  const extraItems: { name: string; qty: number; amount: number }[] = [];

  // Build maps by item name — aggregate quantities across all invoices
  // Strip "(Member Name)" suffix from consolidated family items for matching
  const invoiceMap = new Map<string, { qty: number; amount: number }>();
  for (const ii of invoiceItems) {
    // "Junior (Members Family) (Flora McQueen)" → "Junior (Members Family)"
    const name = ii.name.replace(/\s+\([A-Z][a-z]+ [A-Z][a-z]+\)$/, '');
    const existing = invoiceMap.get(name);
    if (existing) {
      existing.qty += ii.quantity;
    } else {
      invoiceMap.set(name, { qty: ii.quantity, amount: ii.unit_price });
    }
  }

  const paidMap = new Map<string, { qty: number; amount: number }>();
  for (const ci of crmItems) {
    paidMap.set(ci.name, { qty: ci.qty, amount: ci.amount });
  }

  // Find outstanding items (on invoice but not fully covered by payment)
  // Skip zero-amount items — they don't represent a real outstanding balance
  for (const [name, inv] of invoiceMap) {
    if (inv.amount <= 0) continue;
    const paid = paidMap.get(name);
    if (!paid) {
      outstandingItems.push({ name, qty: inv.qty, amount: inv.amount });
    } else if (paid.qty < inv.qty) {
      outstandingItems.push({ name, qty: inv.qty - paid.qty, amount: inv.amount });
    }
  }

  // Find extra items (in payment but not on invoice, or more than invoiced)
  for (const [name, paid] of paidMap) {
    const inv = invoiceMap.get(name);
    if (!inv) {
      extraItems.push({ name, qty: paid.qty, amount: paid.amount });
    } else if (paid.qty > inv.qty) {
      extraItems.push({ name, qty: paid.qty - inv.qty, amount: paid.amount });
    }
  }

  // Match against combined total (payer + family) or just payer's total
  const exactMatch = Math.abs(amount - combinedTotal) < 0.01
    || Math.abs(amount - invoice.total) < 0.01;

  return {
    matches: exactMatch,
    invoiceId: invoice.id,
    invoiceTotal: combinedTotal,
    invoiceStatus: invoice.status,
    outstandingItems,
    extraItems,
    familyInvoices: allInvoices.length > 0 ? allInvoices : undefined,
  };
}

export interface CrmLineItem {
  name: string;
  qty: number;
  amount: number;
}

/**
 * Map TouchOffice receipt line items to CRM payment item names.
 * Patterns:
 * - "Locker" £10 → Locker
 * - "Y) England Golf & Union" £18.50 → England Golf + Northumberland County
 * - "A) Full Home" £450.50 → Full + England Golf + Northumberland County
 * - "B) Full Away" £432 → Full
 */
export function mapToCrmItems(
  toItems: { description: string; qty: number; amount: number }[],
  paymentItems: { name: string; fee: number; category: string }[]
): CrmLineItem[] {
  const EGU_FEE = paymentItems.find(p => p.name === 'England Golf')?.fee || 12;
  const COUNTY_FEE = paymentItems.find(p => p.name === 'Northumberland County')?.fee || 6.5;
  const EGU_COUNTY_TOTAL = EGU_FEE + COUNTY_FEE;

  const result: CrmLineItem[] = [];

  for (const item of toItems) {
    const unitAmount = Math.round((item.amount / Math.abs(item.qty)) * 100) / 100;
    const absQty = Math.abs(item.qty);

    // 1. Direct match to a single payment item
    const directMatch = paymentItems.find(p => p.fee === unitAmount);
    if (directMatch) {
      result.push({ name: directMatch.name, qty: absQty, amount: directMatch.fee });
      continue;
    }

    // 2. Check if amount = subscription + EGU + County
    const subAmount = Math.round((unitAmount - EGU_COUNTY_TOTAL) * 100) / 100;
    const subMatch = paymentItems.find(p => p.fee === subAmount && p.category === 'Subscription');
    if (subMatch) {
      result.push({ name: subMatch.name, qty: absQty, amount: subMatch.fee });
      result.push({ name: 'England Golf', qty: absQty, amount: EGU_FEE });
      result.push({ name: 'Northumberland County', qty: absQty, amount: COUNTY_FEE });
      continue;
    }

    // 3. Check if amount is EGU + County combined
    if (Math.abs(unitAmount - EGU_COUNTY_TOTAL) < 0.01) {
      result.push({ name: 'England Golf', qty: absQty, amount: EGU_FEE });
      result.push({ name: 'Northumberland County', qty: absQty, amount: COUNTY_FEE });
      continue;
    }

    // 4. Unknown — skip non-membership items (food, drink, green fees etc.)
  }

  // Merge items with same name
  const merged = new Map<string, CrmLineItem>();
  for (const item of result) {
    const existing = merged.get(item.name);
    if (existing) {
      existing.qty += item.qty;
    } else {
      merged.set(item.name, { ...item });
    }
  }

  return Array.from(merged.values());
}
