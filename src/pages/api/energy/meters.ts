import type { APIRoute } from 'astro'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB
  if (!db) return json({ error: 'DB not configured' }, 500)
  const meters = await db.prepare('SELECT * FROM energy_meters ORDER BY name').all()
  return json(meters.results)
}

export const PATCH: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB
  if (!db) return json({ error: 'DB not configured' }, 500)
  const { id, name, location } = await request.json()
  if (!id || !name) return json({ error: 'id and name required' }, 400)
  await db.prepare('UPDATE energy_meters SET name = ?, location = ? WHERE id = ?').bind(name, location ?? '', id).run()
  return json({ ok: true })
}
