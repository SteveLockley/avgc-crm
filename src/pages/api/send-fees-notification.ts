// API endpoint to send fees notification email to all members (or a single test member)
// POST /api/send-fees-notification { testEmail?: string }
// If testEmail is provided, sends only to that address
// If no testEmail, sends to all members with email addresses

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateFeesNotificationEmail, generateFeesNotificationSubject } from '../../lib/fees-notification-email';

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

  // Bulk mode: send to all members with email addresses
  const members = await env.DB.prepare(
    "SELECT id, first_name, surname, email FROM members WHERE email IS NOT NULL AND email <> '' ORDER BY surname, first_name"
  ).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({ error: 'No members with email addresses found' }), { status: 404 });
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const member of members.results) {
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
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
