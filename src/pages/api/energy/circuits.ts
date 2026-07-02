import type { APIRoute } from 'astro'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export const PATCH: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB
  if (!db) return json({ error: 'DB not configured' }, 500)

  const body = await request.json() as { id: number; label: string }
  if (!body.id || !body.label?.trim()) return json({ error: 'id and label are required' }, 400)

  await db.prepare(
    `UPDATE energy_logger_circuits SET label = ? WHERE id = ?`
  ).bind(body.label.trim(), body.id).run()

  return json({ ok: true })
}
