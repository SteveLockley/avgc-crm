// Encryption for secrets held in D1 (online account credentials).
//
// AES-256-GCM under a key held only as a Cloudflare secret (ACCOUNTS_VAULT_KEY,
// 32 random bytes base64-encoded). A database backup on its own is therefore
// useless to an attacker; they would need the Pages secret as well. Each value
// gets a fresh random IV, so identical passwords do not produce identical
// ciphertext.
//
// Stored form: "v1:<base64 iv>:<base64 ciphertext+tag>"
//
// Generate a key with:  openssl rand -base64 32
// Set it with:          printf '%s' KEY | npx wrangler pages secret put ACCOUNTS_VAULT_KEY --project-name alnmouth-golf-crm

const VERSION = 'v1';

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: { raw: string; key: CryptoKey } | null = null;

async function importKey(rawB64: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.raw === rawB64) return cachedKey.key;
  const bytes = b64decode(rawB64.trim());
  if (bytes.length !== 32) {
    throw new Error(`ACCOUNTS_VAULT_KEY must decode to 32 bytes (got ${bytes.length})`);
  }
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  cachedKey = { raw: rawB64, key };
  return key;
}

export function isVaultConfigured(env: { ACCOUNTS_VAULT_KEY?: string } | undefined): boolean {
  return !!env?.ACCOUNTS_VAULT_KEY;
}

export async function encryptSecret(env: { ACCOUNTS_VAULT_KEY?: string }, plaintext: string): Promise<string> {
  if (!env.ACCOUNTS_VAULT_KEY) throw new Error('VAULT_NOT_CONFIGURED');
  const key = await importKey(env.ACCOUNTS_VAULT_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${VERSION}:${b64encode(iv)}:${b64encode(new Uint8Array(ct))}`;
}

export async function decryptSecret(env: { ACCOUNTS_VAULT_KEY?: string }, stored: string): Promise<string> {
  if (!env.ACCOUNTS_VAULT_KEY) throw new Error('VAULT_NOT_CONFIGURED');
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error('Unrecognised ciphertext format');
  const key = await importKey(env.ACCOUNTS_VAULT_KEY);
  const iv = b64decode(parts[1]);
  const ct = b64decode(parts[2]);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    // A wrong key or tampered value both surface here; say which is likelier.
    throw new Error('Could not decrypt — the vault key has changed since this value was stored');
  }
}
