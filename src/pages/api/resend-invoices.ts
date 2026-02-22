// API endpoint to resend previously sent invoices
// POST /api/resend-invoices { invoiceIds: number[] }
// Does NOT change invoice status, just updates sent_at and re-sends email

import type { APIRoute } from 'astro';
import type { Invoice, InvoiceItem, Member } from '../../lib/db';
import { sendEmail } from '../../lib/email';
import { generateInvoiceEmail, generateInvoiceSubject } from '../../lib/email-template';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { invoiceIds?: number[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (!body.invoiceIds || body.invoiceIds.length === 0) {
    return new Response(JSON.stringify({ error: 'invoiceIds is required' }), { status: 400 });
  }

  // Get settings
  const settingsResult = await env.DB.prepare(`SELECT * FROM invoice_settings`).all();
  const settings: Record<string, string> = {};
  settingsResult.results?.forEach((row: any) => {
    settings[row.setting_key] = row.setting_value;
  });

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const invoiceId of body.invoiceIds) {
    const invoice = await env.DB.prepare(
      `SELECT * FROM invoices WHERE id = ? AND status = 'sent'`
    ).bind(invoiceId).first<Invoice>();

    if (!invoice) {
      failed++;
      errors.push(`Invoice ${invoiceId}: not found or not in 'sent' status`);
      continue;
    }

    const member = await env.DB.prepare(
      `SELECT * FROM members WHERE id = ?`
    ).bind(invoice.member_id).first<Member>();

    if (!member || !member.email) {
      failed++;
      errors.push(`Invoice ${invoiceId}: member not found or has no email`);
      continue;
    }

    const itemsResult = await env.DB.prepare(
      `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id`
    ).bind(invoiceId).all();
    const items = (itemsResult.results || []) as InvoiceItem[];

    const periodYear = parseInt(invoice.period_start.substring(0, 4));
    const emailHtml = generateInvoiceEmail({ member, invoice, items, settings });
    const emailSubject = generateInvoiceSubject(invoice, periodYear);

    const result = await sendEmail({ to: member.email, subject: emailSubject, html: emailHtml }, emailEnv);

    if (result.success) {
      sent++;
      // Update sent_at timestamp
      await env.DB.prepare(
        `UPDATE invoices SET sent_at = datetime('now') WHERE id = ?`
      ).bind(invoiceId).run();
    } else {
      failed++;
      errors.push(`Invoice ${invoice.invoice_number} (${member.email}): ${result.error}`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return new Response(JSON.stringify({
    success: true, sent, failed,
    errors: errors.length > 0 ? errors : undefined,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
