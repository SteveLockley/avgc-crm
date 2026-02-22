// HTML email template for Social membership renewal notifications
// Social members are non-playing, clubhouse/bar access only, NE65/NE66 postcodes

interface SocialRenewalMember {
  title?: string;
  first_name: string;
  surname: string;
  club_number?: string;
  email?: string;
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

export function generateSocialRenewalSubject(year: number): string {
  return `AVGC ${year} Social Membership Renewal`;
}

export function generateSocialRenewalEmail(
  member: SocialRenewalMember,
  fee: number,
  year: number,
  bankDetails: BankDetails
): string {
  const memberName = [member.title, member.first_name, member.surname]
    .filter(Boolean)
    .join(' ');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AVGC ${year} Social Membership Renewal</title>
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
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                Alnmouth Village Golf Club
              </h1>
              <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
                Social Membership Renewal ${year}/${year + 1}
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 30px 0 30px;">
              <p style="margin: 0 0 15px 0; font-size: 16px; color: #333;">
                Dear ${escapeHtml(memberName)},
              </p>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                Thank you for your continued Social membership of Alnmouth Village Golf Club. Your
                membership is due for renewal on <strong>1st April ${year}</strong> for the
                ${year}/${year + 1} membership year.
              </p>
            </td>
          </tr>

          <!-- Fee -->
          <tr>
            <td style="padding: 15px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <tbody>
                  <tr style="background-color: #ffffff;">
                    <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
                      Social membership subscription
                    </td>
                    <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px; color: #333;">
                      ${formatCurrency(fee)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td style="padding: 12px; font-size: 14px; font-weight: 600; color: #ffffff;">
                      Total amount due
                    </td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(fee)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Social Membership Terms -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 10px 0; color: #1e5631; font-size: 16px;">
                Your Social Membership
              </h3>
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                As a Social member, you enjoy the following benefits:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 4px 0; font-size: 14px; color: #333; vertical-align: top; width: 25px;">&#8226;</td>
                  <td style="padding: 4px 0; font-size: 14px; color: #333; line-height: 1.5;">
                    Access to the clubhouse and bar facilities
                  </td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; font-size: 14px; color: #333; vertical-align: top;">&#8226;</td>
                  <td style="padding: 4px 0; font-size: 14px; color: #333; line-height: 1.5;">
                    Participation in social events and functions
                  </td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; font-size: 14px; color: #333; vertical-align: top;">&#8226;</td>
                  <td style="padding: 4px 0; font-size: 14px; color: #333; line-height: 1.5;">
                    Member pricing at the bar
                  </td>
                </tr>
              </table>
              <p style="margin: 10px 0 0 0; font-size: 13px; color: #666; line-height: 1.5;">
                Social membership is a non-playing membership available to residents of the NE65 and NE66 postcode areas.
                Social members do not have playing rights on the course.
              </p>
            </td>
          </tr>

          <!-- Payment Instructions -->
          <tr>
            <td style="padding: 15px 30px;">
              <h3 style="margin: 0 0 15px 0; color: #1e5631; font-size: 16px;">
                How to Pay
              </h3>
              <p style="margin: 0 0 15px 0; font-size: 14px; color: #333; line-height: 1.6;">
                Payment is due by <strong>1st April ${year}</strong>. You can pay by either of the following methods:
              </p>

              <!-- Pay at Clubhouse -->
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

          <!-- Closing -->
          <tr>
            <td style="padding: 15px 30px 30px 30px;">
              <div style="border-top: 1px solid #e0e0e0; padding-top: 20px;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #333; line-height: 1.6;">
                  We look forward to seeing you in the clubhouse throughout the coming season.
                  If you have any questions, please do not hesitate to contact us.
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
          This email was sent to you as a Social member of Alnmouth Village Golf Club regarding your membership renewal.
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
