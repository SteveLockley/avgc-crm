// API endpoint to send fees notification email to all members (or a single test member)
// POST /api/send-fees-notification { testEmail?: string }
// If testEmail is provided, sends only to that address
// If no testEmail, sends to all members with email addresses
// Bulk mode processes up to BATCH_SIZE members per request, skipping already-sent

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateFeesNotificationEmail, generateFeesNotificationSubject } from '../../lib/fees-notification-email';

const BATCH_SIZE = 40;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: { testEmail?: string; year?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const year = body.year || new Date().getFullYear();
  const subject = generateFeesNotificationSubject(year);
  const html = generateFeesNotificationEmail(year);

  // Test mode: send to a single email
  if (body.testEmail) {
    const result = await sendEmail(
      { to: body.testEmail, subject, html },
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

    return new Response(JSON.stringify({
      success: true,
      mode: 'test',
      sentTo: body.testEmail,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Bulk mode: send to all members with email addresses (exclude Winter — separate Oct renewal cycle)
  // Skip members already sent for this email_type + year
  const members = await env.DB.prepare(
    `SELECT m.id, m.first_name, m.surname, m.email
     FROM members m
     LEFT JOIN sent_emails se ON se.member_id = m.id AND se.email_type = 'fees_notification' AND se.year = ? AND se.status = 'sent'
     WHERE m.email IS NOT NULL AND m.email <> ''
       AND LOWER(m.category) <> 'winter'
       AND se.id IS NULL
     ORDER BY m.surname, m.first_name`
  ).bind(year).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      mode: 'bulk',
      total: 0,
      sent: 0,
      failed: 0,
      remaining: 0,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const totalRemaining = members.results.length;
  const batch = members.results.slice(0, BATCH_SIZE);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of batch) {
    const result = await sendEmail(
      { to: member.email as string, subject, html },
      {
        AZURE_TENANT_ID: env.AZURE_TENANT_ID,
        AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
        AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
        AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
        AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
      }
    );

    if (result.success) {
      sent++;
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status) VALUES (?, 'fees_notification', ?, ?, 'sent')`
      ).bind(member.id, member.email, year).run();
    } else {
      failed++;
      errors.push(`${member.first_name} ${member.surname} (${member.email}): ${result.error}`);
      await env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, 'fees_notification', ?, ?, 'failed', ?)`
      ).bind(member.id, member.email, year, result.error || 'Unknown error').run();
    }

    // Rate limit: 100ms between emails
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const remaining = totalRemaining - batch.length;

  return new Response(JSON.stringify({
    success: true,
    mode: 'bulk',
    total: batch.length,
    sent,
    failed,
    remaining,
    errors: errors.length > 0 ? errors : undefined,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
