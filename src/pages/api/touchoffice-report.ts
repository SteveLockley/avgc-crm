import type { APIRoute } from 'astro';
import { fetchWeeklyReport, getCompleteWeeks } from '../../lib/touchoffice';

/**
 * Actions:
 *   { action: "status", year } - Returns stored weeks + missing week numbers
 *   { action: "fetch", year, weekNumber, start, end } - Fetches ONE week and stores it
 */
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any).runtime?.env;
    const db = env?.DB;

    if (!db) {
      return json({ error: 'Database not available.' }, 500);
    }

    const body = await request.json();
    const action = body.action || 'status';
    const year = body.year || new Date().getFullYear();

    if (action === 'status') {
      const allWeeks = getCompleteWeeks(year);

      const existingRows = await db.prepare(
        'SELECT DISTINCT week_number FROM weekly_sales WHERE year = ?'
      ).bind(year).all();

      const existingSet = new Set(
        (existingRows.results || []).map((r: any) => r.week_number)
      );

      const missingWeeks = allWeeks
        .filter(w => !existingSet.has(w.weekNumber))
        .map(w => ({ weekNumber: w.weekNumber, start: w.start, end: w.end }));

      const allData = await db.prepare(
        `SELECT week_number, week_start, week_end, department, quantity, value
         FROM weekly_sales WHERE year = ? ORDER BY week_number, department`
      ).bind(year).all();

      const totalsData = await db.prepare(
        `SELECT week_number, category, name, quantity, value
         FROM weekly_totals WHERE year = ? ORDER BY week_number, name`
      ).bind(year).all();

      const weeks = groupWeeks(allData.results || [], totalsData.results || []);

      return json({ year, weeks, missingWeeks, totalPossible: allWeeks.length });
    }

    if (action === 'fetch') {
      const { weekNumber, start, end } = body;
      if (!weekNumber || !start || !end) {
        return json({ error: 'weekNumber, start, and end are required' }, 400);
      }

      const existing = await db.prepare(
        'SELECT COUNT(*) as cnt FROM weekly_sales WHERE year = ? AND week_number = ?'
      ).bind(year, weekNumber).first() as any;

      if (existing?.cnt > 0) {
        return json({ weekNumber, status: 'already_stored' });
      }

      // Read session from D1 (saved by /api/touchoffice-login)
      const sessionRow = await db.prepare(
        "SELECT value FROM app_settings WHERE key = 'touchoffice_session'"
      ).first() as any;
      const session = sessionRow?.value;
      if (!session) {
        return json({ error: 'No TouchOffice session available.' }, 500);
      }

      const report = await fetchWeeklyReport(session, start, end);

      for (const dept of report.departments) {
        await db.prepare(
          `INSERT OR IGNORE INTO weekly_sales
           (year, week_number, week_start, week_end, department, department_id, quantity, value, percentage)
           VALUES (?, ?, ?, ?, ?, '', ?, ?, 0)`
        ).bind(year, weekNumber, start, end, dept.name, dept.quantity, dept.value).run();
      }

      for (const ft of report.fixedTotals) {
        await db.prepare(
          `INSERT OR IGNORE INTO weekly_totals
           (year, week_number, week_start, week_end, category, name, quantity, value)
           VALUES (?, ?, ?, ?, 'fixed', ?, ?, ?)`
        ).bind(year, weekNumber, start, end, ft.name, ft.quantity, ft.value).run();
      }

      for (const tk of report.transactionKeys) {
        await db.prepare(
          `INSERT OR IGNORE INTO weekly_totals
           (year, week_number, week_start, week_end, category, name, quantity, value)
           VALUES (?, ?, ?, ?, 'transaction', ?, ?, ?)`
        ).bind(year, weekNumber, start, end, tk.name, tk.quantity, tk.value).run();
      }

      return json({
        weekNumber,
        status: 'fetched',
        total: report.total,
        departments: report.departments.length,
        fixedTotals: report.fixedTotals.length,
        transactionKeys: report.transactionKeys.length,
      });
    }

    return json({ error: 'Unknown action. Use "status" or "fetch".' }, 400);

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function groupWeeks(salesRows: any[], totalsRows: any[]) {
  const weekMap = new Map<number, any>();

  for (const row of salesRows) {
    if (!weekMap.has(row.week_number)) {
      weekMap.set(row.week_number, {
        weekNumber: row.week_number,
        weekStart: row.week_start,
        weekEnd: row.week_end,
        departments: [],
        fixedTotals: [],
        transactionKeys: [],
        total: 0,
      });
    }
    const w = weekMap.get(row.week_number)!;
    w.departments.push({
      name: row.department,
      quantity: row.quantity,
      value: row.value,
    });
    w.total += row.value;
  }

  for (const row of totalsRows) {
    const w = weekMap.get(row.week_number);
    if (!w) continue;
    if (row.category === 'fixed') {
      w.fixedTotals.push({ name: row.name, quantity: row.quantity, value: row.value });
    } else if (row.category === 'transaction') {
      w.transactionKeys.push({ name: row.name, quantity: row.quantity, value: row.value });
    }
  }

  return [...weekMap.values()].sort((a, b) => a.weekNumber - b.weekNumber);
}
