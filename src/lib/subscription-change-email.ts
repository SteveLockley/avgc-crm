// HTML email template for subscription change notifications
// Sent when a member's subscription category changes (e.g. Full → Senior Loyalty)

interface SubscriptionChangeMember {
  title?: string;
  first_name: string;
  surname: string;
  club_number?: string;
  category: string; // NEW category
  email?: string;
  locker_number?: string;
  national_id?: string;
  home_away?: string;
  handicap_index?: number | null;
  default_payment_method?: string;
}

interface BankDetails {
  bank_name: string;
  sort_code: string;
  account_number: string;
  account_name: string;
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
  return '&pound;' + amount.toFixed(2);
}

export function generateSubscriptionChangeSubject(year: number): string {
  return `AVGC ${year} Subscription Change Notification`;
}

export function generateSubscriptionChangeEmail(
  member: SubscriptionChangeMember,
  oldCategory: string,
  newCategory: string,
  subscriptionFee: number,
  year: number,
  bankDetails: BankDetails
): string {
  const memberName = [member.title, member.first_name, member.surname]
    .filter(Boolean)
    .join(' ');

  const isHome = member.home_away === 'H';
  const hasCDH = !!member.national_id && member.national_id.trim() !== '';
  const isOutOfCounty = member.category.toLowerCase().includes('out of county');
  const hasHomeHandicap = member.handicap_index !== null && member.handicap_index !== undefined;
  const hasLocker = !!member.locker_number && member.locker_number.trim() !== '';
  const isDD = member.default_payment_method === 'Clubwise Direct Debit';

  let englandGolfFee = 0;
  let countyFee = 0;
  if (hasCDH) {
    if (isHome && !isOutOfCounty) {
      englandGolfFee = 12.0;
      countyFee = 6.5;
    } else if (isOutOfCounty && hasHomeHandicap) {
      englandGolfFee = 12.0;
    }
  }

  const lockerFee = hasLocker ? 10.0 : 0;
  const totalAmount = subscriptionFee + englandGolfFee + countyFee + lockerFee;

  // Build fee breakdown rows
  const feeRows: string[] = [];
  feeRows.push(`
    <tr style="background-color: #ffffff;">
      <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
        ${escapeHtml(newCategory)} subscription
      </td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
        ${formatCurrency(subscriptionFee)}
      </td>
    </tr>
  `);
  if (englandGolfFee > 0) {
    feeRows.push(`
      <tr style="background-color: #f8f9fa;">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          England Golf Affiliation Fee
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
          ${formatCurrency(englandGolfFee)}
        </td>
      </tr>
    `);
  }
  if (countyFee > 0) {
    feeRows.push(`
      <tr style="background-color: ${englandGolfFee > 0 ? '#ffffff' : '#f8f9fa'};">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          Northumberland County Fee
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
          ${formatCurrency(countyFee)}
        </td>
      </tr>
    `);
  }
  if (lockerFee > 0) {
    feeRows.push(`
      <tr style="background-color: #f8f9fa;">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
          Locker Rental
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
          ${formatCurrency(lockerFee)}
        </td>
      </tr>
    `);
  }

  // Payment section depends on payment method
  const paymentSection = isDD ? `
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                As you pay by <strong>Direct Debit</strong>, your monthly payments will be adjusted to reflect
                the new subscription amount. No action is required on your part.
              </p>
  ` : `
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                If you have already paid for the current membership year, any difference will be adjusted on your account.
                If you have not yet paid, please use the details below:
              </p>

              <!-- Bank Transfer -->
              <div style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; margin-bottom: 15px;">
                <div style="background: #f8f9fa; padding: 10px 15px; border-bottom: 1px solid #e0e0e0;">
                  <strong style="font-size: 14px; color: #333;">Bank Transfer (BACS)</strong>
                </div>
                <div style="padding: 15px;">
                  <table role="presentation" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Bank:</td>
                      <td style="padding: 4px 0; font-size: 14px; color: #333;">${escapeHtml(bankDetails.bank_name)}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Account Name:</td>
                      <td style="padding: 4px 0; font-size: 14px; color: #333;">${escapeHtml(bankDetails.account_name)}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Sort Code:</td>
                      <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #333;">${escapeHtml(bankDetails.sort_code)}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Account No:</td>
                      <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #333;">${escapeHtml(bankDetails.account_number)}</td>
                    </tr>
                  </table>
                  <p style="margin: 10px 0 0 0; font-size: 13px; color: #666; line-height: 1.5;">
                    Please use your <strong>membership number</strong> or <strong>surname</strong> as the payment reference.
                  </p>
                </div>
              </div>

              <!-- Over the Till -->
              <div style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; margin-bottom: 15px;">
                <div style="background: #f8f9fa; padding: 10px 15px; border-bottom: 1px solid #e0e0e0;">
                  <strong style="font-size: 14px; color: #333;">Pay at the Clubhouse</strong>
                </div>
                <div style="padding: 15px;">
                  <p style="margin: 0; font-size: 14px; color: #333; line-height: 1.6;">
                    You can pay over the till at the clubhouse during normal opening hours.
                    Cash and card payments are accepted.
                  </p>
                </div>
              </div>
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AVGC ${year} Subscription Change</title>
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
                      Subscription Change Notification
                    </p>
                  </td>
                  <td align="right" style="color: #ffffff;">
                    <p style="margin: 0; font-size: 14px;">Membership Year</p>
                    <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600;">
                      ${year}/${year + 1}
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
                Dear ${escapeHtml(memberName)},
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                We are writing to let you know that your membership category has been updated
                for the ${year}/${year + 1} membership year.
              </p>
            </td>
          </tr>

          <!-- Change Notice -->
          <tr>
            <td style="padding: 15px 30px;">
              <div style="background: #fff3e0; border-left: 4px solid #f57c00; padding: 16px 20px; border-radius: 0 8px 8px 0;">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Previous category:</td>
                    <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #c62828;">${escapeHtml(oldCategory)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">New category:</td>
                    <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #2e7d32;">${escapeHtml(newCategory)}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Member Details -->
          <tr>
            <td style="padding: 15px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f8f9fa; border-radius: 6px;">
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
                        <td style="padding: 4px 0; font-size: 14px; color: #333;">${escapeHtml(newCategory)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 20px 4px 0; font-size: 14px; color: #666;">Period:</td>
                        <td style="padding: 4px 0; font-size: 14px; color: #333;">1st April ${year} &ndash; 31st March ${year + 1}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Fee Breakdown -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Your Updated Fees
              </h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <tbody>
                  ${feeRows.join('')}
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td style="padding: 12px; font-size: 14px; font-weight: 600; color: #ffffff;">
                      Total amount due
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Payment Instructions -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                Payment
              </h3>
              ${paymentSection}
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td style="padding: 15px 30px 30px 30px;">
              <div style="border-top: 1px solid #e0e0e0; padding-top: 20px;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                  If you have any questions about this change or your membership,
                  please do not hesitate to contact us.
                </p>
                <p style="margin: 0; font-size: 14px; color: #333;">
                  Kind regards,<br>
                  <strong>The Committee and Management</strong><br>
                  Alnmouth Village Golf Club
                </p>
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
          This email was sent to you as a member of Alnmouth Village Golf Club regarding a change to your membership.
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
