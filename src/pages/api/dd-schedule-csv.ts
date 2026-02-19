// API endpoint to generate a CSV of DD member payment schedules
// GET /api/dd-schedule-csv

import type { APIRoute } from 'astro';
import { calculateDDSchedule } from '../../lib/dd-renewal-email';

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  const year = new Date().getFullYear();

  // Get DD members from CRM
  const members = await env.DB.prepare(
    `SELECT m.id, m.title, m.first_name, m.surname, m.category, m.email,
            m.direct_debit_member_id, m.locker_number, m.national_id,
            m.home_away, m.handicap_index, m.club_number, m.pin,
            p.fee as subscription_fee
     FROM members m
     LEFT JOIN payment_items p ON p.name = m.category AND p.category = 'Subscription' AND p.active = 1
     WHERE m.default_payment_method = 'Clubwise Direct Debit'
       AND p.fee IS NOT NULL
     ORDER BY m.surname, m.first_name`
  ).all();

  if (!members.results || members.results.length === 0) {
    return new Response(JSON.stringify({ error: 'No DD members found' }), { status: 404 });
  }

  // Load DD membership types from the latest consolidation
  const ddMembershipTypes = new Map<number, string>();
  const latestConsolidation = await env.DB.prepare(
    `SELECT matched_json FROM dd_consolidation ORDER BY imported_at DESC LIMIT 1`
  ).first<{ matched_json: string | null }>();

  if (latestConsolidation?.matched_json) {
    try {
      const matched = JSON.parse(latestConsolidation.matched_json) as Array<{
        crmId: number;
        ddMembershipType?: string;
      }>;
      for (const m of matched) {
        if (m.ddMembershipType) {
          ddMembershipTypes.set(m.crmId, m.ddMembershipType);
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  const rows: string[] = [];
  rows.push('Name,Membership Number,CRM Membership Type,DD Membership Type,DD Subscription ID,First Monthly Payment,Subsequent Monthly Payment,First Payment Date');

  // CSV-escape fields that might contain commas
  const escapeCsv = (val: string) => val.includes(',') ? `"${val}"` : val;

  for (const m of members.results) {
    const schedule = calculateDDSchedule(
      {
        title: m.title as string,
        first_name: m.first_name as string,
        surname: m.surname as string,
        club_number: (m.club_number || m.pin) as string,
        category: m.category as string,
        email: m.email as string,
        direct_debit_member_id: m.direct_debit_member_id as string,
        locker_number: m.locker_number as string,
        national_id: m.national_id as string,
        home_away: m.home_away as string,
        handicap_index: m.handicap_index as number | null,
      },
      m.subscription_fee as number,
      year
    );

    const name = `${m.first_name} ${m.surname}`;
    const membershipNumber = (m.club_number || m.pin || '') as string;
    const crmType = (m.category || '') as string;
    const ddType = ddMembershipTypes.get(m.id as number) || '';
    const ddId = m.direct_debit_member_id || '';
    const firstPayment = schedule.initialCollectionTotal.toFixed(2);
    const monthlyPayment = schedule.monthlyPayment.toFixed(2);
    const firstDate = `1st April ${year}`;

    rows.push(`${escapeCsv(name)},${escapeCsv(String(membershipNumber))},${escapeCsv(crmType)},${escapeCsv(ddType)},${escapeCsv(String(ddId))},${firstPayment},${monthlyPayment},${firstDate}`);
  }

  const csv = rows.join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="dd-schedule-${year}.csv"`,
    },
  });
};
