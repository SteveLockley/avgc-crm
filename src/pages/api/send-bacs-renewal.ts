// API endpoint to send BACS/OTT/Standing Order/Cheque renewal email
// POST /api/send-bacs-renewal { memberId?: number, year?: number, testEmail?: string }
// Excludes Social category members (they get a separate email)
// Bulk mode processes up to BATCH_SIZE members per request, skipping already-sent

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateBACSRenewalEmail, generateBACSRenewalSubject } from '../../lib/bacs-renewal-email';

const BATCH_SIZE = 40;
const BACS_PAYMENT_METHODS = ['BACS', 'Over the Till', 'Standing Order', 'Cheque'];

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

  let body: { memberId?: number; year?: number; testEmail?: string; sample?: boolean };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const year = body.year || new Date().getFullYear();
  const subject = generateBACSRenewalSubject(year);
  const bankDetails = await getBankDetails(env.DB);

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  const placeholders = BACS_PAYMENT_METHODS.map(() => '?').join(',');

  // Sample mode: one email per distinct category, all sent to testEmail
  if (body.testEmail && body.sample) {
    const members = await env.DB.prepare(
      `SELECT m.*, p.fee as subscription_fee
       FROM members m
       LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
       WHERE m.default_payment_method IN (${placeholders})
         AND LOWER(m.category) NOT LIKE '%social%'
         AND LOWER(m.category) <> 'winter'
         AND m.email IS NOT NULL AND m.email <> ''
       GROUP BY m.category
       ORDER BY m.category`
    ).bind(...BACS_PAYMENT_METHODS).all();

    if (!members.results || members.results.length === 0) {
      return new Response(JSON.stringify({ error: 'No eligible BACS members found' }), { status: 404 });
    }

    let sent = 0;
    let failed = 0;
    const categories: string[] = [];
    const errors: string[] = [];

    for (const member of members.results) {
      if (member.subscription_fee === null) { failed++; errors.push(`${member.category}: No subscription fee configured`); continue; }
      const html = generateBACSRenewalEmail(
        {
          title: member.title, first_name: member.first_name, surname: member.surname,
          club_number: member.club_number || member.pin, category: member.category,
          email: member.email, locker_number: member.locker_number,
          national_id: member.national_id, home_away: member.home_away,
          handicap_index: member.handicap_index,
        },
        member.subscription_fee as number, year, bankDetails
      );
      const catSubject = `[SAMPLE: ${member.category}] ${subject}`;

      const result = await sendEmail({ to: body.testEmail, subject: catSubject, html }, emailEnv);
      if (result.success) { sent++; categories.push(member.category as string); }
      else { failed++; errors.push(`${member.category}: ${result.error}`); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return new Response(JSON.stringify({
      success: true, mode: 'sample', sentTo: body.testEmail, sent, failed,
      categories, errors: errors.length > 0 ? errors : undefined,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Test mode
  if (body.testEmail) {
    const member = body.memberId
      ? await env.DB.prepare(
          `SELECT m.*, p.fee as subscription_fee
           FROM members m
           LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
           WHERE m.id = ?`
        ).bind(body.memberId).first()
      : await env.DB.prepare(
          `SELECT m.*, p.fee as subscription_fee
           FROM members m
           LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
           WHERE m.default_payment_method IN (${placeholders})
             AND LOWER(m.category) NOT LIKE '%social%'
             AND LOWER(m.category) <> 'winter'
             AND m.email IS NOT NULL AND m.email <> ''
           ORDER BY m.surname LIMIT 1`
        ).bind(...BACS_PAYMENT_METHODS).first();

    if (!member || member.subscription_fee === null) {
      return new Response(JSON.stringify({ error: 'No eligible BACS member found for test' }), { status: 404 });
    }

    const html = generateBACSRenewalEmail(
      {
        title: member.title, first_name: member.first_name, surname: member.surname,
        club_number: member.club_number || member.pin, category: member.category,
        email: member.email, locker_number: member.locker_number,
        national_id: member.national_id, home_away: member.home_away,
        handicap_index: member.handicap_index,
      },
      member.subscription_fee, year, bankDetails
    );

    const result = await sendEmail({ to: body.testEmail, subject, html }, emailEnv);
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500 });
    }

    return new Response(JSON.stringify({
      success: true, mode: 'test', sentTo: body.testEmail,
      sampleMember: `${member.first_name} ${member.surname}`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Single member mode
  if (body.memberId) {
    const member = await env.DB.prepare(
      `SELECT m.*, p.fee as subscription_fee
       FROM members m
       LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
       WHERE m.id = ?`
    ).bind(body.memberId).first();

    if (!member) return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404 });
    if (!member.email) return new Response(JSON.stringify({ error: 'Member has no email' }), { status: 400 });
    if (member.subscription_fee === null) return new Response(JSON.stringify({ error: `No fee for: ${member.category}` }), { status: 400 });

    const html = generateBACSRenewalEmail(
      {
        title: member.title, first_name: member.first_name, surname: member.surname,
        club_number: member.club_number || member.pin, category: member.category,
        email: member.email, locker_number: member.locker_number,
        national_id: member.national_id, home_away: member.home_away,
        handicap_index: member.handicap_index,
      },
      member.subscription_fee, year, bankDetails
    );

    const result = await sendEmail({ to: member.email, subject, html }, emailEnv);
    if (!result.success) return new Response(JSON.stringify({ error: result.error }), { status: 500 });

    return new Response(JSON.stringify({
      success: true, mode: 'single',
      member: `${member.first_name} ${member.surname}`, email: member.email,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Bulk mode — skip already-sent members
  const members = await env.DB.prepare(
    `SELECT m.*, p.fee as subscription_fee
     FROM members m
     LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
     LEFT JOIN sent_emails se ON se.member_id = m.id AND se.email_type = 'bacs_renewal' AND se.year = ? AND se.status = 'sent'
     WHERE m.default_payment_method IN (${placeholders})
       AND LOWER(m.category) NOT LIKE '%social%'
       AND LOWER(m.category) <> 'winter'
       AND m.email IS NOT NULL AND m.email <> ''
       AND se.id IS NULL
     ORDER BY m.surname, m.first_name`
  ).bind(year, ...BACS_PAYMENT_METHODS).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({
      success: true, mode: 'bulk', total: 0, sent: 0, failed: 0, remaining: 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const totalRemaining = members.results.length;
  const batch = members.results.slice(0, BATCH_SIZE);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of batch) {
    if (member.subscription_fee === null || member.subscription_fee === undefined) {
      failed++;
      errors.push(`${member.first_name} ${member.surname}: No fee for category ${member.category}`);
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'bacs_renewal', ?, ?, 'failed', ?)`
      ).bind(member.id, member.email, year, `No fee for category ${member.category}`).run();
      continue;
    }

    const html = generateBACSRenewalEmail(
      {
        title: member.title as string, first_name: member.first_name as string,
        surname: member.surname as string,
        club_number: (member.club_number || member.pin) as string,
        category: member.category as string, email: member.email as string,
        locker_number: member.locker_number as string,
        national_id: member.national_id as string,
        home_away: member.home_away as string,
        handicap_index: member.handicap_index as number,
      },
      member.subscription_fee as number, year, bankDetails
    );

    const result = await sendEmail({ to: member.email as string, subject, html }, emailEnv);
    if (result.success) {
      sent++;
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status) VALUES (?, 'bacs_renewal', ?, ?, 'sent')`
      ).bind(member.id, member.email, year).run();
    } else {
      failed++;
      errors.push(`${member.first_name} ${member.surname} (${member.email}): ${result.error}`);
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'bacs_renewal', ?, ?, 'failed', ?)`
      ).bind(member.id, member.email, year, result.error || 'Unknown error').run();
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const remaining = totalRemaining - batch.length;

  return new Response(JSON.stringify({
    success: true, mode: 'bulk', total: batch.length, sent, failed, remaining,
    errors: errors.length > 0 ? errors : undefined,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
