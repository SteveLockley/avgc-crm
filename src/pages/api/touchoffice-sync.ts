import type { APIRoute } from 'astro';
import {
  updateCustomerCard,
  TO_GROUP_MEMBERS,
  TO_GROUP_SOCIAL,
  TO_GROUP_DEAD_CARDS,
  TO_FLAG_BLACKLISTED,
} from '../../lib/touchoffice';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'No database' }, 500);

  const body = await request.json();
  const action = body.action;

  // Set the touchoffice_num for a single member
  if (action === 'set-num') {
    const { memberId, touchofficeNum } = body;
    await db.prepare(
      `UPDATE members SET touchoffice_num = ? WHERE id = ?`
    ).bind(touchofficeNum ?? null, memberId).run();
    return json({ ok: true });
  }

  // Sync a single member to TouchOffice
  if (action === 'sync-one') {
    const { memberId } = body;
    const member = await db.prepare(
      `SELECT id, first_name, surname, category, date_expires, touchoffice_num
       FROM members WHERE id = ?`
    ).bind(memberId).first<Member>();
    if (!member) return json({ error: 'Member not found' }, 404);
    if (!member.touchoffice_num) return json({ error: 'No TouchOffice num set for this member' }, 400);

    const result = await syncMember(db, env, member);
    return json(result);
  }

  // Sync all members that have a touchoffice_num set — batched to avoid timeouts and TO rate limits
  if (action === 'sync-all') {
    const BATCH_SIZE = 20;
    const offset = Number(body.offset) || 0;

    const rows = await db.prepare(
      `SELECT id, first_name, surname, category, date_expires, touchoffice_num
       FROM members WHERE touchoffice_num IS NOT NULL ORDER BY surname, first_name`
    ).all();
    const allMembers = (rows.results || []) as Member[];
    const total = allMembers.length;
    const batch = allMembers.slice(offset, offset + BATCH_SIZE);

    const results: { memberId: number; name: string; ok: boolean; error?: string }[] = [];
    for (const member of batch) {
      const result = await syncMember(db, env, member);
      results.push({ memberId: member.id, name: `${member.first_name} ${member.surname}`, ...result });
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const nextOffset = offset + batch.length;
    return json({ synced: batch.length, total, offset, nextOffset, remaining: total - nextOffset, results });
  }

  // Toggle directly by TouchOffice customer number (used from customer balance page)
  if (action === 'toggle-card-status') {
    const { customerNumber, memberId, dead } = body;
    let custgroup: number;
    let flag: number;
    if (dead) {
      custgroup = TO_GROUP_DEAD_CARDS;
      flag = TO_FLAG_BLACKLISTED;
    } else {
      // Look up member category to restore correct live group
      const member = memberId
        ? await db.prepare(`SELECT category FROM members WHERE id = ?`).bind(memberId).first<{ category: string }>()
        : await db.prepare(`SELECT category FROM members WHERE touchoffice_num = ?`).bind(customerNumber).first<{ category: string }>();
      custgroup = member?.category === 'Social' ? TO_GROUP_SOCIAL : TO_GROUP_MEMBERS;
      flag = 0;
    }
    const result = await updateCustomerCard(db, env, customerNumber, { custgroup, flag });
    return json({ ...result, custgroup });
  }

  // Force a member to Dead Cards or back to live without a full sync
  if (action === 'toggle-status') {
    const { memberId, dead } = body;
    const member = await db.prepare(
      `SELECT id, first_name, surname, category, touchoffice_num FROM members WHERE id = ?`
    ).bind(memberId).first<{ id: number; first_name: string; surname: string; category: string; touchoffice_num: number | null }>();
    if (!member) return json({ error: 'Member not found' }, 404);
    if (!member.touchoffice_num) return json({ error: 'No TouchOffice num set' }, 400);

    const custgroup = dead
      ? TO_GROUP_DEAD_CARDS
      : member.category === 'Social' ? TO_GROUP_SOCIAL : TO_GROUP_MEMBERS;
    const flag = dead ? TO_FLAG_BLACKLISTED : 0;

    const result = await updateCustomerCard(db, env, member.touchoffice_num, { custgroup, flag });
    return json(result);
  }

  return json({ error: 'Unknown action' }, 400);
};

interface Member {
  id: number;
  first_name: string;
  surname: string;
  category: string;
  date_expires: string | null;
  touchoffice_num: number;
}

function touchofficeGroup(member: Member): number {
  if (isExpired(member)) return TO_GROUP_DEAD_CARDS;
  if (member.category === 'Social') return TO_GROUP_SOCIAL;
  return TO_GROUP_MEMBERS;
}

function touchofficeFlag(member: Member): number {
  return isExpired(member) ? TO_FLAG_BLACKLISTED : 0;
}

function isExpired(member: Member): boolean {
  if (!member.date_expires) return false;
  return new Date(member.date_expires) < new Date();
}

async function syncMember(db: any, env: any, member: Member) {
  return updateCustomerCard(db, env, member.touchoffice_num, {
    firstname: member.first_name,
    lastname: member.surname,
    longname: `${member.first_name} ${member.surname}`,
    accountnumber: member.id,
    custgroup: touchofficeGroup(member),
    flag: touchofficeFlag(member),
  });
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
