/**
 * Weekly Receipts Report — w/c 2 Feb 2026
 *
 * Sources:
 *   bank_transfers  → Dojo (Paymentsense LimitDOJOxxF) and P.O. (CASH IN P.O. …)
 *   other_payments  → daily Other Receipts (date-named entries to Money In Till)
 *
 * Run:  node scripts/weekly-receipts-report.mjs
 */

import { execSync } from 'child_process';

const WEEK_FROM = '2026-02-02'; // Monday — week start (till receipts from here)
const WEEK_TO   = '2026-02-09'; // Monday — P.O. banking day / Dojo window end
const TILL_TO   = '2026-02-08'; // Sunday — till receipts Mon–Sun only
const DOJO_FROM = '2026-02-03'; // Tuesday — Dojo settlements run Tue–Mon (one day lag)
const DOJO_TO   = '2026-02-09'; // Monday — last Dojo settlement for this week
const SAGE_API  = 'https://api.accounting.sage.com/v3.1';

// ── Token management ───────────────────────────────────────────────────────
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

// ── Sage fetch helpers ─────────────────────────────────────────────────────
async function fetchAll(token, path, params = {}) {
  const items = []; let page = 1;
  while (true) {
    const url = new URL(`${SAGE_API}${path}`);
    url.searchParams.set('items_per_page', '200');
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { console.log(`  SKIP ${path}: ${res.status}`); return items; }
    const data = await res.json();
    items.push(...(data.$items ?? []));
    if (!data.$next) break;
    page++; if (page > 20) break;
  }
  return items;
}

async function fetchFull(token, summaries) {
  const out = [];
  for (let i = 0; i < summaries.length; i += 20) {
    const batch = summaries.slice(i, i + 20);
    const results = await Promise.all(
      batch.map(s => fetch(`${SAGE_API}${s.$path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()))
    );
    out.push(...results);
  }
  return out;
}

// ── Formatters ─────────────────────────────────────────────────────────────
const fmt   = n  => `£${parseFloat(n || 0).toFixed(2).padStart(10)}`;
const col   = (s, w) => { const str = String(s ?? ''); return str.length >= w ? str.slice(0, w - 1) + '…' : str.padEnd(w); };
const day   = d  => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
const divider = '─'.repeat(90);

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const token = await getToken();

  // Fetch bank transfers (Dojo + P.O.)
  process.stdout.write('Fetching bank transfers…');
  const xferSummaries = await fetchAll(token, '/bank_transfers', { from_date: DOJO_FROM, to_date: WEEK_TO });
  const xfers = await fetchFull(token, xferSummaries);
  process.stdout.write(` ${xfers.length}\n`);

  // Fetch daily till receipts (Other Receipts to Money In Till) — Mon to Sun only
  process.stdout.write('Fetching till receipts…');
  const tillSummaries = await fetchAll(token, '/other_payments', { from_date: WEEK_FROM, to_date: TILL_TO });
  const tillFull = await fetchFull(token, tillSummaries);
  process.stdout.write(` ${tillFull.length}\n\n`);

  // Categorise transfers
  const dojo = xfers.filter(t => /paymentsense.*dojo/i.test(t.displayed_as ?? ''));

  // P.O. cash banking is done at end of week. Only entries dated on or after TILL_TO
  // (the Sunday) belong to this week — earlier ones are late carry-overs from prior weeks.
  // If none found in window, search forward for the first P.O. entry after TILL_TO.
  let po = xfers.filter(t => (t.displayed_as ?? '').toUpperCase().includes('CASH IN P.O') && (t.date ?? '') >= TILL_TO);
  if (po.length === 0) {
    process.stdout.write('No P.O. in window — searching ahead…');
    // Look up to 4 weeks forward
    const lookAheadEnd = new Date(WEEK_TO);
    lookAheadEnd.setDate(lookAheadEnd.getDate() + 28);
    const aheadSummaries = await fetchAll(token, '/bank_transfers', {
      from_date: WEEK_TO,
      to_date: lookAheadEnd.toISOString().slice(0, 10),
    });
    const aheadFull = await fetchFull(token, aheadSummaries.filter(t => (t.displayed_as ?? '').toUpperCase().includes('CASH IN P.O')));
    // Take only the first one (earliest date after TILL_TO)
    const late = aheadFull
      .filter(t => (t.date ?? '') > TILL_TO)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    po = late.length > 0 ? [late[0]] : [];
    process.stdout.write(po.length > 0 ? ` found on ${po[0].date}\n` : ' none found\n');
  }

  // Daily till receipts — date-named OTHER_RECEIPT entries to Money In Till
  const till = tillFull
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.displayed_as ?? '') && e.transaction_type?.id === 'OTHER_RECEIPT')
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  // ── Report header ────────────────────────────────────────────────────────
  console.log(`╔${'═'.repeat(88)}╗`);
  console.log(`║  Weekly Receipts Report  ·  ${WEEK_FROM} to ${WEEK_TO}  (Till: Mon–Sun  Dojo: Tue–Mon)`.padEnd(89) + '║');
  console.log(`╚${'═'.repeat(88)}╝`);

  // ── P.O. Cash Receipts ───────────────────────────────────────────────────
  console.log(`\n${'━'.repeat(90)}`);
  console.log(`  P.O. Cash Receipts  (${po.length} found)`);
  console.log('━'.repeat(90));
  if (po.length === 0) {
    console.log('\n  ⚠  No CASH IN P.O. transfers found for this period.');
  } else {
    console.log(`\n${col('Date', 14)}${col('Reference', 32)}${col('From', 26)}${col('To', 24)}  ${'Amount'.padStart(12)}`);
    console.log(divider);
    let total = 0;
    for (const t of po.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
      const amt = parseFloat(t.amount || 0);
      total += amt;
      console.log(
        `${col(day(t.date), 14)}${col(t.displayed_as, 32)}${col(t.from_bank_account?.displayed_as ?? '', 26)}${col(t.to_bank_account?.displayed_as ?? '', 24)}  ${fmt(amt)}`
      );
    }
    console.log(divider);
    console.log(`${'TOTAL'.padEnd(106 - 14)}  ${fmt(total)}`);
  }

  // ── Dojo Transfers ───────────────────────────────────────────────────────
  console.log(`\n${'━'.repeat(90)}`);
  console.log(`  Dojo (Paymentsense) Transfers — ${DOJO_FROM} to ${DOJO_TO} (Tue–Mon)  (${dojo.length} entries)`);
  console.log('━'.repeat(90));
  if (dojo.length === 0) {
    console.log('\n  ⚠  No Dojo transfers found.');
  } else {
    console.log(`\n${col('Date', 14)}${col('Reference', 32)}${col('From', 26)}${col('To', 24)}  ${'Amount'.padStart(12)}`);
    console.log(divider);
    let total = 0;
    for (const t of dojo.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
      const amt = parseFloat(t.amount || 0);
      total += amt;
      console.log(
        `${col(day(t.date), 14)}${col(t.displayed_as, 32)}${col(t.from_bank_account?.displayed_as ?? '', 26)}${col(t.to_bank_account?.displayed_as ?? '', 24)}  ${fmt(amt)}`
      );
    }
    console.log(divider);
    console.log(`${'TOTAL'.padEnd(106 - 14)}  ${fmt(total)}`);
  }

  // ── Daily Till Receipts ───────────────────────────────────────────────────
  console.log(`\n${'━'.repeat(90)}`);
  console.log(`  Daily Till Receipts — ${WEEK_FROM} to ${TILL_TO} (Mon–Sun)  (${till.length} entries)`);
  console.log('━'.repeat(90));
  if (till.length === 0) {
    console.log('\n  ⚠  No daily till receipts found.');
  } else {
    // Fixed columns
    const FIXED = [
      { label: 'Bar',        rx: /bar sales/i },
      { label: 'Food',       rx: /food sales/i },
      { label: 'Green Fees', rx: /green fee/i },
      { label: 'Coffee',     rx: /coffee/i },
    ];

    // Discover all "other" ledger accounts across the week
    const otherAccounts = new Map(); // name → short label
    for (const e of till) {
      for (const l of (e.payment_lines ?? [])) {
        const name = l.ledger_account?.displayed_as ?? '';
        if (!name) continue;
        if (FIXED.some(f => f.rx.test(name))) continue;
        if (!otherAccounts.has(name)) {
          // Shorten: strip nominal code in parens, trim
          const short = name.replace(/\s*\(\d+\)\s*$/, '').trim();
          otherAccounts.set(name, short);
        }
      }
    }
    const otherCols = [...otherAccounts.entries()]; // [fullName, shortLabel]

    // Column widths
    const W = 10;
    const fixedHdr  = FIXED.map(f => f.label.padStart(W + 2)).join('  ');
    const otherHdr  = otherCols.map(([, s]) => s.slice(0, W).padStart(W)).join('  ');
    const totalHdr  = 'Total'.padStart(12);
    const rowPrefix = 28; // date + day columns
    const fullDiv   = '─'.repeat(rowPrefix + (FIXED.length * (W + 2)) + (otherCols.length * (W + 2)) + 14);

    console.log(`\n${col('Date', 14)}${col('Day', 14)}${fixedHdr}  ${otherHdr}  ${totalHdr}`);
    console.log(fullDiv);

    const totals = new Map([...FIXED.map(f => [f.label, 0]), ...otherCols.map(([n]) => [n, 0]), ['grand', 0]]);

    for (const e of till) {
      const lines = e.payment_lines ?? [];
      const get   = rx => lines.filter(l => rx.test(l.ledger_account?.displayed_as ?? '')).reduce((s, l) => s + parseFloat(l.total_amount || 0), 0);
      const total = parseFloat(e.total_amount || 0);

      const fixedVals = FIXED.map(f => get(f.rx));
      const otherVals = otherCols.map(([name]) => {
        return lines.filter(l => l.ledger_account?.displayed_as === name).reduce((s, l) => s + parseFloat(l.total_amount || 0), 0);
      });

      FIXED.forEach((f, i) => totals.set(f.label, totals.get(f.label) + fixedVals[i]));
      otherCols.forEach(([name], i) => totals.set(name, totals.get(name) + otherVals[i]));
      totals.set('grand', totals.get('grand') + total);

      const fixedStr = fixedVals.map(v => `£${v.toFixed(2).padStart(W)}`).join('  ');
      const otherStr = otherVals.map(v => (v === 0 ? '' : `£${v.toFixed(2)}`).padStart(W)).join('  ');
      console.log(`${col(e.date, 14)}${col(day(e.date), 14)}  ${fixedStr}  ${otherStr}  ${fmt(total)}`);
    }

    console.log(fullDiv);
    const fixedTotStr = FIXED.map(f => `£${totals.get(f.label).toFixed(2).padStart(W)}`).join('  ');
    const otherTotStr = otherCols.map(([name]) => `£${totals.get(name).toFixed(2).padStart(W)}`).join('  ');
    console.log(`${'TOTAL'.padEnd(rowPrefix - 2)}  ${fixedTotStr}  ${otherTotStr}  ${fmt(totals.get('grand'))}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const poTotal   = po.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const dojoTotal = dojo.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const tillTotal = till.reduce((s, e) => s + parseFloat(e.total_amount || 0), 0);

  console.log(`\n${'━'.repeat(90)}`);
  console.log('  Summary');
  console.log('━'.repeat(90));
  const bankedTotal = poTotal + dojoTotal;
  const diff        = bankedTotal - tillTotal;
  const balanced    = Math.abs(diff) < 0.01;
  const line        = '─'.repeat(60);

  console.log(`\n  TILL RECEIPTS (money in)\n  ${line}`);
  for (const e of till) {
    console.log(`  ${col(day(e.date), 16)}${col(e.date, 14)}${fmt(e.total_amount)}`);
  }
  console.log(`  ${line}`);
  console.log(`  ${'TOTAL TILL'.padEnd(30)}${fmt(tillTotal)}`);

  console.log(`\n  BANKED (P.O. + Dojo)\n  ${line}`);
  for (const t of [...po, ...dojo].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
    console.log(`  ${col(day(t.date), 16)}${col(t.displayed_as, 32)}${fmt(t.amount)}  ${t.from_bank_account?.displayed_as ?? ''}`);
  }
  console.log(`  ${line}`);
  console.log(`  ${'P.O.'.padEnd(30)}${fmt(poTotal)}`);
  console.log(`  ${'Dojo'.padEnd(30)}${fmt(dojoTotal)}`);
  console.log(`  ${'─'.repeat(60)}`);
  console.log(`  ${'TOTAL BANKED'.padEnd(30)}${fmt(bankedTotal)}`);

  console.log(`\n  ${line}`);
  console.log(`  ${'DIFFERENCE (banked − till)'.padEnd(30)}${fmt(diff)}   ${balanced ? '✓ BALANCED' : '⚠  MISMATCH'}\n`);

})().catch(err => { console.error('\nError:', err.message); process.exit(1); });
