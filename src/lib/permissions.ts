// Permission groups and capabilities.
//
// A member's capabilities come from the permission groups they belong to.
// members.is_committee is the flag on the membership record; it is always
// written together with the committee row in member_permission_groups so the
// two cannot drift.

export const CAPABILITIES = {
  COMMITTEE_PORTAL: 'committee.portal',
  DOCUMENTS_VIEW_ALL: 'documents.view_all',
  FINANCE_INCOME_EXPENDITURE: 'finance.income_expenditure',
} as const;

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES];

export const CAPABILITY_LABELS: Record<string, string> = {
  'committee.portal': 'Committee portal access',
  'documents.view_all': 'View all member documents (including unpublished)',
  'finance.income_expenditure': 'View Income & Expenditure (Cash Based) reports',
};

export const COMMITTEE_GROUP_KEY = 'committee';

export interface PermissionGroup {
  id: number;
  key: string;
  name: string;
  description: string | null;
  mail_group: string | null;
}

export async function getGroupByKey(db: D1Database, key: string): Promise<PermissionGroup | null> {
  return await db.prepare(
    `SELECT id, key, name, description, mail_group FROM permission_groups WHERE key = ?`
  ).bind(key).first<PermissionGroup>();
}

/** Capabilities granted to a member through all of their groups. */
export async function getMemberCapabilities(db: D1Database, memberId: number): Promise<Set<string>> {
  const rows = await db.prepare(
    `SELECT DISTINCT c.capability
       FROM member_permission_groups mpg
       JOIN permission_group_capabilities c ON c.group_id = mpg.group_id
      WHERE mpg.member_id = ?`
  ).bind(memberId).all<{ capability: string }>();
  return new Set((rows.results || []).map(r => r.capability));
}

export async function memberHasCapability(
  db: D1Database,
  memberId: number,
  capability: Capability
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok
       FROM member_permission_groups mpg
       JOIN permission_group_capabilities c ON c.group_id = mpg.group_id
      WHERE mpg.member_id = ? AND c.capability = ?
      LIMIT 1`
  ).bind(memberId, capability).first<{ ok: number }>();
  return !!row;
}

/**
 * Grant or revoke the committee group for a member, keeping members.is_committee
 * in step. Local database only — the Microsoft 365 group is updated separately
 * by the caller (see committee-sync.ts), so a Graph failure never leaves the
 * CRM in a half-written state.
 */
export async function setCommitteeMembership(
  db: D1Database,
  memberId: number,
  isCommittee: boolean,
  opts: { source: 'manual' | 'sync'; by?: string | null } = { source: 'manual' }
): Promise<void> {
  const group = await getGroupByKey(db, COMMITTEE_GROUP_KEY);
  if (!group) throw new Error('Committee permission group is missing — run migration 063.');

  if (isCommittee) {
    await db.batch([
      db.prepare(
        `INSERT INTO member_permission_groups (member_id, group_id, source, added_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(member_id, group_id) DO UPDATE SET source = excluded.source`
      ).bind(memberId, group.id, opts.source, opts.by || null),
      db.prepare(
        `UPDATE members SET is_committee = 1, committee_synced_at = datetime('now') WHERE id = ?`
      ).bind(memberId),
    ]);
  } else {
    await db.batch([
      db.prepare(
        `DELETE FROM member_permission_groups WHERE member_id = ? AND group_id = ?`
      ).bind(memberId, group.id),
      db.prepare(
        `UPDATE members SET is_committee = 0, committee_synced_at = datetime('now') WHERE id = ?`
      ).bind(memberId),
    ]);
  }
}

export interface CommitteeMemberRow {
  id: number;
  first_name: string;
  surname: string;
  email: string | null;
  source: string;
  added_at: string;
  added_by: string | null;
}

export async function listCommitteeMembers(db: D1Database): Promise<CommitteeMemberRow[]> {
  const rows = await db.prepare(
    `SELECT m.id, m.first_name, m.surname, m.email, mpg.source, mpg.added_at, mpg.added_by
       FROM member_permission_groups mpg
       JOIN members m ON m.id = mpg.member_id
       JOIN permission_groups g ON g.id = mpg.group_id
      WHERE g.key = ? AND m.deleted_at IS NULL
      ORDER BY m.surname, m.first_name`
  ).bind(COMMITTEE_GROUP_KEY).all<CommitteeMemberRow>();
  return rows.results || [];
}
