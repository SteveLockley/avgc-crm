import type { APIRoute } from 'astro';
import { ensureSession, loginForSession, fetchMembershipSalesList, fetchSaleReceipt } from '../../lib/touchoffice';
import { matchMember, checkInvoiceMatch, mapToCrmItems, coalesceCandidates } from '../../lib/candidate-matching';
import { parseBacsFile, isNonMembershipPayment, matchBacsMember } from '../../lib/bacs-parser';
import { sendEmail } from '../../lib/email';
import { generateWelcomeEmail, generateWelcomeEmailSubject } from '../../lib/welcome-email';

/** Send welcome email if member is new (joined this year) and hasn't received one yet */
async function sendWelcomeIfNew(db: any, env: any, memberId: number) {
  const member = await db.prepare(
    'SELECT first_name, surname, pin, email, date_joined FROM members WHERE id = ?'
  ).bind(memberId).first<{ first_name: string; surname: string; pin: string; email: string; date_joined: string }>();

  if (!member?.pin || !member?.email || !member.date_joined) return;

  const now = new Date();
  const yearStart = now.getMonth() >= 3
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1);
  if (new Date(member.date_joined) < yearStart) return;

  const alreadySent = await db.prepare(
    "SELECT id FROM sent_emails WHERE member_id = ? AND email_type = 'welcome'"
  ).bind(memberId).first();
  if (alreadySent) return;

  const html = generateWelcomeEmail(member);
  const result = await sendEmail({
    to: member.email,
    subject: generateWelcomeEmailSubject(),
    html
  }, env);

  await db.prepare(
    `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error)
     VALUES (?, 'welcome', ?, ?, ?, ?)`
  ).bind(memberId, member.email, now.getFullYear(), result.success ? 'sent' : 'failed', result.error || null).run();
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const env = locals.runtime.env;

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'sync':
        return await handleSync(db, env, body);
      case 'list':
        return await handleList(db, body);
      case 'process':
        return await handleProcess(db, body, locals);
      case 'dismiss':
        return await handleDismiss(db, body);
      case 'link-invoice':
        return await handleLinkInvoice(db, body);
      case 'search-invoices':
        return await handleSearchInvoices(db, body);
      case 'process-all':
        return await handleProcessAll(db, locals);
      case 'reinvoice':
        return await handleReinvoice(db, body, locals);
      case 'send-outstanding-reminder':
        return await handleSendOutstandingReminder(db, body, locals);
      case 'import-bacs':
        return await handleImportBacs(db, body);
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
};

/**
 * Create payment_line_items for a payment by matching CRM items to invoice items.
 * Returns the count of line items created.
 */
async function createPaymentLineItems(
  db: any,
  paymentId: number,
  invoiceId: number | null,
  crmItems: { name: string; qty: number; amount: number }[]
): Promise<number> {
  if (!invoiceId || crmItems.length === 0) return 0;

  // Get invoice items to look up invoice_item_id and payment_item_id
  const invoiceItemsResult = await db.prepare(
    `SELECT ii.id as invoice_item_id, ii.payment_item_id,
            COALESCE(pi.name, REPLACE(ii.description, ' subscription', '')) as name
     FROM invoice_items ii
     LEFT JOIN payment_items pi ON ii.payment_item_id = pi.id
     WHERE ii.invoice_id = ?`
  ).bind(invoiceId).all();
  const invoiceItems = (invoiceItemsResult.results || []) as {
    invoice_item_id: number; payment_item_id: number | null; name: string;
  }[];

  // Build lookup by name
  const invoiceItemMap = new Map<string, { invoice_item_id: number; payment_item_id: number | null }>();
  for (const ii of invoiceItems) {
    invoiceItemMap.set(ii.name, { invoice_item_id: ii.invoice_item_id, payment_item_id: ii.payment_item_id });
  }

  let count = 0;
  for (const item of crmItems) {
    const match = invoiceItemMap.get(item.name);
    // Also look up payment_item_id directly if not on the invoice
    let paymentItemId = match?.payment_item_id || null;
    if (!paymentItemId) {
      const pi = await db.prepare(
        `SELECT id FROM payment_items WHERE name = ? AND active = 1`
      ).bind(item.name).first<{ id: number }>();
      paymentItemId = pi?.id || null;
    }

    await db.prepare(
      `INSERT INTO payment_line_items (payment_id, invoice_item_id, payment_item_id, description, amount)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      paymentId,
      match?.invoice_item_id || null,
      paymentItemId,
      item.name,
      item.amount * item.qty,
    ).run();
    count++;
  }

  return count;
}

/**
 * Sync: fetch new sales from TouchOffice, parse receipts, match members, insert into DB.
 */
async function handleSync(db: any, env: any, body: any) {
  let { session } = await ensureSession(db, env);

  // Get latest sale_date from candidate_payments or default to 01/02/{year}
  const latest = await db.prepare(
    `SELECT MAX(sale_date) as last_date FROM candidate_payments`
  ).first<{ last_date: string | null }>();

  const now = new Date();
  const year = now.getFullYear();
  let startDate: string;
  let startTime = '00:00';

  if (latest?.last_date) {
    // Stored as "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
    const [datePart, timePart] = latest.last_date.split(' ');
    const parts = datePart.split('-');
    if (parts.length === 3 && !isNaN(Number(parts[0]))) {
      startDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      if (timePart) startTime = timePart.substring(0, 5); // HH:MM
    } else {
      startDate = `01/02/${year}`;
    }
  } else {
    startDate = `01/02/${year}`;
  }

  const endDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  // Fetch sales list from TouchOffice dept 6 — retry with fresh login if session expired
  let sales;
  try {
    sales = await fetchMembershipSalesList(session, startDate, endDate, startTime);
  } catch (err: any) {
    if (err.message?.includes('Session expired')) {
      // Force fresh login and retry
      ({ session } = await loginForSession(env.TOUCHOFFICE_USERNAME, env.TOUCHOFFICE_PASSWORD));
      await db.prepare(
        `INSERT INTO app_settings (key, value) VALUES ('touchoffice_session', ?)
         ON CONFLICT(key) DO UPDATE SET value = ?`
      ).bind(session, session).run();
      sales = await fetchMembershipSalesList(session, startDate, endDate, startTime);
    } else {
      throw err;
    }
  }

  // Load known subscription/fee items for filtering and name mapping
  const paymentItemsResult = await db.prepare(
    `SELECT name, fee, category FROM payment_items WHERE active = 1 AND fee > 0`
  ).all();
  const paymentItems = (paymentItemsResult.results || []) as { name: string; fee: number; category: string }[];
  let fetched = sales.length;
  let newCount = 0;
  let matched = 0;
  let skipped = 0;

  for (const sale of sales) {
    // Check if we already have this sale as a candidate or recorded payment
    const existing = await db.prepare(
      `SELECT id FROM candidate_payments WHERE sale_id = ?`
    ).bind(sale.saleId).first();
    if (existing) continue;

    const alreadyPaid = await db.prepare(
      `SELECT id FROM payments WHERE reference = ?`
    ).bind(`TouchOffice Sale ${sale.saleId}`).first();
    if (alreadyPaid) continue;

    // Fetch the receipt for this sale
    let receipt;
    try {
      receipt = await fetchSaleReceipt(session, sale.saleId);
    } catch (err: any) {
      // Skip this sale if we can't fetch the receipt
      continue;
    }

    // Map TouchOffice items to CRM payment item names and filter to membership items
    const crmItems = mapToCrmItems(receipt.lineItems, paymentItems);

    // Skip sales with no membership items
    if (crmItems.length === 0) {
      skipped++;
      continue;
    }

    // Match member
    const matchResult = await matchMember(db, receipt.memberName, receipt.discountCard);

    // Check invoice match using the full sale amount and compare line items
    let invoiceMatch = { matches: false, invoiceId: null as number | null, invoiceTotal: null as number | null, invoiceStatus: null as string | null, outstandingItems: [] as any[], extraItems: [] as any[] };
    if (matchResult.memberId) {
      invoiceMatch = await checkInvoiceMatch(db, matchResult.memberId, receipt.total, crmItems);
    }

    // Convert sale date from "DD/MM/YYYY - HH:MM:SS" to YYYY-MM-DD HH:MM:SS for storage
    const [dateStr, timeStr] = sale.date.split(' - ');
    const dateOnly = dateStr.split(' ')[0]; // strip any extra whitespace
    const dateParts = dateOnly.split('/');
    const saleDate = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}${timeStr ? ' ' + timeStr.trim() : ''}`
      : sale.date;

    // Insert — store membership items only, but keep full amount for payment matching
    await db.prepare(
      `INSERT INTO candidate_payments
        (sale_id, sale_date, amount, member_name, discount_card, payment_type,
         line_items, receipt_text, matched_member_id, match_status,
         amount_matches_invoice, matched_invoice_id, invoice_total,
         outstanding_items, extra_items, family_invoices)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sale.saleId,
      saleDate,
      receipt.total,
      receipt.memberName,
      receipt.discountCard,
      receipt.paymentType,
      JSON.stringify(crmItems),
      receipt.rawText,
      matchResult.memberId,
      matchResult.status,
      invoiceMatch.matches ? 1 : 0,
      invoiceMatch.invoiceId,
      invoiceMatch.invoiceTotal,
      invoiceMatch.outstandingItems.length > 0 ? JSON.stringify(invoiceMatch.outstandingItems) : null,
      invoiceMatch.extraItems.length > 0 ? JSON.stringify(invoiceMatch.extraItems) : null,
      invoiceMatch.familyInvoices ? JSON.stringify(invoiceMatch.familyInvoices) : null,
    ).run();

    newCount++;
    if (matchResult.status === 'matched') matched++;
  }

  // Post-sync: coalesce multiple unprocessed candidates for the same member
  // e.g., £10 Locker + £490.50 subscription = £500.50 covering one invoice
  const coalesced = await coalesceCandidates(db);

  return json({ success: true, fetched, new: newCount, matched, skipped, coalesced });
}

/**
 * List candidate payments with optional filters.
 */
async function handleList(db: any, body: any) {
  const { processed = 0, limit = 50, offset = 0 } = body;

  const results = await db.prepare(
    `SELECT cp.*,
            m.first_name as m_first_name, m.surname as m_surname,
            i.invoice_number
     FROM candidate_payments cp
     LEFT JOIN members m ON cp.matched_member_id = m.id
     LEFT JOIN invoices i ON cp.matched_invoice_id = i.id
     WHERE cp.processed = ?
     ORDER BY cp.sale_date DESC, cp.id DESC
     LIMIT ? OFFSET ?`
  ).bind(processed, limit, offset).all();

  const countResult = await db.prepare(
    `SELECT COUNT(*) as count FROM candidate_payments WHERE processed = ?`
  ).bind(processed).first<{ count: number }>();

  return json({
    success: true,
    payments: results.results || [],
    total: countResult?.count || 0,
  });
}

/**
 * Process a candidate payment — create a real payment and link to invoice.
 */
async function handleProcess(db: any, body: any, locals: any) {
  const { candidateId, invoiceId } = body;

  const candidate = await db.prepare(
    `SELECT * FROM candidate_payments WHERE id = ? AND processed = 0`
  ).bind(candidateId).first<any>();

  if (!candidate) {
    return json({ error: 'Candidate payment not found or already processed' }, 404);
  }

  if (!candidate.matched_member_id) {
    return json({ error: 'No matched member — cannot process' }, 400);
  }

  const targetInvoiceId = invoiceId || candidate.matched_invoice_id;
  const familyInvoices = candidate.family_invoices ? JSON.parse(candidate.family_invoices) : [];

  // Calculate combined total (payer + family)
  let combinedTotal = 0;
  if (targetInvoiceId) {
    const invoice = await db.prepare(
      `SELECT total FROM invoices WHERE id = ?`
    ).bind(targetInvoiceId).first<{ total: number }>();
    combinedTotal = invoice?.total || 0;
    for (const fi of familyInvoices) {
      combinedTotal += fi.total;
    }

    if (Math.abs(candidate.amount - combinedTotal) > 0.01) {
      return json({ error: 'Partial payment — reinvoice first or wait for full payment' }, 400);
    }
  }

  // Create the real payment
  const isBacs = candidate.payment_source === 'bacs';
  const paymentMethod = isBacs ? 'BACS' : candidate.payment_type === 'card' ? 'Card' : candidate.payment_type === 'cheque' ? 'Cheque' : 'Cash';
  const coalescedSaleIds = candidate.coalesced_sale_ids ? JSON.parse(candidate.coalesced_sale_ids) : [];
  const allSaleIds = [candidate.sale_id, ...coalescedSaleIds];
  const reference = isBacs
    ? `BACS ${candidate.sale_id}`
    : allSaleIds.length > 1
      ? `TouchOffice Sales ${allSaleIds.join(', ')}`
      : `TouchOffice Sale ${candidate.sale_id}`;

  let notes = isBacs
    ? `Auto-matched from BACS import.`
    : `Auto-matched from TouchOffice. Card: ${candidate.discount_card || 'N/A'}`;
  if (!isBacs && coalescedSaleIds.length > 0) {
    notes = `Combined from ${allSaleIds.length} TouchOffice sales. Card: ${candidate.discount_card || 'N/A'}`;
  }
  if (familyInvoices.length > 0) {
    notes = `Family payment covering ${familyInvoices.map((fi: any) => fi.memberName).join(', ')}. ${notes}`;
  }

  const paymentResult = await db.prepare(
    `INSERT INTO payments (member_id, invoice_id, amount, payment_date, payment_method, payment_type, reference, notes, recorded_by)
     VALUES (?, ?, ?, ?, ?, 'subscription', ?, ?, ?)`
  ).bind(
    candidate.matched_member_id,
    targetInvoiceId,
    candidate.amount,
    candidate.sale_date,
    paymentMethod,
    reference,
    notes,
    locals.user?.email || 'system',
  ).run();

  const paymentId = paymentResult.meta.last_row_id;

  // Create payment line items from CRM items — covers all invoices
  const crmItems = candidate.line_items ? JSON.parse(candidate.line_items) : [];
  const allInvoiceIds = [targetInvoiceId, ...familyInvoices.map((fi: any) => fi.invoiceId)];
  // Create line items against each invoice
  for (const invId of allInvoiceIds) {
    await createPaymentLineItems(db, paymentId, invId, crmItems);
  }

  // Mark payer's invoice as paid and update member dates
  if (targetInvoiceId) {
    await db.prepare(
      `UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ?`
    ).bind(candidate.sale_date, targetInvoiceId).run();

    // Set renewal/expiry dates on payer
    const inv = await db.prepare(
      `SELECT period_start, period_end FROM invoices WHERE id = ?`
    ).bind(targetInvoiceId).first<{ period_start: string; period_end: string }>();
    if (inv) {
      await db.prepare(
        `UPDATE members SET date_renewed = ?, date_expires = ?, date_subscription_paid = ? WHERE id = ?`
      ).bind(inv.period_start, inv.period_end, candidate.sale_date, candidate.matched_member_id).run();
    }
  }

  // Mark family invoices as paid
  for (const fi of familyInvoices) {
    await db.prepare(
      `UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ?`
    ).bind(candidate.sale_date, fi.invoiceId).run();

    // Decrement family member's account balance and set dates
    const famInv = await db.prepare(
      `SELECT period_start, period_end FROM invoices WHERE id = ?`
    ).bind(fi.invoiceId).first<{ period_start: string; period_end: string }>();
    await db.prepare(
      `UPDATE members SET account_balance = account_balance + ?, date_renewed = ?, date_expires = ?, date_subscription_paid = ? WHERE id = ?`
    ).bind(fi.total, famInv?.period_start || null, famInv?.period_end || null, candidate.sale_date, fi.memberId).run();
  }

  // Payment clears payer's debt (by payer's own invoice total, not full payment)
  const payerInvoiceTotal = combinedTotal - familyInvoices.reduce((sum: number, fi: any) => sum + fi.total, 0);
  await db.prepare(
    `UPDATE members SET account_balance = account_balance + ? WHERE id = ?`
  ).bind(payerInvoiceTotal, candidate.matched_member_id).run();

  // Mark candidate as processed
  await db.prepare(
    `UPDATE candidate_payments SET processed = 1, processed_at = datetime('now'), matched_invoice_id = ? WHERE id = ?`
  ).bind(targetInvoiceId, candidateId).run();

  // Send welcome email to new members (payer + family)
  const allMemberIds = [candidate.matched_member_id, ...familyInvoices.map((fi: any) => fi.memberId)];
  for (const mid of allMemberIds) {
    try {
      await sendWelcomeIfNew(db, locals.runtime.env, mid);
    } catch (e: any) {
      console.error('Welcome email error:', e.message);
    }
  }

  return json({ success: true, paymentId, familyInvoicesPaid: familyInvoices.length });
}

/**
 * Dismiss a candidate payment without creating a real payment.
 */
async function handleDismiss(db: any, body: any) {
  const { candidateId, notes } = body;

  const result = await db.prepare(
    `UPDATE candidate_payments SET processed = 1, processed_at = datetime('now'), notes = ? WHERE id = ? AND processed = 0`
  ).bind(notes || 'Dismissed', candidateId).run();

  if (result.meta.changes === 0) {
    return json({ error: 'Candidate not found or already processed' }, 404);
  }

  return json({ success: true });
}

/**
 * Manually link a candidate payment to an invoice by number.
 * Runs the same item-level comparison as the auto-match.
 */
async function handleLinkInvoice(db: any, body: any) {
  const { candidateId, invoiceNumber } = body;

  if (!candidateId || !invoiceNumber) {
    return json({ error: 'Missing candidateId or invoiceNumber' }, 400);
  }

  const candidate = await db.prepare(
    `SELECT * FROM candidate_payments WHERE id = ? AND processed = 0`
  ).bind(candidateId).first<any>();

  if (!candidate) {
    return json({ error: 'Candidate payment not found or already processed' }, 404);
  }

  // Look up invoice by number
  const invoice = await db.prepare(
    `SELECT id, total, status, member_id, invoice_number FROM invoices WHERE invoice_number = ?`
  ).bind(invoiceNumber.trim()).first<any>();

  if (!invoice) {
    return json({ error: `Invoice ${invoiceNumber} not found` }, 404);
  }

  // Get invoice line items for comparison
  const invoiceItemsResult = await db.prepare(
    `SELECT ii.quantity, ii.unit_price, pi.name
     FROM invoice_items ii
     LEFT JOIN payment_items pi ON ii.payment_item_id = pi.id
     WHERE ii.invoice_id = ?`
  ).bind(invoice.id).all();
  const invoiceItems = (invoiceItemsResult.results || []) as { name: string; quantity: number; unit_price: number }[];

  // Parse candidate's CRM items
  const crmItems = candidate.line_items ? JSON.parse(candidate.line_items) : [];

  // Compare items — aggregate invoice items by name (family items may have same pi.name)
  const invoiceMap = new Map<string, { qty: number; amount: number }>();
  for (const ii of invoiceItems) {
    const existing = invoiceMap.get(ii.name);
    if (existing) {
      existing.qty += ii.quantity;
    } else {
      invoiceMap.set(ii.name, { qty: ii.quantity, amount: ii.unit_price });
    }
  }
  const paidMap = new Map<string, { qty: number; amount: number }>();
  for (const ci of crmItems) {
    paidMap.set(ci.name, { qty: ci.qty, amount: ci.amount });
  }

  const outstandingItems: any[] = [];
  const extraItems: any[] = [];

  for (const [name, inv] of invoiceMap) {
    if (inv.amount <= 0) continue; // Skip zero-amount items
    const paid = paidMap.get(name);
    if (!paid) {
      outstandingItems.push({ name, qty: inv.qty, amount: inv.amount });
    } else if (paid.qty < inv.qty) {
      outstandingItems.push({ name, qty: inv.qty - paid.qty, amount: inv.amount });
    }
  }
  for (const [name, paid] of paidMap) {
    const inv = invoiceMap.get(name);
    if (!inv) {
      extraItems.push({ name, qty: paid.qty, amount: paid.amount });
    } else if (paid.qty > inv.qty) {
      extraItems.push({ name, qty: paid.qty - inv.qty, amount: paid.amount });
    }
  }

  const exactMatch = Math.abs(candidate.amount - invoice.total) < 0.01;

  // Look up the invoice's member name
  const member = await db.prepare(
    `SELECT id, first_name, surname FROM members WHERE id = ?`
  ).bind(invoice.member_id).first<any>();

  const matchStatus = member ? 'matched' : candidate.match_status;

  // Update the candidate payment with the linked invoice and member
  await db.prepare(
    `UPDATE candidate_payments
     SET matched_invoice_id = ?, amount_matches_invoice = ?,
         invoice_total = ?, outstanding_items = ?, extra_items = ?,
         matched_member_id = ?, match_status = ?
     WHERE id = ?`
  ).bind(
    invoice.id,
    exactMatch ? 1 : 0,
    invoice.total,
    outstandingItems.length > 0 ? JSON.stringify(outstandingItems) : null,
    extraItems.length > 0 ? JSON.stringify(extraItems) : null,
    invoice.member_id,
    matchStatus,
    candidateId,
  ).run();

  return json({
    success: true,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    invoiceTotal: invoice.total,
    exactMatch,
    outstandingItems,
    extraItems,
  });
}

/**
 * Search invoices by number fragment.
 */
async function handleSearchInvoices(db: any, body: any) {
  const { query } = body;
  if (!query) return json({ success: true, invoices: [] });

  const results = await db.prepare(
    `SELECT i.invoice_number, i.total, i.status, i.member_id,
            m.first_name, m.surname
     FROM invoices i
     LEFT JOIN members m ON i.member_id = m.id
     WHERE i.invoice_number LIKE ?
        OR m.first_name LIKE ? OR m.surname LIKE ?
     ORDER BY i.id DESC
     LIMIT 10`
  ).bind(`%${query}%`, `%${query}%`, `%${query}%`).all();

  const invoices = (results.results || []).map((r: any) => ({
    invoice_number: r.invoice_number,
    total: r.total,
    status: r.status,
    member_name: r.first_name && r.surname ? `${r.first_name} ${r.surname}` : 'Unknown',
  }));

  return json({ success: true, invoices });
}

/**
 * Reinvoice: add extra items to the invoice, record payment, mark processed.
 */
async function handleReinvoice(db: any, body: any, locals: any) {
  const { candidateId, invoiceId } = body;

  const candidate = await db.prepare(
    `SELECT * FROM candidate_payments WHERE id = ? AND processed = 0`
  ).bind(candidateId).first<any>();

  if (!candidate) {
    return json({ error: 'Candidate not found or already processed' }, 404);
  }

  const extraItems = candidate.extra_items ? JSON.parse(candidate.extra_items) : [];
  if (extraItems.length === 0) {
    return json({ error: 'No extra items to reinvoice' }, 400);
  }

  // Add extra items to the invoice
  for (const extra of extraItems) {
    // Look up the payment_item by name
    const pi = await db.prepare(
      `SELECT id, fee FROM payment_items WHERE name = ? AND active = 1`
    ).bind(extra.name).first<{ id: number; fee: number }>();

    if (!pi) continue;

    // Check if this item already exists on the invoice
    const existing = await db.prepare(
      `SELECT id, quantity, line_total FROM invoice_items WHERE invoice_id = ? AND payment_item_id = ?`
    ).bind(invoiceId, pi.id).first<{ id: number; quantity: number; line_total: number }>();

    if (existing) {
      // Increase quantity
      const newQty = existing.quantity + extra.qty;
      const newTotal = newQty * pi.fee;
      await db.prepare(
        `UPDATE invoice_items SET quantity = ?, line_total = ? WHERE id = ?`
      ).bind(newQty, newTotal, existing.id).run();
    } else {
      // Insert new line item
      await db.prepare(
        `INSERT INTO invoice_items (invoice_id, payment_item_id, description, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(invoiceId, pi.id, extra.name, extra.qty, pi.fee, extra.qty * pi.fee).run();
    }
  }

  // Recalculate invoice total
  const totalResult = await db.prepare(
    `SELECT SUM(line_total) as total FROM invoice_items WHERE invoice_id = ?`
  ).bind(invoiceId).first<{ total: number }>();

  const newInvoiceTotal = totalResult?.total || 0;
  await db.prepare(
    `UPDATE invoices SET total = ? WHERE id = ?`
  ).bind(newInvoiceTotal, invoiceId).run();

  // Create payment record
  const isBacs = candidate.payment_source === 'bacs';
  const paymentMethod = isBacs ? 'BACS' : candidate.payment_type === 'card' ? 'Card' : candidate.payment_type === 'cheque' ? 'Cheque' : 'Cash';
  const reference = isBacs ? `BACS ${candidate.sale_id}` : `TouchOffice Sale ${candidate.sale_id}`;
  const saleDate = candidate.sale_date.split(' ')[0]; // date only for payment_date

  const paymentResult = await db.prepare(
    `INSERT INTO payments (member_id, invoice_id, amount, payment_date, payment_method, payment_type, reference, notes, recorded_by)
     VALUES (?, ?, ?, ?, ?, 'subscription', ?, ?, ?)`
  ).bind(
    candidate.matched_member_id,
    invoiceId,
    candidate.amount,
    saleDate,
    paymentMethod,
    reference,
    isBacs ? `Reinvoiced & paid from BACS import.` : `Reinvoiced & paid from TouchOffice. Card: ${candidate.discount_card || 'N/A'}`,
    locals.user?.email || 'system',
  ).run();

  const paymentId = paymentResult.meta.last_row_id;

  // Create payment line items from the candidate's CRM items
  const crmItems = candidate.line_items ? JSON.parse(candidate.line_items) : [];
  await createPaymentLineItems(db, paymentId, invoiceId, crmItems);

  // If payment covers the full invoice, mark as paid; otherwise leave as is
  if (Math.abs(candidate.amount - newInvoiceTotal) < 0.01) {
    await db.prepare(
      `UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ?`
    ).bind(saleDate, invoiceId).run();

    // Set renewal/expiry dates from the invoice period
    const inv = await db.prepare(
      `SELECT period_start, period_end FROM invoices WHERE id = ?`
    ).bind(invoiceId).first<{ period_start: string; period_end: string }>();
    if (inv) {
      await db.prepare(
        `UPDATE members SET date_renewed = ?, date_expires = ?, date_subscription_paid = ? WHERE id = ?`
      ).bind(inv.period_start, inv.period_end, saleDate, candidate.matched_member_id).run();
    }
  }

  // Payment clears member's debt
  await db.prepare(
    `UPDATE members SET account_balance = account_balance + ? WHERE id = ?`
  ).bind(candidate.amount, candidate.matched_member_id).run();

  // Mark candidate as processed
  await db.prepare(
    `UPDATE candidate_payments SET processed = 1, processed_at = datetime('now') WHERE id = ?`
  ).bind(candidateId).run();

  return json({ success: true, newInvoiceTotal });
}

/**
 * Process all matched valid candidate payments in one go.
 * Only processes candidates with match_status='matched' and amount_matches_invoice=1.
 */
async function handleProcessAll(db: any, locals: any) {
  const results = await db.prepare(
    `SELECT * FROM candidate_payments
     WHERE processed = 0 AND match_status = 'matched' AND amount_matches_invoice = 1
       AND matched_member_id IS NOT NULL`
  ).all();

  const candidates = results.results || [];
  let processed = 0;

  for (const candidate of candidates as any[]) {
    const targetInvoiceId = candidate.matched_invoice_id;
    const familyInvoices = candidate.family_invoices ? JSON.parse(candidate.family_invoices) : [];
    const isBacs = candidate.payment_source === 'bacs';
    const paymentMethod = isBacs ? 'BACS' : candidate.payment_type === 'card' ? 'Card' : candidate.payment_type === 'cheque' ? 'Cheque' : 'Cash';
    const coalescedSaleIds = candidate.coalesced_sale_ids ? JSON.parse(candidate.coalesced_sale_ids) : [];
    const allSaleIds = [candidate.sale_id, ...coalescedSaleIds];
    const reference = isBacs
      ? `BACS ${candidate.sale_id}`
      : allSaleIds.length > 1
        ? `TouchOffice Sales ${allSaleIds.join(', ')}`
        : `TouchOffice Sale ${candidate.sale_id}`;

    let processNotes = isBacs
      ? `Auto-matched from BACS import.`
      : `Auto-matched from TouchOffice. Card: ${candidate.discount_card || 'N/A'}`;
    if (!isBacs && coalescedSaleIds.length > 0) {
      processNotes = `Combined from ${allSaleIds.length} TouchOffice sales. Card: ${candidate.discount_card || 'N/A'}`;
    }
    if (familyInvoices.length > 0) {
      processNotes = `Family payment covering ${familyInvoices.map((fi: any) => fi.memberName).join(', ')}. ${processNotes}`;
    }

    const paymentResult = await db.prepare(
      `INSERT INTO payments (member_id, invoice_id, amount, payment_date, payment_method, payment_type, reference, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, 'subscription', ?, ?, ?)`
    ).bind(
      candidate.matched_member_id,
      targetInvoiceId,
      candidate.amount,
      candidate.sale_date,
      paymentMethod,
      reference,
      processNotes,
      locals.user?.email || 'system',
    ).run();

    const paymentId = paymentResult.meta.last_row_id;

    // Create payment line items for all invoices
    const crmItems = candidate.line_items ? JSON.parse(candidate.line_items) : [];
    const allInvoiceIds = [targetInvoiceId, ...familyInvoices.map((fi: any) => fi.invoiceId)];
    for (const invId of allInvoiceIds) {
      await createPaymentLineItems(db, paymentId, invId, crmItems);
    }

    // Mark payer's invoice as paid and set renewal dates
    if (targetInvoiceId) {
      await db.prepare(
        `UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ?`
      ).bind(candidate.sale_date, targetInvoiceId).run();

      const inv = await db.prepare(
        `SELECT period_start, period_end FROM invoices WHERE id = ?`
      ).bind(targetInvoiceId).first<{ period_start: string; period_end: string }>();
      if (inv) {
        await db.prepare(
          `UPDATE members SET date_renewed = ?, date_expires = ?, date_subscription_paid = ? WHERE id = ?`
        ).bind(inv.period_start, inv.period_end, candidate.sale_date, candidate.matched_member_id).run();
      }
    }

    // Mark family invoices as paid, decrement balances, set dates
    for (const fi of familyInvoices) {
      await db.prepare(
        `UPDATE invoices SET status = 'paid', updated_at = ? WHERE id = ?`
      ).bind(candidate.sale_date, fi.invoiceId).run();
      const famInv = await db.prepare(
        `SELECT period_start, period_end FROM invoices WHERE id = ?`
      ).bind(fi.invoiceId).first<{ period_start: string; period_end: string }>();
      await db.prepare(
        `UPDATE members SET account_balance = account_balance + ?, date_renewed = ?, date_expires = ?, date_subscription_paid = ? WHERE id = ?`
      ).bind(fi.total, famInv?.period_start || null, famInv?.period_end || null, candidate.sale_date, fi.memberId).run();
    }

    // Payment clears payer's debt (their own invoice portion)
    const payerTotal = candidate.amount - familyInvoices.reduce((sum: number, fi: any) => sum + fi.total, 0);
    await db.prepare(
      `UPDATE members SET account_balance = account_balance + ? WHERE id = ?`
    ).bind(payerTotal, candidate.matched_member_id).run();

    await db.prepare(
      `UPDATE candidate_payments SET processed = 1, processed_at = datetime('now') WHERE id = ?`
    ).bind(candidate.id).run();

    // Send welcome email to new members
    const allMemberIds = [candidate.matched_member_id, ...familyInvoices.map((fi: any) => fi.memberId)];
    for (const mid of allMemberIds) {
      try {
        await sendWelcomeIfNew(db, locals.runtime.env, mid);
      } catch (e: any) {
        console.error('Welcome email error:', e.message);
      }
    }

    processed++;
  }

  return json({ success: true, processed });
}

/**
 * Send an outstanding balance reminder email for a partially-paid candidate.
 */
async function handleSendOutstandingReminder(db: any, body: any, locals: any) {
  const { candidateId } = body;
  if (!candidateId) return json({ error: 'Missing candidateId' }, 400);

  const candidate = await db.prepare(
    `SELECT cp.*, m.first_name, m.surname, m.email, m.title,
            i.invoice_number, i.total as invoice_total
     FROM candidate_payments cp
     LEFT JOIN members m ON cp.matched_member_id = m.id
     LEFT JOIN invoices i ON cp.matched_invoice_id = i.id
     WHERE cp.id = ?`
  ).bind(candidateId).first<any>();

  if (!candidate) return json({ error: 'Candidate not found' }, 404);
  if (!candidate.matched_member_id) return json({ error: 'No matched member' }, 400);
  if (!candidate.email) return json({ error: 'Member has no email address' }, 400);

  // Calculate outstanding items and amount
  const outstanding = candidate.outstanding_items ? JSON.parse(candidate.outstanding_items) : [];
  if (outstanding.length === 0) return json({ error: 'No outstanding items' }, 400);

  const outstandingTotal = outstanding.reduce((sum: number, item: any) => sum + (item.amount * item.qty), 0);
  const greeting = candidate.title
    ? `Dear ${candidate.title} ${candidate.surname}`
    : `Dear ${candidate.first_name}`;

  // Build outstanding items table rows
  const itemRows = outstanding.map((item: any) => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 14px; color: #333;">
        ${item.name}${item.qty > 1 ? ` x ${item.qty}` : ''}
      </td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 14px; color: #333; text-align: right;">
        £${(item.amount * item.qty).toFixed(2)}
      </td>
    </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background: #f4f4f4; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f4f4f4; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: #1e5631; padding: 24px 30px; text-align: center;">
              <h1 style="margin: 0; color: #fff; font-size: 20px; font-weight: 600;">
                Alnmouth Village Golf Club
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 16px; font-size: 15px; color: #333; line-height: 1.5;">
                ${greeting},
              </p>
              <div style="background-color: #fff3e0; border-left: 4px solid #f57c00; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 14px; color: #e65100; font-weight: 600;">
                  This is a reminder that you have outstanding subscription items that still need to be paid.
                </p>
              </div>
              <p style="margin: 0 0 12px; font-size: 14px; color: #555; line-height: 1.5;">
                We have received your payment of <strong>£${candidate.amount.toFixed(2)}</strong>${candidate.invoice_number ? ` against invoice <strong>${candidate.invoice_number}</strong>` : ''}, thank you.
                However, the following items remain outstanding:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e8e8e8; border-radius: 6px; overflow: hidden; margin-bottom: 16px;">
                <tr style="background: #f8f8f8;">
                  <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #666; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Item</th>
                  <th style="padding: 10px 12px; text-align: right; font-size: 13px; color: #666; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Amount</th>
                </tr>
                ${itemRows}
                <tr style="background: #f0fdf4;">
                  <td style="padding: 10px 12px; font-size: 14px; color: #1e5631; font-weight: 700;">Total Outstanding</td>
                  <td style="padding: 10px 12px; font-size: 14px; color: #1e5631; font-weight: 700; text-align: right;">£${outstandingTotal.toFixed(2)}</td>
                </tr>
              </table>
              <p style="margin: 0 0 8px; font-size: 14px; color: #555; line-height: 1.5;">
                Please arrange payment at your earliest convenience — either over the till in the clubhouse or by BACS transfer.
              </p>
              <p style="margin: 16px 0 0; font-size: 14px; color: #555;">
                Kind regards,<br/>
                <strong>Alnmouth Village Golf Club</strong>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background: #f8f8f8; padding: 16px 30px; text-align: center; border-top: 1px solid #eee;">
              <p style="margin: 0; font-size: 12px; color: #999;">
                Alnmouth Village Golf Club, Foxton Hall, Alnmouth, Northumberland NE66 3BE
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const env = locals.runtime.env;
  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  const subject = `REMINDER: Outstanding subscription items - Alnmouth Village Golf Club`;
  const result = await sendEmail({ to: candidate.email, subject, html }, emailEnv);

  // Log in sent_emails
  const year = new Date().getFullYear();
  if (result.success) {
    await db.prepare(
      `INSERT INTO sent_emails (member_id, email_type, email_address, year, status)
       VALUES (?, 'outstanding_reminder', ?, ?, 'sent')`
    ).bind(candidate.matched_member_id, candidate.email, year).run();
  } else {
    await db.prepare(
      `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error)
       VALUES (?, 'outstanding_reminder', ?, ?, 'failed', ?)`
    ).bind(candidate.matched_member_id, candidate.email, year, result.error || 'Unknown error').run();
    return json({ error: result.error || 'Failed to send email' }, 500);
  }

  return json({ success: true, email: candidate.email });
}

/**
 * Import BACS payments from pasted/uploaded text file.
 * Parses, filters non-membership, matches members & invoices, inserts as candidates.
 */
async function handleImportBacs(db: any, body: any) {
  const { text } = body;
  if (!text) return json({ error: 'No BACS data provided' }, 400);

  const records = parseBacsFile(text);
  if (records.length === 0) return json({ error: 'No valid BACS records found' }, 400);

  let newCount = 0;
  let matched = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const record of records) {
    // Skip non-membership payments
    if (isNonMembershipPayment(record)) {
      skipped++;
      continue;
    }

    // Generate a unique sale_id for BACS records
    const saleId = `BACS-${record.date}-${record.amount.toFixed(2)}-${record.description.substring(0, 20).replace(/\s+/g, '_')}`;

    // Check for existing candidate with same sale_id
    const existing = await db.prepare(
      `SELECT id FROM candidate_payments WHERE sale_id = ?`
    ).bind(saleId).first();
    if (existing) { duplicates++; continue; }

    // Also check if already recorded as a payment
    const alreadyPaid = await db.prepare(
      `SELECT id FROM payments WHERE reference = ?`
    ).bind(`BACS ${saleId}`).first();
    if (alreadyPaid) { duplicates++; continue; }

    // Match member
    const matchResult = await matchBacsMember(db, record);

    // Check invoice match — BACS has no line items, just amount
    let invoiceMatch = { matches: false, invoiceId: null as number | null, invoiceTotal: null as number | null, invoiceStatus: null as string | null, outstandingItems: [] as any[], extraItems: [] as any[], familyInvoices: undefined as any };

    // If we matched via invoice number, look up that invoice directly
    if (record.invoiceNumber && matchResult.memberId) {
      const inv = await db.prepare(
        `SELECT id, total, status FROM invoices WHERE invoice_number = ? AND member_id = ?`
      ).bind(record.invoiceNumber, matchResult.memberId).first<any>();
      if (inv) {
        invoiceMatch = {
          matches: Math.abs(record.amount - inv.total) < 0.01,
          invoiceId: inv.id,
          invoiceTotal: inv.total,
          invoiceStatus: inv.status,
          outstandingItems: [],
          extraItems: [],
          familyInvoices: undefined,
        };
      }
    }

    // If no invoice match yet but we have a member, check by amount
    if (!invoiceMatch.invoiceId && matchResult.memberId) {
      invoiceMatch = await checkInvoiceMatch(db, matchResult.memberId, record.amount, []);
    }

    // Build receipt text from raw BACS line
    const receiptText = `BACS Payment\nDate: ${record.date}\nDescription: ${record.description}\nReference: ${record.reference}\nAmount: £${record.amount.toFixed(2)}${record.invoiceNumber ? `\nInvoice: ${record.invoiceNumber}` : ''}`;

    await db.prepare(
      `INSERT INTO candidate_payments
        (sale_id, sale_date, amount, member_name, discount_card, payment_type,
         line_items, receipt_text, matched_member_id, match_status,
         amount_matches_invoice, matched_invoice_id, invoice_total,
         outstanding_items, extra_items, family_invoices, payment_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bacs')`
    ).bind(
      saleId,
      record.date,
      record.amount,
      record.description,
      null,   // no discount card for BACS
      null,   // payment_type NULL for BACS (CHECK constraint allows NULL)
      null,   // no line items — BACS is a lump sum
      receiptText,
      matchResult.memberId,
      matchResult.status,
      invoiceMatch.matches ? 1 : 0,
      invoiceMatch.invoiceId,
      invoiceMatch.invoiceTotal,
      invoiceMatch.outstandingItems?.length > 0 ? JSON.stringify(invoiceMatch.outstandingItems) : null,
      invoiceMatch.extraItems?.length > 0 ? JSON.stringify(invoiceMatch.extraItems) : null,
      invoiceMatch.familyInvoices ? JSON.stringify(invoiceMatch.familyInvoices) : null,
    ).run();

    newCount++;
    if (matchResult.status === 'matched') matched++;
  }

  // Coalesce any multi-payment BACS for same member
  const coalesced = await coalesceCandidates(db);

  return json({ success: true, total: records.length, new: newCount, matched, skipped, duplicates, coalesced });
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
