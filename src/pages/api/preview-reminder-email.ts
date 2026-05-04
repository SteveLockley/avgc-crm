// GET /api/preview-reminder-email?invoiceId=123
// Returns the rendered reminder email HTML for preview purposes (no email sent)

import type { APIRoute } from 'astro';
import { generateBACSRenewalEmail, generateBACSRenewalSubject } from '../../lib/bacs-renewal-email';
import { generateSocialRenewalEmail, generateSocialRenewalSubject } from '../../lib/social-renewal-email';
import { generateDDRenewalEmail, generateDDRenewalSubject, calculateDDSchedule } from '../../lib/dd-renewal-email';

const DD_PAYMENT_METHODS = ['Clubwise Direct Debit'];
const SOCIAL_CATEGORIES = ['social'];

function getReminderMessage(year: number): string {
  return `Your annual membership at Alnmouth Village Golf Club expired on the 31st March ${year}. Our records indicate that you have not renewed for ${year + 1}. If this is not correct please contact us so that we can correct our records. If you wish to renew please do so before the 30th April ${year}, after which your membership will be cancelled.`;
}

function applyReminderTitle(html: string): string {
  return html.replace(
    /Membership Renewal (\d{4}\/\d{4})/,
    'Membership Renewal Reminder $1'
  );
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

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response('Database not available', { status: 500 });
  }

  const url = new URL(request.url);
  const invoiceIdParam = url.searchParams.get('invoiceId');

  let invoice: any;

  if (invoiceIdParam) {
    invoice = await env.DB.prepare(
      `SELECT i.*, m.title, m.first_name, m.surname, m.email,
              m.category, m.default_payment_method, m.locker_number, m.national_id,
              m.home_away, m.handicap_index, m.direct_debit_member_id,
              p.fee as subscription_fee
       FROM invoices i
       JOIN members m ON i.member_id = m.id
       LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
       WHERE i.id = ? AND i.status = 'draft'`
    ).bind(parseInt(invoiceIdParam)).first();
  } else {
    // Use the first unpaid invoice with an email address
    invoice = await env.DB.prepare(
      `SELECT i.*, m.title, m.first_name, m.surname, m.email,
              m.category, m.default_payment_method, m.locker_number, m.national_id,
              m.home_away, m.handicap_index, m.direct_debit_member_id,
              p.fee as subscription_fee
       FROM invoices i
       JOIN members m ON i.member_id = m.id
       LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
       WHERE i.status = 'draft' AND i.total > 0
         AND m.email IS NOT NULL AND m.email != ''
       LIMIT 1`
    ).first();
  }

  if (!invoice) {
    return new Response('<p style="font-family:sans-serif;padding:2rem;color:#666;">No unpaid invoice found to preview.</p>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const bankDetails = await getBankDetails(env.DB);
  const year = invoice.period_start ? parseInt((invoice.period_start as string).substring(0, 4)) : new Date().getFullYear();
  const isSocial = SOCIAL_CATEGORIES.some(s => (invoice.category as string || '').toLowerCase().includes(s));
  const isDD = DD_PAYMENT_METHODS.includes(invoice.default_payment_method as string);

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

  let html: string;
  let subject: string;
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

  html = applyReminderTitle(html);

  // Wrap with a preview banner showing subject and recipient
  const previewBanner = `
<div style="background:#1e5631;color:#fff;padding:12px 20px;font-family:sans-serif;font-size:13px;display:flex;gap:20px;flex-wrap:wrap;">
  <span><strong>To:</strong> ${invoice.first_name} ${invoice.surname} &lt;${invoice.email}&gt;</span>
  <span><strong>Subject:</strong> ${subject}</span>
  <span style="opacity:0.7;font-style:italic;">Preview based on first unpaid invoice — all recipients receive a personalised version</span>
</div>`;

  return new Response(previewBanner + html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
