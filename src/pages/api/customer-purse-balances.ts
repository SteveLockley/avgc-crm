import type { APIRoute } from 'astro';
import {
  ensureSession,
  fetchCustomerBalanceReport,
  debugFetchCustomerBalance,
  CUSTOMER_GROUPS,
} from '../../lib/touchoffice';

const SENIORS_CUSTOMER_NUMBER = 1035;

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
      case 'sync':        return await handleSync(db, env);
      case 'list':        return await handleList(db);
      case 'save-match':  return await handleSaveMatch(db, body);
      case 'debug':       return await handleDebug(db, env, body);
      default:            return json({ error: 'Unknown action' }, 400);
    }
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500);
  }
};

/**
 * Fetch all 4 customer groups from TouchOffice, upsert into DB.
 * - Preserves manually-set member_id (auto_matched = 0).
 * - Auto-matches unmatched rows by first+last name against members (non-junior).
 * - Returns counts per group plus total seniors purse balance cross-check.
 */
async function handleSync(db: any, env: any) {
  const { session } = await ensureSession(db, env);

  // ── Load reference data up front (2 D1 subrequests total) ──────────────────

  // All existing cards — so we know what to INSERT vs UPDATE
  const existingResult = await db.prepare(
    `SELECT customer_number, auto_matched, member_id FROM customer_purse_balances`
  ).all<{ customer_number: number; auto_matched: number; member_id: number | null }>();
  const existingMap = new Map<number, { auto_matched: number; member_id: number | null }>();
  for (const row of (existingResult.results || [])) {
    existingMap.set(row.customer_number, { auto_matched: row.auto_matched, member_id: row.member_id });
  }

  // All non-junior members for auto-matching — keyed by "lower(first) lower(last)"
  // Build a map: key → [id, ...] so we can detect ambiguous matches
  const membersResult = await db.prepare(
    `SELECT id, first_name, surname FROM members WHERE category NOT LIKE '%Junior%'`
  ).all<{ id: number; first_name: string; surname: string }>();
  const membersByName = new Map<string, number[]>();
  for (const m of (membersResult.results || [])) {
    const key = `${m.first_name.toLowerCase()}|${m.surname.toLowerCase()}`;
    const arr = membersByName.get(key) ?? [];
    arr.push(m.id);
    membersByName.set(key, arr);
  }

  function autoMatch(firstName: string, lastName: string, custNum: number): { memberId: number | null; autoMatched: number } {
    if (custNum === SENIORS_CUSTOMER_NUMBER) return { memberId: null, autoMatched: 0 };
    const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
    const ids = membersByName.get(key);
    if (ids?.length === 1) return { memberId: ids[0], autoMatched: 1 };
    return { memberId: null, autoMatched: 0 };
  }

  // ── Fetch all groups from TouchOffice (4 subrequests) ──────────────────────

  const allEntries: Array<{ entry: any; group: string }> = [];
  const groupResults: Record<string, { added: number; updated: number }> = {};

  for (const group of CUSTOMER_GROUPS) {
    let entries;
    try {
      entries = await fetchCustomerBalanceReport(session, group.id);
    } catch (e: any) {
      return json({ error: `Failed fetching group ${group.name}: ${e.message}` }, 500);
    }
    for (const entry of entries) allEntries.push({ entry, group: group.name });
    groupResults[group.name] = { added: 0, updated: 0 };
  }

  // ── Build batched D1 statements ───────────────────────────────────────────
  // D1 batch() counts as ONE subrequest regardless of how many statements it contains.

  const statements: any[] = [];
  let totalAdded = 0;
  let totalUpdated = 0;
  let autoMatchCount = 0;

  for (const { entry, group } of allEntries) {
    const existing = existingMap.get(entry.customerNumber);

    if (existing) {
      statements.push(db.prepare(`
        UPDATE customer_purse_balances SET
          first_name      = ?,
          last_name       = ?,
          account_number  = ?,
          account_balance = ?,
          customer_group  = ?,
          fetched_at      = datetime('now'),
          updated_at      = datetime('now')
        WHERE customer_number = ?
      `).bind(
        entry.firstName, entry.lastName, entry.accountNumber,
        entry.accountBalance, group, entry.customerNumber
      ));
      groupResults[group].updated++;
      totalUpdated++;
    } else {
      // New row: try name-based auto-match (pure JS, no extra subrequests)
      const { memberId, autoMatched } = autoMatch(entry.firstName, entry.lastName, entry.customerNumber);
      if (autoMatched) autoMatchCount++;

      statements.push(db.prepare(`
        INSERT INTO customer_purse_balances
          (customer_number, first_name, last_name, account_number,
           account_balance, customer_group,
           member_id, auto_matched, fetched_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        entry.customerNumber, entry.firstName, entry.lastName, entry.accountNumber,
        entry.accountBalance, group, memberId, autoMatched
      ));
      groupResults[group].added++;
      totalAdded++;
    }
  }

  // Also re-match any previously-unmatched rows (no manual override) that we now have a name for
  for (const [custNum, existing] of existingMap) {
    if (existing.member_id !== null || existing.auto_matched !== 0) continue;
    if (custNum === SENIORS_CUSTOMER_NUMBER) continue;
    // We don't have the name in existingMap — skip; they'll be re-matched if they appear in allEntries
  }

  // Execute all writes in one batch (1 subrequest)
  if (statements.length > 0) {
    // D1 batch has a 100-statement limit per call; chunk if needed
    const CHUNK = 100;
    for (let i = 0; i < statements.length; i += CHUNK) {
      await db.batch(statements.slice(i, i + CHUNK));
    }
  }

  // Seniors purse cross-check
  const seniorsPurseRow = await db.prepare(`
    SELECT running_balance FROM seniors_purse_entries
    WHERE year = CAST(strftime('%Y', 'now') AS INTEGER)
    ORDER BY sale_date DESC, id DESC LIMIT 1
  `).first<{ running_balance: number }>();

  const seniorsCardRow = await db.prepare(`
    SELECT account_balance FROM customer_purse_balances WHERE customer_number = ?
  `).bind(SENIORS_CUSTOMER_NUMBER).first<{ account_balance: number }>();

  const seniorsPurseBalance   = seniorsPurseRow?.running_balance ?? null;
  const seniorsCardBalance    = seniorsCardRow?.account_balance  ?? null;
  const seniorsMismatch = seniorsPurseBalance !== null && seniorsCardBalance !== null
    && Math.abs(seniorsPurseBalance - seniorsCardBalance) > 0.01;

  return json({
    ok: true,
    totalAdded,
    totalUpdated,
    autoMatched: autoMatchCount,
    groupResults,
    seniorsPurseBalance,
    seniorsCardBalance,
    seniorsMismatch,
  });
}

/**
 * Return all stored rows joined to member name.
 * Also returns seniors purse balance for cross-check.
 */
async function handleList(db: any) {
  const result = await db.prepare(`
    SELECT
      cpb.*,
      m.first_name || ' ' || m.surname AS member_name
    FROM customer_purse_balances cpb
    LEFT JOIN members m ON m.id = cpb.member_id
    ORDER BY cpb.last_name, cpb.first_name, cpb.customer_number
  `).all().catch(() => ({ results: [] }));

  const seniorsPurseRow = await db.prepare(`
    SELECT running_balance FROM seniors_purse_entries
    WHERE year = CAST(strftime('%Y', 'now') AS INTEGER)
    ORDER BY sale_date DESC, id DESC LIMIT 1
  `).first<{ running_balance: number }>().catch(() => null);

  return json({
    rows: result.results || [],
    seniorsPurseBalance: seniorsPurseRow?.running_balance ?? null,
  });
}

/**
 * Save a member_id match for a customer card.
 * Passing member_id = null clears the match (marks as manually unmatched).
 */
async function handleSaveMatch(db: any, body: any) {
  const { customerNumber, memberId } = body;
  if (!customerNumber) return json({ error: 'customerNumber required' }, 400);

  await db.prepare(`
    UPDATE customer_purse_balances
    SET member_id = ?, auto_matched = 0, updated_at = datetime('now')
    WHERE customer_number = ?
  `).bind(memberId ?? null, customerNumber).run();

  let memberName: string | null = null;
  if (memberId) {
    const m = await db.prepare(`SELECT first_name || ' ' || surname AS name FROM members WHERE id = ?`)
      .bind(memberId).first<{ name: string }>();
    memberName = m?.name ?? null;
  }

  return json({ ok: true, memberName });
}

/**
 * Debug: return raw div sample for one customer group.
 */
async function handleDebug(db: any, env: any, body: any) {
  const groupId = String(body.groupId || '1');
  const { session } = await ensureSession(db, env);
  const result = await debugFetchCustomerBalance(session, groupId);
  return json(result);
}
