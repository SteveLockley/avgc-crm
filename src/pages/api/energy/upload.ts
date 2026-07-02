import type { APIRoute } from 'astro'
import { importSmartMeterCsv, importBillsCsv, importKitchenLoggerCsv } from '../../../lib/energy/parsers'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB
  if (!db) return json({ error: 'DB not configured' }, 500)

  const form = await request.formData()
  const file = form.get('file') as File | null
  const type = form.get('type') as string | null

  if (!file || !type) return json({ error: 'file and type are required' }, 400)

  const text = await file.text()

  try {
    if (type === 'smart-meter') return json({ ok: true, ...await importSmartMeterCsv(db, text) })
    if (type === 'bills')       return json({ ok: true, ...await importBillsCsv(db, text) })
    if (type === 'kitchen-logger') {
      const meterName = (form.get('meterName') as string | null)?.trim() || 'kitchen'
      return json({ ok: true, ...await importKitchenLoggerCsv(db, text, meterName) })
    }
    return json({ error: 'unknown type' }, 400)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
}
