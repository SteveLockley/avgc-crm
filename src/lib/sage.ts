/**
 * Sage Business Cloud Accounting API Client
 *
 * Base URL: https://api.accounting.sage.com/v3.1
 * Auth: OAuth 2.0 Authorization Code flow
 * Rate limits: 100/min, 2500/day per company
 * Access tokens expire in ~5 minutes, refresh tokens in 31 days
 * Refresh tokens rotate on every use — must persist the new one immediately
 */

const SAGE_API_BASE = 'https://api.accounting.sage.com/v3.1';
const SAGE_AUTH_URL = 'https://www.sageone.com/oauth2/auth/central?filter=apiv3.1';
const SAGE_TOKEN_URL = 'https://oauth.accounting.sage.com/token';

// ─── Types ───────────────────────────────────────────────────────────

export interface SageTokens {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  refresh_token_expires_at: string;
  resource_owner_id?: string;
}

export interface SagePaginatedResponse<T = any> {
  $total: number;
  $page: number;
  $next: string | null;
  $back: string | null;
  $itemsPerPage: number;
  $items: T[];
}

// ─── OAuth Flow ──────────────────────────────────────────────────────

export function getAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${SAGE_AUTH_URL}&${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<SageTokens & { raw: any }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(SAGE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json() as any;
  const now = Date.now();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: new Date(now + data.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + (data.refresh_token_expires_in || 2678400) * 1000).toISOString(),
    resource_owner_id: data.resource_owner_id,
    raw: data,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<SageTokens & { raw: any }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(SAGE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json() as any;
  const now = Date.now();

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: new Date(now + data.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now + (data.refresh_token_expires_in || 2678400) * 1000).toISOString(),
    resource_owner_id: data.resource_owner_id,
    raw: data,
  };
}

// ─── Token Management ────────────────────────────────────────────────

/** Which connected Sage business to talk to: the club's real accounts, or a trial business. */
export type SageRole = 'live' | 'test';

export async function getValidToken(
  db: any,
  clientId: string,
  clientSecret: string,
  role: SageRole = 'live',
): Promise<string> {
  // Rows predating migration 064 default to 'live', so the live lookup still
  // finds a connection made before roles existed.
  const row = await db.prepare(
    'SELECT * FROM sage_tokens WHERE role = ? ORDER BY id LIMIT 1'
  ).bind(role).first() as any;
  if (!row) {
    throw new Error(role === 'live' ? 'NO_SAGE_CONNECTION' : 'NO_SAGE_TEST_CONNECTION');
  }

  // Check if access token is still valid (with 60s buffer)
  const expiresAt = new Date(row.token_expires_at).getTime();
  const now = Date.now();

  if (now < expiresAt - 60000) {
    return row.access_token;
  }

  // Refresh the token
  const tokens = await refreshAccessToken(row.refresh_token, clientId, clientSecret);

  // CRITICAL: Persist new tokens immediately (refresh token has rotated)
  await db.prepare(`
    UPDATE sage_tokens SET
      access_token = ?,
      refresh_token = ?,
      token_expires_at = ?,
      refresh_token_expires_at = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    tokens.access_token,
    tokens.refresh_token,
    tokens.token_expires_at,
    tokens.refresh_token_expires_at,
    row.id,
  ).run();

  return tokens.access_token;
}

// ─── API Client ──────────────────────────────────────────────────────

export interface SageClientOptions {
  db: any;
  clientId: string;
  clientSecret: string;
  /** Which connected business to use. Defaults to the club's live accounts. */
  role?: SageRole;
  /**
   * Writes are refused unless this is true. The change-set engine turns it on
   * for a single apply run; nothing else should.
   */
  allowWrites?: boolean;
}

export class SageClient {
  private db: any;
  private clientId: string;
  private clientSecret: string;
  private tokenPromise: Promise<string> | null = null;
  readonly role: SageRole;
  private allowWrites: boolean;

  constructor(opts: SageClientOptions) {
    this.db = opts.db;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.role = opts.role ?? 'live';
    this.allowWrites = opts.allowWrites ?? false;
  }

  private getToken(): Promise<string> {
    // Cache the promise so parallel calls share one refresh instead of racing
    if (!this.tokenPromise) {
      this.tokenPromise = getValidToken(this.db, this.clientId, this.clientSecret, this.role);
    }
    return this.tokenPromise;
  }

  private assertWritable(method: string, path: string): void {
    if (!this.allowWrites) {
      throw new Error(
        `Sage writes are disabled for this client (${method} ${path} on the ${this.role} business). ` +
        'Writes only run through the change-set engine.'
      );
    }
  }

  private async write<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    this.assertWritable(method, path);
    const token = await this.getToken();
    const res = await fetch(`${SAGE_API_BASE}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sage ${method} ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async post<T = any>(path: string, body: unknown): Promise<T> {
    return this.write<T>('POST', path, body);
  }

  async put<T = any>(path: string, body: unknown): Promise<T> {
    return this.write<T>('PUT', path, body);
  }

  async delete<T = any>(path: string): Promise<T> {
    return this.write<T>('DELETE', path);
  }

  async get<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getToken();
    const url = new URL(`${SAGE_API_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sage API ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /** Fetch all pages of a paginated endpoint sequentially */
  async getAll<T = any>(path: string, params?: Record<string, string>): Promise<T[]> {
    const allItems: T[] = [];
    let page = 1;
    const perPage = '200';

    while (true) {
      const data = await this.get<SagePaginatedResponse<T>>(path, {
        ...params,
        page: String(page),
        items_per_page: perPage,
      });

      allItems.push(...data.$items);

      if (!data.$next) break;
      page++;

      // Safety valve
      if (page > 50) break;
    }

    return allItems;
  }

  /** Fetch all pages in parallel batches — much faster for large datasets */
  async getAllParallel<T = any>(path: string, params?: Record<string, string>, batchSize = 10): Promise<T[]> {
    const perPage = 200;
    const first = await this.get<SagePaginatedResponse<T>>(path, {
      ...params,
      page: '1',
      items_per_page: String(perPage),
    });

    const total = first.$total ?? 0;
    const totalPages = Math.ceil(total / perPage);
    const items: T[] = [...(first.$items ?? [])];

    if (totalPages <= 1) return items;

    const remaining: number[] = [];
    for (let p = 2; p <= totalPages; p++) remaining.push(p);

    for (let i = 0; i < remaining.length; i += batchSize) {
      const batch = remaining.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(p => this.get<SagePaginatedResponse<T>>(path, {
          ...params,
          page: String(p),
          items_per_page: String(perPage),
        }))
      );
      for (const r of results) items.push(...(r.$items ?? []));
    }

    return items;
  }

  // ─── Convenience Methods ─────────────────────────────────────────

  async getBusinesses() {
    return this.get('/businesses');
  }

  async getFinancialSettings() {
    return this.get('/financial_settings');
  }

  async getBusinessSettings() {
    return this.get('/business_settings');
  }

  async getLedgerAccounts() {
    return this.getAll('/ledger_accounts');
  }

  async getLedgerAccountTypes() {
    return this.getAll('/ledger_account_types');
  }

  async getBankAccounts() {
    return this.getAll('/bank_accounts');
  }

  async getBankTransactions(params?: Record<string, string>) {
    return this.getAll('/bank_transactions', params);
  }

  async getContacts(params?: Record<string, string>) {
    return this.getAll('/contacts', params);
  }

  async getSalesInvoices(params?: Record<string, string>) {
    return this.getAll('/sales_invoices', params);
  }

  async getPurchaseInvoices(params?: Record<string, string>) {
    return this.getAll('/purchase_invoices', params);
  }

  async getJournals(params?: Record<string, string>) {
    return this.getAll('/journals', params);
  }

  async getTaxRates() {
    return this.getAll('/tax_rates');
  }

  async getTrialBalance(fromDate: string, toDate: string) {
    return this.get('/trial_balance', { from_date: fromDate, to_date: toDate });
  }

  async getLedgerEntries(params?: Record<string, string>) {
    return this.getAll('/ledger_entries', params);
  }

  async getOtherPayments(params?: Record<string, string>) {
    return this.getAll('/other_payments', params);
  }

  async getContactPayments(params?: Record<string, string>) {
    return this.getAll('/contact_payments', params);
  }

  async getProducts() {
    return this.getAll('/products');
  }

  async getServices() {
    return this.getAll('/services');
  }

  async createJournal(journal: {
    date: string;
    reference: string;
    description?: string;
    journalLines: Array<{
      ledgerAccountId: string;
      debit: number;
      credit: number;
      details?: string;
    }>;
  }): Promise<any> {
    return this.post('/journals', {
      journal: {
        date: journal.date,
        reference: journal.reference,
        description: journal.description,
        journal_lines: journal.journalLines.map(l => ({
          ledger_account: { id: l.ledgerAccountId },
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
          details: l.details ?? '',
        })),
      },
    });
  }
}

// ─── Helper: Create SageClient from Astro locals ────────────────────

export function createSageClient(
  env: Env,
  opts: { role?: SageRole; allowWrites?: boolean } = {},
): SageClient {
  return new SageClient({
    db: env.DB,
    clientId: env.SAGE_CLIENT_ID,
    clientSecret: env.SAGE_CLIENT_SECRET,
    role: opts.role,
    allowWrites: opts.allowWrites,
  });
}
