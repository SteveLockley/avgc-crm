import type { APIRoute } from 'astro';
import { ensureSession, fetchSeniorsPurseStatement, fetchSaleReceipt, debugFetchPurseReport } from '../../lib/touchoffice';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const env = locals.runtime.env;

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'sync':
        return await handleSync(db, env, body);
      case 'list':
        return await handleList(db, body);
      case 'debug':
        return await handleDebug(db, env, body);
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
};

/**
 * Fetch the Customer Statement for the given year from TouchOffice,
 * look up the till receipt for each new entry, and store in DB.
 */
async function handleSync(db: any, env: any, body: any) {
  const year = parseInt(body.year) || new Date().getFullYear();

  const { session, csrfToken } = await ensureSession(db, env);
  const entries = await fetchSeniorsPurseStatement(session, year, csrfToken);

  if (!entries.length) {
    return json({ added: 0, skipped: 0, message: 'No entries found in statement.' });
  }

  let added = 0;
  let skipped = 0;

  for (const entry of entries) {
    // Check if already stored
    const existing = await db.prepare(
      'SELECT id FROM seniors_purse_entries WHERE sale_id = ?'
    ).bind(entry.saleId).first();

    if (existing) {
      skipped++;
      continue;
    }

    // Fetch the till receipt
    let receiptText: string | null = null;
    let receiptItems: string | null = null;

    try {
      const receipt = await fetchSaleReceipt(session, entry.saleId);
      receiptText = receipt.rawText;
      receiptItems = JSON.stringify(receipt.lineItems);
    } catch {
      // Receipt fetch is best-effort — store the statement entry without it
    }

    await db.prepare(`
      INSERT INTO seniors_purse_entries
        (sale_id, sale_date, balance_adj, running_balance, year, receipt_text, receipt_items)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.saleId,
      entry.saleDate,
      entry.balanceAdj,
      entry.runningBalance,
      year,
      receiptText,
      receiptItems,
    ).run();

    added++;
  }

  return json({ added, skipped });
}

/**
 * Debug: return raw form fields and raw report HTML snippet so we can see
 * what TouchOffice actually sends back.
 */
async function handleDebug(db: any, env: any, body: any) {
  const year = parseInt(body.year) || new Date().getFullYear();
  const { session, csrfToken } = await ensureSession(db, env);
  const result = await debugFetchPurseReport(session, year, csrfToken);
  return json({ ...result, sessionCsrfToken: csrfToken });
}

/**
 * Return stored purse entries for the given year, ordered by date ascending.
 */
async function handleList(db: any, body: any) {
  const year = parseInt(body.year) || new Date().getFullYear();

  const result = await db.prepare(`
    SELECT id, sale_id, sale_date, balance_adj, running_balance, year,
           receipt_text, receipt_items, fetched_at
    FROM seniors_purse_entries
    WHERE year = ?
    ORDER BY sale_date ASC
  `).bind(year).all();

  const rows = result.results || [];

  // Also return the current balance (last running_balance) and totals
  const totalCredits = rows
    .filter((r: any) => r.balance_adj > 0)
    .reduce((sum: number, r: any) => sum + r.balance_adj, 0);
  const totalDebits = rows
    .filter((r: any) => r.balance_adj < 0)
    .reduce((sum: number, r: any) => sum + r.balance_adj, 0);
  const currentBalance = rows.length > 0 ? rows[rows.length - 1].running_balance : null;
  const lastFetched = rows.length > 0
    ? rows.reduce((latest: string, r: any) => r.fetched_at > latest ? r.fetched_at : latest, '')
    : null;

  return json({
    entries: rows,
    summary: { totalCredits, totalDebits, currentBalance, lastFetched, count: rows.length },
  });
}
