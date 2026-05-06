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

export async function getValidToken(db: any, clientId: string, clientSecret: string): Promise<string> {
  const row = await db.prepare('SELECT * FROM sage_tokens ORDER BY id LIMIT 1').first() as any;
  if (!row) {
    throw new Error('NO_SAGE_CONNECTION');
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
}

export class SageClient {
  private db: any;
  private clientId: string;
  private clientSecret: string;

  constructor(opts: SageClientOptions) {
    this.db = opts.db;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
  }

  private async getToken(): Promise<string> {
    return getValidToken(this.db, this.clientId, this.clientSecret);
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

  /** Fetch all pages of a paginated endpoint */
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
}

// ─── Helper: Create SageClient from Astro locals ────────────────────

export function createSageClient(env: Env): SageClient {
  return new SageClient({
    db: env.DB,
    clientId: env.SAGE_CLIENT_ID,
    clientSecret: env.SAGE_CLIENT_SECRET,
  });
}
