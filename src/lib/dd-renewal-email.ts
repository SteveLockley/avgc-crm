// HTML email template for annual Direct Debit renewal notifications
// Complies with UK Direct Debit Guarantee requirements

interface DDRenewalMember {
  title?: string;
  first_name: string;
  surname: string;
  club_number?: string;
  category: string;
  email?: string;
  direct_debit_member_id?: string;
  locker_number?: string;
  national_id?: string;
  home_away?: string;
  handicap_index?: number | null;
}

interface DDPaymentSchedule {
  annualSubscription: number;
  englandGolfFee: number;
  countyFee: number;
  lockerFee: number;
  totalAnnualMembership: number;
  monthlyPayment: number;
  firstMonthPayment: number;
  initialCollectionTotal: number;
  collectionDate: string; // "1st April 2026"
  membershipYear: string; // "2026/2027"
}

/**
 * Calculate the DD payment schedule for a member
 *
 * Initial payment (1st April): EGU + County + locker rental (full) + first month membership
 * Monthly = floor(subscription / 12) to nearest penny (locker NOT spread)
 * First month = subscription - (11 x monthly)
 */
export function calculateDDSchedule(
  member: DDRenewalMember,
  subscriptionFee: number,
  year: number
): DDPaymentSchedule {
  const isHome = member.home_away === 'H';
  const hasCDH = !!member.national_id && member.national_id.trim() !== '';
  const isOutOfCounty = member.category.toLowerCase().includes('out of county');
  const hasHomeHandicap = member.handicap_index !== null && member.handicap_index !== undefined;
  const isSocial = member.category.toLowerCase() === 'social';
  const hasLocker = !!member.locker_number && member.locker_number.trim() !== '';

  // EGU and county fee rules (from invoice.ts logic)
  let englandGolfFee = 0;
  let countyFee = 0;
  if (hasCDH && !isSocial) {
    if (isHome && !isOutOfCounty) {
      englandGolfFee = 12.0;
      countyFee = 6.5;
    } else if (isOutOfCounty && hasHomeHandicap) {
      englandGolfFee = 12.0;
    }
  }

  const lockerFee = hasLocker ? 10.0 : 0;

  // Total annual membership = subscription + locker
  const totalAnnualMembership = subscriptionFee + lockerFee;

  // Monthly payment based on subscription only (locker charged in full in initial collection)
  const monthlyPayment = Math.floor((subscriptionFee / 12) * 100) / 100;

  // First month picks up the rounding remainder of subscription
  const firstMonthPayment = +(subscriptionFee - 11 * monthlyPayment).toFixed(2);

  // Initial collection = EGU + County + locker (full) + first month subscription
  const initialCollectionTotal = +(englandGolfFee + countyFee + lockerFee + firstMonthPayment).toFixed(2);

  const collectionDate = `1st April ${year}`;
  const membershipYear = `${year}/${year + 1}`;

  return {
    annualSubscription: subscriptionFee,
    englandGolfFee,
    countyFee,
    lockerFee,
    totalAnnualMembership,
    monthlyPayment,
    firstMonthPayment,
    initialCollectionTotal,
    collectionDate,
    membershipYear,
  };
}

/**
 * Calculate a consolidated DD schedule for a family group.
 * The payer's schedule plus all dependants' schedules combined into one DD collection.
 */
export interface FamilyMemberSchedule {
  member: DDRenewalMember;
  schedule: DDPaymentSchedule;
}

export interface ConsolidatedDDSchedule {
  payer: DDRenewalMember;
  familyMembers: FamilyMemberSchedule[];
  totalInitialCollection: number;
  totalMonthlyPayment: number;
  totalAnnual: number;
  collectionDate: string;
  membershipYear: string;
}

export function calculateConsolidatedSchedule(
  payer: DDRenewalMember,
  payerFee: number,
  dependants: { member: DDRenewalMember; fee: number }[],
  year: number
): ConsolidatedDDSchedule {
  const payerSchedule = calculateDDSchedule(payer, payerFee, year);
  const familyMembers: FamilyMemberSchedule[] = [
    { member: payer, schedule: payerSchedule },
  ];

  for (const dep of dependants) {
    const depSchedule = calculateDDSchedule(dep.member, dep.fee, year);
    familyMembers.push({ member: dep.member, schedule: depSchedule });
  }

  const totalInitialCollection = +familyMembers.reduce((sum, fm) => sum + fm.schedule.initialCollectionTotal, 0).toFixed(2);
  const totalMonthlyPayment = +familyMembers.reduce((sum, fm) => sum + fm.schedule.monthlyPayment, 0).toFixed(2);
  const totalAnnual = +(totalInitialCollection + 11 * totalMonthlyPayment).toFixed(2);

  return {
    payer,
    familyMembers,
    totalInitialCollection,
    totalMonthlyPayment,
    totalAnnual,
    collectionDate: payerSchedule.collectionDate,
    membershipYear: payerSchedule.membershipYear,
  };
}

function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

function formatCurrency(amount: number): string {
  return '£' + amount.toFixed(2);
}

function getMonthName(monthIndex: number): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return months[monthIndex % 12];
}

/**
 * Generate HTML email for DD renewal notification
 */
export function generateDDRenewalEmail(
  member: DDRenewalMember,
  schedule: DDPaymentSchedule
): string {
  const memberName = [member.title, member.first_name, member.surname]
    .filter(Boolean)
    .join(' ');

  // Build initial payment breakdown rows
  const initialBreakdownRows: string[] = [];
  if (schedule.englandGolfFee > 0) {
    initialBreakdownRows.push(`
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          England Golf Affiliation Fee
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
          ${formatCurrency(schedule.englandGolfFee)}
        </td>
      </tr>
    `);
  }
  if (schedule.countyFee > 0) {
    initialBreakdownRows.push(`
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          Northumberland County Fee
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
          ${formatCurrency(schedule.countyFee)}
        </td>
      </tr>
    `);
  }
  if (schedule.lockerFee > 0) {
    initialBreakdownRows.push(`
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          Locker rental (annual)
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
          ${formatCurrency(schedule.lockerFee)}
        </td>
      </tr>
    `);
  }
  initialBreakdownRows.push(`
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
        Membership fee (${getMonthName(3)})
      </td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
        ${formatCurrency(schedule.firstMonthPayment)}
      </td>
    </tr>
  `);

  // Build the 12-month schedule table rows
  const year = parseInt(schedule.membershipYear.split('/')[0]);
  const scheduleRows: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = (3 + i) % 12; // April = 3, May = 4, ... March = 2
    const paymentYear = monthIndex < 3 ? year + 1 : year; // Jan-Mar are next year
    const monthName = getMonthName(monthIndex);
    const isFirst = i === 0;
    const amount = isFirst ? schedule.initialCollectionTotal : schedule.monthlyPayment;
    const description = isFirst
      ? `${monthName} ${paymentYear} (initial collection)`
      : `${monthName} ${paymentYear}`;

    scheduleRows.push(`
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          ${description}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: center; font-size: 14px; color: #333;">
          1st ${monthName} ${paymentYear}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; font-weight: ${isFirst ? '600' : '400'}; color: #333;">
          ${formatCurrency(amount)}
        </td>
      </tr>
    `);
  }

  // Annual total
  const annualTotal = schedule.initialCollectionTotal + 11 * schedule.monthlyPayment;

  // Membership fee breakdown
  const feeBreakdownRows: string[] = [];
  feeBreakdownRows.push(`
    <tr>
      <td style="padding: 8px 12px; font-size: 14px; color: #333;">${escapeHtml(member.category)} subscription</td>
      <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(schedule.annualSubscription)}</td>
    </tr>
  `);
  if (schedule.lockerFee > 0) {
    feeBreakdownRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 14px; color: #333;">Locker rental</td>
        <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(schedule.lockerFee)}</td>
      </tr>
    `);
  }
  if (schedule.englandGolfFee > 0) {
    feeBreakdownRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 14px; color: #333;">England Golf affiliation</td>
        <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(schedule.englandGolfFee)}</td>
      </tr>
    `);
  }
  if (schedule.countyFee > 0) {
    feeBreakdownRows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 14px; color: #333;">Northumberland County fee</td>
        <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(schedule.countyFee)}</td>
      </tr>
    `);
  }

  // Advance notice date (at least 10 working days before 1st April)
  // For a 1st April collection, notice should be sent by ~mid-March

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Direct Debit Renewal Notice - ${schedule.membershipYear}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Main container -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #1e5631; padding: 30px; border-radius: 8px 8px 0 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                      Alnmouth Village Golf Club
                    </h1>
                    <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
                      Direct Debit Renewal Notice
                    </p>
                  </td>
                  <td align="right" style="color: #ffffff;">
                    <p style="margin: 0; font-size: 14px;">Membership Year</p>
                    <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600;">
                      ${schedule.membershipYear}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting & Notice -->
          <tr>
            <td style="padding: 30px 30px 0 30px;">
              <p style="margin: 0 0 15px 0; font-size: 16px; color: #333;">
                Dear ${escapeHtml(memberName)},
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                Thank you for your continued membership of Alnmouth Village Golf Club. This letter serves as your
                <strong>advance notice</strong> that your annual membership subscription will be renewed by Direct Debit
                from <strong>1st April ${year}</strong> for the ${schedule.membershipYear} membership year.
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                In accordance with the Direct Debit Guarantee, we are writing to advise you of your payment
                schedule for the coming year. Please retain this notice for your records.
              </p>
            </td>
          </tr>

          <!-- Member Details -->
          <tr>
            <td style="padding: 15px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f8f9fa; border-radius: 6px; padding: 15px;">
                <tr>
                  <td style="padding: 15px;">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      ${member.club_number ? `
                      <tr>
                        <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Member No:</td>
                        <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #333;">${escapeHtml(member.club_number)}</td>
                      </tr>
                      ` : ''}
                      <tr>
                        <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Category:</td>
                        <td style="padding: 4px 0; font-size: 14px; color: #333;">${escapeHtml(member.category)}</td>
                      </tr>
                      ${member.direct_debit_member_id ? `
                      <tr>
                        <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">DD Reference:</td>
                        <td style="padding: 4px 0; font-size: 14px; color: #333;">${escapeHtml(member.direct_debit_member_id)}</td>
                      </tr>
                      ` : ''}
                      <tr>
                        <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Membership Period:</td>
                        <td style="padding: 4px 0; font-size: 14px; color: #333;">1st April ${year} &ndash; 31st March ${year + 1}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Annual Fee Summary -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Annual Membership Fees
              </h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <tbody>
                  ${feeBreakdownRows.join('')}
                </tbody>
                <tfoot>
                  <tr style="background-color: #f8f9fa; border-top: 2px solid #1e5631;">
                    <td style="padding: 12px; font-size: 14px; font-weight: 600; color: #333;">
                      Total annual amount
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 14px; font-weight: 700; color: #1e5631;">
                      ${formatCurrency(annualTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Initial Payment Breakdown -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Initial Payment &mdash; ${schedule.collectionDate}
              </h3>
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                Your first collection will include any applicable England Golf and county affiliation fees${schedule.lockerFee > 0 ? ', locker rental,' : ''}
                plus your first monthly membership instalment:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <tbody>
                  ${initialBreakdownRows.join('')}
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td style="padding: 12px; font-size: 14px; font-weight: 600; color: #ffffff;">
                      Initial collection total
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(schedule.initialCollectionTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Full Payment Schedule -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Schedule of Payments
              </h3>
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                Your membership fees will be collected by Direct Debit in 12 monthly instalments
                on or around the 1st of each month:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8f9fa;">
                    <th style="padding: 12px; text-align: left; font-size: 13px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">
                      Month
                    </th>
                    <th style="padding: 12px; text-align: center; font-size: 13px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">
                      Collection Date
                    </th>
                    <th style="padding: 12px; text-align: right; font-size: 13px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  ${scheduleRows.join('')}
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td colspan="2" style="padding: 12px; font-size: 14px; font-weight: 600; color: #ffffff;">
                      Total for ${schedule.membershipYear}
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(annualTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Junior Membership Promotion -->
          <tr>
            <td style="padding: 15px 30px;">
              <div style="background: #e8f5e9; border-radius: 6px; padding: 20px;">
                <h3 style="margin: 0 0 10px 0; color: #1e5631; font-size: 16px;">
                  Junior Membership for Members' Families
                </h3>
                <p style="margin: 0; font-size: 14px; color: #333; line-height: 1.6;">
                  Did you know that children of existing members can join the club for just
                  <strong>&pound;20 per year</strong>? Junior membership includes access to the course, coaching
                  opportunities, and a great introduction to the game. Contact the club for details.
                </p>
              </div>
            </td>
          </tr>

          <!-- Important Information -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Important Information
              </h3>
              <div style="background: #fff8e1; border-left: 4px solid #f9a825; padding: 15px; border-radius: 0 6px 6px 0; margin-bottom: 15px;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                  <strong>If you wish to cancel your membership</strong>, you must notify the club in writing
                  before 1st March ${year} to avoid being charged for the ${schedule.membershipYear} membership year.
                  After this date, you will be liable for the full annual subscription.
                </p>
                <p style="margin: 0; font-size: 14px; color: #333; line-height: 1.6;">
                  If any of the details shown above are incorrect, or if you wish to discuss your membership,
                  please contact us at
                  <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #1e5631; font-weight: 600;">subscriptions@AlnmouthVillage.Golf</a>
                  or telephone 01665 830231.
                </p>
              </div>
            </td>
          </tr>

          <!-- Direct Debit Guarantee -->
          <tr>
            <td style="padding: 15px 30px 30px 30px;">
              <div style="border: 2px solid #1e5631; border-radius: 6px; overflow: hidden;">
                <div style="background-color: #1e5631; padding: 12px 15px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td>
                        <h3 style="margin: 0; color: #ffffff; font-size: 15px; font-weight: 600;">
                          The Direct Debit Guarantee
                        </h3>
                      </td>
                      <td align="right">
                                <img src="https://www.bacs.co.uk/media/wxojztsn/directdebitlogo.jpg" alt="Direct Debit Logo" width="100" style="display: block;" />
                      </td>
                    </tr>
                  </table>
                </div>
                <div style="padding: 15px; background-color: #ffffff;">
                  <ul style="margin: 0; padding: 0 0 0 20px; font-size: 13px; color: #333; line-height: 1.8;">
                    <li style="margin-bottom: 8px;">
                      This Guarantee is offered by all banks and building societies that accept instructions
                      to pay Direct Debits.
                    </li>
                    <li style="margin-bottom: 8px;">
                      If there are any changes to the amount, date, or frequency of your Direct Debit,
                      Alnmouth Village Golf Club will notify you <strong>10 working days</strong> in advance
                      of your account being debited or as otherwise agreed. If you request Alnmouth Village
                      Golf Club to collect a payment, confirmation of the amount and date will be given to
                      you at the time of the request.
                    </li>
                    <li style="margin-bottom: 8px;">
                      If an error is made in the payment of your Direct Debit, by Alnmouth Village Golf Club
                      or your bank or building society, you are entitled to a <strong>full and immediate refund</strong>
                      of the amount paid from your bank or building society.
                    </li>
                    <li style="margin-bottom: 8px;">
                      If you receive a refund you are not entitled to, you must pay it back when Alnmouth Village
                      Golf Club asks you to.
                    </li>
                    <li>
                      You can cancel a Direct Debit at any time by simply contacting your bank or building society.
                      Written confirmation may be required. Please also notify us.
                    </li>
                  </ul>
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; border-radius: 0 0 8px 8px; border-top: 1px solid #e0e0e0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 13px; color: #666; line-height: 1.6;">
                    <p style="margin: 0;"><strong>Alnmouth Village Golf Club</strong></p>
                    <p style="margin: 5px 0 0 0;">Marine Road, Alnmouth, Northumberland, NE66 2RZ</p>
                    <p style="margin: 5px 0 0 0;">Tel: 01665 830231 | Email: <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #1e5631;">subscriptions@AlnmouthVillage.Golf</a></p>
                    <p style="margin: 10px 0 0 0;"><a href="https://alnmouthvillage.golf" style="color: #1e5631;">www.AlnmouthVillage.Golf</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

        <!-- Disclaimer -->
        <p style="margin: 20px 0 0 0; font-size: 12px; color: #999; text-align: center; max-width: 600px; line-height: 1.5;">
          This email serves as your advance notice of Direct Debit payments in accordance with the Direct Debit Guarantee.
          If you have any questions, please contact
          <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #999;">subscriptions@AlnmouthVillage.Golf</a>.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate consolidated family DD renewal email.
 * Shows each family member's annual charges, then one combined monthly payment schedule.
 */
export function generateConsolidatedDDRenewalEmail(
  consolidated: ConsolidatedDDSchedule
): string {
  const payerName = [consolidated.payer.title, consolidated.payer.first_name, consolidated.payer.surname]
    .filter(Boolean)
    .join(' ');

  const year = parseInt(consolidated.membershipYear.split('/')[0]);

  // Build per-member fee breakdown sections
  const memberSections = consolidated.familyMembers.map(fm => {
    const name = [fm.member.title, fm.member.first_name, fm.member.surname].filter(Boolean).join(' ');
    const rows: string[] = [];

    rows.push(`
      <tr>
        <td style="padding: 8px 12px; font-size: 14px; color: #333;">${escapeHtml(fm.member.category)} subscription</td>
        <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.annualSubscription)}</td>
      </tr>
    `);
    if (fm.schedule.lockerFee > 0) {
      rows.push(`
        <tr>
          <td style="padding: 8px 12px; font-size: 14px; color: #333;">Locker rental</td>
          <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.lockerFee)}</td>
        </tr>
      `);
    }
    if (fm.schedule.englandGolfFee > 0) {
      rows.push(`
        <tr>
          <td style="padding: 8px 12px; font-size: 14px; color: #333;">England Golf affiliation</td>
          <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.englandGolfFee)}</td>
        </tr>
      `);
    }
    if (fm.schedule.countyFee > 0) {
      rows.push(`
        <tr>
          <td style="padding: 8px 12px; font-size: 14px; color: #333;">Northumberland County fee</td>
          <td style="padding: 8px 12px; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.countyFee)}</td>
        </tr>
      `);
    }

    const memberTotal = fm.schedule.initialCollectionTotal + 11 * fm.schedule.monthlyPayment;

    return `
      <tr>
        <td colspan="2" style="padding: 10px 12px 4px 12px; font-size: 14px; font-weight: 600; color: #1e5631; border-top: 1px solid #e0e0e0;">
          ${escapeHtml(name)} (${escapeHtml(fm.member.category)})
        </td>
      </tr>
      ${rows.join('')}
      <tr style="background-color: #f8f9fa;">
        <td style="padding: 8px 12px; font-size: 14px; font-weight: 600; color: #333;">Subtotal</td>
        <td style="padding: 8px 12px; text-align: right; font-size: 14px; font-weight: 600; color: #333;">${formatCurrency(memberTotal)}</td>
      </tr>
    `;
  }).join('');

  // Build combined 12-month schedule
  const scheduleRows: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = (3 + i) % 12;
    const paymentYear = monthIndex < 3 ? year + 1 : year;
    const monthName = getMonthName(monthIndex);
    const isFirst = i === 0;
    const amount = isFirst ? consolidated.totalInitialCollection : consolidated.totalMonthlyPayment;
    const description = isFirst
      ? `${monthName} ${paymentYear} (initial collection)`
      : `${monthName} ${paymentYear}`;

    scheduleRows.push(`
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          ${description}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: center; font-size: 14px; color: #333;">
          1st ${monthName} ${paymentYear}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; font-weight: ${isFirst ? '600' : '400'}; color: #333;">
          ${formatCurrency(amount)}
        </td>
      </tr>
    `);
  }

  // Initial collection breakdown (combined)
  const initialBreakdownRows: string[] = [];
  for (const fm of consolidated.familyMembers) {
    const name = `${fm.member.first_name} ${fm.member.surname}`;
    if (fm.schedule.englandGolfFee > 0) {
      initialBreakdownRows.push(`
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">England Golf &mdash; ${escapeHtml(name)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.englandGolfFee)}</td>
        </tr>
      `);
    }
    if (fm.schedule.countyFee > 0) {
      initialBreakdownRows.push(`
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">County fee &mdash; ${escapeHtml(name)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.countyFee)}</td>
        </tr>
      `);
    }
    if (fm.schedule.lockerFee > 0) {
      initialBreakdownRows.push(`
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">Locker rental &mdash; ${escapeHtml(name)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.lockerFee)}</td>
        </tr>
      `);
    }
    initialBreakdownRows.push(`
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">Membership (${getMonthName(3)}) &mdash; ${escapeHtml(name)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">${formatCurrency(fm.schedule.firstMonthPayment)}</td>
      </tr>
    `);
  }

  const familyMemberNames = consolidated.familyMembers.map(fm =>
    `${fm.member.first_name} ${fm.member.surname}`
  ).join(', ');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Direct Debit Renewal Notice - ${consolidated.membershipYear}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #1e5631; padding: 30px; border-radius: 8px 8px 0 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                      Alnmouth Village Golf Club
                    </h1>
                    <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
                      Family Direct Debit Renewal Notice
                    </p>
                  </td>
                  <td align="right" style="color: #ffffff;">
                    <p style="margin: 0; font-size: 14px;">Membership Year</p>
                    <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600;">
                      ${consolidated.membershipYear}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 30px 0 30px;">
              <p style="margin: 0 0 15px 0; font-size: 16px; color: #333;">
                Dear ${escapeHtml(payerName)},
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                Thank you for your continued membership of Alnmouth Village Golf Club. This letter serves as your
                <strong>advance notice</strong> of the Direct Debit collections for the ${consolidated.membershipYear}
                membership year, covering the following family members: <strong>${escapeHtml(familyMemberNames)}</strong>.
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                All charges below will be collected from your Direct Debit as a single consolidated payment each month.
              </p>
            </td>
          </tr>

          <!-- Per-Member Fee Breakdown -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Annual Membership Fees
              </h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <tbody>
                  ${memberSections}
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td style="padding: 12px; font-size: 14px; font-weight: 600; color: #ffffff;">
                      Family total
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(consolidated.totalAnnual)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Initial Collection Breakdown -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Initial Payment &mdash; ${consolidated.collectionDate}
              </h3>
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                The first collection includes affiliation fees, locker rental, and the first monthly membership instalment for each family member:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <tbody>
                  ${initialBreakdownRows.join('')}
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td style="padding: 12px; font-size: 14px; font-weight: 600; color: #ffffff;">
                      Initial collection total
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(consolidated.totalInitialCollection)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Combined Payment Schedule -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Schedule of Payments
              </h3>
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                The combined family membership fees will be collected by Direct Debit in 12 monthly instalments
                on or around the 1st of each month:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8f9fa;">
                    <th style="padding: 12px; text-align: left; font-size: 13px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">Month</th>
                    <th style="padding: 12px; text-align: center; font-size: 13px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">Collection Date</th>
                    <th style="padding: 12px; text-align: right; font-size: 13px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${scheduleRows.join('')}
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td colspan="2" style="padding: 12px; font-size: 14px; font-weight: 600; color: #ffffff;">
                      Total for ${consolidated.membershipYear}
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(consolidated.totalAnnual)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Important Information -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Important Information
              </h3>
              <div style="background: #fff8e1; border-left: 4px solid #f9a825; padding: 15px; border-radius: 0 6px 6px 0; margin-bottom: 15px;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                  <strong>If you wish to cancel any membership</strong>, you must notify the club in writing
                  before 1st March ${year} to avoid being charged for the ${consolidated.membershipYear} membership year.
                  After this date, you will be liable for the full annual subscription.
                </p>
                <p style="margin: 0; font-size: 14px; color: #333; line-height: 1.6;">
                  If any of the details shown above are incorrect, or if you wish to discuss your membership,
                  please contact us at
                  <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #1e5631; font-weight: 600;">subscriptions@AlnmouthVillage.Golf</a>
                  or telephone 01665 830231.
                </p>
              </div>
            </td>
          </tr>

          <!-- Direct Debit Guarantee -->
          <tr>
            <td style="padding: 15px 30px 30px 30px;">
              <div style="border: 2px solid #1e5631; border-radius: 6px; overflow: hidden;">
                <div style="background-color: #1e5631; padding: 12px 15px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td>
                        <h3 style="margin: 0; color: #ffffff; font-size: 15px; font-weight: 600;">
                          The Direct Debit Guarantee
                        </h3>
                      </td>
                      <td align="right">
                        <img src="https://www.bacs.co.uk/media/wxojztsn/directdebitlogo.jpg" alt="Direct Debit Logo" width="100" style="display: block;" />
                      </td>
                    </tr>
                  </table>
                </div>
                <div style="padding: 15px; background-color: #ffffff;">
                  <ul style="margin: 0; padding: 0 0 0 20px; font-size: 13px; color: #333; line-height: 1.8;">
                    <li style="margin-bottom: 8px;">This Guarantee is offered by all banks and building societies that accept instructions to pay Direct Debits.</li>
                    <li style="margin-bottom: 8px;">If there are any changes to the amount, date, or frequency of your Direct Debit, Alnmouth Village Golf Club will notify you <strong>10 working days</strong> in advance of your account being debited or as otherwise agreed.</li>
                    <li style="margin-bottom: 8px;">If an error is made in the payment of your Direct Debit, by Alnmouth Village Golf Club or your bank or building society, you are entitled to a <strong>full and immediate refund</strong> of the amount paid from your bank or building society.</li>
                    <li style="margin-bottom: 8px;">If you receive a refund you are not entitled to, you must pay it back when Alnmouth Village Golf Club asks you to.</li>
                    <li>You can cancel a Direct Debit at any time by simply contacting your bank or building society. Written confirmation may be required. Please also notify us.</li>
                  </ul>
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; border-radius: 0 0 8px 8px; border-top: 1px solid #e0e0e0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 13px; color: #666; line-height: 1.6;">
                    <p style="margin: 0;"><strong>Alnmouth Village Golf Club</strong></p>
                    <p style="margin: 5px 0 0 0;">Marine Road, Alnmouth, Northumberland, NE66 2RZ</p>
                    <p style="margin: 5px 0 0 0;">Tel: 01665 830231 | Email: <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #1e5631;">subscriptions@AlnmouthVillage.Golf</a></p>
                    <p style="margin: 10px 0 0 0;"><a href="https://alnmouthvillage.golf" style="color: #1e5631;">www.AlnmouthVillage.Golf</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

        <p style="margin: 20px 0 0 0; font-size: 12px; color: #999; text-align: center; max-width: 600px; line-height: 1.5;">
          This email serves as your advance notice of Direct Debit payments in accordance with the Direct Debit Guarantee.
          If you have any questions, please contact
          <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #999;">subscriptions@AlnmouthVillage.Golf</a>.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate the email subject line
 */
export function generateDDRenewalSubject(year: number): string {
  return `AVGC ${year} Membership renewal`;
}
