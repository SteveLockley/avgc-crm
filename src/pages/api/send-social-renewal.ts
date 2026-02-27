// API endpoint to send Social membership renewal email
// POST /api/send-social-renewal { memberId?: number, year?: number, testEmail?: string }
// Bulk mode processes up to BATCH_SIZE members per request, skipping already-sent

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateSocialRenewalEmail, generateSocialRenewalSubject } from '../../lib/social-renewal-email';
import { loadFeeItems, generateInvoiceForMember } from '../../lib/generate-invoice';

const BATCH_SIZE = 40;

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
  const subject = generateSocialRenewalSubject(year);
  const bankDetails = await getBankDetails(env.DB);

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  // Sample mode: one email per distinct category, all sent to testEmail
  if (body.testEmail && body.sample) {
    const members = await env.DB.prepare(
      `SELECT m.*, p.fee as subscription_fee
       FROM members m
       LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
       WHERE LOWER(m.category) LIKE '%social%'
         AND m.email IS NOT NULL AND m.email <> ''
       GROUP BY m.category
       ORDER BY m.category`
    ).all();

    if (!members.results || members.results.length === 0) {
      return new Response(JSON.stringify({ error: 'No eligible Social members found' }), { status: 404 });
    }

    let sent = 0;
    let failed = 0;
    const categories: string[] = [];
    const errors: string[] = [];

    for (const member of members.results) {
      if (member.subscription_fee === null) { failed++; errors.push(`${member.category}: No subscription fee configured`); continue; }
      const html = generateSocialRenewalEmail(
        {
          title: member.title, first_name: member.first_name, surname: member.surname,
          club_number: member.club_number || member.pin, email: member.email,
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
           WHERE LOWER(m.category) LIKE '%social%'
             AND m.email IS NOT NULL AND m.email <> ''
           ORDER BY m.surname LIMIT 1`
        ).first();

    if (!member || member.subscription_fee === null) {
      return new Response(JSON.stringify({ error: 'No eligible Social member found for test' }), { status: 404 });
    }

    const html = generateSocialRenewalEmail(
      {
        title: member.title, first_name: member.first_name, surname: member.surname,
        club_number: member.club_number || member.pin, email: member.email,
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

    const html = generateSocialRenewalEmail(
      {
        title: member.title, first_name: member.first_name, surname: member.surname,
        club_number: member.club_number || member.pin, email: member.email,
      },
      member.subscription_fee, year, bankDetails
    );

    const result = await sendEmail({ to: member.email, subject, html }, emailEnv);
    if (!result.success) {
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'social_renewal', ?, ?, 'failed', ?)`
      ).bind(member.id, member.email, year, result.error || 'Unknown error').run();
      return new Response(JSON.stringify({ error: result.error }), { status: 500 });
    }

    await env.DB.prepare(
      `INSERT INTO sent_emails (member_id, email_type, email_address, year, status) VALUES (?, 'social_renewal', ?, ?, 'sent')`
    ).bind(member.id, member.email, year).run();

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
     LEFT JOIN sent_emails se ON se.member_id = m.id AND se.email_type = 'social_renewal' AND se.year = ? AND se.status = 'sent'
     WHERE LOWER(m.category) LIKE '%social%'
       AND m.email IS NOT NULL AND m.email <> ''
       AND se.id IS NULL
     ORDER BY m.surname, m.first_name`
  ).bind(year).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({
      success: true, mode: 'bulk', total: 0, sent: 0, failed: 0, remaining: 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const totalRemaining = members.results.length;
  const batch = members.results.slice(0, BATCH_SIZE);

  // Load fee items for invoice generation
  const feeItems = await loadFeeItems(env.DB);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of batch) {
    if (member.subscription_fee === null || member.subscription_fee === undefined) {
      failed++;
      errors.push(`${member.first_name} ${member.surname}: No fee for category ${member.category}`);
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'social_renewal', ?, ?, 'failed', ?)`
      ).bind(member.id, member.email, year, `No fee for category ${member.category}`).run();
      continue;
    }

    const html = generateSocialRenewalEmail(
      {
        title: member.title as string, first_name: member.first_name as string,
        surname: member.surname as string,
        club_number: (member.club_number || member.pin) as string,
        email: member.email as string,
      },
      member.subscription_fee as number, year, bankDetails
    );

    const result = await sendEmail({ to: member.email as string, subject, html }, emailEnv);
    if (result.success) {
      sent++;
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status) VALUES (?, 'social_renewal', ?, ?, 'sent')`
      ).bind(member.id, member.email, year).run();

      // Generate invoice for this member
      await generateInvoiceForMember(env.DB, member, feeItems, { year, isDD: false, isSocial: true });
    } else {
      failed++;
      errors.push(`${member.first_name} ${member.surname} (${member.email}): ${result.error}`);
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'social_renewal', ?, ?, 'failed', ?)`
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
