// Cloudflare Access JWT verification.
//
// Access puts a signed JWT on every authenticated request (the
// Cf-Access-Jwt-Assertion header, and the CF_Authorization cookie). Decoding it
// without checking the signature proves nothing — anyone can craft a token with
// any email in it. This verifies the signature against the team's public keys
// and checks the audience, issuer and expiry before the identity is trusted.

export interface AccessIdentity {
  email: string;
  sub?: string;
}

// Defaults for this club's Access setup; override with env vars if it changes.
export const DEFAULT_TEAM_DOMAIN = 'membership-crm.cloudflareaccess.com';
export const DEFAULT_AUD = 'd219ff524cac76b4a91f4a82e60eb33b0e26d373c95222d30a40607fb50d9b5d';

interface CachedKeys {
  keys: Record<string, CryptoKey>;
  fetchedAt: number;
}

const KEY_TTL_MS = 60 * 60 * 1000;
let cache: { teamDomain: string; value: CachedKeys } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

async function getKeys(teamDomain: string): Promise<Record<string, CryptoKey>> {
  if (cache && cache.teamDomain === teamDomain && Date.now() - cache.value.fetchedAt < KEY_TTL_MS) {
    return cache.value.keys;
  }

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const data = await res.json() as { keys?: Array<{ kid: string; kty: string; n: string; e: string }> };

  const keys: Record<string, CryptoKey> = {};
  for (const jwk of data.keys || []) {
    if (jwk.kty !== 'RSA') continue;
    keys[jwk.kid] = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  }

  cache = { teamDomain, value: { keys, fetchedAt: Date.now() } };
  return keys;
}

/**
 * Verify an Access token. Returns the identity, or null if the token is
 * missing, malformed, unsigned by this team, for another application, or
 * expired. Never throws — a failure is simply "not authenticated".
 */
export async function verifyAccessJwt(
  token: string | null | undefined,
  opts: { teamDomain?: string; aud?: string } = {},
): Promise<AccessIdentity | null> {
  if (!token) return null;

  const teamDomain = opts.teamDomain || DEFAULT_TEAM_DOMAIN;
  const aud = opts.aud || DEFAULT_AUD;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    const header = b64urlToJson<{ alg: string; kid: string }>(headerB64);
    if (header.alg !== 'RS256' || !header.kid) return null;

    const keys = await getKeys(teamDomain);
    const key = keys[header.kid];
    if (!key) return null;   // signed by a key this team does not publish

    const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, b64urlToBytes(sigB64), signed,
    );
    if (!ok) return null;

    const payload = b64urlToJson<{
      aud?: string | string[]; iss?: string; exp?: number; nbf?: number;
      email?: string; sub?: string;
    }>(payloadB64);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 60) return null;
    if (payload.iss && payload.iss !== `https://${teamDomain}`) return null;

    const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!audiences.includes(aud)) return null;   // token for a different Access app

    if (!payload.email) return null;
    return { email: payload.email, sub: payload.sub };
  } catch {
    return null;
  }
}
