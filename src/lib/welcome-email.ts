// HTML email template for new member welcome/introduction email
// Sent after a new member pays their first invoice

interface WelcomeMember {
  first_name: string;
  surname: string;
  pin: string;
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

export function generateWelcomeEmailSubject(): string {
  return 'Welcome to Alnmouth Village Golf Club';
}

export function generateWelcomeEmail(member: WelcomeMember): string {
  const pin = String(parseInt(member.pin, 10) || 0).padStart(4, '0');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #1e5631; padding: 30px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">
                Alnmouth Village Golf Club
              </h1>
              <p style="margin: 8px 0 0 0; color: #a8d5ba; font-size: 14px;">
                Welcome to the Club
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #333; line-height: 1.6;">
                Dear ${escapeHtml(member.first_name)},
              </p>

              <p style="margin: 0 0 20px 0; font-size: 15px; color: #333; line-height: 1.6;">
                Thank you for your membership with us. We hope you enjoy your time at Alnmouth Village Golf Club.
              </p>

              <!-- BRS Section -->
              <div style="background-color: #f8f9fa; border-left: 4px solid #1e5631; padding: 20px; margin: 25px 0; border-radius: 0 4px 4px 0;">
                <h2 style="margin: 0 0 12px 0; font-size: 17px; color: #1e5631;">
                  Online Tee Time Booking (BRS)
                </h2>
                <p style="margin: 0 0 12px 0; font-size: 14px; color: #333; line-height: 1.6;">
                  We use an online booking system called <strong>BRS</strong> here at AVGC. This allows members the flexibility and convenience to book tee times from home.
                </p>
                <p style="margin: 0 0 12px 0; font-size: 14px; color: #333; line-height: 1.6;">
                  To get started, you must register using the link below with the following username:
                </p>
                <p style="margin: 0 0 16px 0; text-align: center;">
                  <span style="display: inline-block; background-color: #1e5631; color: #ffffff; padding: 8px 20px; border-radius: 4px; font-size: 18px; font-weight: 700; letter-spacing: 2px;">
                    ${escapeHtml(pin)}
                  </span>
                </p>
                <p style="margin: 0; text-align: center;">
                  <a href="https://brsgolf.com/alnmouthvillage/members_home.php"
                     style="display: inline-block; background-color: #1e5631; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: 600;">
                    Register with BRS
                  </a>
                </p>
              </div>

              <!-- 9/18 Hole Tip -->
              <div style="background-color: #fff8e1; border-left: 4px solid #f9a825; padding: 15px 20px; margin: 25px 0; border-radius: 0 4px 4px 0;">
                <p style="margin: 0; font-size: 14px; color: #333; line-height: 1.6;">
                  <strong>Tip:</strong> As we are a 9 hole course, if you book to play 18 holes your second 9 will be automatically booked for you 1 hr 44 min after your initial tee off time. The default is 18 holes &mdash; you will need to change the booking to 9 holes if that&rsquo;s all you want to play.
                </p>
              </div>

              <!-- Website Section -->
              <div style="background-color: #f8f9fa; border-left: 4px solid #1e5631; padding: 20px; margin: 25px 0; border-radius: 0 4px 4px 0;">
                <h2 style="margin: 0 0 12px 0; font-size: 17px; color: #1e5631;">
                  Club Website &amp; Member Portal
                </h2>
                <p style="margin: 0 0 12px 0; font-size: 14px; color: #333; line-height: 1.6;">
                  Visit our website for club news, competition results, opening hours and more. The member portal gives you access to your account, documents and online payments.
                </p>
                <p style="margin: 0; text-align: center;">
                  <a href="https://www.alnmouthvillage.golf"
                     style="display: inline-block; background-color: #1e5631; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: 600;">
                    Visit Website
                  </a>
                </p>
              </div>

              <p style="margin: 25px 0 20px 0; font-size: 15px; color: #333; line-height: 1.6;">
                If you have any questions please don&rsquo;t hesitate to contact us at any time.
              </p>

              <p style="margin: 0; font-size: 15px; color: #333; line-height: 1.8;">
                Kind Regards,<br>
                <strong>Ian Simpson</strong><br>
                Secretary<br>
                Alnmouth Village Golf Club
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f4; padding: 20px 40px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="margin: 0; font-size: 12px; color: #999; line-height: 1.6;">
                Alnmouth Village Golf Club, Foxton Hall, Alnmouth, Northumberland NE66 3BE<br>
                <a href="https://www.alnmouthvillage.golf" style="color: #1e5631; text-decoration: none;">www.alnmouthvillage.golf</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
