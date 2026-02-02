// Member authentication via magic links

import { sendEmail } from './email';

// Generate a secure random token
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a session token
function generateSessionToken(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

export interface MemberAuthResult {
  success: boolean;
  error?: string;
  memberId?: number;
  memberName?: string;
}

/**
 * Request a magic link for a member
 */
export async function requestMagicLink(
  email: string,
  db: D1Database,
  env: {
    AZURE_TENANT_ID?: string;
    AZURE_CLIENT_ID?: string;
    AZURE_CLIENT_SECRET?: string;
    AZURE_SERVICE_USER?: string;
    AZURE_SERVICE_PASSWORD?: string;
  },
  baseUrl: string
): Promise<MemberAuthResult> {
  // Find member by email
  const member = await db.prepare(
    `SELECT id, first_name, surname, email FROM members WHERE LOWER(email) = LOWER(?)`
  ).bind(email).first<{ id: number; first_name: string; surname: string; email: string }>();

  if (!member) {
    // Don't reveal whether email exists for security
    return { success: true };
  }

  // Check if a token was recently created (within last 60 seconds) to prevent duplicates
  const recentToken = await db.prepare(
    `SELECT id FROM member_login_tokens
     WHERE member_id = ? AND created_at > datetime('now', '-60 seconds') AND used = 0`
  ).bind(member.id).first();

  if (recentToken) {
    // Token already sent recently, don't send again
    return { success: true };
  }

  // Generate token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store token
  await db.prepare(
    `INSERT INTO member_login_tokens (member_id, token, expires_at)
     VALUES (?, ?, ?)`
  ).bind(member.id, token, expiresAt.toISOString()).run();

  // Build login link
  const loginLink = `${baseUrl}/members/verify/${token}`;

  // Send email
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
    .button { display: inline-block; background: #1e5631; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Alnmouth Village Golf Club</h1>
    </div>
    <div class="content">
      <p>Hi ${member.first_name},</p>
      <p>Click the button below to access the members area:</p>
      <p style="text-align: center;">
        <a href="${loginLink}" class="button">Sign In to Members Area</a>
      </p>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #1e5631;">${loginLink}</p>
      <p>This link will expire in 15 minutes.</p>
      <div class="footer">
        <p>If you didn't request this email, you can safely ignore it.</p>
        <p>Alnmouth Village Golf Club<br>
        Marine Road, Alnmouth, Northumberland NE66 2RZ</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const emailResult = await sendEmail({
    to: member.email,
    subject: 'Your Alnmouth Village Golf Club Login Link',
    html: emailHtml
    // Uses default from address (subscriptions@AlnmouthVillage.Golf)
  }, env);

  if (!emailResult.success) {
    console.error('Failed to send magic link email:', emailResult.error);
    // Still return success to not reveal email existence
  }

  return {
    success: true,
    memberId: member.id,
    memberName: `${member.first_name} ${member.surname}`
  };
}

/**
 * Verify a magic link token and create a session
 */
export async function verifyMagicLink(
  token: string,
  db: D1Database
): Promise<{ success: boolean; sessionToken?: string; memberId?: number; error?: string }> {
  // Find and validate token
  const loginToken = await db.prepare(
    `SELECT lt.*, m.first_name, m.surname
     FROM member_login_tokens lt
     JOIN members m ON lt.member_id = m.id
     WHERE lt.token = ? AND lt.used = 0 AND lt.expires_at > datetime('now')`
  ).bind(token).first<{
    id: number;
    member_id: number;
    first_name: string;
    surname: string;
  }>();

  if (!loginToken) {
    return { success: false, error: 'Invalid or expired link. Please request a new one.' };
  }

  // Mark token as used
  await db.prepare(
    `UPDATE member_login_tokens SET used = 1 WHERE id = ?`
  ).bind(loginToken.id).run();

  // Create session (1 year expiry)
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await db.prepare(
    `INSERT INTO member_sessions (member_id, session_token, expires_at, last_used)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(loginToken.member_id, sessionToken, expiresAt.toISOString()).run();

  return {
    success: true,
    sessionToken,
    memberId: loginToken.member_id
  };
}

/**
 * Validate and refresh a session
 */
export async function validateSession(
  sessionToken: string,
  db: D1Database
): Promise<{
  valid: boolean;
  member?: {
    id: number;
    firstName: string;
    surname: string;
    email: string;
  }
}> {
  const session = await db.prepare(
    `SELECT ms.*, m.id as member_id, m.first_name, m.surname, m.email
     FROM member_sessions ms
     JOIN members m ON ms.member_id = m.id
     WHERE ms.session_token = ? AND ms.expires_at > datetime('now')`
  ).bind(sessionToken).first<{
    member_id: number;
    first_name: string;
    surname: string;
    email: string;
  }>();

  if (!session) {
    return { valid: false };
  }

  // Update last_used
  await db.prepare(
    `UPDATE member_sessions SET last_used = datetime('now') WHERE session_token = ?`
  ).bind(sessionToken).run();

  return {
    valid: true,
    member: {
      id: session.member_id,
      firstName: session.first_name,
      surname: session.surname,
      email: session.email
    }
  };
}

/**
 * Invalidate a session (logout)
 */
export async function invalidateSession(
  sessionToken: string,
  db: D1Database
): Promise<void> {
  await db.prepare(
    `DELETE FROM member_sessions WHERE session_token = ?`
  ).bind(sessionToken).run();
}

/**
 * Clean up expired tokens and sessions (should be run periodically)
 */
export async function cleanupExpiredTokens(db: D1Database): Promise<void> {
  // Delete expired login tokens
  await db.prepare(
    `DELETE FROM member_login_tokens WHERE expires_at < datetime('now')`
  ).run();

  // Delete expired sessions
  await db.prepare(
    `DELETE FROM member_sessions WHERE expires_at < datetime('now')`
  ).run();
}
