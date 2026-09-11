import type { APIRoute } from 'astro';
import { pullCommitteeFromGroup, pushMemberToGroup } from '@/lib/committee-sync';
import {
  CAPABILITIES, ACCOUNT_CREDENTIALS_GROUP_KEY,
  setCommitteeMembership, setAdminGroupMembership, adminHasCapability, normaliseEmail,
} from '@/lib/permissions';

/**
 * Permission group administration.
 * POST /api/admin/permissions
 *   { action: 'sync-committee' }                        — pull committee@ group membership into the CRM
 *   { action: 'set-committee', memberId, value: bool }  — set the flag and mirror it into the mail group
 *   { action: 'set-admin-group', groupKey, email, value: bool }
 *       — grant/revoke an admin-level group by sign-in email; the caller must hold it already
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Not configured' }, 500);

  // /admin and /api/admin are behind Cloudflare Access; locals.user is set by middleware.
  const user = locals.user;
  if (!user && !import.meta.env.DEV) return json({ error: 'Not authorised' }, 403);
  const actor = user?.email || 'system';

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body?.action === 'sync-committee') {
    const result = await pullCommitteeFromGroup(db, env, actor);
    return json(result, result.ok ? 200 : 502);
  }

  if (body?.action === 'set-committee') {
    const memberId = Number(body.memberId);
    const value = !!body.value;
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return json({ error: 'memberId is required' }, 400);
    }

    const member = await db.prepare(
      `SELECT id, first_name, surname, email FROM members WHERE id = ? AND deleted_at IS NULL`
    ).bind(memberId).first<{ id: number; first_name: string; surname: string; email: string | null }>();
    if (!member) return json({ error: 'Member not found' }, 404);

    await setCommitteeMembership(db, memberId, value, { source: 'manual', by: actor });
    const push = await pushMemberToGroup(db, env, member, value, actor);

    return json({ ok: true, isCommittee: value, mailGroupUpdated: push.ok, warning: push.warning });
  }

  if (body?.action === 'set-admin-group') {
    const groupKey = String(body.groupKey || '');
    const email = normaliseEmail(body.email);
    const value = !!body.value;

    // Only the credentials group exists at admin level for now, and only its
    // current holders may change it.
    if (groupKey !== ACCOUNT_CREDENTIALS_GROUP_KEY) return json({ error: 'Unknown group' }, 400);
    if (!email || !email.includes('@')) return json({ error: 'A valid email address is required' }, 400);
    const allowed = import.meta.env.DEV || await adminHasCapability(db, actor, CAPABILITIES.ACCOUNT_CREDENTIALS);
    if (!allowed) return json({ error: 'Only current holders can change who sees credentials' }, 403);
    if (!value && email === normaliseEmail(actor)) {
      return json({ error: 'You cannot remove yourself — ask another holder to do it' }, 400);
    }

    try {
      await setAdminGroupMembership(db, groupKey, email, value, actor);
    } catch (e: any) {
      return json({ error: e.message }, 400);
    }
    await db.prepare(
      `INSERT INTO audit_log (user_email, action, entity_type, details) VALUES (?, ?, 'permission_group', ?)`
    ).bind(actor, value ? 'admin_group_granted' : 'admin_group_revoked', JSON.stringify({ groupKey, email })).run();

    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
