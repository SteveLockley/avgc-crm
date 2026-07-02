/**
 * TouchOffice Web Homepage Client
 * Fetches Department Sales, Fixed Totals and Transaction Keys from the
 * TouchOffice homepage tables (standard HTML <table> elements).
 */

const BASE_URL = 'https://www.touchoffice.net';
const LOGIN_URL = `${BASE_URL}/auth/login`;
const HOME_URL = BASE_URL + '/';

/**
 * Login to TouchOffice and return a fresh session cookie.
 * After login POST, follows the redirect to the homepage to capture
 * the final working session cookie.
 */
/** Extract named cookie from Set-Cookie response headers using forEach (handles multiple headers). */
function extractCookies(headers: Headers): Record<string, string> {
  const cookies: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const pair = value.split(';')[0].trim();
      const eqIdx = pair.indexOf('=');
      if (eqIdx > -1) {
        cookies[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
      }
    }
  });
  return cookies;
}

export async function loginForSession(
  username: string,
  password: string
): Promise<{ session: string; csrfToken: string }> {
  // Step 1: GET login page to get initial session cookie + any CSRF cookie
  const loginPageRes = await fetch(LOGIN_URL, { redirect: 'manual' });
  const pageCookies = extractCookies(loginPageRes.headers);
  const initialSession = pageCookies['icrtouch_connect_login_id'] ?? '';

  if (!initialSession) {
    throw new Error('Could not get initial session from TouchOffice.');
  }

  // Track CSRF cookie across all responses
  let csrfToken = Object.entries(pageCookies).find(([k]) => /csrf/i.test(k))?.[1] ?? '';

  // Step 2: POST credentials — send session + any CSRF cookie we already have
  const formBody = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&submit-login=`;
  const loginCookie = csrfToken
    ? `icrtouch_connect_login_id=${initialSession}; ${Object.keys(pageCookies).find(k => /csrf/i.test(k))}=${csrfToken}`
    : `icrtouch_connect_login_id=${initialSession}`;

  const loginRes = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': loginCookie,
    },
    redirect: 'manual',
    body: formBody,
  });

  // Pick up updated session + CSRF cookies from login response
  const loginCookies = extractCookies(loginRes.headers);
  let session = loginCookies['icrtouch_connect_login_id'] ?? initialSession;
  const loginCsrf = Object.entries(loginCookies).find(([k]) => /csrf/i.test(k))?.[1];
  if (loginCsrf) csrfToken = loginCsrf;

  if (loginRes.status === 200) {
    const html = await loginRes.text();
    if (html.includes('name="submit-login"')) {
      throw new Error('TouchOffice login failed — check username and password.');
    }
  }

  // Step 3: Follow through to the homepage — may issue updated session/CSRF cookies
  const homeRes = await fetch(HOME_URL, {
    method: 'GET',
    headers: { 'Cookie': `icrtouch_connect_login_id=${session}` },
    redirect: 'manual',
  });

  const homeCookies = extractCookies(homeRes.headers);
  if (homeCookies['icrtouch_connect_login_id']) session = homeCookies['icrtouch_connect_login_id'];
  const homeCsrf = Object.entries(homeCookies).find(([k]) => /csrf/i.test(k))?.[1];
  if (homeCsrf) csrfToken = homeCsrf;

  // If we got redirected back to login, the credentials didn't actually work
  const location = homeRes.headers.get('location') || '';
  if (location.includes('auth/login')) {
    throw new Error('TouchOffice login failed — redirected back to login.');
  }

  return { session, csrfToken };
}

// --- Session management ---

/**
 * Ensure we have a working TouchOffice session.
 * Reads from app_settings, tests it, re-logs in if expired, stores + returns working cookie.
 */
export async function ensureSession(db: any, env: any): Promise<{ session: string; csrfToken: string }> {
  // Try stored session first
  const [storedSession, storedCsrf] = await Promise.all([
    db.prepare(`SELECT value FROM app_settings WHERE key = 'touchoffice_session'`).first<{ value: string }>(),
    db.prepare(`SELECT value FROM app_settings WHERE key = 'touchoffice_csrf'`).first<{ value: string }>(),
  ]);

  if (storedSession?.value) {
    // Test it with a quick GET to homepage
    const testRes = await fetch(HOME_URL, {
      method: 'GET',
      headers: { 'Cookie': `icrtouch_connect_login_id=${storedSession.value}` },
    });

    // Capture any rotated session or CSRF cookies from the response
    const testCookies = extractCookies(testRes.headers);
    const currentSession = testCookies['icrtouch_connect_login_id'] ?? storedSession.value;
    const rotatedCsrf = Object.entries(testCookies).find(([k]) => /csrf/i.test(k))?.[1];
    const currentCsrf = rotatedCsrf ?? storedCsrf?.value ?? '';

    const testHtml = await testRes.text();
    if (!testHtml.includes('name="submit-login"') && !testRes.url.includes('auth/login')) {
      // Persist any changes
      if (currentSession !== storedSession.value) {
        await db.prepare(
          `INSERT INTO app_settings (key, value) VALUES ('touchoffice_session', ?)
           ON CONFLICT(key) DO UPDATE SET value = ?`
        ).bind(currentSession, currentSession).run();
      }
      if (rotatedCsrf && rotatedCsrf !== storedCsrf?.value) {
        await db.prepare(
          `INSERT INTO app_settings (key, value) VALUES ('touchoffice_csrf', ?)
           ON CONFLICT(key) DO UPDATE SET value = ?`
        ).bind(rotatedCsrf, rotatedCsrf).run();
      }
      return { session: currentSession, csrfToken: currentCsrf };
    }
  }

  // Session expired or missing — re-login
  const username = env.TOUCHOFFICE_USERNAME;
  const password = env.TOUCHOFFICE_PASSWORD;
  if (!username || !password) {
    throw new Error('TouchOffice credentials not configured.');
  }

  const { session, csrfToken } = await loginForSession(username, password);

  // Store both
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('touchoffice_session', ?)
     ON CONFLICT(key) DO UPDATE SET value = ?`
  ).bind(session, session).run();
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('touchoffice_csrf', ?)
     ON CONFLICT(key) DO UPDATE SET value = ?`
  ).bind(csrfToken, csrfToken).run();

  return { session, csrfToken };
}

// --- Sales list + receipt interfaces ---

export interface SalesListEntry {
  date: string;
  consecNum: string;
  saleId: string;
  site: string;
  till: string;
  clerk: string;
  saleTotal: number;
}

export interface SaleLineItem {
  description: string;
  qty: number;
  amount: number;
}

export interface SaleReceipt {
  saleId: string;
  memberName: string | null;
  discountCard: string | null;
  lineItems: SaleLineItem[];
  paymentType: 'cash' | 'card' | 'cheque';
  total: number;
  rawText: string;
}

// --- Sales detail fetchers ---

/**
 * Fetch membership sales list for a date range.
 * Departments: 5 (social memberships), 6 (memberships), 9 (lockers).
 * Sets date filter via POST, then GETs sales from each department.
 */
export async function fetchMembershipSalesList(
  sessionCookie: string,
  startDate: string,
  endDate: string,
  startTime = '00:00'
): Promise<SalesListEntry[]> {
  const cookie = `icrtouch_connect_login_id=${sessionCookie}`;

  // Step 1: POST filter form to set date range
  const formFields = [
    `filter-startdate=${startDate}`,
    `filter-enddate=${endDate}`,
    `filter-starttime=${startTime}`,
    'filter-endtime=23:59',
    'filter-clerk=0',
    'site=0',
    'submit-filter=',
  ];

  const filterRes = await fetch(HOME_URL, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formFields.join('&'),
  });

  const filterHtml = await filterRes.text();
  if (filterHtml.includes('name="submit-login"')) {
    throw new Error('Session expired during sales list fetch.');
  }

  // Step 2: Fetch sales from dept 5 (social memberships), 6 (memberships), 9 (lockers)
  const allEntries: SalesListEntry[] = [];
  const seenSaleIds = new Set<string>();

  for (const dept of [5, 6, 9]) {
    const pageSize = 100;
    let start = 0;
    let totalRecords = 0;

    do {
      const jsonUrl = `${BASE_URL}/apps/jsonsalesdetails?dept=${dept}&iDisplayStart=${start}&iDisplayLength=${pageSize}`;
      const jsonRes = await fetch(jsonUrl, {
        method: 'GET',
        headers: { 'Cookie': cookie },
      });

      const jsonText = await jsonRes.text();
      if (jsonText.includes('name="submit-login"')) {
        throw new Error('Session expired during sales detail fetch.');
      }

      let data: any;
      try {
        data = JSON.parse(jsonText);
      } catch {
        throw new Error(`Failed to parse sales JSON (dept ${dept}). Status:${jsonRes.status} len:${jsonText.length} start:${jsonText.substring(0, 500)}`);
      }

      const entries = parseSalesJsonData(data);
      // Deduplicate — a sale with both membership + locker items appears in both depts
      for (const entry of entries) {
        if (!seenSaleIds.has(entry.saleId)) {
          seenSaleIds.add(entry.saleId);
          allEntries.push(entry);
        }
      }

      totalRecords = data.iTotalRecords || data.iTotalDisplayRecords || entries.length;
      start += pageSize;

      if (entries.length < pageSize) break;
    } while (start < totalRecords);
  }

  return allEntries;
}

/**
 * Parse DataTables server-side JSON response.
 * Format: { aaData: [[date, consecNum, saleIdHtml, site, till, clerk, totalHtml], ...] }
 * Columns: Date, Consec Num, Sale ID, Site, Till, Clerk, Sale Total
 */
function parseSalesJsonData(data: any): SalesListEntry[] {
  const entries: SalesListEntry[] = [];
  const rows = data.aaData || data.data || [];

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;

    const date = stripTags(String(row[0])).trim();
    const consecNum = stripTags(String(row[1])).trim();
    const saleId = stripTags(String(row[2])).trim();
    const site = stripTags(String(row[3])).trim();
    const till = stripTags(String(row[4])).trim();
    const clerk = stripTags(String(row[5])).trim();
    const totalStr = stripTags(String(row[6])).trim();

    if (!saleId || !date) continue;

    entries.push({
      date,
      consecNum,
      saleId,
      site,
      till,
      clerk,
      saleTotal: parseFloat(totalStr.replace(/[£,]/g, '')) || 0,
    });
  }

  return entries;
}

/**
 * Fetch and parse a single sale receipt.
 */
export async function fetchSaleReceipt(
  sessionCookie: string,
  saleId: string
): Promise<SaleReceipt> {
  const cookie = `icrtouch_connect_login_id=${sessionCookie}`;
  const url = `${BASE_URL}/apps/viewsinglesale?sale=${saleId}&site=1`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Cookie': cookie },
  });

  const html = await res.text();
  if (html.includes('name="submit-login"')) {
    throw new Error('Session expired during receipt fetch.');
  }

  return parseReceiptHtml(html, saleId);
}

/**
 * Parse a receipt page.
 * The receipt is typically rendered as a <pre> block or a series of lines.
 * Key patterns:
 * - Line items: qty description amount (e.g. "1 FULL ADULT                200.00")
 * - Negative lines are deselects: "-1 OLD ITEM              -100.00"
 * - Discount card: line near bottom like "Shaun Doyle    00831"
 * - Payment: "Cash" or "Card" line
 */
function parseReceiptHtml(html: string, saleId: string): SaleReceipt {
  // Extract the receipt text — look for <pre> blocks or the main content
  let rawText = '';
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (preMatch) {
    rawText = preMatch[1];
  } else {
    // Fall back to the receipt div or body text
    const receiptMatch = html.match(/class="receipt[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    rawText = receiptMatch ? receiptMatch[1] : html;
  }

  // Clean HTML entities and tags
  rawText = rawText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#163;/g, '£');

  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  // Parse line items: look for lines with qty, description, and amount
  // Pattern: optional leading number (qty), text (description), trailing number (amount)
  const lineItems: SaleLineItem[] = [];
  const itemRegex = /^(-?\d+)\s+(.+?)\s+£?(-?[\d]+\.\d{2})$/;

  for (const line of lines) {
    const m = line.match(itemRegex);
    if (m) {
      const qty = parseInt(m[1]);
      const description = m[2].trim();
      const amount = parseFloat(m[3]);
      lineItems.push({ description, qty, amount });
    }
  }

  // Net line items by description (qty=1 adds, qty=-1 removes)
  const netted = new Map<string, SaleLineItem>();
  for (const item of lineItems) {
    const existing = netted.get(item.description);
    if (existing) {
      existing.qty += item.qty;
      existing.amount += item.amount;
    } else {
      netted.set(item.description, { ...item });
    }
  }
  const nettedItems = Array.from(netted.values()).filter(i => i.qty !== 0);

  // Detect payment type
  const lowerText = rawText.toLowerCase();
  const paymentType: 'cash' | 'card' | 'cheque' =
    lowerText.includes('card payment') || lowerText.includes('credit card') || lowerText.includes('visa') || lowerText.includes('mastercard')
      ? 'card'
      : lowerText.includes('cheque')
      ? 'cheque'
      : 'cash';

  // Calculate total from netted items
  const total = nettedItems.reduce((sum, i) => sum + i.amount, 0);

  // Extract member name and discount card
  // Look for a line near the bottom that has a name and optional card number
  // Pattern: "Name    12345" or just "Name" after the items section
  let memberName: string | null = null;
  let discountCard: string | null = null;

  // Look for discount card pattern — a line with a name followed by digits
  // Name may have mixed case (e.g., "Ian tate") so use case-insensitive matching
  const discountRegex = /discount\s*(?:card)?[:\s]+(\d{3,})/i;
  const nameCardRegex = /^([a-zA-Z]+(?:\s+[a-zA-Z]+)+)\s+(\d{3,})\s*$/i;

  for (const line of lines) {
    // Check for explicit discount card reference
    const dm = line.match(discountRegex);
    if (dm) {
      discountCard = dm[1];
      continue;
    }

    // Check for "Name   CardNumber" pattern (e.g., "Ian tate    01001")
    const nm = line.match(nameCardRegex);
    if (nm) {
      // Avoid matching lines that look like item lines or metadata
      const candidate = nm[1].trim();
      if (!/^(last|spend|no of|discount|balance)/i.test(candidate)) {
        memberName = candidate;
        discountCard = nm[2].trim();
      }
    }
  }

  // If no name found from card line, look for a standalone name near bottom
  if (!memberName) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/^\d+\.\d{2}$/.test(line)) continue;
      if (/^-?\d+\s+/.test(line)) continue;
      if (/^(cash|card|credit|total|subtotal|change|tendered|vat|last|spend|no of|discount|balance)/i.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^[a-zA-Z]+(\s+[a-zA-Z]+)+$/.test(line)) {
        memberName = line;
        break;
      }
    }
  }

  return {
    saleId,
    memberName,
    discountCard,
    lineItems: nettedItems,
    paymentType,
    total: Math.round(total * 100) / 100,
    rawText,
  };
}

/** Strip HTML tags from a string */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#163;/g, '£');
}

function parseAmount(s: string): number {
  const c = s.replace(/[£,\s]/g, '').trim();
  if (!c) return 0;
  if (c.startsWith('(') && c.endsWith(')')) return -(parseFloat(c.slice(1, -1)) || 0);
  return parseFloat(c) || 0;
}

// --- Seniors' Purse: Customer Statement report ---

export interface PurseStatementEntry {
  saleId: string;
  saleDate: string;    // ISO: YYYY-MM-DD HH:MM:SS
  balanceAdj: number;
  runningBalance: number;
}

const REPORT_VIEW_URL = `${BASE_URL}/reports_engine/report_view`;
const CUSTOMER_STATEMENT_PATH = 'NRE/standard/Centralised Customers/Customer_Statement';
const SENIORS_CUSTOMER_ID = '1035';

/**
 * Fetch the Customer Statement for the Seniors Section (customer 1035) from TouchOffice.
 *
 * Uses the same form POST that the browser uses — no CSRF token needed.
 * POST /reports_engine/report_view with form fields → full HTML page with report embedded.
 */
export async function fetchSeniorsPurseStatement(
  sessionCookie: string,
  year: number,
  _csrfToken = '' // kept for API compatibility
): Promise<PurseStatementEntry[]> {
  const cookie = `icrtouch_connect_login_id=${sessionCookie}`;

  const body = new URLSearchParams({
    report: CUSTOMER_STATEMENT_PATH,
    'filter-report-startdate': `01/01/${year}`,
    'filter-report-enddate': `31/12/${year}`,
    'filter-report-starttime': '00:00',
    'filter-report-endtime': '23:59',
    'filter-terminals': '0',
    'filter-location': '0',
    'custnum_filter_dropdown': `SenIor SectIon (${SENIORS_CUSTOMER_ID})`,
    'filter-customers': SENIORS_CUSTOMER_ID,
    'filter-customergroups': '0',
    'filter-customernotes': '',
    'format': 'html',
    'submit-filter': '',
  });

  const res = await fetch(REPORT_VIEW_URL, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const html = await res.text();

  if (html.includes('name="submit-login"')) {
    throw new Error('Session expired during report fetch.');
  }

  return parseCustomerStatementHtml(html);
}

/**
 * Debug helper: posts the report form and returns a snippet of the HTML response
 * so we can inspect the report structure.
 */
export async function debugFetchPurseReport(
  sessionCookie: string,
  year: number,
  _csrfToken = '' // kept for API compatibility
): Promise<any> {
  const cookie = `icrtouch_connect_login_id=${sessionCookie}`;

  const body = new URLSearchParams({
    report: CUSTOMER_STATEMENT_PATH,
    'filter-report-startdate': `01/01/${year}`,
    'filter-report-enddate': `31/12/${year}`,
    'filter-report-starttime': '00:00',
    'filter-report-endtime': '23:59',
    'filter-terminals': '0',
    'filter-location': '0',
    'custnum_filter_dropdown': `SenIor SectIon (${SENIORS_CUSTOMER_ID})`,
    'filter-customers': SENIORS_CUSTOMER_ID,
    'filter-customergroups': '0',
    'filter-customernotes': '',
    'format': 'html',
    'submit-filter': '',
  });

  const res = await fetch(REPORT_VIEW_URL, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const html = await res.text();
  const isLogin = html.includes('name="submit-login"');

  // Find "Sale Id" or "Sale ID" in the HTML to locate report tables
  const saleIdIdx = html.search(/Sale\s*Id/i);
  const saleIdSnippet = saleIdIdx >= 0 ? html.substring(Math.max(0, saleIdIdx - 200), saleIdIdx + 1000) : '';

  // Also find first <table> after the reportcontainer
  const containerStart = html.search(/<div[^>]+id=["']reportcontainer["']/i);
  const firstTableIdx = containerStart >= 0 ? html.indexOf('<table', containerStart) : -1;
  const firstTableSnippet = firstTableIdx >= 0 ? html.substring(firstTableIdx, firstTableIdx + 1500) : '';

  // Try parsing — capture any error
  let parsedEntries: PurseStatementEntry[] = [];
  let parseError = '';
  if (!isLogin) {
    try { parsedEntries = parseCustomerStatementHtml(html); }
    catch (e: any) { parseError = e?.message ?? String(e); }
  }

  // Extract ALL positioned divs from the report section
  const containerStart2 = html.search(/<div[^>]+id=["']reportcontainer["']/i);
  const section2 = containerStart2 >= 0 ? html.substring(containerStart2) : html;
  const allDivs: {left:number,top:number,text:string}[] = [];
  const parts2 = section2.split('<div ');
  for (const part of parts2) {
    const styleM = part.match(/style="([^"]*)"/);
    if (!styleM) continue;
    const style = styleM[1];
    const leftM = style.match(/left:([\d.]+)pt/);
    const topM  = style.match(/top:([\d.]+)pt/);
    if (!leftM || !topM) continue;
    const closeTag = part.indexOf('>');
    if (closeTag === -1) continue;
    const endDiv = part.indexOf('</div>', closeTag);
    if (endDiv === -1) continue;
    const text = stripTags(part.substring(closeTag + 1, endDiv)).trim();
    if (text) allDivs.push({ left: parseFloat(leftM[1]), top: parseFloat(topM[1]), text });
  }

  // Find the header row (contains "Sale Id") and extract ALL header texts with positions
  const saleIdDiv2 = allDivs.find(d => /^sale\s*id$/i.test(d.text));
  const headerTop2 = saleIdDiv2?.top ?? -1;
  const headerDivs = headerTop2 >= 0 ? allDivs.filter(d => Math.abs(d.top - headerTop2) < 3) : [];

  // First 60 non-header divs (actual data rows) — enough to see 3–5 full rows
  const dataSample = allDivs.filter(d => Math.abs(d.top - headerTop2) >= 3).slice(0, 60);

  return {
    status: res.status,
    isLogin,
    htmlLength: html.length,
    totalDivsInSection: allDivs.length,
    headerDivs,          // ← all column headers with left positions
    dataSample,          // ← first ~60 data divs so we can see row structure
    parseError,
    parsedCount: parsedEntries.length,
    parsedEntries,       // ← full list so we can cross-check against DB
  };
}

/**
 * Parse the Customer Statement HTML report.
 *
 * TouchOffice renders this as a multi-page PDF-style document: every page uses
 * top coordinates that restart from 0, so divs from different pages share the
 * same absolute top values.  Any approach that sorts or groups by top therefore
 * conflates entries from different pages.
 *
 * The correct strategy is to process <div> elements in HTML source order.
 * Because the HTML is emitted page-by-page, each column's data divs appear in
 * the same sequential (chronological) order in the source.  We collect the
 * values for each column into separate arrays (preserving source order) and
 * then match them by position index.
 *
 * Additional observation from debug data: the column structure is
 *   Date (left≈0) | Sale Id (left≈204) | Discount | Sale Total |
 *   Balance Adj (left≈419) | Site (left≈96) | Balance (left≈487)
 * with every transaction preceded by a repeated column-header row.
 */
function parseCustomerStatementHtml(html: string): PurseStatementEntry[] {
  const containerStart = html.search(/<div[^>]+id=["']reportcontainer["']/i);
  const section = containerStart >= 0 ? html.substring(containerStart) : html;

  const COL_TOL = 12;

  // ── Helper: extract (left, top, text) from one split part ──────────────────
  interface DivInfo { left: number; top: number; text: string; }
  const extractDiv = (part: string): DivInfo | null => {
    const styleM = part.match(/style="([^"]*)"/);
    if (!styleM) return null;
    const style = styleM[1];
    const leftM = style.match(/left:([\d.]+)pt/);
    const topM  = style.match(/top:([\d.]+)pt/);
    if (!leftM || !topM) return null;
    const closeTag = part.indexOf('>');
    if (closeTag === -1) return null;
    const endDiv = part.indexOf('</div>', closeTag);
    if (endDiv === -1) return null;
    const text = stripTags(part.substring(closeTag + 1, endDiv)).trim();
    return text ? { left: parseFloat(leftM[1]), top: parseFloat(topM[1]), text } : null;
  };

  const parts = section.split('<div ');

  // ── Phase 1: detect column left-positions from the first header row ─────────
  const allDivs: DivInfo[] = [];
  for (const part of parts) {
    const d = extractDiv(part);
    if (d) allDivs.push(d);
  }

  const saleIdHeaderDiv = allDivs.find(d => /^sale\s*id$/i.test(d.text));
  if (!saleIdHeaderDiv) return [];

  const headerTop = saleIdHeaderDiv.top;
  const colLeft: Record<string, number> = {};
  for (const d of allDivs.filter(d => Math.abs(d.top - headerTop) < 3)) {
    const t = d.text.trim();
    if (/^date$/i.test(t))                colLeft.date    = d.left;
    else if (/^sale\s*id$/i.test(t))      colLeft.saleId  = d.left;
    else if (/balance\s*adj/i.test(t))    colLeft.balAdj  = d.left;
    else if (/balance/i.test(t))          colLeft.balance = d.left;
  }

  if (colLeft.saleId == null || colLeft.date == null || colLeft.balAdj == null) return [];

  // ── Phase 2: collect column values in HTML SOURCE ORDER ─────────────────────
  // Sorting by top would mix divs from different pages (each page restarts at
  // top=0).  Source order is always page-sequential, so index N in the saleId
  // array corresponds to index N in the date / balAdj / balance arrays.

  const isDateText   = (t: string) => /^\d{2}\/\d{2}\/\d{4}/.test(t) && !t.includes(' To ');
  const isAmountText = (t: string) => /\d/.test(t) && /^[\d,.()\-£\s]+$/.test(t);

  const saleIds:  string[] = [];
  const dates:    string[] = [];
  const balAdjs:  string[] = [];
  const balances: string[] = [];

  for (const part of parts) {
    const d = extractDiv(part);
    if (!d) continue;

    if (Math.abs(d.left - colLeft.saleId) < COL_TOL) {
      const clean = d.text.replace(/\s/g, '');
      if (/^\d{8,}$/.test(clean)) saleIds.push(clean);   // numeric ID ≥8 digits
    } else if (Math.abs(d.left - colLeft.date) < COL_TOL && isDateText(d.text)) {
      dates.push(d.text);
    } else if (Math.abs(d.left - colLeft.balAdj) < COL_TOL && isAmountText(d.text)) {
      balAdjs.push(d.text);
    } else if (colLeft.balance != null && Math.abs(d.left - colLeft.balance) < COL_TOL && isAmountText(d.text)) {
      balances.push(d.text);
    }
  }

  // ── Phase 3: parse amount strings ───────────────────────────────────────────

  // ── Phase 4: index-match across columns ─────────────────────────────────────
  const entries: PurseStatementEntry[] = [];
  for (let i = 0; i < saleIds.length; i++) {
    const rawDate = dates[i] ?? '';
    if (!rawDate) continue;
    entries.push({
      saleId:         saleIds[i],
      saleDate:       parseTouchOfficeDate(rawDate),
      balanceAdj:     parseAmount(balAdjs[i]  ?? ''),
      runningBalance: parseAmount(balances[i] ?? ''),
    });
  }

  entries.sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  return entries;
}

/**
 * Parse TouchOffice date format "DD/MM/YYYY HH:MM:SS" → "YYYY-MM-DD HH:MM:SS"
 */
function parseTouchOfficeDate(raw: string): string {
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
  if (!m) return raw;
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  return m[4] ? `${date} ${m[4]}` : date;
}

// --- Interfaces ---

export interface DepartmentSale {
  name: string;
  quantity: number;
  value: number;
}

export interface FixedTotal {
  name: string;
  quantity: number;
  value: number;
}

export interface TransactionKey {
  name: string;
  quantity: number;
  value: number;
}

export interface WeeklyReport {
  startDate: string;
  endDate: string;
  departments: DepartmentSale[];
  fixedTotals: FixedTotal[];
  transactionKeys: TransactionKey[];
  total: number;
  fetchedAt: string;
}

// --- Homepage fetcher ---

const AJAX_URL = BASE_URL + '/apps/ajaxloader';

/**
 * Submit the date filter form to set the session's date range,
 * then fetch each widget's data via the AJAX loader endpoint.
 * Returns concatenated widget HTML containing DataTables and CSV textareas.
 */
export async function fetchHomepage(
  sessionCookie: string,
  startDate: string,
  endDate: string
): Promise<string> {
  const cookie = `icrtouch_connect_login_id=${sessionCookie}`;

  // Step 1: POST the filter form to set date range in the server session
  const formFields = [
    `filter-startdate=${startDate}`,
    `filter-enddate=${endDate}`,
    'filter-starttime=00:00',
    'filter-endtime=23:59',
    'filter-clerk=0',
    'site=0',
    'submit-filter=',
  ];

  const filterRes = await fetch(HOME_URL, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formFields.join('&'),
  });

  // Check we didn't get bounced to login
  const filterHtml = await filterRes.text();
  if (filterHtml.includes('name="submit-login"')) {
    throw new Error('Session expired. Please sign in again.');
  }

  // Step 2: Fetch each widget via the AJAX loader endpoint
  const widgets = ['departmentSalesTotal', 'fixedtotal', 'transactionKeySales'];
  const parts: string[] = [];

  for (const widgetFn of widgets) {
    const url = `${AJAX_URL}?call=${widgetFn}&postdata=[]`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Cookie': cookie },
    });
    if (res.ok) {
      parts.push(await res.text());
    }
  }

  return parts.join('\n');
}

// --- CSV textarea parser ---

/**
 * Parse a number, stripping pipes, commas, currency symbols.
 */
function parseNum(s: string): number {
  const cleaned = s.replace(/[|£,\s]/g, '').trim();
  if (!cleaned || cleaned === '-') return 0;
  return parseFloat(cleaned) || 0;
}

/**
 * Extract CSV data from <textarea name="reportdata"> elements in the HTML.
 * Each widget has CSV export forms with data like: RECORD,NAME,QUANTITY,VALUE\n1,Bar Sales,43.16,|190.25|
 * We find the CSV textarea by the associated filename hidden field.
 */
function extractCsvByFilename(html: string, filename: string): string[][] {
  // Find the export form containing this filename, then grab its textarea
  const fnIdx = html.indexOf(`value="${filename}"`);
  if (fnIdx === -1) return [];

  // Search backwards from filename to find the form start, and forward for the textarea
  const formStart = html.lastIndexOf('<form', fnIdx);
  const formEnd = html.indexOf('</form>', fnIdx);
  if (formStart === -1 || formEnd === -1) return [];

  const formHtml = html.substring(formStart, formEnd);
  const textareaMatch = formHtml.match(/<textarea[^>]*name="reportdata"[^>]*>([\s\S]*?)<\/textarea>/i);
  if (!textareaMatch) return [];

  const csv = textareaMatch[1].trim();
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  return lines.slice(1).map(line => line.split(','));
}

/**
 * Fallback: extract all CSV textareas in order from the HTML.
 * Returns array of parsed CSV blocks.
 */
function extractAllCsvTextareas(html: string): string[][][] {
  const results: string[][][] = [];
  const regex = /<textarea[^>]*name="reportdata"[^>]*>([\s\S]*?)<\/textarea>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const csv = match[1].trim();
    // Skip PDF export textareas (they contain &#163; currency symbols)
    if (csv.includes('&#163;') || csv.includes('&amp;#163;')) continue;
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
      results.push(lines.slice(1).map(line => line.split(',')));
    }
  }
  return results;
}

/**
 * Parse widget HTML data: Department Sales, Fixed Totals, Transaction Keys.
 * The HTML is concatenated AJAX responses from /apps/ajaxloader for each widget.
 * Each response contains CSV export textareas with clean data.
 */
export function parseHomepageTables(html: string): {
  departments: DepartmentSale[];
  fixedTotals: FixedTotal[];
  transactionKeys: TransactionKey[];
} {
  const departments: DepartmentSale[] = [];
  const fixedTotals: FixedTotal[] = [];
  const transactionKeys: TransactionKey[] = [];

  // Try by filename first (most reliable)
  const deptCsv = extractCsvByFilename(html, 'departmentsales.csv');
  const fixedCsv = extractCsvByFilename(html, 'fixedtotalsales.csv');
  const txCsv = extractCsvByFilename(html, 'transactionkeysales.csv');

  // Fallback: if filenames not found, use positional CSV textareas
  // Order from AJAX calls: departmentSalesTotal, fixedtotal, transactionKeySales
  const allCsv = (deptCsv.length === 0 && fixedCsv.length === 0 && txCsv.length === 0)
    ? extractAllCsvTextareas(html)
    : [];

  const deptRows = deptCsv.length > 0 ? deptCsv : (allCsv[0] || []);
  const fixedRows = fixedCsv.length > 0 ? fixedCsv : (allCsv[1] || []);
  const txRows = txCsv.length > 0 ? txCsv : (allCsv[2] || []);

  // 1) DEPARTMENT SALES — CSV: RECORD,NAME,QUANTITY,VALUE
  for (const row of deptRows) {
    if (row.length < 4) continue;
    departments.push({
      name: row[1],
      quantity: parseNum(row[2]),
      value: parseNum(row[3]),
    });
  }

  // 2) FIXED TOTALS — CSV: RECORD,NAME,QUANTITY,VALUE (value may have extra text like "Avg/cover |0.00|")
  for (const row of fixedRows) {
    if (row.length < 4) continue;
    const valuePart = row.slice(3).join(',');
    fixedTotals.push({
      name: row[1],
      quantity: parseNum(row[2]),
      value: parseNum(valuePart),
    });
  }

  // 3) TRANSACTION KEY — CSV: RECORD,NAME,QUANTITY,VALUE
  for (const row of txRows) {
    if (row.length < 4) continue;
    transactionKeys.push({
      name: row[1],
      quantity: parseNum(row[2]),
      value: parseNum(row[3]),
    });
  }

  return { departments, fixedTotals, transactionKeys };
}

// --- Customer Balance report ---

export interface CustomerBalanceEntry {
  customerNumber: number;
  firstName: string;
  lastName: string;
  accountNumber: string;
  accountBalance: number;
}

export const CUSTOMER_GROUPS: { id: string; name: string }[] = [
  { id: '1', name: 'MEMBERS' },
  { id: '2', name: 'SOCIAL MEMBER' },
  { id: '3', name: 'Dead Cards' },
  { id: '4', name: 'STAFF DISCOUNT' },
];

const CUSTOMER_BALANCE_PATH = 'NRE/standard/Centralised Customers/Customer_Balance';

/**
 * Fetch the Customer Balance report for one customer group from TouchOffice.
 * No date range needed — report shows current balances.
 */
export async function fetchCustomerBalanceReport(
  sessionCookie: string,
  groupId: string
): Promise<CustomerBalanceEntry[]> {
  const cookie = `icrtouch_connect_login_id=${sessionCookie}`;

  const body = new URLSearchParams({
    report: CUSTOMER_BALANCE_PATH,
    'filter-terminals': '0',
    'filter-location': '0',
    'custnum_filter_dropdown': '',
    'filter-customers': '',
    'filter-customergroups': groupId,
    'filter-customernotes': '',
    'format': 'html',
    'submit-filter': '',
  });

  const res = await fetch(REPORT_VIEW_URL, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const html = await res.text();

  if (html.includes('name="submit-login"')) {
    throw new Error('Session expired during customer balance fetch.');
  }

  return parseCustomerBalanceHtml(html);
}

/**
 * Debug helper: returns raw div sample + parse attempt for one customer group.
 */
export async function debugFetchCustomerBalance(
  sessionCookie: string,
  groupId: string
): Promise<any> {
  const cookie = `icrtouch_connect_login_id=${sessionCookie}`;

  const body = new URLSearchParams({
    report: CUSTOMER_BALANCE_PATH,
    'filter-terminals': '0',
    'filter-location': '0',
    'custnum_filter_dropdown': '',
    'filter-customers': '',
    'filter-customergroups': groupId,
    'filter-customernotes': '',
    'format': 'html',
    'submit-filter': '',
  });

  const res = await fetch(REPORT_VIEW_URL, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const html = await res.text();
  const isLogin = html.includes('name="submit-login"');

  const containerStart = html.search(/<div[^>]+id=["']reportcontainer["']/i);
  const section = containerStart >= 0 ? html.substring(containerStart) : html;

  interface DivInfo { left: number; top: number; text: string; }
  const allDivs: DivInfo[] = [];
  const parts = section.split('<div ');
  for (const part of parts) {
    const styleM = part.match(/style="([^"]*)"/);
    if (!styleM) continue;
    const style = styleM[1];
    const leftM = style.match(/left:([\d.]+)pt/);
    const topM  = style.match(/top:([\d.]+)pt/);
    if (!leftM || !topM) continue;
    const closeTag = part.indexOf('>');
    if (closeTag === -1) continue;
    const endDiv = part.indexOf('</div>', closeTag);
    if (endDiv === -1) continue;
    const text = stripTags(part.substring(closeTag + 1, endDiv)).trim();
    if (text) allDivs.push({ left: parseFloat(leftM[1]), top: parseFloat(topM[1]), text });
  }

  const numberHeader = allDivs.find(d => /^number$/i.test(d.text));
  const headerTop = numberHeader?.top ?? -1;
  const headerDivs = headerTop >= 0 ? allDivs.filter(d => Math.abs(d.top - headerTop) < 3) : [];
  const dataSample = allDivs.filter(d => Math.abs(d.top - (headerTop >= 0 ? headerTop : -999)) >= 3).slice(0, 80);

  let parsedEntries: CustomerBalanceEntry[] = [];
  let parseError = '';
  if (!isLogin) {
    try { parsedEntries = parseCustomerBalanceHtml(html); }
    catch (e: any) { parseError = e?.message ?? String(e); }
  }

  return {
    status: res.status,
    isLogin,
    htmlLength: html.length,
    totalDivs: allDivs.length,
    headerDivs,
    dataSample,
    parsedCount: parsedEntries.length,
    parsedEntries: parsedEntries.slice(0, 20),
    parseError,
  };
}

/**
 * Parse the Customer Balance HTML report (PDF-style positioned divs).
 * Columns: Number | First Name | Last Name | Account Number |
 *          (£) Account Balance | (£) Available Balance
 * Processes divs in HTML source order to handle multi-page reports correctly.
 */
/**
 * Parse the Customer Balance HTML report.
 *
 * TouchOffice renders each page with top coordinates that reset to 0, so
 * parallel-array / source-order indexing breaks as soon as any field is blank
 * (no div emitted) for any customer — all subsequent rows shift.
 *
 * Instead we use row-based grouping:
 *   1. Assign every div an "effective top" that accumulates a page offset each
 *      time the top coordinate drops significantly (page break).
 *   2. Bucket divs into rows by effective top (within ±ROW_TOL).
 *   3. For each row that contains a Number-column div, extract the other
 *      columns from the same row bucket.
 *
 * This tolerates blank fields, repeated page headers, and section headings
 * without any array misalignment.
 */
function parseCustomerBalanceHtml(html: string): CustomerBalanceEntry[] {
  const containerStart = html.search(/<div[^>]+id=["']reportcontainer["']/i);
  const section = containerStart >= 0 ? html.substring(containerStart) : html;

  const COL_TOL = 15;
  const ROW_TOL = 4;   // pt — same logical row
  const PAGE_SEP = 9999; // effective-top offset per page (> any real page height)

  interface RawDiv  { left: number; top: number; text: string; }
  interface EDiv    { left: number; effTop: number; text: string; }

  const extractRaw = (part: string): RawDiv | null => {
    const styleM = part.match(/style="([^"]*)"/);
    if (!styleM) return null;
    const s = styleM[1];
    const lM = s.match(/left:([\d.]+)pt/);
    const tM = s.match(/top:([\d.]+)pt/);
    if (!lM || !tM) return null;
    const close = part.indexOf('>');
    if (close === -1) return null;
    const end = part.indexOf('</div>', close);
    if (end === -1) return null;
    const text = stripTags(part.substring(close + 1, end)).trim();
    return text ? { left: parseFloat(lM[1]), top: parseFloat(tM[1]), text } : null;
  };

  // ── Phase 1: build effective-top coordinates ─────────────────────────────────
  const parts = section.split('<div ');
  const allDivs: EDiv[] = [];
  let lastTop = -1;
  let pageOffset = 0;

  for (const part of parts) {
    const raw = extractRaw(part);
    if (!raw) continue;
    if (lastTop > 50 && raw.top < lastTop - 50) pageOffset += PAGE_SEP;
    lastTop = raw.top;
    allDivs.push({ left: raw.left, effTop: pageOffset + raw.top, text: raw.text });
  }

  // ── Phase 2: detect column positions from first header row ────────────────────
  const numHeader = allDivs.find(d => /^number$/i.test(d.text));
  if (!numHeader) return [];

  const hTop = numHeader.effTop;
  const colLeft: Record<string, number> = {};

  for (const d of allDivs.filter(d => Math.abs(d.effTop - hTop) < ROW_TOL)) {
    const t = d.text.trim();
    if (/^number$/i.test(t))                 colLeft.number         = d.left;
    else if (/^first\s*name$/i.test(t))      colLeft.firstName      = d.left;
    else if (/^last\s*name$/i.test(t))       colLeft.lastName       = d.left;
    else if (/^account\s*number$/i.test(t))  colLeft.accountNumber  = d.left;
    else if (/account\s*balance/i.test(t))   colLeft.accountBalance = d.left;
  }

  if (colLeft.number == null || colLeft.firstName == null || colLeft.lastName == null) return [];

  // The header row repeats at the same within-page top on every page.
  const headerTopWithinPage = hTop % PAGE_SEP;

  // ── Phase 3: bucket non-header divs into rows by effective top ───────────────
  // rowBuckets: effectiveTop (of first div placed) → array of divs
  const rowBuckets: Array<{ effTop: number; divs: EDiv[] }> = [];

  for (const d of allDivs) {
    // Skip repeated column headers (same within-page top on any page)
    if (Math.abs((d.effTop % PAGE_SEP) - headerTopWithinPage) < ROW_TOL) continue;

    // Find existing bucket within ROW_TOL
    let placed = false;
    for (const bucket of rowBuckets) {
      if (Math.abs(d.effTop - bucket.effTop) < ROW_TOL) {
        bucket.divs.push(d);
        placed = true;
        break;
      }
    }
    if (!placed) rowBuckets.push({ effTop: d.effTop, divs: [d] });
  }

  rowBuckets.sort((a, b) => a.effTop - b.effTop);

  // ── Phase 4: extract entries from each row bucket ─────────────────────────────
  const isNumericId  = (t: string) => /^\d+$/.test(t.trim());
  const isAmountText = (t: string) => /\d/.test(t) && /^[\d,.()\-£\s]+$/.test(t);
  const isNameText   = (t: string) => t.length > 0 && !isAmountText(t) && !isNumericId(t);

  const entries: CustomerBalanceEntry[] = [];

  for (const { divs } of rowBuckets) {
    // A data row must contain a Number-column div with a positive integer
    const numDiv = divs.find(d =>
      Math.abs(d.left - colLeft.number) < COL_TOL && isNumericId(d.text) && parseInt(d.text) > 0
    );
    if (!numDiv) continue;

    const custNum = parseInt(numDiv.text);

    const fnDiv  = divs.find(d => colLeft.firstName     != null && Math.abs(d.left - colLeft.firstName)     < COL_TOL && isNameText(d.text));
    const lnDiv  = divs.find(d => colLeft.lastName      != null && Math.abs(d.left - colLeft.lastName)      < COL_TOL && isNameText(d.text));
    const accDiv = divs.find(d => colLeft.accountNumber != null && Math.abs(d.left - colLeft.accountNumber) < COL_TOL && isNumericId(d.text) && d !== numDiv);
    const balDiv = divs.find(d => colLeft.accountBalance != null && Math.abs(d.left - colLeft.accountBalance) < COL_TOL && isAmountText(d.text));

    entries.push({
      customerNumber: custNum,
      firstName:      fnDiv?.text  ?? '',
      lastName:       lnDiv?.text  ?? '',
      accountNumber:  accDiv?.text ?? String(custNum),
      accountBalance: balDiv ? parseAmount(balDiv.text) : 0,
    });
  }

  return entries;
}

// --- Week ranges ---

export interface WeekRange {
  weekNumber: number;
  year: number;
  start: string; // DD/MM/YYYY
  end: string;   // DD/MM/YYYY
}

/**
 * Get all complete Mon-Sun weeks from Jan 1 of the given year up to now.
 * A week is only complete once midnight on Sunday has passed (i.e. it's Monday).
 */
export function getCompleteWeeks(year: number): WeekRange[] {
  const weeks: WeekRange[] = [];
  const now = new Date();

  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const daysToMonday = jan1Day === 0 ? 1 : jan1Day === 1 ? 0 : (8 - jan1Day);
  let monday = new Date(year, 0, 1 + daysToMonday);

  let weekNum = 1;
  while (true) {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    // Week is only complete after midnight on Sunday (i.e. Monday 00:00:00)
    const weekEnd = new Date(sunday);
    weekEnd.setDate(weekEnd.getDate() + 1); // Monday 00:00:00
    if (now < weekEnd) break;
    if (monday.getFullYear() > year) break;

    const fmt = (d: Date) => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}/${d.getFullYear()}`;
    };

    weeks.push({ weekNumber: weekNum, year, start: fmt(monday), end: fmt(sunday) });

    weekNum++;
    monday = new Date(monday);
    monday.setDate(monday.getDate() + 7);
  }

  return weeks;
}

/**
 * Fetch and parse a weekly report from the TouchOffice homepage.
 */
export async function fetchWeeklyReport(
  sessionCookie: string,
  startDate: string,
  endDate: string
): Promise<WeeklyReport> {
  const html = await fetchHomepage(sessionCookie, startDate, endDate);

  // Check if we got the login form instead of data
  if (html.includes('name="submit-login"')) {
    throw new Error('Session expired. Please sign in again.');
  }

  const { departments, fixedTotals, transactionKeys } = parseHomepageTables(html);

  if (departments.length === 0) {
    // Temp: include key markers so we can diagnose server-side vs browser HTML differences
    const hasWidget = html.includes('data-widget-name="department_sales_total"');
    const hasTextarea = html.includes('name="reportdata"');
    const hasDataTable = html.includes('id="deptSales"');
    const hasLoaded = html.includes('data-loaded="true"');
    throw new Error(`No dept data. widget:${hasWidget} textarea:${hasTextarea} datatable:${hasDataTable} loaded:${hasLoaded} len:${html.length}`);
  }

  const total = departments.reduce((sum, d) => sum + d.value, 0);

  return {
    startDate,
    endDate,
    departments,
    fixedTotals,
    transactionKeys,
    total,
    fetchedAt: new Date().toISOString(),
  };
}

// TouchOffice customer group IDs
export const TO_GROUP_MEMBERS = 1;
export const TO_GROUP_SOCIAL = 2;
export const TO_GROUP_DEAD_CARDS = 3;

// TouchOffice customer flag bitmask values
export const TO_FLAG_BLACKLISTED = 1;

/**
 * Update a TouchOffice customer card's fields.
 * Uses the field[num][fieldname] POST format discovered from browser devtools.
 * Only sends the fields you provide — unchanged fields are left alone.
 */
export async function updateCustomerCard(
  db: any,
  env: any,
  touchofficeNum: number,
  fields: {
    firstname?: string;
    lastname?: string;
    longname?: string;
    accountnumber?: string | number;
    custgroup?: number;
    flag?: number;
  }
): Promise<{ ok: boolean; error?: string }> {
  const { session } = await ensureSession(db, env);
  const cookie = `icrtouch_connect_login_id=${session}`;
  const num = String(touchofficeNum);
  const editUrl = `${BASE_URL}/apps/editcustomerdetails?num=${num}`;

  const params = new URLSearchParams();
  if (fields.firstname !== undefined) params.set(`field[${num}][firstname]`, fields.firstname);
  if (fields.lastname !== undefined) params.set(`field[${num}][lastname]`, fields.lastname);
  if (fields.longname !== undefined) params.set(`field[${num}][longname]`, fields.longname);
  if (fields.accountnumber !== undefined) params.set(`field[${num}][accountnumber]`, String(fields.accountnumber));
  if (fields.custgroup !== undefined) params.set(`field[${num}][custgroup]`, String(fields.custgroup));
  if (fields.flag !== undefined) params.set(`field[${num}][flag]`, String(fields.flag));
  params.set('submit-savecustomer', '');

  const res = await fetch(editUrl, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': BASE_URL,
      'Referer': editUrl,
    },
    body: params.toString(),
  });

  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const html = await res.text();
  if (html.includes('name="submit-login"')) return { ok: false, error: 'Session expired' };
  return { ok: true };
}
