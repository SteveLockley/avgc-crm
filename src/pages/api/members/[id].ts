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
      'SELECT id, first_name, surname, email FROM members WHERE id = ?'
    ).bind(memberId).first();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete member (cascades to payments, subscription_history, etc.)
    await db.prepare('DELETE FROM members WHERE id = ?').bind(memberId).run();

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
