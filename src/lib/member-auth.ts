// Member authentication via email/password

import { sendEmail } from './email';

// --- Password Hashing (PBKDF2, Cloudflare Workers compatible) ---

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 32;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_LENGTH * 8
  );
  return `${toHex(salt.buffer)}:${toHex(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_LENGTH * 8
  );
  return toHex(hash) === hashHex;
}

// --- Token Generation ---

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function generateSessionToken(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// --- Types ---

export interface AuthResult {
  success: boolean;
  error?: string;
  sessionToken?: string;
  memberId?: number;
}

// --- Login ---

export async function authenticateWithPassword(
  email: string,
  password: string,
  db: D1Database
): Promise<AuthResult> {
  const member = await db.prepare(
    `SELECT id, password_hash FROM members WHERE LOWER(email) = LOWER(?)`
  ).bind(email).first<{ id: number; password_hash: string | null }>();

  if (!member || !member.password_hash) {
    return { success: false, error: 'Invalid email or password.' };
  }

  const valid = await verifyPassword(password, member.password_hash);
  if (!valid) {
    return { success: false, error: 'Invalid email or password.' };
  }

  // Create session
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await db.prepare(
    `INSERT INTO member_sessions (member_id, session_token, expires_at, last_used)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(member.id, sessionToken, expiresAt.toISOString()).run();

  return { success: true, sessionToken, memberId: member.id };
}

// --- Registration ---

export async function requestRegistration(
  email: string,
  password: string,
  db: D1Database,
  env: {
    AZURE_TENANT_ID?: string;
    AZURE_CLIENT_ID?: string;
    AZURE_CLIENT_SECRET?: string;
    AZURE_SERVICE_USER?: string;
    AZURE_SERVICE_PASSWORD?: string;
  },
  baseUrl: string
): Promise<AuthResult> {
  const member = await db.prepare(
    `SELECT id, first_name, surname, email, password_hash FROM members WHERE LOWER(email) = LOWER(?)`
  ).bind(email).first<{ id: number; first_name: string; surname: string; email: string; password_hash: string | null }>();

  if (!member) {
    return { success: false, error: 'No membership found for this email address. Please contact the club if you believe this is an error.' };
  }

  if (member.password_hash) {
    return { success: false, error: 'This email is already registered. Try logging in instead.' };
  }

  // Check for recent registration token (60-second rate limit)
  const recent = await db.prepare(
    `SELECT id FROM member_registration_tokens
     WHERE member_id = ? AND created_at > datetime('now', '-60 seconds') AND used = 0`
  ).bind(member.id).first();

  if (recent) {
    return { success: true }; // Already sent recently
  }

  // Hash password and store with token
  const passwordHash = await hashPassword(password);
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await db.prepare(
    `INSERT INTO member_registration_tokens (member_id, token, password_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  ).bind(member.id, token, passwordHash, expiresAt.toISOString()).run();

  // Send verification email
  const verifyLink = `${baseUrl}/members/verify/${token}`;

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
      <p>Please click the button below to verify your email and complete your account registration:</p>
      <p style="text-align: center;">
        <a href="${verifyLink}" class="button">Verify Email &amp; Complete Registration</a>
      </p>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #1e5631;">${verifyLink}</p>
      <p>This link will expire in 15 minutes.</p>
      <div class="footer">
        <p>If you didn't request this, you can safely ignore this email.</p>
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
    subject: 'Verify your Alnmouth Village Golf Club account',
    html: emailHtml
  }, env);

  if (!emailResult.success) {
    console.error('Failed to send registration email:', emailResult.error);
  }

  return { success: true };
}

export async function verifyRegistration(
  token: string,
  db: D1Database
): Promise<AuthResult> {
  const regToken = await db.prepare(
    `SELECT rt.*, m.first_name, m.surname
     FROM member_registration_tokens rt
     JOIN members m ON rt.member_id = m.id
     WHERE rt.token = ? AND rt.used = 0 AND rt.expires_at > datetime('now')`
  ).bind(token).first<{
    id: number;
    member_id: number;
    password_hash: string;
    first_name: string;
    surname: string;
  }>();

  if (!regToken) {
    return { success: false, error: 'Invalid or expired verification link. Please register again.' };
  }

  // Mark token as used
  await db.prepare(
    `UPDATE member_registration_tokens SET used = 1 WHERE id = ?`
  ).bind(regToken.id).run();

  // Set the password on the member
  await db.prepare(
    `UPDATE members SET password_hash = ? WHERE id = ?`
  ).bind(regToken.password_hash, regToken.member_id).run();

  // Create session
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await db.prepare(
    `INSERT INTO member_sessions (member_id, session_token, expires_at, last_used)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(regToken.member_id, sessionToken, expiresAt.toISOString()).run();

  return { success: true, sessionToken, memberId: regToken.member_id };
}

// --- Password Reset ---

export async function requestPasswordReset(
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
): Promise<AuthResult> {
  const member = await db.prepare(
    `SELECT id, first_name, surname, email FROM members WHERE LOWER(email) = LOWER(?)`
  ).bind(email).first<{ id: number; first_name: string; surname: string; email: string }>();

  if (!member) {
    // Don't reveal whether email exists
    return { success: true };
  }

  // Rate limit (60 seconds)
  const recent = await db.prepare(
    `SELECT id FROM member_password_resets
     WHERE member_id = ? AND created_at > datetime('now', '-60 seconds') AND used = 0`
  ).bind(member.id).first();

  if (recent) {
    return { success: true };
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.prepare(
    `INSERT INTO member_password_resets (member_id, token, expires_at)
     VALUES (?, ?, ?)`
  ).bind(member.id, token, expiresAt.toISOString()).run();

  const resetLink = `${baseUrl}/members/reset-password/${token}`;

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
      <p>We received a request to reset your password. Click the button below to set a new password:</p>
      <p style="text-align: center;">
        <a href="${resetLink}" class="button">Reset Password</a>
      </p>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #1e5631;">${resetLink}</p>
      <p>This link will expire in 15 minutes.</p>
      <div class="footer">
        <p>If you didn't request this, you can safely ignore this email. Your password will not change.</p>
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
    subject: 'Reset your Alnmouth Village Golf Club password',
    html: emailHtml
  }, env);

  if (!emailResult.success) {
    console.error('Failed to send password reset email:', emailResult.error);
  }

  return { success: true };
}

export async function resetPassword(
  token: string,
  newPassword: string,
  db: D1Database
): Promise<AuthResult> {
  const resetToken = await db.prepare(
    `SELECT pr.*, m.first_name
     FROM member_password_resets pr
     JOIN members m ON pr.member_id = m.id
     WHERE pr.token = ? AND pr.used = 0 AND pr.expires_at > datetime('now')`
  ).bind(token).first<{ id: number; member_id: number; first_name: string }>();

  if (!resetToken) {
    return { success: false, error: 'Invalid or expired reset link. Please request a new one.' };
  }

  // Mark token as used
  await db.prepare(
    `UPDATE member_password_resets SET used = 1 WHERE id = ?`
  ).bind(resetToken.id).run();

  // Update password
  const passwordHash = await hashPassword(newPassword);
  await db.prepare(
    `UPDATE members SET password_hash = ? WHERE id = ?`
  ).bind(passwordHash, resetToken.member_id).run();

  return { success: true };
}

// --- Change Password (for logged-in members) ---

export async function changePassword(
  memberId: number,
  currentPassword: string,
  newPassword: string,
  db: D1Database
): Promise<AuthResult> {
  const member = await db.prepare(
    `SELECT password_hash FROM members WHERE id = ?`
  ).bind(memberId).first<{ password_hash: string | null }>();

  if (!member || !member.password_hash) {
    return { success: false, error: 'Account not found.' };
  }

  const valid = await verifyPassword(currentPassword, member.password_hash);
  if (!valid) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  const passwordHash = await hashPassword(newPassword);
  await db.prepare(
    `UPDATE members SET password_hash = ? WHERE id = ?`
  ).bind(passwordHash, memberId).run();

  return { success: true };
}

// --- Session Management (unchanged) ---

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

export async function invalidateSession(
  sessionToken: string,
  db: D1Database
): Promise<void> {
  await db.prepare(
    `DELETE FROM member_sessions WHERE session_token = ?`
  ).bind(sessionToken).run();
}

export async function cleanupExpiredTokens(db: D1Database): Promise<void> {
  await db.prepare(
    `DELETE FROM member_login_tokens WHERE expires_at < datetime('now')`
  ).run();
  await db.prepare(
    `DELETE FROM member_registration_tokens WHERE expires_at < datetime('now')`
  ).run();
  await db.prepare(
    `DELETE FROM member_password_resets WHERE expires_at < datetime('now')`
  ).run();
  await db.prepare(
    `DELETE FROM member_sessions WHERE expires_at < datetime('now')`
  ).run();
}
