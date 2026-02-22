// API endpoint to send DD renewal email for a specific member or all DD members
// POST /api/send-dd-renewal { memberId?: number, year?: number, testEmail?: string }
// If memberId provided: sends to that member
// If no memberId and no testEmail: bulk sends to all DD payers
// If testEmail provided: sends test using first DD member's data
// Protected by Cloudflare Access (admin only)

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { calculateDDSchedule, generateDDRenewalEmail, generateDDRenewalSubject } from '../../lib/dd-renewal-email';

function buildMemberData(member: any) {
  return {
    title: member.title,
    first_name: member.first_name,
    surname: member.surname,
    club_number: member.club_number || member.pin,
    category: member.category,
    email: member.email,
    direct_debit_member_id: member.direct_debit_member_id,
    locker_number: member.locker_number,
    national_id: member.national_id,
    home_away: member.home_away,
    handicap_index: member.handicap_index,
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { memberId?: number; year?: number; testEmail?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const year = body.year || new Date().getFullYear();
  const subject = generateDDRenewalSubject(year);

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  // Test mode: send to a test email using first DD member's data
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
           WHERE m.default_payment_method = 'Clubwise Direct Debit'
             AND m.email IS NOT NULL AND m.email <> ''
           ORDER BY m.surname LIMIT 1`
        ).first();

    if (!member || member.subscription_fee === null) {
      return new Response(JSON.stringify({ error: 'No eligible DD member found for test' }), { status: 404 });
    }

    const memberData = buildMemberData(member);
    const schedule = calculateDDSchedule(memberData, member.subscription_fee, year);
    const html = generateDDRenewalEmail(memberData, schedule);

    const result = await sendEmail({ to: body.testEmail, subject, html }, emailEnv);
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500 });
    }

    return new Response(JSON.stringify({
      success: true,
      mode: 'test',
      sentTo: body.testEmail,
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

    if (!member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404 });
    }
    if (!member.email) {
      return new Response(JSON.stringify({ error: 'Member has no email address' }), { status: 400 });
    }
    if (member.subscription_fee === null || member.subscription_fee === undefined) {
      return new Response(JSON.stringify({ error: `No subscription fee found for category: ${member.category}` }), { status: 400 });
    }

    const memberData = buildMemberData(member);
    const schedule = calculateDDSchedule(memberData, member.subscription_fee, year);
    const html = generateDDRenewalEmail(memberData, schedule);

    const result = await sendEmail({ to: member.email, subject, html }, emailEnv);
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500 });
    }

    const annualTotal = schedule.initialCollectionTotal + 11 * schedule.monthlyPayment;
    return new Response(JSON.stringify({
      success: true,
      mode: 'single',
      member: `${member.first_name} ${member.surname}`,
      email: member.email,
      category: member.category,
      annualTotal,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Bulk mode: send to all DD payers
  const members = await env.DB.prepare(
    `SELECT m.*, p.fee as subscription_fee
     FROM members m
     LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
     WHERE m.default_payment_method = 'Clubwise Direct Debit'
       AND m.email IS NOT NULL AND m.email <> ''
     ORDER BY m.surname, m.first_name`
  ).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({ error: 'No DD members with email addresses found' }), { status: 404 });
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of members.results) {
    if (member.subscription_fee === null || member.subscription_fee === undefined) {
      failed++;
      errors.push(`${member.first_name} ${member.surname}: No fee for category ${member.category}`);
      continue;
    }

    const memberData = buildMemberData(member);
    const schedule = calculateDDSchedule(memberData, member.subscription_fee as number, year);
    const html = generateDDRenewalEmail(memberData, schedule);

    const result = await sendEmail({ to: member.email as string, subject, html }, emailEnv);
    if (result.success) {
      sent++;
    } else {
      failed++;
      errors.push(`${member.first_name} ${member.surname} (${member.email}): ${result.error}`);
    }

    // Rate limit: 100ms between emails
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return new Response(JSON.stringify({
    success: true,
    mode: 'bulk',
    total: members.results.length,
    sent,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
