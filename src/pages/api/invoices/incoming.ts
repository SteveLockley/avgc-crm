import type { APIRoute } from 'astro';
import { ingestPdf } from '@/lib/invoices/ingest';

/**
 * Incoming supplier invoices.
 *
 * POST /api/invoices/incoming            multipart form with one or more `file` PDFs
 * POST /api/invoices/incoming?action=... JSON actions: approve | reject | reparse | correct
 */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const env = locals.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Not configured' }, 500);

  const user = locals.user;
  if (!user && !import.meta.env.DEV) return json({ error: 'Not authorised' }, 403);
  const actor = user?.email || 'system';

  const action = url.searchParams.get('action');

  // ─── Upload ────────────────────────────────────────────────────────
  if (!action) {
    const form = await request.formData();
    const files = form.getAll('file').filter((f): f is File => f instanceof File);
    if (!files.length) return json({ error: 'No PDF supplied' }, 400);

    const results = [];
    for (const file of files) {
      if (file.size > 15 * 1024 * 1024) {
        results.push({ fileName: file.name, outcome: 'error', detail: 'Larger than 15MB' });
        continue;
      }
      const bytes = await file.arrayBuffer();
      const r = await ingestPdf(db, { bytes, fileName: file.name, source: 'upload' });
      results.push({ fileName: file.name, ...r });
    }
    return json({ ok: true, results });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const id = Number(body?.id);
  if (!id) return json({ error: 'id is required' }, 400);

  if (action === 'approve' || action === 'reject') {
    const status = action === 'approve' ? 'approved' : 'rejected';
    await db.prepare(
      `UPDATE supplier_invoices
          SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), notes = COALESCE(?, notes)
        WHERE id = ?`
    ).bind(status, actor, body.notes ?? null, id).run();
    return json({ ok: true, status });
  }

  // Fix a field the parser got wrong. Corrections are how the adapters improve.
  if (action === 'correct') {
    const allowed = ['invoice_number', 'invoice_date', 'due_date', 'net_amount', 'vat_amount', 'gross_amount', 'account_reference', 'supplier_name'];
    const sets: string[] = [];
    const values: any[] = [];
    for (const field of allowed) {
      if (field in (body.fields || {})) {
        sets.push(`${field} = ?`);
        const v = body.fields[field];
        values.push(v === '' ? null : v);
      }
    }
    if (!sets.length) return json({ error: 'No recognised fields to correct' }, 400);

    await db.prepare(
      `UPDATE supplier_invoices SET ${sets.join(', ')}, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).bind(...values, actor, id).run();

    await db.prepare(
      `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
       VALUES (?, 'invoice_corrected', 'supplier_invoice', ?, ?)`
    ).bind(actor, id, JSON.stringify(body.fields)).run();

    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
