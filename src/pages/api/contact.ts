import type { APIRoute } from 'astro';
import { sendEmail, isValidEmail } from '../../lib/email';

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const db = locals.runtime?.env?.DB;
  const env = locals.runtime?.env;

  if (!db) {
    return new Response(
      JSON.stringify({ success: false, error: 'Service unavailable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Parse form data
    const contentType = request.headers.get('content-type') || '';
    let name: string, email: string, phone: string, enquiry: string, message: string;

    if (contentType.includes('application/json')) {
      const body = await request.json();
      name = body.name?.trim();
      email = body.email?.trim();
      phone = body.phone?.trim() || '';
      enquiry = body.enquiry?.trim() || 'general';
      message = body.message?.trim();
    } else {
      const formData = await request.formData();
      name = formData.get('name')?.toString().trim() || '';
      email = formData.get('email')?.toString().trim() || '';
      phone = formData.get('phone')?.toString().trim() || '';
      enquiry = formData.get('enquiry')?.toString().trim() || 'general';
      message = formData.get('message')?.toString().trim() || '';
    }

    // Validate required fields
    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please fill in all required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!isValidEmail(email)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please enter a valid email address' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Simple spam protection: check message length
    if (message.length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a more detailed message' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (message.length > 5000) {
      return new Response(
        JSON.stringify({ success: false, error: 'Message is too long (max 5000 characters)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get user agent for spam tracking
    const userAgent = request.headers.get('user-agent') || '';

    // Store submission in database
    const result = await db.prepare(
      `INSERT INTO contact_submissions (name, email, phone, enquiry_type, message, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(name, email, phone, enquiry, message, clientAddress || '', userAgent).run();

    const submissionId = result.meta.last_row_id;

    // Format enquiry type for display
    const enquiryLabels: Record<string, string> = {
      general: 'General Enquiry',
      visitor: 'Visitor Booking',
      membership: 'Membership Enquiry',
      society: 'Society / Group Booking',
      function: 'Function / Event Enquiry',
      feedback: 'Feedback',
    };
    const enquiryLabel = enquiryLabels[enquiry] || enquiry;

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e5631; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .field { margin-bottom: 20px; }
    .label { font-weight: 600; color: #1e5631; margin-bottom: 5px; }
    .value { background: white; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0; }
    .message-box { background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0; white-space: pre-wrap; }
    .footer { margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 20px;">New Website Enquiry</h1>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">From</div>
        <div class="value">${escapeHtml(name)}</div>
      </div>
      <div class="field">
        <div class="label">Email</div>
        <div class="value"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></div>
      </div>
      ${phone ? `
      <div class="field">
        <div class="label">Phone</div>
        <div class="value"><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></div>
      </div>
      ` : ''}
      <div class="field">
        <div class="label">Enquiry Type</div>
        <div class="value">${escapeHtml(enquiryLabel)}</div>
      </div>
      <div class="field">
        <div class="label">Message</div>
        <div class="message-box">${escapeHtml(message)}</div>
      </div>
      <div class="footer">
        <p>Submission ID: #${submissionId}</p>
        <p>Submitted via website contact form</p>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    // Send email to club
    const emailResult = await sendEmail({
      to: 'Manager@AlnmouthVillage.Golf',
      subject: `Website Enquiry: ${enquiryLabel} from ${name}`,
      html: emailHtml,
    }, env);

    if (!emailResult.success) {
      console.error('Failed to send contact form email:', emailResult.error);
      // Still return success to user - we have the submission in the database
    }

    // Send confirmation email to the user
    const confirmationHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e5631; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .message-box { background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0; margin: 20px 0; white-space: pre-wrap; font-size: 14px; color: #555; }
    .footer { margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 20px;">Alnmouth Village Golf Club</h1>
    </div>
    <div class="content">
      <p>Dear ${escapeHtml(name)},</p>
      <p>Thank you for contacting Alnmouth Village Golf Club. We have received your enquiry and will respond as soon as possible.</p>
      <p><strong>Your message:</strong></p>
      <div class="message-box">${escapeHtml(message)}</div>
      <p>If your enquiry is urgent, please call us on <a href="tel:01665830370">01665 830370</a>.</p>
      <div class="footer">
        <p>Alnmouth Village Golf Club<br>
        Marine Road, Alnmouth, Northumberland NE66 2RZ<br>
        Tel: 01665 830370<br>
        Email: Manager@AlnmouthVillage.Golf</p>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    // Send confirmation to user (don't await or fail on this)
    sendEmail({
      to: email,
      subject: 'Thank you for contacting Alnmouth Village Golf Club',
      html: confirmationHtml,
    }, env).catch(err => {
      console.error('Failed to send confirmation email:', err);
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Thank you for your message. We will respond shortly.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Contact form error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred. Please try again or contact us directly.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Helper function to escape HTML
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
