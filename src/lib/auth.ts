// Simple auth utilities for the CRM
// In production, consider using Cloudflare Access for M365 SSO

const SESSION_COOKIE = 'avgc_session';
const SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 hours

export interface Session {
  email: string;
  name: string;
  role: string;
  expires: number;
}

// Simple hash function for demo purposes
// In production, use bcrypt or Argon2
export function hashPassword(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function createSessionToken(session: Session): string {
  const data = JSON.stringify(session);
  return btoa(data);
}

export function parseSessionToken(token: string): Session | null {
  try {
    const data = atob(token);
    const session = JSON.parse(data) as Session;
    if (session.expires < Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function getSessionCookie(request: Request): Session | null {
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  return parseSessionToken(match[1]);
}

export function createSessionCookieHeader(session: Session): string {
  const token = createSessionToken(session);
  const expires = new Date(session.expires).toUTCString();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${expires}`;
}

export function createLogoutCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function createSession(email: string, name: string, role: string): Session {
  return {
    email,
    name,
    role,
    expires: Date.now() + SESSION_DURATION
  };
}
