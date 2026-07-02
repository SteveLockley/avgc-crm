import type { APIRoute } from 'astro';
import { createSageClient } from '@/lib/sage';
import { ensureSession, fetchHomepage, parseHomepageTables } from '@/lib/touchoffice';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toTouchOfficeDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return json({ error: 'DB not configured' }, 500);

  const db = env.DB;

  const [importsResult, mappingsResult, debitAccountRow, ledgerAccountsResult] = await Promise.all([
    db.prepare(`
      SELECT * FROM touchoffice_sage_imports
      WHERE import_date >= date('now', '-90 days')
      ORDER BY import_date DESC
    `).all().catch(() => ({ results: [] })),

    db.prepare(`SELECT * FROM dept_sage_mapping ORDER BY dept_pattern`).all().catch(() => ({ results: [] })),

    db.prepare(`SELECT value FROM app_settings WHERE key = 'sage_sales_debit_account_id'`)
      .first<{ value: string }>().catch(() => null),

    db.prepare(`
      SELECT id, nominal_code, name, displayed_as, ledger_account_type
      FROM sage_ledger_accounts
      WHERE is_visible_in_journals = 1
      ORDER BY nominal_code
    `).all().catch(() => ({ results: [] })),
  ]);

  return json({
    imports: importsResult.results || [],
    mappings: mappingsResult.results || [],
    debitAccountId: debitAccountRow?.value ?? null,
    ledgerAccounts: ledgerAccountsResult.results || [],
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return json({ error: 'DB not configured' }, 500);

  const db = env.DB;
  let body: any;

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { date, preview = false } = body;

  // Validate date
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  if (date >= new Date().toISOString().slice(0, 10)) {
    return json({ error: 'Cannot import today or a future date' }, 400);
  }

  // For actual import (not preview), check for duplicate
  if (!preview) {
    const existing = await db.prepare(
      `SELECT status FROM touchoffice_sage_imports WHERE import_date = ?`
    ).bind(date).first<{ status: string }>().catch(() => null);

    if (existing?.status === 'imported') {
      return json({ error: 'already_imported', message: `${date} has already been imported` }, 409);
    }
  }

  // Load mappings and debit account
  const [mappingsResult, debitAccountRow] = await Promise.all([
    db.prepare(`SELECT * FROM dept_sage_mapping WHERE enabled = 1`).all(),
    db.prepare(`SELECT value FROM app_settings WHERE key = 'sage_sales_debit_account_id'`)
      .first<{ value: string }>().catch(() => null),
  ]);

  const mappings: any[] = mappingsResult.results || [];

  if (mappings.length === 0) {
    return json({ error: 'No department mappings configured' }, 400);
  }
  if (!preview && !debitAccountRow?.value) {
    return json({ error: 'Clearing (debit) account not configured' }, 400);
  }

  // Fetch TouchOffice data for the date
  let departments: Array<{ name: string; quantity: number; value: number }>;
  try {
    const { session } = await ensureSession(db, env);
    const toDate = toTouchOfficeDate(date);
    const html = await fetchHomepage(session, toDate, toDate);
    const parsed = parseHomepageTables(html);
    departments = parsed.departments;
  } catch (err: any) {
    return json({ error: 'TouchOffice fetch failed', detail: err?.message }, 502);
  }

  // Match departments to mappings
  const matched: Array<{ deptName: string; value: number; ledgerAccountId: string; ledgerAccountName: string }> = [];

  for (const dept of departments) {
    if (dept.value === 0) continue;
    for (const mapping of mappings) {
      if (dept.name.toLowerCase().includes(mapping.dept_pattern.toLowerCase())) {
        matched.push({
          deptName: dept.name,
          value: dept.value,
          ledgerAccountId: mapping.sage_ledger_account_id,
          ledgerAccountName: mapping.sage_ledger_account_name ?? mapping.sage_ledger_account_id,
        });
        break;
      }
    }
  }

  const total = matched.reduce((s, m) => s + m.value, 0);

  if (total === 0) {
    return json({
      error: 'no_data',
      message: 'No matching departments found or all values are zero',
      departments,
    }, 400);
  }

  // Preview mode — return what would be posted without writing anything
  if (preview) {
    return json({ preview: true, date, matched, total, allDepartments: departments });
  }

  // Create Sage journal
  const debitAccountId = debitAccountRow!.value;
  const dateLabel = new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const journalLines = [
    {
      ledgerAccountId: debitAccountId,
      debit: total,
      credit: 0,
      details: `TouchOffice daily POS takings ${dateLabel}`,
    },
    ...matched.map(m => ({
      ledgerAccountId: m.ledgerAccountId,
      debit: 0,
      credit: m.value,
      details: m.deptName,
    })),
  ];

  // Write a pending record first so we can update it on error
  await db.prepare(`
    INSERT INTO touchoffice_sage_imports (import_date, status, total_amount, dept_breakdown_json)
    VALUES (?, 'pending', ?, ?)
    ON CONFLICT(import_date) DO UPDATE SET
      status = 'pending',
      total_amount = excluded.total_amount,
      dept_breakdown_json = excluded.dept_breakdown_json,
      error_message = NULL,
      sage_journal_id = NULL,
      imported_at = NULL
  `).bind(date, total, JSON.stringify(matched)).run();

  let sageJournalId: string;
  try {
    const client = createSageClient(env);
    const result = await client.createJournal({
      date,
      reference: `TO-${date}`,
      description: `TouchOffice Daily Sales ${dateLabel}`,
      journalLines,
    });
    sageJournalId = result?.journal?.id ?? result?.id ?? '';
  } catch (err: any) {
    await db.prepare(`
      UPDATE touchoffice_sage_imports
      SET status = 'error', error_message = ?, imported_at = datetime('now')
      WHERE import_date = ?
    `).bind(err?.message ?? String(err), date).run();
    return json({ error: 'Sage journal creation failed', detail: err?.message }, 502);
  }

  await db.prepare(`
    UPDATE touchoffice_sage_imports
    SET status = 'imported', sage_journal_id = ?, imported_at = datetime('now')
    WHERE import_date = ?
  `).bind(sageJournalId, date).run();

  return json({ success: true, date, total, matched, sageJournalId });
};
