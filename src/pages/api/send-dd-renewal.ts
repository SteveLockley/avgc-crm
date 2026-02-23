// API endpoint to send DD renewal email for a specific member or all DD members
// POST /api/send-dd-renewal { memberId?: number, year?: number, testEmail?: string }
// Family members with family_payer_id are consolidated into the payer's email
// Protected by Cloudflare Access (admin only)
// Bulk mode processes up to BATCH_SIZE members per request, skipping already-sent

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import {
  calculateDDSchedule, generateDDRenewalEmail, generateDDRenewalSubject,
  calculateConsolidatedSchedule, generateConsolidatedDDRenewalEmail,
} from '../../lib/dd-renewal-email';

const BATCH_SIZE = 40;

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

// Fetch dependants for a given payer ID
async function getDependants(db: any, payerId: number) {
  const rows = await db.prepare(
    `SELECT m.*, p.fee as subscription_fee
     FROM members m
     LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
     WHERE m.family_payer_id = ?
     ORDER BY m.surname, m.first_name`
  ).bind(payerId).all();
  return rows.results || [];
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
  const subject = generateDDRenewalSubject(year);

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  // Sample mode: one email per distinct category + one family consolidated sample
  if (body.testEmail && body.sample) {
    const members = await env.DB.prepare(
      `SELECT m.*, p.fee as subscription_fee
       FROM members m
       LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
       WHERE m.default_payment_method = 'Clubwise Direct Debit'
         AND LOWER(m.category) <> 'winter'
         AND m.family_payer_id IS NULL
         AND m.email IS NOT NULL AND m.email <> ''
       GROUP BY m.category
       ORDER BY m.category`
    ).all();

    if (!members.results || members.results.length === 0) {
      return new Response(JSON.stringify({ error: 'No eligible DD members found' }), { status: 404 });
    }

    let sent = 0;
    let failed = 0;
    const categories: string[] = [];
    const errors: string[] = [];

    for (const member of members.results) {
      if (member.subscription_fee === null) { failed++; errors.push(`${member.category}: No subscription fee configured`); continue; }
      const memberData = buildMemberData(member);
      const schedule = calculateDDSchedule(memberData, member.subscription_fee as number, year);
      const html = generateDDRenewalEmail(memberData, schedule);
      const catSubject = `[SAMPLE: ${member.category}] ${subject}`;

      const result = await sendEmail({ to: body.testEmail, subject: catSubject, html }, emailEnv);
      if (result.success) { sent++; categories.push(member.category as string); }
      else { failed++; errors.push(`${member.category}: ${result.error}`); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Also send a family consolidated sample if any family payers exist
    const familyPayer = await env.DB.prepare(
      `SELECT m.*, p.fee as subscription_fee
       FROM members m
       LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
       WHERE m.default_payment_method = 'Clubwise Direct Debit'
         AND LOWER(m.category) <> 'winter'
         AND m.email IS NOT NULL AND m.email <> ''
         AND m.id IN (SELECT DISTINCT family_payer_id FROM members WHERE family_payer_id IS NOT NULL)
       LIMIT 1`
    ).first();

    if (familyPayer && familyPayer.subscription_fee !== null) {
      const deps = await getDependants(env.DB, familyPayer.id as number);
      const payerData = buildMemberData(familyPayer);
      const depData = deps.filter((d: any) => d.subscription_fee !== null).map((d: any) => ({
        member: buildMemberData(d),
        fee: d.subscription_fee as number,
      }));
      const consolidated = calculateConsolidatedSchedule(payerData, familyPayer.subscription_fee as number, depData, year);
      const html = generateConsolidatedDDRenewalEmail(consolidated);
      const famSubject = `[SAMPLE: Family Consolidated] ${subject}`;

      const result = await sendEmail({ to: body.testEmail, subject: famSubject, html }, emailEnv);
      if (result.success) { sent++; categories.push('Family Consolidated'); }
      else { failed++; errors.push(`Family: ${result.error}`); }
    }

    return new Response(JSON.stringify({
      success: true, mode: 'sample', sentTo: body.testEmail, sent, failed,
      categories, errors: errors.length > 0 ? errors : undefined,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Test mode: send single test to admin email
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
             AND LOWER(m.category) <> 'winter'
             AND m.family_payer_id IS NULL
             AND m.email IS NOT NULL AND m.email <> ''
           ORDER BY m.surname LIMIT 1`
        ).first();

    if (!member || member.subscription_fee === null) {
      return new Response(JSON.stringify({ error: 'No eligible DD member found for test' }), { status: 404 });
    }

    const memberData = buildMemberData(member);

    // Check if this member is a family payer
    const deps = await getDependants(env.DB, member.id as number);
    let html: string;
    if (deps.length > 0) {
      const depData = deps.filter((d: any) => d.subscription_fee !== null).map((d: any) => ({
        member: buildMemberData(d),
        fee: d.subscription_fee as number,
      }));
      const consolidated = calculateConsolidatedSchedule(memberData, member.subscription_fee, depData, year);
      html = generateConsolidatedDDRenewalEmail(consolidated);
    } else {
      const schedule = calculateDDSchedule(memberData, member.subscription_fee, year);
      html = generateDDRenewalEmail(memberData, schedule);
    }

    const result = await sendEmail({ to: body.testEmail, subject: `[TEST] ${subject}`, html }, emailEnv);
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
    const deps = await getDependants(env.DB, member.id as number);
    let html: string;
    let annualTotal: number;

    if (deps.length > 0) {
      const depData = deps.filter((d: any) => d.subscription_fee !== null).map((d: any) => ({
        member: buildMemberData(d),
        fee: d.subscription_fee as number,
      }));
      const consolidated = calculateConsolidatedSchedule(memberData, member.subscription_fee, depData, year);
      html = generateConsolidatedDDRenewalEmail(consolidated);
      annualTotal = consolidated.totalAnnual;
    } else {
      const schedule = calculateDDSchedule(memberData, member.subscription_fee, year);
      html = generateDDRenewalEmail(memberData, schedule);
      annualTotal = schedule.initialCollectionTotal + 11 * schedule.monthlyPayment;
    }

    const result = await sendEmail({ to: member.email, subject, html }, emailEnv);
    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500 });
    }

    return new Response(JSON.stringify({
      success: true,
      mode: 'single',
      member: `${member.first_name} ${member.surname}`,
      email: member.email,
      category: member.category,
      annualTotal,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Bulk mode: send to all DD payers (skip dependants — they're included in payer's consolidated email)
  // Skip members already sent for this email_type + year
  const members = await env.DB.prepare(
    `SELECT m.*, p.fee as subscription_fee
     FROM members m
     LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
     LEFT JOIN sent_emails se ON se.member_id = m.id AND se.email_type = 'dd_renewal' AND se.year = ? AND se.status = 'sent'
     WHERE m.default_payment_method = 'Clubwise Direct Debit'
       AND LOWER(m.category) <> 'winter'
       AND m.family_payer_id IS NULL
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

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of batch) {
    if (member.subscription_fee === null || member.subscription_fee === undefined) {
      failed++;
      errors.push(`${member.first_name} ${member.surname}: No fee for category ${member.category}`);
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'dd_renewal', ?, ?, 'failed', ?)`
      ).bind(member.id, member.email, year, `No fee for category ${member.category}`).run();
      continue;
    }

    const memberData = buildMemberData(member);
    const deps = await getDependants(env.DB, member.id as number);
    let html: string;

    if (deps.length > 0) {
      const depData = deps.filter((d: any) => d.subscription_fee !== null).map((d: any) => ({
        member: buildMemberData(d),
        fee: d.subscription_fee as number,
      }));
      const consolidated = calculateConsolidatedSchedule(memberData, member.subscription_fee as number, depData, year);
      html = generateConsolidatedDDRenewalEmail(consolidated);
    } else {
      const schedule = calculateDDSchedule(memberData, member.subscription_fee as number, year);
      html = generateDDRenewalEmail(memberData, schedule);
    }

    const result = await sendEmail({ to: member.email as string, subject, html }, emailEnv);
    if (result.success) {
      sent++;
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status) VALUES (?, 'dd_renewal', ?, ?, 'sent')`
      ).bind(member.id, member.email, year).run();
    } else {
      failed++;
      errors.push(`${member.first_name} ${member.surname} (${member.email}): ${result.error}`);
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'dd_renewal', ?, ?, 'failed', ?)`
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
