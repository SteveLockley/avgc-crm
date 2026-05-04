// API endpoint to send reminder emails for unpaid invoices
// POST /api/send-invoice-reminder { invoiceIds: number[] }
// Re-generates the renewal email with REMINDER prefix and payment deadline notice

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateBACSRenewalEmail, generateBACSRenewalSubject } from '../../lib/bacs-renewal-email';
import { generateSocialRenewalEmail, generateSocialRenewalSubject } from '../../lib/social-renewal-email';
import { generateDDRenewalEmail, generateDDRenewalSubject, calculateDDSchedule } from '../../lib/dd-renewal-email';

const DD_PAYMENT_METHODS = ['Clubwise Direct Debit'];
const SOCIAL_CATEGORIES = ['social'];

function getReminderMessage(year: number): string {
  return `Your annual membership at Alnmouth Village Golf Club expired on the 31st March ${year}. Our records indicate that you have not renewed for ${year + 1}. If this is not correct please contact us so that we can correct our records. If you wish to renew please do so before the 30th April ${year}, after which your membership will be cancelled.`;
}

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

function applyReminderTitle(html: string, year: number): string {
  // Change header subtitle to "Membership Renewal Reminder YYYY/YYYY"
  return html.replace(
    /Membership Renewal (\d{4}\/\d{4})/,
    'Membership Renewal Reminder $1'
  );
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  const BATCH_SIZE = 20;

  let body: { invoiceIds?: number[]; allUnpaid?: boolean; offset?: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  let allIds: number[];

  if (body.allUnpaid) {
    const result = await env.DB.prepare(
      `SELECT i.id FROM invoices i
       JOIN members m ON i.member_id = m.id
       WHERE i.status = 'draft' AND i.total > 0
         AND m.email IS NOT NULL AND m.email != ''
       ORDER BY i.id`
    ).all();
    allIds = (result.results || []).map((r: any) => r.id as number);
  } else {
    allIds = body.invoiceIds || [];
  }

  if (allIds.length === 0) {
    return new Response(JSON.stringify({ error: 'No unpaid invoices found' }), { status: 400 });
  }

  const offset = body.offset || 0;
  const invoiceIds = allIds.slice(offset, offset + BATCH_SIZE);
  const remaining = Math.max(0, allIds.length - offset - invoiceIds.length);
  const total = allIds.length;

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  const bankDetails = await getBankDetails(env.DB);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const invoiceId of invoiceIds) {
    try {
      // Load invoice + member + subscription fee
      const invoice = await env.DB.prepare(
        `SELECT i.*, m.title, m.first_name, m.surname, m.email, m.pin,
                m.category, m.default_payment_method, m.locker_number, m.national_id,
                m.home_away, m.handicap_index, m.direct_debit_member_id,
                p.fee as subscription_fee
         FROM invoices i
         JOIN members m ON i.member_id = m.id
         LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
         WHERE i.id = ? AND i.status = 'draft'`
      ).bind(invoiceId).first();

      if (!invoice) {
        failed++;
        errors.push(`Invoice ${invoiceId}: not found or not unpaid`);
        continue;
      }

      if (!invoice.email) {
        failed++;
        errors.push(`Invoice ${invoiceId}: member has no email`);
        continue;
      }

      const year = invoice.period_start ? parseInt((invoice.period_start as string).substring(0, 4)) : new Date().getFullYear();
      const isSocial = SOCIAL_CATEGORIES.some(s => (invoice.category as string || '').toLowerCase().includes(s));
      const isDD = DD_PAYMENT_METHODS.includes(invoice.default_payment_method as string);

      let subject: string;
      let html: string;

      const member = {
        title: invoice.title as string | undefined,
        first_name: invoice.first_name as string,
        surname: invoice.surname as string,
        id: invoice.member_id as number,
        category: invoice.category as string,
        email: invoice.email as string,
        locker_number: invoice.locker_number as string | undefined,
        national_id: invoice.national_id as string | undefined,
        home_away: invoice.home_away as string | undefined,
        handicap_index: invoice.handicap_index as number | null,
        direct_debit_member_id: invoice.direct_debit_member_id as string | undefined,
      };

      const reminderMessage = getReminderMessage(year);

      if (isSocial) {
        subject = `REMINDER: ${generateSocialRenewalSubject(year)}`;
        html = generateSocialRenewalEmail(member, invoice.subscription_fee as number || 0, year, bankDetails, reminderMessage);
      } else if (isDD) {
        subject = `REMINDER: ${generateDDRenewalSubject(year)}`;
        const schedule = calculateDDSchedule(member, invoice.subscription_fee as number || 0, year);
        html = generateDDRenewalEmail(member, schedule, reminderMessage);
      } else {
        subject = `REMINDER: ${generateBACSRenewalSubject(year)}`;
        html = generateBACSRenewalEmail(member, invoice.subscription_fee as number || 0, year, bankDetails, reminderMessage);
      }

      // Update header subtitle to say "Reminder"
      html = applyReminderTitle(html, year);

      const result = await sendEmail({ to: invoice.email as string, subject, html }, emailEnv);

      if (result.success) {
        sent++;

        // Log in sent_emails
        await env.DB.prepare(
          `INSERT INTO sent_emails (member_id, email_type, email_address, year, status)
           VALUES (?, 'reminder', ?, ?, 'sent')`
        ).bind(invoice.member_id, invoice.email, year).run();
      } else {
        failed++;
        errors.push(`Invoice ${invoiceId} (${invoice.first_name} ${invoice.surname}): ${result.error}`);

        // Log failure
        await env.DB.prepare(
          `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error)
           VALUES (?, 'reminder', ?, ?, 'failed', ?)`
        ).bind(invoice.member_id, invoice.email, year, result.error || 'Unknown error').run();
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err: any) {
      failed++;
      errors.push(`Invoice ${invoiceId}: ${err.message}`);
    }
  }

  return new Response(JSON.stringify({
    sent,
    failed,
    total,
    remaining,
    nextOffset: offset + invoiceIds.length,
    errors: errors.length > 0 ? errors : undefined,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
