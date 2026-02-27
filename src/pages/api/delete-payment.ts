import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { paymentId?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!body.paymentId) {
    return new Response(JSON.stringify({ error: 'paymentId required' }), { status: 400 });
  }

  const payment = await env.DB.prepare(
    `SELECT * FROM payments WHERE id = ?`
  ).bind(body.paymentId).first();

  if (!payment) {
    return new Response(JSON.stringify({ error: 'Payment not found' }), { status: 404 });
  }

  // Delete payment line items first
  await env.DB.prepare(
    `DELETE FROM payment_line_items WHERE payment_id = ?`
  ).bind(body.paymentId).run();

  // Delete the payment
  await env.DB.prepare(
    `DELETE FROM payments WHERE id = ?`
  ).bind(body.paymentId).run();

  // If this payment was linked to an invoice, set invoice back to draft and restore member balance
  if (payment.invoice_id) {
    const invoice = await env.DB.prepare(
      `SELECT id, status, total, member_id FROM invoices WHERE id = ?`
    ).bind(payment.invoice_id).first();

    if (invoice && invoice.status === 'paid') {
      // Check if there are any other payments for this invoice
      const otherPayment = await env.DB.prepare(
        `SELECT id FROM payments WHERE invoice_id = ? LIMIT 1`
      ).bind(payment.invoice_id).first();

      if (!otherPayment) {
        // No other payments — set invoice back to draft and add balance back as outstanding
        await env.DB.prepare(
          `UPDATE invoices SET status = 'draft', updated_at = datetime('now') WHERE id = ?`
        ).bind(payment.invoice_id).run();

        await env.DB.prepare(
          `UPDATE members SET account_balance = account_balance + ? WHERE id = ?`
        ).bind(invoice.total, invoice.member_id).run();
      }
    }
  }

  // Log action
  const userEmail = (locals as any).user?.email || 'system';
  await env.DB.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
     VALUES (?, 'delete_payment', 'payment', ?, ?)`
  ).bind(userEmail, body.paymentId, JSON.stringify({
    member_id: payment.member_id,
    amount: payment.amount,
    payment_method: payment.payment_method,
  })).run();

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
