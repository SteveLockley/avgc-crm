// API endpoint to run DD consolidation from a CSV upload
// POST /api/run-dd-consolidation (multipart form with 'ddfile' field, optional 'mode' field)

import type { APIRoute } from 'astro';

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeName(name: string | null): string {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/[^a-z]/g, '');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get('ddfile') as File;
  const mode = (formData.get('mode') as string) || 'apply';

  if (!file || file.size === 0) {
    return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400 });
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) {
    return new Response(JSON.stringify({ error: 'CSV file is empty' }), { status: 400 });
  }

  const header = parseCSVLine(lines[0]);

  const memberNoIdx = header.findIndex(h => h.toLowerCase().includes('member number'));
  const salutationIdx = header.findIndex(h => h.toLowerCase().includes('salutation'));
  const firstNameIdx = header.findIndex(h => h.toLowerCase().includes('first name'));
  const surnameIdx = header.findIndex(h => h.toLowerCase().includes('surname'));
  const addressIdx = header.findIndex(h => h.toLowerCase().includes('street address'));
  const townIdx = header.findIndex(h => h.toLowerCase() === 'town');
  const countyIdx = header.findIndex(h => h.toLowerCase() === 'county');
  const postcodeIdx = header.findIndex(h => h.toLowerCase() === 'postcode');
  const genderIdx = header.findIndex(h => h.toLowerCase() === 'gender');
  const eveningTelIdx = header.findIndex(h => h.toLowerCase().includes('evening tel'));
  const mobileIdx = header.findIndex(h => h.toLowerCase().includes('mobile'));
  const emailIdx = header.findIndex(h => h.toLowerCase().includes('email'));
  const dobIdx = header.findIndex(h => h.toLowerCase() === 'dob');
  const statusIdx = header.findIndex(h => h.toLowerCase() === 'status');
  const cardNoIdx = header.findIndex(h => h.toLowerCase().includes('card no'));
  const membershipTypeIdx = header.findIndex(h => h.toLowerCase().includes('membership type'));
  const companyIdx = header.findIndex(h => h.toLowerCase() === 'company');
  const feeIdx = header.findIndex(h => h.toLowerCase() === 'fee');
  const joiningDateIdx = header.findIndex(h => h.toLowerCase().includes('joining date'));
  const minCommitmentIdx = header.findIndex(h => h.toLowerCase().includes('minimum commitment'));
  const expiryDateIdx = header.findIndex(h => h.toLowerCase().includes('expiry date'));
  const nextBillingIdx = header.findIndex(h => h.toLowerCase().includes('next billing'));
  const lastVisitIdx = header.findIndex(h => h.toLowerCase().includes('last visit'));

  if (memberNoIdx === -1 || firstNameIdx === -1 || surnameIdx === -1) {
    return new Response(JSON.stringify({ error: 'CSV must contain Member number, First name, Surname columns' }), { status: 400 });
  }

  const getVal = (values: string[], idx: number) => idx >= 0 ? values[idx]?.trim() || '' : '';

  // Parse DD records
  const ddRecords: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length > Math.max(memberNoIdx, firstNameIdx, surnameIdx)) {
      const memberNo = values[memberNoIdx]?.trim();
      const firstName = values[firstNameIdx]?.trim();
      const surname = values[surnameIdx]?.trim();
      if (memberNo && surname) {
        ddRecords.push({
          memberNo, firstName: firstName || '', surname,
          salutation: getVal(values, salutationIdx),
          address: getVal(values, addressIdx),
          town: getVal(values, townIdx),
          county: getVal(values, countyIdx),
          postcode: getVal(values, postcodeIdx),
          gender: getVal(values, genderIdx),
          eveningTel: getVal(values, eveningTelIdx),
          mobile: getVal(values, mobileIdx),
          email: getVal(values, emailIdx),
          dob: getVal(values, dobIdx),
          status: getVal(values, statusIdx),
          cardNo: getVal(values, cardNoIdx),
          membershipType: getVal(values, membershipTypeIdx),
          company: getVal(values, companyIdx),
          fee: getVal(values, feeIdx),
          joiningDate: getVal(values, joiningDateIdx),
          minCommitmentDate: getVal(values, minCommitmentIdx),
          expiryDate: getVal(values, expiryDateIdx),
          nextBillingDate: getVal(values, nextBillingIdx),
          lastVisit: getVal(values, lastVisitIdx),
          normalizedKey: normalizeName(surname) + '|' + normalizeName(firstName),
        });
      }
    }
  }

  // Get CRM members
  const crmResult = await env.DB.prepare(
    `SELECT id, first_name, surname, category, default_payment_method, direct_debit_member_id FROM members ORDER BY surname, first_name`
  ).all();
  const crmMembers = (crmResult.results || []) as Array<{
    id: number; first_name: string; surname: string; category: string;
    default_payment_method: string | null; direct_debit_member_id: string | null;
  }>;

  const crmByName = new Map<string, typeof crmMembers[0][]>();
  for (const m of crmMembers) {
    const key = normalizeName(m.surname) + '|' + normalizeName(m.first_name);
    if (!crmByName.has(key)) crmByName.set(key, []);
    crmByName.get(key)!.push(m);
  }

  const matchedCrmIds = new Set<number>();
  const matched: any[] = [];
  const ddNotInCrm: any[] = [];
  let updated = 0;
  const errors: string[] = [];

  for (const dd of ddRecords) {
    const crmMatches = crmByName.get(dd.normalizedKey);
    if (crmMatches && crmMatches.length > 0) {
      const crm = crmMatches[0];
      matchedCrmIds.add(crm.id);

      matched.push({
        ddMemberNo: dd.memberNo, ddSalutation: dd.salutation,
        ddName: `${dd.firstName} ${dd.surname}`,
        ddAddress: dd.address, ddTown: dd.town, ddCounty: dd.county, ddPostcode: dd.postcode,
        ddGender: dd.gender, ddEveningTel: dd.eveningTel, ddMobile: dd.mobile,
        ddEmail: dd.email, ddDob: dd.dob, ddStatus: dd.status, ddCardNo: dd.cardNo,
        ddMembershipType: dd.membershipType, ddCompany: dd.company, ddFee: dd.fee,
        ddJoiningDate: dd.joiningDate, ddMinCommitmentDate: dd.minCommitmentDate,
        ddExpiryDate: dd.expiryDate, ddNextBillingDate: dd.nextBillingDate, ddLastVisit: dd.lastVisit,
        crmId: crm.id, crmName: `${crm.first_name} ${crm.surname}`,
        crmCategory: crm.category,
        crmPaymentMethod: crm.default_payment_method,
        paymentMethodCorrect: crm.default_payment_method === 'Clubwise Direct Debit',
      });

      if (mode === 'apply' && crm.direct_debit_member_id !== dd.memberNo) {
        try {
          await env.DB.prepare(
            `UPDATE members SET direct_debit_member_id = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(dd.memberNo, crm.id).run();
          updated++;
        } catch (e: any) {
          errors.push(`Failed to update ${crm.first_name} ${crm.surname}: ${e.message}`);
        }
      }
    } else {
      ddNotInCrm.push({
        ddMemberNo: dd.memberNo, ddSalutation: dd.salutation,
        ddName: `${dd.firstName} ${dd.surname}`,
        ddAddress: dd.address, ddTown: dd.town, ddCounty: dd.county, ddPostcode: dd.postcode,
        ddGender: dd.gender, ddEveningTel: dd.eveningTel, ddMobile: dd.mobile,
        ddEmail: dd.email, ddDob: dd.dob, ddStatus: dd.status, ddCardNo: dd.cardNo,
        ddMembershipType: dd.membershipType, ddCompany: dd.company, ddFee: dd.fee,
        ddJoiningDate: dd.joiningDate, ddMinCommitmentDate: dd.minCommitmentDate,
        ddExpiryDate: dd.expiryDate, ddNextBillingDate: dd.nextBillingDate, ddLastVisit: dd.lastVisit,
      });
    }
  }

  const crmNotInDd: any[] = [];
  for (const crm of crmMembers) {
    if (crm.default_payment_method === 'Clubwise Direct Debit' && !matchedCrmIds.has(crm.id)) {
      crmNotInDd.push({
        crmId: crm.id, crmName: `${crm.first_name} ${crm.surname}`,
        crmPaymentMethod: crm.default_payment_method, crmDdMemberId: crm.direct_debit_member_id,
      });
    }
  }

  // Save consolidation
  await env.DB.prepare(
    `INSERT INTO dd_consolidation (imported_by, matched_count, dd_not_in_crm_count, crm_not_in_dd_count,
     matched_json, dd_not_in_crm_json, crm_not_in_dd_json, errors_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    'api', matched.length, ddNotInCrm.length, crmNotInDd.length,
    JSON.stringify(matched), JSON.stringify(ddNotInCrm), JSON.stringify(crmNotInDd), JSON.stringify(errors)
  ).run();

  return new Response(JSON.stringify({
    success: true, mode,
    matched: matched.length, ddNotInCrm: ddNotInCrm.length, crmNotInDd: crmNotInDd.length,
    updated, errors: errors.length > 0 ? errors : undefined,
    incorrectPaymentMethod: matched.filter((m: any) => !m.paymentMethodCorrect).length,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
