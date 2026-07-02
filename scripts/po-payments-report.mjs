/**
 * Report: Cash payments from PO (Post Office) — 5 Jan 2026 to 9 Feb 2026
 * Run: node scripts/po-payments-report.mjs
 */

import { execSync } from 'child_process';

const FROM_DATE = '2026-01-05';
const TO_DATE   = '2026-02-09';
const SAGE_API  = 'https://api.accounting.sage.com/v3.1';

// ── Get token from D1 ──────────────────────────────────────────────────────
function getTokenFromD1() {
  const raw = execSync(
    `npx wrangler d1 execute alnmouth-golf-db --remote --command="SELECT access_token, refresh_token, token_expires_at, id FROM sage_tokens ORDER BY id LIMIT 1" --json 2>/dev/null`,
    { encoding: 'utf8', cwd: process.cwd() }
  );
  const results = JSON.parse(raw);
  return results[0]?.results?.[0];
}

function saveToken(id, access_token, refresh_token, token_expires_at) {
  const escaped = access_token.replace(/'/g, "''");
  const escapedR = refresh_token.replace(/'/g, "''");
  execSync(
    `npx wrangler d1 execute alnmouth-golf-db --remote --command="UPDATE sage_tokens SET access_token='${escaped}', refresh_token='${escapedR}', token_expires_at='${token_expires_at}', updated_at=datetime('now') WHERE id=${id}" 2>/dev/null`,
    { encoding: 'utf8', cwd: process.cwd() }
  );
}

async function getValidToken() {
  const row = getTokenFromD1();
  if (!row) throw new Error('No Sage token in D1');

  const expiresAt = new Date(row.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60000) {
    return row.access_token;
  }

  // Refresh
  console.log('Token expired — refreshing…');
  const clientId     = process.env.SAGE_CLIENT_ID;
  const clientSecret = process.env.SAGE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SAGE_CLIENT_ID / SAGE_CLIENT_SECRET env vars not set. Export them first.');
  }

  const res = await fetch('https://oauth.accounting.sage.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  const now  = Date.now();
  const newExpiry = new Date(now + data.expires_in * 1000).toISOString();
  saveToken(row.id, data.access_token, data.refresh_token, newExpiry);
  return data.access_token;
}

// ── Sage API fetch helper ──────────────────────────────────────────────────
async function fetchAll(token, path, params = {}) {
  const items = [];
  let page = 1;
  while (true) {
    const url = new URL(`${SAGE_API}${path}`);
    url.searchParams.set('items_per_page', '200');
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`GET ${path} failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    items.push(...(data.$items ?? []));
    if (!data.$next) break;
    page++;
    if (page > 50) break;
  }
  return items;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) {
  const num = parseFloat(n) || 0;
  return `£${num.toFixed(2).padStart(10)}`;
}
function col(str, width) {
  const s = String(str ?? '');
  return s.length >= width ? s.slice(0, width - 1) + '…' : s.padEnd(width);
}
function isInRange(dateStr) {
  return dateStr >= FROM_DATE && dateStr <= TO_DATE;
}
function isPO(str) {
  if (!str) return false;
  const s = str.toLowerCase();
  return s.includes('post office') || s.includes('p.o.') ||
         /\bpo\b/.test(s) || s.includes('postoffice');
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  PO (Post Office) Cash Payments Report`);
  console.log(`  Period: ${FROM_DATE} to ${TO_DATE}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  const token = await getValidToken();
  const allRows = [];

  // 1) Contact payments (receipts from customers)
  console.log('Fetching contact payments…');
  const contactPayments = await fetchAll(token, '/contact_payments', {
    from_date: FROM_DATE,
    to_date:   TO_DATE,
  });
  for (const p of contactPayments) {
    const ref   = p.reference ?? '';
    const desc  = p.description ?? '';
    const cname = p.contact?.displayed_as ?? '';
    const bank  = p.bank_account?.displayed_as ?? '';
    if (isPO(ref) || isPO(desc) || isPO(cname) || isPO(bank)) {
      allRows.push({
        source:   'Contact Payment',
        date:     p.date ?? '',
        ref:      ref || desc,
        contact:  cname,
        bank:     bank,
        amount:   p.total_amount ?? p.amount ?? 0,
        type:     p.payment_method?.displayed_as ?? 'Cash',
      });
    }
  }

  // 2) Other payments/receipts
  console.log('Fetching other payments…');
  const otherPayments = await fetchAll(token, '/other_payments', {
    from_date: FROM_DATE,
    to_date:   TO_DATE,
  });
  for (const p of otherPayments) {
    const ref  = p.reference ?? '';
    const desc = p.description ?? '';
    const bank = p.bank_account?.displayed_as ?? '';
    if (isPO(ref) || isPO(desc) || isPO(bank)) {
      allRows.push({
        source:  'Other Payment',
        date:    p.date ?? '',
        ref:     ref || desc,
        contact: '',
        bank:    bank,
        amount:  p.total_amount ?? p.amount ?? 0,
        type:    p.payment_method?.displayed_as ?? 'Cash',
      });
    }
  }

  // 3) Bank transactions (catches anything posted directly to a bank account)
  console.log('Fetching bank transactions…');
  try {
    const bankTxns = await fetchAll(token, '/bank_transactions', {
      from_date: FROM_DATE,
      to_date:   TO_DATE,
    });
    for (const t of bankTxns) {
      const ref  = t.reference ?? '';
      const desc = t.description ?? t.details ?? '';
      const bank = t.bank_account?.displayed_as ?? '';
      if (isPO(ref) || isPO(desc) || isPO(bank)) {
        allRows.push({
          source:  'Bank Txn',
          date:    t.date ?? '',
          ref:     ref || desc,
          contact: t.contact?.displayed_as ?? '',
          bank:    bank,
          amount:  t.total_amount ?? t.amount ?? 0,
          type:    t.transaction_type?.displayed_as ?? '—',
        });
      }
    }
  } catch (e) {
    console.log(`  (bank_transactions skipped: ${e.message.split('\n')[0]})`);
  }

  // 4) Ledger entries — broadest net, covers all posted transactions
  console.log('Fetching ledger entries…');
  try {
    const ledger = await fetchAll(token, '/ledger_entries', {
      from_date: FROM_DATE,
      to_date:   TO_DATE,
    });
    for (const e of ledger) {
      const ref  = e.reference ?? '';
      const desc = e.description ?? e.details ?? '';
      const contact = e.contact?.displayed_as ?? '';
      if (isPO(ref) || isPO(desc) || isPO(contact)) {
        allRows.push({
          source:  'Ledger Entry',
          date:    e.date ?? '',
          ref:     ref || desc,
          contact: contact,
          bank:    e.ledger_account?.displayed_as ?? '',
          amount:  e.debit_amount ?? e.credit_amount ?? e.amount ?? 0,
          type:    e.transaction_type?.displayed_as ?? '—',
        });
      }
    }
  } catch (e) {
    console.log(`  (ledger_entries skipped: ${e.message.split('\n')[0]})`);
  }

  // Sort by date
  allRows.sort((a, b) => a.date.localeCompare(b.date));

  // ── Print report ──────────────────────────────────────────────────────
  if (allRows.length === 0) {
    console.log('\n  No PO / Post Office payments found in this period.\n');
    console.log('  Tip: PO matching looks for "post office", "p.o.", or standalone "po" in');
    console.log('  reference, description, contact name, or bank account name.\n');
  } else {
    const header = [
      col('Date',       12),
      col('Source',     18),
      col('Reference',  28),
      col('Contact',    24),
      col('Bank Account', 28),
      'Amount'.padStart(12),
    ].join('  ');
    const divider = '─'.repeat(header.length);
    console.log(header);
    console.log(divider);

    let total = 0;
    for (const r of allRows) {
      console.log([
        col(r.date,    12),
        col(r.source,  18),
        col(r.ref,     28),
        col(r.contact, 24),
        col(r.bank,    28),
        fmt(r.amount),
      ].join('  '));
      total += parseFloat(r.amount) || 0;
    }

    console.log('─'.repeat(header.length));
    console.log(`${'Total'.padStart(header.length - 12)}${fmt(total)}`);
    console.log(`\n  ${allRows.length} payment(s) found.\n`);
  }

  // Also print totals by endpoint if multiple sources
  const bySource = {};
  for (const r of allRows) {
    bySource[r.source] = (bySource[r.source] || 0) + (parseFloat(r.amount) || 0);
  }
  if (Object.keys(bySource).length > 1) {
    console.log('  By source:');
    for (const [src, amt] of Object.entries(bySource)) {
      console.log(`    ${col(src, 20)}  ${fmt(amt)}`);
    }
    console.log('');
  }
})().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
