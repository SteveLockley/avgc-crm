/**
 * 21-week receipts reconciliation summary — w/c 5 Jan 2026
 * Fetches all data in one pass then calculates each week's till vs banked difference.
 *
 * Run:  node scripts/weekly-receipts-21weeks.mjs
 */

import { execSync } from 'child_process';

const FIRST_MONDAY = '2026-01-05';
const NUM_WEEKS    = 10;
const SAGE_API     = 'https://api.accounting.sage.com/v3.1';

// ── Token ──────────────────────────────────────────────────────────────────
async function getToken() {
  const row = JSON.parse(execSync(
    `npx wrangler d1 execute alnmouth-golf-db --remote --command="SELECT * FROM sage_tokens LIMIT 1" --json 2>/dev/null`,
    { encoding: 'utf8' }
  ))[0].results[0];

  const expiresAt = new Date(row.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60000) return row.access_token;

  const res = await fetch('https://oauth.accounting.sage.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: row.refresh_token,
      client_id: process.env.SAGE_CLIENT_ID, client_secret: process.env.SAGE_CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const td = await res.json();
  const expiry = new Date(Date.now() + td.expires_in * 1000).toISOString();
  const ea = td.access_token.replace(/'/g, "''");
  const er = td.refresh_token.replace(/'/g, "''");
  execSync(
    `npx wrangler d1 execute alnmouth-golf-db --remote --command="UPDATE sage_tokens SET access_token='${ea}', refresh_token='${er}', token_expires_at='${expiry}' WHERE id=${row.id}" 2>/dev/null`,
    { encoding: 'utf8' }
  );
  return td.access_token;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function fetchAll(token, path, params = {}) {
  const items = []; let page = 1;
  while (true) {
    const url = new URL(`${SAGE_API}${path}`);
    url.searchParams.set('items_per_page', '200');
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { console.error(`SKIP ${path}: ${res.status}`); return items; }
    const data = await res.json();
    items.push(...(data.$items ?? []));
    if (!data.$next) break;
    page++; if (page > 50) break;
  }
  return items;
}

async function fetchFull(token, summaries) {
  const out = [];
  for (let i = 0; i < summaries.length; i += 20) {
    const batch = summaries.slice(i, i + 20);
    const res = await Promise.all(
      batch.map(s => fetch(`${SAGE_API}${s.$path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()))
    );
    out.push(...res);
  }
  return out;
}

// ── Date helpers ───────────────────────────────────────────────────────────
function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmt(n) {
  const v = parseFloat(n || 0);
  const s = Math.abs(v).toFixed(2).padStart(10);
  return v < 0 ? `-£${s}` : ` £${s}`;
}

// ── Build week definitions ─────────────────────────────────────────────────
const weeks = [];
for (let i = 0; i < NUM_WEEKS; i++) {
  const weekFrom = addDays(FIRST_MONDAY, i * 7);
  const tillTo   = addDays(weekFrom, 6);   // Sunday
  const weekTo   = addDays(weekFrom, 7);   // Monday (P.O. banking / Dojo end)
  const dojoFrom = addDays(weekFrom, 1);   // Tuesday
  weeks.push({ weekFrom, tillTo, weekTo, dojoFrom });
}

const periodFrom = weeks[0].dojoFrom;                          // Tue 6 Jan
const periodTo   = addDays(weeks[NUM_WEEKS - 1].weekTo, 14);  // buffer for late P.O.

// ── Fetch everything ───────────────────────────────────────────────────────
const token = await getToken();

process.stdout.write(`Fetching bank transfers ${periodFrom} → ${periodTo}…`);
const xferSummaries = await fetchAll(token, '/bank_transfers', { from_date: periodFrom, to_date: periodTo });
process.stdout.write(` ${xferSummaries.length} summaries. Fetching full details…\n`);
const allXfers = await fetchFull(token, xferSummaries);

process.stdout.write(`Fetching till receipts ${weeks[0].weekFrom} → ${weeks[NUM_WEEKS - 1].tillTo}…`);
const tillSummaries = await fetchAll(token, '/other_payments', {
  from_date: weeks[0].weekFrom,
  to_date:   weeks[NUM_WEEKS - 1].tillTo,
});
process.stdout.write(` ${tillSummaries.length} summaries. Fetching full details…\n`);
const allTill = await fetchFull(token, tillSummaries);

// Pre-filter to only date-named OTHER_RECEIPT entries to the till
const tillEntries = allTill.filter(e =>
  /^\d{4}-\d{2}-\d{2}$/.test(e.displayed_as ?? '') &&
  e.transaction_type?.id === 'OTHER_RECEIPT'
);
const dojoXfers = allXfers.filter(t => /paymentsense.*dojo/i.test(t.displayed_as ?? ''));
const poXfers   = allXfers.filter(t => (t.displayed_as ?? '').toUpperCase().includes('CASH IN P.O'));

console.log(`\nFiltered: ${tillEntries.length} till entries, ${dojoXfers.length} Dojo transfers, ${poXfers.length} P.O. transfers\n`);

// ── Calculate per week ─────────────────────────────────────────────────────
const results = [];

for (const { weekFrom, tillTo, weekTo, dojoFrom } of weeks) {
  const till = tillEntries.filter(e => e.date >= weekFrom && e.date <= tillTo);
  const dojo = dojoXfers.filter(t => t.date >= dojoFrom && t.date <= weekTo);

  // P.O.: dated on or after the Sunday (tillTo), within window; if none, first one after tillTo
  let po = poXfers.filter(t => t.date >= tillTo && t.date <= weekTo);
  if (po.length === 0) {
    const late = poXfers.filter(t => t.date > tillTo).sort((a, b) => a.date.localeCompare(b.date));
    if (late.length > 0) po = [late[0]];
  }

  const tillTotal  = till.reduce((s, e) => s + parseFloat(e.total_amount || 0), 0);
  const dojoTotal  = dojo.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const poTotal    = po.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const banked     = dojoTotal + poTotal;
  const diff       = banked - tillTotal;
  const poDate     = po.length > 0 ? po[0].date : '—';
  const poLate     = po.length > 0 && poDate > weekTo ? ` (late: ${poDate})` : '';

  results.push({ weekFrom, tillTo, weekTo, tillTotal, dojoTotal, poTotal, banked, diff, poDate, poLate, tillCount: till.length, dojoCount: dojo.length });
}

// ── Print table ────────────────────────────────────────────────────────────
const divider = '─'.repeat(110);
console.log(`╔${'═'.repeat(108)}╗`);
console.log(`║  21-Week Receipts Reconciliation  ·  w/c ${FIRST_MONDAY}  ·  ${NUM_WEEKS} weeks`.padEnd(109) + '║');
console.log(`╚${'═'.repeat(108)}╝`);
console.log(`\n${'Week'.padEnd(6)}${'Mon–Sun'.padEnd(24)}${'Till (7d)'.padStart(13)}  ${'Dojo (7)'.padStart(13)}  ${'P.O.'.padStart(13)}  ${'Banked'.padStart(13)}  ${'Difference'.padStart(13)}  Notes`);
console.log(divider);

let grandTill = 0, grandDojo = 0, grandPO = 0, grandBanked = 0, grandDiff = 0;
let mismatches = 0;

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  grandTill   += r.tillTotal;
  grandDojo   += r.dojoTotal;
  grandPO     += r.poTotal;
  grandBanked += r.banked;
  grandDiff   += r.diff;

  const balanced = Math.abs(r.diff) < 0.01;
  if (!balanced) mismatches++;
  const flag = balanced ? '✓' : Math.abs(r.diff) < 50 ? '~' : '⚠';
  const warn = r.tillCount !== 7 ? ` till:${r.tillCount}d` : '';
  const dojowarn = r.dojoCount !== 7 ? ` dojo:${r.dojoCount}` : '';

  console.log(
    `${String(i + 1).padStart(3)}.  ${r.weekFrom} – ${r.tillTo}  ` +
    `${fmt(r.tillTotal)}  ${fmt(r.dojoTotal)}  ${fmt(r.poTotal)}  ${fmt(r.banked)}  ${fmt(r.diff)}  ${flag}${r.poLate}${warn}${dojowarn}`
  );
}

console.log(divider);
console.log(
  `${'TOTAL'.padEnd(30)}  ${fmt(grandTill)}  ${fmt(grandDojo)}  ${fmt(grandPO)}  ${fmt(grandBanked)}  ${fmt(grandDiff)}`
);
console.log(`\n  ${mismatches} week(s) with a mismatch > £0.01`);
console.log(`  Overall difference (banked − till): ${fmt(grandDiff)}\n`);
