// API endpoint to delete an invoice and all associated payments
// POST /api/delete-invoice { invoiceId: number }

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { invoiceId?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!body.invoiceId) {
    return new Response(JSON.stringify({ error: 'invoiceId required' }), { status: 400 });
  }

  const invoice = await env.DB.prepare(
    `SELECT * FROM invoices WHERE id = ?`
  ).bind(body.invoiceId).first();

  if (!invoice) {
    return new Response(JSON.stringify({ error: 'Invoice not found' }), { status: 404 });
  }

  // If deleting a non-cancelled invoice, decrement the member's balance
  if (invoice.status !== 'cancelled') {
    await env.DB.prepare(
      `UPDATE members SET account_balance = account_balance - ? WHERE id = ?`
    ).bind(invoice.total, invoice.member_id).run();
  }

  // Delete associated payment line items and payments
  await env.DB.prepare(
    `DELETE FROM payment_line_items WHERE payment_id IN (SELECT id FROM payments WHERE invoice_id = ?)`
  ).bind(body.invoiceId).run();
  await env.DB.prepare(
    `DELETE FROM payments WHERE invoice_id = ?`
  ).bind(body.invoiceId).run();

  // Delete invoice items
  await env.DB.prepare(
    `DELETE FROM invoice_items WHERE invoice_id = ?`
  ).bind(body.invoiceId).run();

  // Delete the invoice
  await env.DB.prepare(
    `DELETE FROM invoices WHERE id = ?`
  ).bind(body.invoiceId).run();

  // Nullify the member's renewal date
  await env.DB.prepare(
    `UPDATE members SET date_renewed = NULL WHERE id = ?`
  ).bind(invoice.member_id).run();

  // Log action
  const userEmail = (locals as any).user?.email || 'system';
  await env.DB.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
     VALUES (?, 'delete_invoice', 'invoice', ?, ?)`
  ).bind(userEmail, body.invoiceId, JSON.stringify({ invoice_number: invoice.invoice_number })).run();

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
