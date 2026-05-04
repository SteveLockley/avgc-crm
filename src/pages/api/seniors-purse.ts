import type { APIRoute } from 'astro';
import { ensureSession, fetchSeniorsPurseStatement, fetchSaleReceipt, debugFetchPurseReport } from '../../lib/touchoffice';
import { fetchMyGolfPage } from '../../lib/masterscoreboard';

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
      case 'force-sync':
        return await handleForceSync(db, env, body);
      case 'list':
        return await handleList(db, body);
      case 'senior-members':
        return await handleSeniorMembers(db);
      case 'save-details':
        return await handleSaveDetails(db, body);
      case 'add-entry':
        return await handleAddEntry(db, body);
      case 'delete-entry':
        return await handleDeleteEntry(db, body);
      case 'split-entry':
        return await handleSplitEntry(db, body);
      case 'debug':
        return await handleDebug(db, env, body);
      case 'probe-mygolf':
        return await handleProbeMygolf(env, body);
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
 * Force-resync: fetch the full-year statement and insert any entries not already stored.
 * Same dedup logic as normal sync, but always recalculates running balances afterwards
 * so manual entries and any newly inserted rows are correctly sequenced.
 */
async function handleForceSync(db: any, env: any, body: any) {
  const year = parseInt(body.year) || new Date().getFullYear();

  const { session, csrfToken } = await ensureSession(db, env);
  const entries = await fetchSeniorsPurseStatement(session, year, csrfToken);

  if (!entries.length) {
    return json({ added: 0, skipped: 0, message: 'No entries found in statement.' });
  }

  let added = 0;
  let updated = 0;

  for (const entry of entries) {
    const existing = await db.prepare(
      'SELECT id, sale_date, balance_adj, locked FROM seniors_purse_entries WHERE sale_id = ?'
    ).bind(entry.saleId).first();

    if (existing) {
      // Skip update if the entry has been manually locked (e.g. split into sub-entries)
      if (!existing.locked) {
        // Update financial fields if they differ — preserves member attribution
        const dateMatch = String(existing.sale_date).startsWith(entry.saleDate.split(' ')[0].replace(/-/g, '-'));
        const adjMatch  = Math.abs(Number(existing.balance_adj) - entry.balanceAdj) < 0.01;
        if (!dateMatch || !adjMatch) {
          await db.prepare(
            'UPDATE seniors_purse_entries SET sale_date = ?, balance_adj = ? WHERE id = ?'
          ).bind(entry.saleDate, entry.balanceAdj, existing.id).run();
          updated++;
        }
      }
      continue;
    }

    let receiptText: string | null = null;
    let receiptItems: string | null = null;
    try {
      const receipt = await fetchSaleReceipt(session, entry.saleId);
      receiptText = receipt.rawText;
      receiptItems = JSON.stringify(receipt.lineItems);
    } catch { /* best-effort */ }

    await db.prepare(`
      INSERT INTO seniors_purse_entries
        (sale_id, sale_date, balance_adj, running_balance, year, receipt_text, receipt_items)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.saleId, entry.saleDate, entry.balanceAdj, entry.runningBalance,
      year, receiptText, receiptItems,
    ).run();
    added++;
  }

  await recalcRunningBalances(db, year);
  return json({ added, updated, total: entries.length });
}

/**
 * Probe the MSB MyGolf page for a given PlayerID (or without one).
 * Returns the raw HTML so we can see whether the purse balance is present.
 */
async function handleProbeMygolf(env: any, body: any) {
  const playerId = body.playerId ? parseInt(body.playerId) : undefined;
  const result = await fetchMyGolfPage(env, playerId);
  // Extract just the purse-related snippet to keep response small
  const purseMatch = result.html.match(/(?:purse|Purse|Competition)[^<]{0,200}/gi) ?? [];
  return json({
    url: result.url,
    status: result.status,
    purseSnippets: purseMatch.slice(0, 10),
    htmlLength: result.html.length,
    htmlPreview: result.html.slice(0, 2000),
  });
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
 * Joins to members to include the payment member's name.
 */
async function handleList(db: any, body: any) {
  const year = parseInt(body.year) || new Date().getFullYear();

  const result = await db.prepare(`
    SELECT spe.id, spe.sale_id, spe.sale_date, spe.balance_adj, spe.running_balance, spe.year,
           spe.receipt_text, spe.receipt_items, spe.fetched_at, spe.is_manual,
           spe.payment_member_id, spe.payment_description,
           m.first_name || ' ' || m.surname AS payment_member_name
    FROM seniors_purse_entries spe
    LEFT JOIN members m ON m.id = spe.payment_member_id
    WHERE spe.year = ?
    ORDER BY spe.sale_date ASC, spe.id ASC
  `).bind(year).all();

  const rows = result.results || [];

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

/**
 * Return male members aged 55 or over, for the payment attribution dropdown.
 */
async function handleSeniorMembers(db: any) {
  const result = await db.prepare(`
    SELECT id, first_name, surname
    FROM members
    WHERE gender = 'M'
      AND (
        (date_of_birth IS NOT NULL AND CAST(strftime('%Y', 'now') AS INTEGER) - CAST(strftime('%Y', date_of_birth) AS INTEGER) >= 55)
        OR category LIKE '%Senior%'
      )
    ORDER BY surname, first_name
  `).all();

  return json({ members: result.results || [] });
}

/**
 * Add a manual debit (or credit) entry not sourced from TouchOffice.
 * Recalculates running balances for the year after insertion.
 */
async function handleAddEntry(db: any, body: any) {
  const { year, date, amount, description, entryType } = body;
  if (!date || !amount) return json({ error: 'date and amount are required' }, 400);

  const y = parseInt(year) || new Date().getFullYear();
  const balanceAdj = entryType === 'debit' ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
  const saleId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const saleDate = String(date) + ' 00:00:00';

  await db.prepare(`
    INSERT INTO seniors_purse_entries
      (sale_id, sale_date, balance_adj, running_balance, year, is_manual, payment_description)
    VALUES (?, ?, ?, 0, ?, 1, ?)
  `).bind(saleId, saleDate, balanceAdj, y, description || null).run();

  await recalcRunningBalances(db, y);
  return json({ ok: true });
}

/**
 * Delete a manual entry and recalculate running balances.
 * Synced entries (is_manual = 0) cannot be deleted.
 */
async function handleDeleteEntry(db: any, body: any) {
  const { id, year } = body;
  if (!id) return json({ error: 'Missing id' }, 400);

  const entry = await db.prepare(
    'SELECT is_manual FROM seniors_purse_entries WHERE id = ?'
  ).bind(id).first();
  if (!entry) return json({ error: 'Entry not found' }, 404);
  if (!entry.is_manual) return json({ error: 'Cannot delete synced entries' }, 403);

  await db.prepare('DELETE FROM seniors_purse_entries WHERE id = ?').bind(id).run();

  if (year) await recalcRunningBalances(db, parseInt(year));
  return json({ ok: true });
}

/**
 * Split a single synced entry into multiple sub-entries.
 * The original entry is updated to the first split amount and locked (so force-sync
 * won't overwrite it).  Subsequent split pieces are inserted as is_manual=1 entries
 * linked back to the original via split_from_id.
 *
 * body: { id, year, splits: [{ amount, memberId?, description? }, ...] }
 * The splits must sum to the original balance_adj.
 */
async function handleSplitEntry(db: any, body: any) {
  const { id, year, splits } = body;
  if (!id || !Array.isArray(splits) || splits.length < 2) {
    return json({ error: 'id and at least 2 splits are required' }, 400);
  }

  const entry = await db.prepare(
    'SELECT id, sale_date, balance_adj, year FROM seniors_purse_entries WHERE id = ?'
  ).bind(id).first();

  if (!entry) return json({ error: 'Entry not found' }, 404);

  const originalAdj = Number(entry.balance_adj);
  const splitTotal  = splits.reduce((s: number, x: any) => s + Number(x.amount), 0);

  if (Math.abs(splitTotal - originalAdj) > 0.01) {
    return json({ error: `Split amounts (${splitTotal.toFixed(2)}) must equal original amount (${originalAdj.toFixed(2)})` }, 400);
  }

  const y = parseInt(year) || parseInt(entry.year) || new Date().getFullYear();
  const saleDate = String(entry.sale_date);

  // Update original entry to first split — lock it so force-sync won't reset the amount
  const first = splits[0];
  const stmts: any[] = [
    db.prepare(
      `UPDATE seniors_purse_entries
       SET balance_adj = ?, payment_member_id = ?, payment_description = ?, locked = 1
       WHERE id = ?`
    ).bind(
      Number(first.amount),
      first.memberId ? Number(first.memberId) : null,
      first.description || null,
      id
    ),
  ];

  // Insert remaining splits as manual entries linked to the original
  for (let i = 1; i < splits.length; i++) {
    const s = splits[i];
    const splitSaleId = `split-${id}-${i}`;

    // Check if this split entry already exists (idempotent re-split)
    const exists = await db.prepare(
      'SELECT id FROM seniors_purse_entries WHERE sale_id = ?'
    ).bind(splitSaleId).first();

    if (!exists) {
      stmts.push(
        db.prepare(
          `INSERT INTO seniors_purse_entries
             (sale_id, sale_date, balance_adj, running_balance, year,
              is_manual, split_from_id, payment_member_id, payment_description)
           VALUES (?, ?, ?, 0, ?, 1, ?, ?, ?)`
        ).bind(
          splitSaleId,
          saleDate,
          Number(s.amount),
          y,
          id,
          s.memberId ? Number(s.memberId) : null,
          s.description || null,
        )
      );
    } else {
      stmts.push(
        db.prepare(
          `UPDATE seniors_purse_entries
           SET balance_adj = ?, payment_member_id = ?, payment_description = ?
           WHERE sale_id = ?`
        ).bind(
          Number(s.amount),
          s.memberId ? Number(s.memberId) : null,
          s.description || null,
          splitSaleId,
        )
      );
    }
  }

  await db.batch(stmts);
  await recalcRunningBalances(db, y);

  return json({ ok: true });
}

/**
 * Recalculate running_balance for all entries in a year in chronological order.
 * Uses the first synced entry as the anchor to establish the opening balance,
 * then recomputes forward for all entries (manual and synced).
 */
async function recalcRunningBalances(db: any, year: number): Promise<void> {
  const result = await db.prepare(`
    SELECT id, balance_adj, running_balance, is_manual
    FROM seniors_purse_entries
    WHERE year = ?
    ORDER BY sale_date ASC, id ASC
  `).bind(year).all();

  const entries = (result.results || []) as any[];
  if (!entries.length) return;

  // Anchor: opening balance = first synced entry's running_balance minus its own adj
  const firstSynced = entries.find((e: any) => !e.is_manual);
  let running: number = firstSynced
    ? Number(firstSynced.running_balance) - Number(firstSynced.balance_adj)
    : 0;

  await db.batch(
    entries.map((e: any) => {
      running += Number(e.balance_adj);
      return db.prepare('UPDATE seniors_purse_entries SET running_balance = ? WHERE id = ?')
        .bind(running, e.id);
    })
  );
}

/**
 * Save payment details (member attribution or description) for a purse entry.
 * For credits attributed to a member, also creates/updates a payments record
 * so it appears in the member's payment history.
 */
async function handleSaveDetails(db: any, body: any) {
  const { id, payment_member_id, payment_description } = body;

  if (!id) return json({ error: 'Missing entry id' }, 400);

  // Fetch the entry to get amount, date, sale_id, and any existing payment_id
  const entry = await db.prepare(
    `SELECT balance_adj, sale_date, sale_id, payment_id
     FROM seniors_purse_entries WHERE id = ?`
  ).bind(id).first();

  if (!entry) return json({ error: 'Entry not found' }, 404);

  const paymentDate = String(entry.sale_date).split(' ')[0];
  const reference = `Seniors' Purse — TouchOffice ${entry.sale_id}`;
  const notes = payment_description || "Seniors' Competition Purse payment";
  const existingPaymentId: number | null = entry.payment_id ?? null;
  const isCredit = Number(entry.balance_adj) > 0;

  if (isCredit && payment_member_id) {
    if (existingPaymentId) {
      // Update existing payment + update entry attribution — both in one batch
      await db.batch([
        db.prepare(`UPDATE payments SET member_id = ?, amount = ?, payment_date = ?, reference = ?, notes = ? WHERE id = ?`)
          .bind(payment_member_id, entry.balance_adj, paymentDate, reference, notes, existingPaymentId),
        db.prepare(`UPDATE seniors_purse_entries SET payment_member_id = ?, payment_description = ?, payment_id = ? WHERE id = ?`)
          .bind(payment_member_id ?? null, payment_description ?? null, existingPaymentId, id),
      ]);
    } else {
      // Batch shares the SQLite connection context, so last_insert_rowid() refers to the INSERT above
      await db.batch([
        db.prepare(`INSERT INTO payments (member_id, amount, payment_date, payment_method, payment_type, reference, notes, recorded_by)
          VALUES (?, ?, ?, 'Cash', 'competition_fee', ?, ?, 'seniors-purse')`)
          .bind(payment_member_id, entry.balance_adj, paymentDate, reference, notes),
        db.prepare(`UPDATE seniors_purse_entries SET payment_member_id = ?, payment_description = ?, payment_id = last_insert_rowid() WHERE id = ?`)
          .bind(payment_member_id ?? null, payment_description ?? null, id),
      ]);
    }
  } else if (existingPaymentId) {
    // Member attribution removed — delete the payment and clear the link atomically
    await db.batch([
      db.prepare(`DELETE FROM payments WHERE id = ?`).bind(existingPaymentId),
      db.prepare(`UPDATE seniors_purse_entries SET payment_member_id = ?, payment_description = ?, payment_id = NULL WHERE id = ?`)
        .bind(payment_member_id ?? null, payment_description ?? null, id),
    ]);
  } else {
    // No payment record involved — just update the attribution
    await db.prepare(`UPDATE seniors_purse_entries SET payment_member_id = ?, payment_description = ? WHERE id = ?`)
      .bind(payment_member_id ?? null, payment_description ?? null, id).run();
  }

  return json({ ok: true });
}
