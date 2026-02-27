// API endpoint to apply subscription changes: delete old invoices, send notification, generate new invoice
// POST /api/apply-subscription-changes { changes: Array<{ memberId, oldCategory, newCategory }> }

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateSubscriptionChangeEmail, generateSubscriptionChangeSubject } from '../../lib/subscription-change-email';
import { loadFeeItems, generateInvoiceForMember } from '../../lib/generate-invoice';

async function getBankDetails(db: any) {
  const settings = await db.prepare(
    `SELECT setting_key, setting_value FROM invoice_settings WHERE setting_key IN ('bank_name', 'sort_code', 'account_number', 'account_name')`
  ).all();

  const map: Record<string, string> = {};
  for (const row of settings.results || []) {
    map[row.setting_key as string] = row.setting_value as string;
  }

  return {
    bank_name: map.bank_name || '',
    sort_code: map.sort_code || '',
    account_number: map.account_number || '',
    account_name: map.account_name || '',
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { changes?: Array<{ memberId: number; oldCategory: string; newCategory: string }> };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!body.changes || body.changes.length === 0) {
    return new Response(JSON.stringify({ error: 'No changes provided' }), { status: 400 });
  }

  const db = env.DB;
  const now = new Date();
  const year = now.getFullYear();
  const periodStart = `${year}-04-01`;
  const periodEnd = `${year + 1}-03-31`;

  const bankDetails = await getBankDetails(db);
  const feeItems = await loadFeeItems(db);

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  let processed = 0;
  let emailsSent = 0;
  let invoicesGenerated = 0;
  const errors: string[] = [];

  for (const change of body.changes) {
    try {
      // 1. Load the member with subscription fee for the NEW category
      const member = await db.prepare(
        `SELECT m.*, p.fee as subscription_fee, p.id as subscription_item_id
         FROM members m
         LEFT JOIN payment_items p ON p.name = ? AND p.category = 'Subscription' AND p.active = 1
         WHERE m.id = ?`
      ).bind(change.newCategory, change.memberId).first();

      if (!member) {
        errors.push(`Member ${change.memberId}: not found`);
        continue;
      }

      // 2. Delete existing invoices for the current period
      const existingInvoices = await db.prepare(
        `SELECT id, total, status FROM invoices WHERE member_id = ? AND period_start = ? AND status != 'cancelled'`
      ).bind(change.memberId, periodStart).all();

      for (const inv of existingInvoices.results || []) {
        // Adjust account balance only for draft invoices (draft invoices added to balance when created;
        // paid DD invoices never touched balance so should not be subtracted)
        if (inv.status === 'draft') {
          await db.prepare(
            `UPDATE members SET account_balance = account_balance - ? WHERE id = ?`
          ).bind(inv.total, change.memberId).run();
        }

        // Delete in correct order: payment_line_items → payments → invoice_items → invoices
        await db.prepare(
          `DELETE FROM payment_line_items WHERE payment_id IN (SELECT id FROM payments WHERE invoice_id = ?)`
        ).bind(inv.id).run();
        await db.prepare(
          `DELETE FROM payments WHERE invoice_id = ?`
        ).bind(inv.id).run();
        await db.prepare(
          `DELETE FROM invoice_items WHERE invoice_id = ?`
        ).bind(inv.id).run();
        await db.prepare(
          `DELETE FROM invoices WHERE id = ?`
        ).bind(inv.id).run();
      }

      // Clear renewal date
      await db.prepare(
        `UPDATE members SET date_renewed = NULL WHERE id = ?`
      ).bind(change.memberId).run();

      // 3. Delete sent_emails records for this member + year so bulk renewal won't skip them
      await db.prepare(
        `DELETE FROM sent_emails WHERE member_id = ? AND year = ?`
      ).bind(change.memberId, year).run();

      // 4. Generate new invoice
      const isDD = member.default_payment_method === 'Clubwise Direct Debit';
      const isSocial = (change.newCategory || '').toLowerCase().includes('social');

      const invoiceResult = await generateInvoiceForMember(db, member, feeItems, { year, isDD, isSocial });
      if (invoiceResult.success && invoiceResult.invoiceNumber !== 'already_exists') {
        invoicesGenerated++;
      } else if (!invoiceResult.success) {
        errors.push(`Member ${change.memberId} (${member.first_name} ${member.surname}): Invoice generation failed - ${invoiceResult.error}`);
      }

      // 5. Send notification email
      if (member.email && member.email.trim() !== '') {
        const subject = generateSubscriptionChangeSubject(year);
        const html = generateSubscriptionChangeEmail(
          member,
          change.oldCategory,
          change.newCategory,
          member.subscription_fee || 0,
          year,
          bankDetails
        );

        const emailResult = await sendEmail({ to: member.email, subject, html }, emailEnv);

        if (emailResult.success) {
          emailsSent++;
          // Log in sent_emails
          await db.prepare(
            `INSERT INTO sent_emails (member_id, email_type, email_address, year, sent_at)
             VALUES (?, 'subscription_change', ?, ?, datetime('now'))`
          ).bind(change.memberId, member.email, year).run();
        } else {
          errors.push(`Member ${change.memberId} (${member.first_name} ${member.surname}): Email failed - ${emailResult.error}`);
        }
      }

      processed++;
    } catch (e: any) {
      errors.push(`Member ${change.memberId}: ${e.message}`);
    }
  }

  return new Response(JSON.stringify({
    processed,
    emailsSent,
    invoicesGenerated,
    errors: errors.length > 0 ? errors : undefined,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
