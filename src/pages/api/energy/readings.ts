import type { APIRoute } from 'astro'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB
  if (!db) return json({ error: 'DB not configured' }, 500)

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') ?? 'daily'
  const mpan = searchParams.get('mpan')
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  if (type === 'load-profile') {
    const r = await db.prepare(`
      SELECT interval_time,
        ROUND(AVG(kwh), 4) AS avg_kwh,
        ROUND(MIN(kwh), 4) AS min_kwh,
        ROUND(MAX(kwh), 4) AS max_kwh
      FROM energy_smart_readings
      WHERE mpan = ?
        AND (? IS NULL OR reading_date >= ?)
        AND (? IS NULL OR reading_date <= ?)
      GROUP BY interval_time ORDER BY interval_time
    `).bind(mpan, from, from, to, to).all()
    return json(r.results)
  }

  if (type === 'daily') {
    const r = await db.prepare(`
      SELECT reading_date, mpan, ROUND(SUM(kwh), 3) AS total_kwh
      FROM energy_smart_readings
      WHERE (? IS NULL OR mpan = ?)
        AND (? IS NULL OR reading_date >= ?)
        AND (? IS NULL OR reading_date <= ?)
      GROUP BY reading_date, mpan ORDER BY reading_date
    `).bind(mpan, mpan, from, from, to, to).all()
    return json(r.results)
  }

  if (type === 'heatmap') {
    const r = await db.prepare(`
      SELECT interval_time,
        CAST(strftime('%w', reading_date) AS INTEGER) AS weekday,
        ROUND(AVG(kwh), 4) AS avg_kwh
      FROM energy_smart_readings WHERE mpan = ?
      GROUP BY interval_time, weekday
    `).bind(mpan).all()
    return json(r.results)
  }

  if (type === 'bills-monthly') {
    const r = await db.prepare(`
      SELECT mpan, strftime('%Y-%m', invoice_date) AS month,
        ROUND(SUM(advance_units_kwh), 1) AS kwh,
        ROUND(SUM(invoice_amount), 2) AS cost
      FROM energy_bill_lines
      WHERE (? IS NULL OR mpan = ?)
      GROUP BY mpan, month ORDER BY month, mpan
    `).bind(mpan, mpan).all()
    return json(r.results)
  }

  if (type === 'bills-summary') {
    const r = await db.prepare(`
      SELECT m.name, b.mpan,
        COUNT(DISTINCT b.invoice_number) AS invoices,
        ROUND(SUM(b.advance_units_kwh), 1) AS total_kwh,
        ROUND(SUM(b.invoice_amount), 2) AS invoice_amount,
        MIN(b.invoice_date) AS from_date, MAX(b.invoice_date) AS to_date
      FROM energy_bill_lines b
      LEFT JOIN energy_meters m ON m.mpan = b.mpan
      GROUP BY b.mpan ORDER BY b.mpan
    `).all()
    return json(r.results)
  }

  return json({ error: 'unknown type' }, 400)
}
