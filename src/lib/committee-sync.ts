// Keeps the committee permission group and the Microsoft 365 group
// committee@alnmouthvillage.golf in step, in both directions.
//
//   pull  — group membership is authoritative: the CRM flag is set/cleared to match.
//   push  — a single member's flag was changed in the CRM: mirror it into the group.
//
// Matching between the two is by email address. Anyone in the mail group whose
// address matches no member record, and any flagged member with no directory
// account, is reported as unmatched rather than silently dropped.

import {
  findGroupId,
  listGroupMembers,
  findUserByEmail,
  addGroupMember,
  removeGroupMember,
  isGraphConfigured,
  type GraphEnv,
} from './graph-groups';
import { getGroupByKey, setCommitteeMembership, COMMITTEE_GROUP_KEY } from './permissions';

export interface PullResult {
  ok: boolean;
  error?: string;
  mailGroup?: string;
  added: Array<{ memberId: number; name: string; email: string }>;
  removed: Array<{ memberId: number; name: string; email: string | null }>;
  unchanged: number;
  /** Addresses in the mail group with no matching member record. */
  unmatched: Array<{ email: string; displayName: string | null }>;
  /** Flagged in the CRM by hand and deliberately left alone by the pull. */
  manualKept: Array<{ memberId: number; name: string; email: string | null }>;
}

const nameOf = (r: { first_name: string; surname: string }) => `${r.first_name} ${r.surname}`.trim();

function addressesOf(u: { mail: string | null; userPrincipalName: string | null }): string[] {
  return [u.mail, u.userPrincipalName]
    .filter((a): a is string => !!a)
    .map(a => a.trim().toLowerCase());
}

/** Group -> CRM. The mail group is authoritative for sync-sourced membership. */
export async function pullCommitteeFromGroup(
  db: D1Database,
  env: Partial<GraphEnv>,
  runBy: string | null
): Promise<PullResult> {
  const empty: PullResult = { ok: false, added: [], removed: [], unchanged: 0, unmatched: [], manualKept: [] };

  if (!isGraphConfigured(env)) {
    return { ...empty, error: 'Microsoft Graph is not configured (AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET).' };
  }

  const group = await getGroupByKey(db, COMMITTEE_GROUP_KEY);
  if (!group?.mail_group) {
    return { ...empty, error: 'The committee group has no mail group configured.' };
  }

  let directoryUsers;
  let groupId: string | null;
  try {
    groupId = await findGroupId(env, group.mail_group);
    if (!groupId) return { ...empty, error: `Mail group ${group.mail_group} was not found in the directory.` };
    directoryUsers = await listGroupMembers(env, groupId);
  } catch (e: any) {
    return { ...empty, error: e.message };
  }

  // Current state in the CRM.
  const current = await db.prepare(
    `SELECT m.id, m.first_name, m.surname, m.email, mpg.source
       FROM member_permission_groups mpg
       JOIN members m ON m.id = mpg.member_id
      WHERE mpg.group_id = ? AND m.deleted_at IS NULL`
  ).bind(group.id).all<{ id: number; first_name: string; surname: string; email: string | null; source: string }>();
  const currentRows = current.results || [];
  const currentIds = new Set(currentRows.map(r => r.id));

  // Every live member with an email, indexed by address.
  const all = await db.prepare(
    `SELECT id, first_name, surname, email FROM members
      WHERE deleted_at IS NULL AND email IS NOT NULL AND TRIM(email) != ''`
  ).all<{ id: number; first_name: string; surname: string; email: string }>();
  const byEmail = new Map<string, { id: number; first_name: string; surname: string; email: string }>();
  for (const m of all.results || []) byEmail.set(m.email.trim().toLowerCase(), m);

  const result: PullResult = { ok: true, mailGroup: group.mail_group, added: [], removed: [], unchanged: 0, unmatched: [], manualKept: [] };
  const shouldBeIds = new Set<number>();

  for (const u of directoryUsers) {
    const match = addressesOf(u).map(a => byEmail.get(a)).find(Boolean);
    if (!match) {
      result.unmatched.push({ email: u.mail || u.userPrincipalName || '(no address)', displayName: u.displayName });
      continue;
    }
    shouldBeIds.add(match.id);
    if (currentIds.has(match.id)) {
      result.unchanged++;
    } else {
      await setCommitteeMembership(db, match.id, true, { source: 'sync', by: runBy });
      result.added.push({ memberId: match.id, name: nameOf(match), email: match.email });
    }
  }

  // Anyone previously added by sync but no longer in the group loses access.
  // Manual grants are left in place — an admin put them there deliberately.
  for (const row of currentRows) {
    if (shouldBeIds.has(row.id)) continue;
    if (row.source === 'manual') {
      result.manualKept.push({ memberId: row.id, name: nameOf(row), email: row.email });
      continue;
    }
    await setCommitteeMembership(db, row.id, false, { source: 'sync', by: runBy });
    result.removed.push({ memberId: row.id, name: nameOf(row), email: row.email });
  }

  await db.prepare(
    `INSERT INTO permission_sync_log (group_key, direction, run_by, added, removed, unmatched, ok, detail)
     VALUES (?, 'pull', ?, ?, ?, ?, 1, ?)`
  ).bind(
    COMMITTEE_GROUP_KEY, runBy, result.added.length, result.removed.length, result.unmatched.length,
    JSON.stringify({ added: result.added, removed: result.removed, unmatched: result.unmatched, manualKept: result.manualKept })
  ).run();

  return result;
}

export interface PushResult {
  ok: boolean;
  /** True when the CRM flag was applied but the mail group could not be updated. */
  warning?: string;
  error?: string;
}

/**
 * CRM -> group, for one member. Called after the flag is changed by hand.
 * A failure here is reported as a warning: the CRM flag is already saved and
 * the next pull will reconcile, so it must not block saving the member.
 */
export async function pushMemberToGroup(
  db: D1Database,
  env: Partial<GraphEnv>,
  member: { id: number; email: string | null; first_name: string; surname: string },
  isCommittee: boolean,
  runBy: string | null
): Promise<PushResult> {
  const log = async (ok: boolean, detail: unknown) => {
    await db.prepare(
      `INSERT INTO permission_sync_log (group_key, direction, run_by, added, removed, unmatched, ok, detail)
       VALUES (?, 'push', ?, ?, ?, ?, ?, ?)`
    ).bind(
      COMMITTEE_GROUP_KEY, runBy,
      ok && isCommittee ? 1 : 0,
      ok && !isCommittee ? 1 : 0,
      ok ? 0 : 1,
      ok ? 1 : 0,
      JSON.stringify(detail)
    ).run();
  };

  if (!isGraphConfigured(env)) {
    const warning = 'Microsoft Graph is not configured, so committee@alnmouthvillage.golf was not updated.';
    await log(false, { memberId: member.id, warning });
    return { ok: false, warning };
  }

  if (!member.email || !member.email.trim()) {
    const warning = `${member.first_name} ${member.surname} has no email address, so committee@alnmouthvillage.golf was not updated.`;
    await log(false, { memberId: member.id, warning });
    return { ok: false, warning };
  }

  try {
    const group = await getGroupByKey(db, COMMITTEE_GROUP_KEY);
    if (!group?.mail_group) throw new Error('The committee group has no mail group configured.');

    const groupId = await findGroupId(env, group.mail_group);
    if (!groupId) throw new Error(`Mail group ${group.mail_group} was not found in the directory.`);

    const user = await findUserByEmail(env, member.email);
    if (!user) {
      const warning = `${member.email} has no account in the directory, so it could not be added to ${group.mail_group}. `
        + 'The committee flag has been saved in the CRM; add the address to the mail group by hand if it should receive committee email.';
      await log(false, { memberId: member.id, warning });
      return { ok: false, warning };
    }

    if (isCommittee) {
      await addGroupMember(env, groupId, user.id);
    } else {
      await removeGroupMember(env, groupId, user.id);
    }
    await log(true, { memberId: member.id, email: member.email, isCommittee });
    return { ok: true };
  } catch (e: any) {
    // "already exists" on add and "not found" on remove mean the group is
    // already in the state we wanted.
    const msg = String(e.message || e);
    if (/already exist|One or more added object references already exist/i.test(msg) && isCommittee) {
      await log(true, { memberId: member.id, note: 'already a group member' });
      return { ok: true };
    }
    if (/Resource '.*' does not exist|does not exist or one of its queried/i.test(msg) && !isCommittee) {
      await log(true, { memberId: member.id, note: 'already absent from group' });
      return { ok: true };
    }
    const warning = `The committee flag was saved, but committee@alnmouthvillage.golf could not be updated: ${msg}`;
    await log(false, { memberId: member.id, warning });
    return { ok: false, warning };
  }
}
