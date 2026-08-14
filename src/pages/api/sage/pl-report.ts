import type { APIRoute } from 'astro';
import { computePLReport, lastDayOfMonth } from '@/lib/pl-report';
import { renderPLReportHtml } from '@/lib/pl-report-html';
import { sendEmail, isValidEmail } from '@/lib/email';

/**
 * Monthly P&L report actions.
 * POST /api/sage/pl-report
 *   { action: 'generate', month: 'YYYY-MM' }                          — recompute from Sage and save/overwrite the snapshot
 *   { action: 'send', month: 'YYYY-MM', recipients?: string[] }       — email the saved snapshot to active recipients (or override list)
 *   { action: 'add-recipient', email, name? }
 *   { action: 'remove-recipient', id }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  const db = env?.DB;
  if (!db) {
    return json({ error: 'Not configured' }, 500);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = body?.action;

  if (action === 'generate') {
    const month = body?.month;
    if (!/^\d{4}-\d{2}$/.test(month || '')) return json({ error: 'month must be YYYY-MM' }, 400);
    if (!env?.SAGE_CLIENT_ID || !env?.SAGE_CLIENT_SECRET) return json({ error: 'Not connected to Sage.' }, 500);

    try {
      const periodEnd = lastDayOfMonth(month);
      const data = await computePLReport(env, periodEnd);
      await db.prepare(`
        INSERT INTO pl_reports (period_end, data, generated_at, generated_by)
        VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(period_end) DO UPDATE SET
          data = excluded.data, generated_at = datetime('now'), generated_by = excluded.generated_by
      `).bind(periodEnd, JSON.stringify(data), locals.user?.email ?? null).run();
      return json({ success: true, data });
    } catch (e: any) {
      return json({ error: e.message?.includes('NO_SAGE_CONNECTION') ? 'Not connected to Sage.' : e.message }, 500);
    }
  }

  if (action === 'send') {
    const month = body?.month;
    if (!/^\d{4}-\d{2}$/.test(month || '')) return json({ error: 'month must be YYYY-MM' }, 400);
    const periodEnd = lastDayOfMonth(month);

    const row = await db.prepare('SELECT data FROM pl_reports WHERE period_end = ?').bind(periodEnd).first() as any;
    if (!row) return json({ error: 'No report generated for this month yet.' }, 400);

    let recipients: string[] = Array.isArray(body?.recipients) ? body.recipients : [];
    if (recipients.length === 0) {
      const rs = await db.prepare('SELECT email FROM pl_report_recipients WHERE active = 1').all();
      recipients = (rs.results as any[]).map(r => r.email);
    }
    recipients = recipients.filter(isValidEmail);
    if (recipients.length === 0) return json({ error: 'No valid recipients.' }, 400);

    const data = JSON.parse(row.data);
    const html = renderPLReportHtml(data);
    const subject = `AVGC Income & Expenditure (Cash Based) — ${data.periodLabel}`;

    const results = await Promise.all(
      recipients.map(to => sendEmail({ to, subject, html }, env))
    );
    const failed = recipients.filter((_, i) => !results[i].success);

    await db.prepare(
      `UPDATE pl_reports SET sent_at = datetime('now'), sent_to = ? WHERE period_end = ?`
    ).bind(recipients.filter((_, i) => results[i].success).join(', '), periodEnd).run();

    if (failed.length > 0) {
      return json({ success: true, sent: recipients.length - failed.length, failed }, 207);
    }
    return json({ success: true, sent: recipients.length });
  }

  if (action === 'add-recipient') {
    const email = String(body?.email || '').trim();
    if (!isValidEmail(email)) return json({ error: 'Invalid email address.' }, 400);
    const name = body?.name ? String(body.name).trim() : null;
    try {
      await db.prepare(
        `INSERT INTO pl_report_recipients (email, name) VALUES (?, ?)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name, active = 1`
      ).bind(email, name).run();
      return json({ success: true });
    } catch (e: any) {
      return json({ error: e.message }, 500);
    }
  }

  if (action === 'remove-recipient') {
    const id = parseInt(body?.id);
    if (!id) return json({ error: 'id required' }, 400);
    await db.prepare('UPDATE pl_report_recipients SET active = 0 WHERE id = ?').bind(id).run();
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, 400);
};

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
