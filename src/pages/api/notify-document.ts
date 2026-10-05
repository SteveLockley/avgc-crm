// Email all members that a document (usually minutes) has been published.
// POST /api/notify-document { documentId, mode: 'preview' | 'test' | 'send' }
//   preview → recipient count, subject and email HTML; nothing is sent
//   test    → one copy to the signed-in admin
//   send    → every current member who has an email address and has consented
//             to electronic communication, BCC'd in batches from the club
//             mailbox. Addresses already sent this notice are skipped, so a
//             repeat click cannot email anyone twice.
// Admin-only: /api routes require an admin session unless listed as open in middleware.

import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateDocumentNoticeEmail, generateDocumentNoticeSubject, type NoticeDocument } from '../../lib/document-notice-email';

// Exchange Online allows 500 recipients per message; stay well under it.
const BCC_BATCH_SIZE = 250;
const CLUB_MAILBOX = 'subscriptions@AlnmouthVillage.Golf';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function noticeRecipients(db: any, emailType: string) {
  const rows = await db.prepare(
    `SELECT m.id, LOWER(TRIM(m.email)) AS email
     FROM members m
     WHERE m.deleted_at IS NULL
       AND m.email IS NOT NULL AND TRIM(m.email) <> ''
       AND m.electronic_communication_consent = 'Yes'
       AND (m.date_expires IS NULL OR m.date_expires >= date('now'))
       AND LOWER(TRIM(m.email)) NOT IN (
         SELECT LOWER(email_address) FROM sent_emails WHERE email_type = ? AND status = 'sent'
       )
     ORDER BY m.surname, m.first_name`
  ).bind(emailType).all();

  // One copy per address: family members often share an email
  const seen = new Set<string>();
  const recipients: { id: number; email: string }[] = [];
  const invalid: string[] = [];
  for (const row of rows.results || []) {
    if (seen.has(row.email)) continue;
    seen.add(row.email);
    if (EMAIL_PATTERN.test(row.email)) recipients.push(row);
    else invalid.push(row.email);
  }
  return { recipients, invalid };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return json({ error: 'Database not available' }, 500);

  let body: { documentId?: number; mode?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const doc = await env.DB.prepare(
    `SELECT id, title, category, document_url, document_date, published FROM member_documents WHERE id = ?`
  ).bind(Number(body.documentId)).first() as (NoticeDocument & { id: number; published: number }) | null;
  if (!doc) return json({ error: 'Document not found' }, 404);
  if (!doc.published) return json({ error: 'Publish the document before emailing members about it' }, 400);

  const emailType = `document_notice_${doc.id}`;
  const subject = generateDocumentNoticeSubject(doc);
  const html = generateDocumentNoticeEmail(doc);
  const azure = {
    AZURE_TENANT_ID: env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: env.AZURE_CLIENT_SECRET,
    AZURE_SERVICE_USER: env.AZURE_SERVICE_USER,
    AZURE_SERVICE_PASSWORD: env.AZURE_SERVICE_PASSWORD,
  };

  if (body.mode === 'preview') {
    const { recipients, invalid } = await noticeRecipients(env.DB, emailType);
    const already = await env.DB.prepare(
      `SELECT COUNT(DISTINCT LOWER(email_address)) AS n FROM sent_emails WHERE email_type = ? AND status = 'sent'`
    ).bind(emailType).first();
    return json({ success: true, subject, html, recipientCount: recipients.length, alreadySent: already?.n || 0, invalid });
  }

  if (body.mode === 'test') {
    const adminEmail = (locals as any).user?.email;
    if (!adminEmail) return json({ error: 'No signed-in admin email to send the test to' }, 400);
    const result = await sendEmail({ to: adminEmail, subject: `[TEST] ${subject}`, html }, azure);
    return result.success ? json({ success: true, sentTo: adminEmail }) : json({ error: result.error }, 500);
  }

  if (body.mode !== 'send') return json({ error: 'Unknown mode' }, 400);

  const { recipients, invalid } = await noticeRecipients(env.DB, emailType);
  if (recipients.length === 0) return json({ success: true, sent: 0, failed: 0, batches: 0, invalid });

  const year = Number(String(doc.document_date).slice(0, 4)) || new Date().getFullYear();
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let start = 0; start < recipients.length; start += BCC_BATCH_SIZE) {
    const batch = recipients.slice(start, start + BCC_BATCH_SIZE);
    const result = await sendEmail(
      { to: CLUB_MAILBOX, bcc: batch.map(r => r.email), subject, html },
      azure
    );
    const status = result.success ? 'sent' : 'failed';
    if (result.success) sent += batch.length;
    else {
      failed += batch.length;
      errors.push(`Batch ${start / BCC_BATCH_SIZE + 1} (${batch.length} members): ${result.error}`);
    }
    // Record every address so a re-run only retries the ones that failed
    await env.DB.batch(batch.map(r =>
      env.DB.prepare(
        `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(r.id, emailType, r.email, year, status, result.success ? null : (result.error || 'Unknown error'))
    ));
  }

  await env.DB.prepare(
    `INSERT INTO email_log (email_type, subject, sender, total_recipients, total_sent, total_failed, errors) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(emailType, subject, (locals as any).user?.email || null, recipients.length, sent, failed, errors.length ? JSON.stringify(errors) : null).run();

  return json({
    success: failed === 0,
    sent,
    failed,
    batches: Math.ceil(recipients.length / BCC_BATCH_SIZE),
    invalid,
    errors: errors.length ? errors : undefined,
  });
};
