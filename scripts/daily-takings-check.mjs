#!/usr/bin/env node
/**
 * Daily takings dummy run — read-only.
 *
 * For every day in the range: fetch TouchOffice department totals, build the
 * Other Receipt exactly as the CRM would post it (same code), and compare it
 * with the till receipt(s) already in Sage. Nothing is written anywhere except
 * a CSV. Uses the same library as the admin page so the two cannot drift.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/daily-takings-check.mjs \
 *        --from 2026-01-01 --to 2026-09-28 [--role live] [--out data/daily-takings-check.csv]
 *
 * TouchOffice login: TOUCHOFFICE_USERNAME / TOUCHOFFICE_PASSWORD in .dev.vars
 * (falls back to the session the CRM last stored in D1).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadDevVars, d1, getSageToken, sageGetAll, REPO } from './lib/sage-token.mjs';
import { loginForSession, fetchHomepage, parseHomepageTables } from '../src/lib/touchoffice.ts';
import {
  DEFAULT_MAPPINGS, DEFAULT_BANK_NOMINAL, buildReceipt, compareDay, isTillReceipt,
  normaliseSageReceipt, dateRange, toTouchOfficeDate, addDays, todayInLondon,
} from '../src/lib/daily-takings.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? 'true'] : []).filter(x => x.length));
const TO = args.to ?? addDays(todayInLondon(), -1);
const FROM = args.from ?? addDays(TO, -13);
const ROLE = args.role ?? 'live';
const OUT = args.out ?? path.join(REPO, 'data', `daily-takings-check-${FROM}_${TO}.csv`);
const vars = loadDevVars();

// ── TouchOffice session ────────────────────────────────────────────────────
let session;
if (vars.TOUCHOFFICE_USERNAME && vars.TOUCHOFFICE_PASSWORD) {
  ({ session } = await loginForSession(vars.TOUCHOFFICE_USERNAME, vars.TOUCHOFFICE_PASSWORD));
  console.log('TouchOffice: logged in');
} else {
  session = d1(`SELECT value FROM app_settings WHERE key='touchoffice_session'`)[0]?.value;
  console.log('TouchOffice: using the session stored by the CRM (add TOUCHOFFICE_USERNAME/PASSWORD to .dev.vars to log in directly)');
}
const probe = await fetchHomepage(session, toTouchOfficeDate(TO), toTouchOfficeDate(TO), ['departmentSalesTotal']);
if (probe.includes('not logged in') || probe.includes('name="submit-login"')) {
  console.error('TouchOffice session is not valid. Put TOUCHOFFICE_USERNAME and TOUCHOFFICE_PASSWORD in .dev.vars.');
  process.exit(2);
}

// ── Sage: every till receipt in the range, one pass ───────────────────────
const token = await getSageToken(ROLE);
const raws = await sageGetAll(token, '/other_payments', {
  from_date: FROM, to_date: TO, transaction_type_id: 'OTHER_RECEIPT', attributes: 'all',
});
const byDate = new Map();
for (const r of raws) {
  if (!isTillReceipt(r, DEFAULT_BANK_NOMINAL)) continue;
  if (!byDate.has(r.date)) byDate.set(r.date, []);
  byDate.get(r.date).push(normaliseSageReceipt(r));
}
console.log(`Sage (${ROLE}): ${[...byDate.values()].flat().length} till receipts between ${FROM} and ${TO}\n`);

// ── Day by day ────────────────────────────────────────────────────────────
const f = n => n.toFixed(2).padStart(9);
const rows = [['date', 'status', 'touchoffice_total', 'sage_total', 'delta', 'sage_entries', 'issues', 'notes', 'proposed_lines']];
const counts = {};
for (const date of dateRange(FROM, TO)) {
  const html = await fetchHomepage(session, toTouchOfficeDate(date), toTouchOfficeDate(date), ['departmentSalesTotal']);
  if (html.includes('name="submit-login"')) throw new Error('TouchOffice session expired mid-run');
  const departments = parseHomepageTables(html).departments;
  const proposed = buildReceipt(date, departments, DEFAULT_MAPPINGS);
  const cmp = compareDay(proposed, byDate.get(date) ?? []);
  counts[cmp.status] = (counts[cmp.status] ?? 0) + 1;
  const issues = cmp.diffs.filter(d => d.issues.length).map(d => `${d.ledger_name.replace(/ \(\d+\)/, '')}: ${d.issues.join(', ')}`).join(' | ');
  const mark = cmp.status === 'match' ? '  ' : cmp.status === 'no_sales' ? '· ' : '!!';
  console.log(`${mark} ${date}  TO ${f(cmp.proposed_total)}  Sage ${f(cmp.sage_total)}  Δ ${f(cmp.delta)}  ${cmp.status.padEnd(15)} ${issues}${cmp.notes.length ? '  [' + cmp.notes.join('; ') + ']' : ''}`);
  rows.push([date, cmp.status, cmp.proposed_total, cmp.sage_total, cmp.delta, cmp.entries, issues, cmp.notes.join('; '),
    proposed.lines.map(l => `${l.nominal_code} ${l.tax_rate_id} gross ${l.total} net ${l.net} vat ${l.tax}`).join(' | ')]);
  await new Promise(r => setTimeout(r, 250));
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));
console.log('\nSummary:', counts);
console.log('CSV:', OUT);
