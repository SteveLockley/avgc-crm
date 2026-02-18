// API endpoint to send DD renewal email for a specific member
// POST /api/send-dd-renewal { memberId: number }
// Protected by Cloudflare Access (admin only)

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { calculateDDSchedule, generateDDRenewalEmail, generateDDRenewalSubject } from '../../lib/dd-renewal-email';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { memberId?: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (!body.memberId) {
    return new Response(JSON.stringify({ error: 'memberId is required' }), { status: 400 });
  }

  // Fetch member
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

  const year = new Date().getFullYear();
  const schedule = calculateDDSchedule(
    {
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
    },
    member.subscription_fee,
    year
  );

  const html = generateDDRenewalEmail(
    {
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
    },
    schedule
  );

  const subject = generateDDRenewalSubject(year);

  const result = await sendEmail(
    { to: member.email, subject, html },
    {
      AZURE_TENANT_ID: env.AZURE_TENANT_ID,
      AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
      AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
      AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
      AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
    }
  );

  if (!result.success) {
    return new Response(JSON.stringify({ error: result.error }), { status: 500 });
  }

  const annualTotal = schedule.initialCollectionTotal + 11 * schedule.monthlyPayment;

  return new Response(JSON.stringify({
    success: true,
    member: `${member.first_name} ${member.surname}`,
    email: member.email,
    category: member.category,
    annualTotal,
    initialPayment: schedule.initialCollectionTotal,
    monthlyPayment: schedule.monthlyPayment,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
