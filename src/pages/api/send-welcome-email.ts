import type { APIRoute } from 'astro';
import { sendEmail } from '../../lib/email';
import { generateWelcomeEmail, generateWelcomeEmailSubject } from '../../lib/welcome-email';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const env = locals.runtime.env;

  try {
    const { memberId } = await request.json();
    if (!memberId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing memberId' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const member = await db.prepare(
      'SELECT id, first_name, surname, pin, email FROM members WHERE id = ?'
    ).bind(memberId).first<{ id: number; first_name: string; surname: string; pin: string; email: string }>();

    if (!member) {
      return new Response(JSON.stringify({ success: false, error: 'Member not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!member.pin) {
      return new Response(JSON.stringify({ success: false, error: 'Member has no PIN' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!member.email) {
      return new Response(JSON.stringify({ success: false, error: 'Member has no email address' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const html = generateWelcomeEmail(member);
    const result = await sendEmail({
      to: member.email,
      subject: generateWelcomeEmailSubject(),
      html
    }, env);

    const now = new Date();
    await db.prepare(
      `INSERT INTO sent_emails (member_id, email_type, email_address, year, status, error)
       VALUES (?, 'welcome', ?, ?, ?, ?)`
    ).bind(
      memberId,
      member.email,
      now.getFullYear(),
      result.success ? 'sent' : 'failed',
      result.error || null
    ).run();

    return new Response(JSON.stringify({
      success: result.success,
      error: result.error,
      name: `${member.first_name} ${member.surname}`,
      email: member.email
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
