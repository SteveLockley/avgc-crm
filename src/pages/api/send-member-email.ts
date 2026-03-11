// API endpoint for batch member email sending
// POST /api/send-member-email
// Actions:
//   send:    { action: 'send', subject, body, memberIds: number[] } - send emails to a batch of members
//   test:    { action: 'test', subject, body, testEmail: string } - send test email to specified address
//   log:     { action: 'log', subject, sender, totalSent, totalFailed, errors?: string[] } - write batch summary

import type { APIRoute } from 'astro';
import { sendEmail, isValidEmail } from '../../lib/email';

const BATCH_SIZE = 40;
const DELAY_MS = 200;

function processPlaceholders(text: string): string {
  // Process [img:URL] → <img> tags
  text = text.replace(/\[img:(https?:\/\/[^\]]+)\]/g,
    (_, url) => `<img src="${url}" style="max-width:100%;height:auto;border-radius:8px;margin:8px 0;display:block;" alt="" />`
  );
  // Process [link:URL|text] → <a> tags
  text = text.replace(/\[link:(https?:\/\/[^\]|]+)\|([^\]]+)\]/g,
    (_, url, label) => `<a href="${url}" style="color:#1e5631;font-weight:500;">${label}</a>`
  );
  return text;
}

function generateEmailHtml(body: string): string {
  body = processPlaceholders(body);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: #1e5631; padding: 24px 30px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">Alnmouth Village Golf Club</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <div style="font-size: 15px; line-height: 1.6; color: #333;">${body.replace(/\n/g, '<br>')}</div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; border-radius: 0 0 8px 8px; border-top: 1px solid #e0e0e0;">
              <p style="margin: 0; font-size: 13px; color: #666;"><strong>Alnmouth Village Golf Club</strong></p>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #666;">Marine Road, Alnmouth, Northumberland, NE66 2RZ</p>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #666;">Tel: 01665 830231 | <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #1e5631;">subscriptions@AlnmouthVillage.Golf</a></p>
              <p style="margin: 8px 0 0 0; font-size: 13px;"><a href="https://alnmouthvillage.golf" style="color: #1e5631;">www.AlnmouthVillage.Golf</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const emailEnv = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  const action = body.action || 'send';

  // === TEST MODE ===
  if (action === 'test') {
    const { subject, body: emailBody, testEmail } = body;
    if (!subject || !emailBody || !testEmail) {
      return new Response(JSON.stringify({ error: 'subject, body, and testEmail are required' }), { status: 400 });
    }

    const personalizedBody = emailBody
      .replace(/\{first_name\}/g, 'Test')
      .replace(/\{surname\}/g, 'User')
      .replace(/\{name\}/g, 'Test User');

    const result = await sendEmail({
      to: testEmail,
      subject: `[TEST] ${subject}`,
      html: generateEmailHtml(personalizedBody),
    }, emailEnv);

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500 });
    }

    return new Response(JSON.stringify({
      success: true, mode: 'test', sentTo: testEmail,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // === LOG SUMMARY ===
  if (action === 'log') {
    const { subject, sender, totalSent, totalFailed, errors } = body;
    const errorsText = errors && errors.length > 0 ? errors.join('\n') : null;

    await env.DB.prepare(
      `INSERT INTO email_log (email_type, subject, sender, total_recipients, total_sent, total_failed, errors)
       VALUES ('member_email', ?, ?, ?, ?, ?, ?)`
    ).bind(
      subject || '',
      sender || 'subscriptions@AlnmouthVillage.Golf',
      (totalSent || 0) + (totalFailed || 0),
      totalSent || 0,
      totalFailed || 0,
      errorsText,
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // === SEND BATCH ===
  // When testEmail is provided, all emails are redirected to that address (dry run)
  const { subject, body: emailBody, memberIds, testEmail } = body;
  if (!subject || !emailBody) {
    return new Response(JSON.stringify({ error: 'subject and body are required' }), { status: 400 });
  }
  if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
    return new Response(JSON.stringify({ error: 'memberIds is required' }), { status: 400 });
  }

  // Enforce batch size limit
  const batchIds = memberIds.slice(0, BATCH_SIZE);

  // Fetch members
  const placeholders = batchIds.map(() => '?').join(',');
  const members = await env.DB.prepare(
    `SELECT id, first_name, surname, email FROM members WHERE id IN (${placeholders})`
  ).bind(...batchIds).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({ error: 'No members found' }), { status: 404 });
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const year = new Date().getFullYear();

  for (const member of members.results as any[]) {
    if (!member.email || !isValidEmail(member.email)) {
      failed++;
      errors.push(`${member.first_name} ${member.surname}: invalid email`);
      continue;
    }

    const personalizedBody = emailBody
      .replace(/\{first_name\}/g, member.first_name || '')
      .replace(/\{surname\}/g, member.surname || '')
      .replace(/\{name\}/g, `${member.first_name || ''} ${member.surname || ''}`);

    const sendTo = testEmail || member.email;
    const sendSubject = testEmail ? `[TEST] ${subject}` : subject;

    const result = await sendEmail({
      to: sendTo,
      subject: sendSubject,
      html: generateEmailHtml(personalizedBody),
    }, emailEnv);

    if (result.success) {
      sent++;
    } else {
      failed++;
      const errorMsg = `${member.first_name} ${member.surname} (${member.email}): ${result.error}`;
      errors.push(errorMsg);
      // Log individual failure to sent_emails (skip logging in test mode)
      if (!testEmail) {
        await env.DB.prepare(
          `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error)
           VALUES (?, 'member_email', ?, ?, 'failed', ?)`
        ).bind(member.id, member.email, year, result.error || 'Unknown error').run();
      }
    }

    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  return new Response(JSON.stringify({
    success: true, sent, failed,
    errors: errors.length > 0 ? errors : undefined,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
