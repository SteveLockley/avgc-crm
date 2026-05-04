import type { APIRoute } from 'astro';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Parse Excel-style CSV field: ="value" → value
function parseExcelField(raw: string): string {
  const unquoted = raw.replace(/^"|"$/g, '').replace(/""/g, '"');
  const m = unquoted.match(/^="(.*)"$/);
  return m ? m[1] : unquoted;
}

function parseHcp(s: string): number {
  const t = s.trim();
  if (t.startsWith('+')) return -parseFloat(t.slice(1));
  return parseFloat(t);
}

function parseRange(rangeText: string): { lo: number; hi: number } {
  const parts = rangeText.split(' to ');
  const a = parseHcp(parts[0]);
  const b = parseHcp(parts[1]);
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

interface ChartRow {
  row_order: number;
  handicap_range: string;
  course_handicap: string;
  index_min: number;
  index_max: number;
}

function parseCsv(text: string): ChartRow[] {
  const rows: ChartRow[] = [];
  let rowOrder = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('"Handicap')) continue;
    const match = trimmed.match(/^("(?:[^"]|"")*"),("(?:[^"]|"")*")$/);
    if (!match) continue;
    const rangeText = parseExcelField(match[1]);
    const chText = parseExcelField(match[2]);
    if (!rangeText || !chText) continue;
    const { lo, hi } = parseRange(rangeText);
    if (isNaN(lo) || isNaN(hi)) continue;
    rows.push({
      row_order: rowOrder++,
      handicap_range: rangeText,
      course_handicap: chText,
      index_min: lo,
      index_max: hi,
    });
  }
  return rows;
}

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime?.env?.DB;
  if (!db) return json({ error: 'Database unavailable' }, 503);

  const markers = await db
    .prepare('SELECT * FROM handicap_markers ORDER BY display_order')
    .all();

  const entries = await db
    .prepare('SELECT * FROM handicap_chart_entries ORDER BY marker_id, row_order')
    .all();

  return json({ markers: markers.results, entries: entries.results });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime?.env?.DB;
  if (!db) return json({ error: 'Database unavailable' }, 503);

  // Require admin session
  if (!locals.user) return json({ error: 'Unauthorised' }, 401);

  const formData = await request.formData();
  const action = formData.get('action')?.toString();

  if (action === 'upload-csv') {
    const markerId = parseInt(formData.get('marker_id')?.toString() || '0');
    const file = formData.get('csv_file') as File | null;

    if (!markerId || !file) return json({ error: 'marker_id and csv_file required' }, 400);

    const marker = await db
      .prepare('SELECT id FROM handicap_markers WHERE id = ?')
      .bind(markerId)
      .first();
    if (!marker) return json({ error: 'Marker not found' }, 404);

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) return json({ error: 'No valid rows found in CSV' }, 400);

    await db.prepare('DELETE FROM handicap_chart_entries WHERE marker_id = ?').bind(markerId).run();

    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const stmts = chunk.map(r =>
        db
          .prepare(
            'INSERT INTO handicap_chart_entries (marker_id, row_order, handicap_range, course_handicap, index_min, index_max) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .bind(markerId, r.row_order, r.handicap_range, r.course_handicap, r.index_min, r.index_max)
      );
      await db.batch(stmts);
    }

    await db
      .prepare("UPDATE handicap_markers SET updated_at = datetime('now') WHERE id = ?")
      .bind(markerId)
      .run();

    return json({ ok: true, rows: rows.length });
  }

  if (action === 'update-marker') {
    const markerId = parseInt(formData.get('marker_id')?.toString() || '0');
    const color = formData.get('color')?.toString();
    const textColor = formData.get('text_color')?.toString();
    if (!markerId) return json({ error: 'marker_id required' }, 400);
    await db
      .prepare(
        "UPDATE handicap_markers SET color = COALESCE(?, color), text_color = COALESCE(?, text_color), updated_at = datetime('now') WHERE id = ?"
      )
      .bind(color || null, textColor || null, markerId)
      .run();
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
};
