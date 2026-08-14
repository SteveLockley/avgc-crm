// Microsoft Graph client for reading and writing Microsoft 365 group membership.
//
// Uses the same client-credentials app registration as email sending. The app
// needs GroupMember.Read.All to read membership and GroupMember.ReadWrite.All
// to add or remove members (both application permissions, admin consented).

export interface GraphEnv {
  AZURE_TENANT_ID: string;
  AZURE_CLIENT_ID: string;
  AZURE_CLIENT_SECRET: string;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(env: GraphEnv): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 300_000) return tokenCache.token;

  const res = await fetch(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.AZURE_CLIENT_ID,
      client_secret: env.AZURE_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
  });

  if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function graph<T>(env: GraphEnv, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken(env);
  const res = await fetch(path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try { message = JSON.parse(text)?.error?.message || text; } catch { /* keep raw */ }
    throw new Error(`Graph ${init.method || 'GET'} ${path} failed: ${res.status} ${message}`);
  }
  return text ? JSON.parse(text) as T : (undefined as T);
}

export interface GraphDirectoryUser {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
}

/** Resolve a group by its mail address (e.g. committee@alnmouthvillage.golf). */
export async function findGroupId(env: GraphEnv, mail: string): Promise<string | null> {
  const escaped = mail.trim().toLowerCase().replace(/'/g, "''");
  const data = await graph<{ value: Array<{ id: string }> }>(
    env,
    `/groups?$filter=mail eq '${escaped}'&$select=id`
  );
  return data.value?.[0]?.id || null;
}

/** All user members of a group, following paging. */
export async function listGroupMembers(env: GraphEnv, groupId: string): Promise<GraphDirectoryUser[]> {
  const out: GraphDirectoryUser[] = [];
  let url: string | undefined =
    `/groups/${groupId}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=100`;

  while (url) {
    const page = await graph<{ value: GraphDirectoryUser[]; '@odata.nextLink'?: string }>(env, url);
    out.push(...(page.value || []));
    url = page['@odata.nextLink'];
  }
  return out;
}

/**
 * Find a directory user by any of their addresses. Committee members whose CRM
 * email is a personal address (gmail and so on) will not resolve unless they
 * exist in the tenant as a guest — the caller reports those as unmatched.
 */
export async function findUserByEmail(env: GraphEnv, email: string): Promise<GraphDirectoryUser | null> {
  const e = email.trim().toLowerCase().replace(/'/g, "''");
  const data = await graph<{ value: GraphDirectoryUser[] }>(
    env,
    `/users?$filter=mail eq '${e}' or userPrincipalName eq '${e}'&$select=id,displayName,mail,userPrincipalName`
  );
  if (data.value?.length) return data.value[0];

  // Guests are stored with the address in proxyAddresses and a mangled UPN.
  const guests = await graph<{ value: GraphDirectoryUser[] }>(
    env,
    `/users?$filter=proxyAddresses/any(p:p eq 'SMTP:${e}')&$select=id,displayName,mail,userPrincipalName&$count=true`,
    { headers: { ConsistencyLevel: 'eventual' } }
  );
  return guests.value?.[0] || null;
}

export async function addGroupMember(env: GraphEnv, groupId: string, userId: string): Promise<void> {
  await graph(env, `/groups/${groupId}/members/$ref`, {
    method: 'POST',
    body: JSON.stringify({ '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` }),
  });
}

export async function removeGroupMember(env: GraphEnv, groupId: string, userId: string): Promise<void> {
  await graph(env, `/groups/${groupId}/members/${userId}/$ref`, { method: 'DELETE' });
}

export function isGraphConfigured(env: Partial<GraphEnv> | undefined): env is GraphEnv {
  return !!(env?.AZURE_TENANT_ID && env?.AZURE_CLIENT_ID && env?.AZURE_CLIENT_SECRET);
}
