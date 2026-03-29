import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateWelcomeEmail, generateWelcomeEmailSubject } from '../../lib/welcome-email';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const env = locals.runtime.env;

  try {
    // Find new members (joined this membership year) who have paid invoices
    // but haven't received a welcome email yet
    const now = new Date();
    const yearStart = now.getMonth() >= 3
      ? `${now.getFullYear()}-04-01`
      : `${now.getFullYear() - 1}-04-01`;

    const members = await db.prepare(`
      SELECT m.id, m.first_name, m.surname, m.pin, m.email
      FROM members m
      WHERE m.date_joined >= ?
        AND m.pin IS NOT NULL AND m.pin != ''
        AND m.email IS NOT NULL AND m.email != ''
        AND EXISTS (
          SELECT 1 FROM payments p
          JOIN invoices i ON p.invoice_id = i.id
          WHERE p.member_id = m.id AND i.status = 'paid'
        )
        AND NOT EXISTS (
          SELECT 1 FROM sent_emails se
          WHERE se.member_id = m.id AND se.email_type = 'welcome'
        )
      ORDER BY m.surname, m.first_name
    `).bind(yearStart).all();

    const results: Array<{ name: string; email: string; status: string; error?: string }> = [];

    for (const member of (members.results || []) as any[]) {
      try {
        const html = generateWelcomeEmail(member);
        const result = await sendEmail({
          to: member.email,
          subject: generateWelcomeEmailSubject(),
          html
        }, env);

        await db.prepare(
          `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error)
           VALUES (?, 'welcome', ?, ?, ?, ?)`
        ).bind(
          member.id,
          member.email,
          now.getFullYear(),
          result.success ? 'sent' : 'failed',
          result.error || null
        ).run();

        results.push({
          name: `${member.first_name} ${member.surname}`,
          email: member.email,
          status: result.success ? 'sent' : 'failed',
          error: result.error
        });
      } catch (e: any) {
        results.push({
          name: `${member.first_name} ${member.surname}`,
          email: member.email,
          status: 'failed',
          error: e.message
        });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return new Response(JSON.stringify({
      success: true,
      total: results.length,
      sent,
      failed,
      results
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
