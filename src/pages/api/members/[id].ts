import type { APIContext } from 'astro';

export async function DELETE({ params, locals }: APIContext) {
  const db = locals.runtime.env.DB;
  const memberId = params.id;

  if (!memberId) {
    return new Response(JSON.stringify({ error: 'Member ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get member info for audit log
    const member = await db.prepare(
      'SELECT id, first_name, surname, email, deleted_at FROM members WHERE id = ?'
    ).bind(memberId).first();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (member.deleted_at) {
      return new Response(JSON.stringify({ error: 'Member is already deleted' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Soft-delete: keep the row so invoices, payments, and other accounting
    // records that reference this member stay intact and displayable.
    await db.prepare(
      `UPDATE members SET deleted_at = datetime('now') WHERE id = ?`
    ).bind(memberId).run();

    // Log the deletion
    const userEmail = locals.user?.email || 'unknown';
    await db.prepare(
      `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
       VALUES (?, 'delete', 'member', ?, ?)`
    ).bind(
      userEmail,
      memberId,
      JSON.stringify({ name: `${member.first_name} ${member.surname}`, email: member.email })
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Delete member error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Delete failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function PATCH({ params, locals, request }: APIContext) {
  const db = locals.runtime.env.DB;
  const memberId = params.id;

  if (!memberId) {
    return new Response(JSON.stringify({ error: 'Member ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await request.json().catch(() => ({}));
  if (body.action !== 'restore') {
    return new Response(JSON.stringify({ error: 'Unsupported action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const member = await db.prepare(
    'SELECT id, first_name, surname, email FROM members WHERE id = ?'
  ).bind(memberId).first();

  if (!member) {
    return new Response(JSON.stringify({ error: 'Member not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await db.prepare('UPDATE members SET deleted_at = NULL WHERE id = ?').bind(memberId).run();

  const userEmail = locals.user?.email || 'unknown';
  await db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
     VALUES (?, 'restore', 'member', ?, ?)`
  ).bind(
    userEmail,
    memberId,
    JSON.stringify({ name: `${member.first_name} ${member.surname}`, email: member.email })
  ).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
