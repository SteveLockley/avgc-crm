#!/usr/bin/env node
/**
 * VAT partial exemption for one VAT quarter — read-only, straight from Sage.
 * Same code as the finance page (/admin/sage/vat-partial-exemption).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/vat-partial-exemption.mjs \
 *        --quarter 2026-Q3 [--out data/vat-pe-2026-Q3.json]
 *   node --import ./scripts/lib/register-ts.mjs scripts/vat-partial-exemption.mjs \
 *        --from 2026-04-01 --to 2026-09-30
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getSageToken, SAGE_API, REPO } from './lib/sage-token.mjs';
import { fetchPeriodData } from '../src/lib/vat-partial-exemption-sage.ts';
import { computePartialExemption, vatQuarter, lastCompletedQuarter } from '../src/lib/vat-partial-exemption.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? 'true'] : []).filter(x => x.length));
let period;
if (args.from && args.to) period = { from: args.from, to: args.to, key: `${args.from}_${args.to}` };
else if (args.quarter) {
  const m = args.quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error('--quarter must look like 2026-Q3');
  period = vatQuarter(Number(m[1]), Number(m[2]));
} else period = lastCompletedQuarter(new Date().toISOString().slice(0, 10));

const token = await getSageToken(args.role ?? 'live');
const get = async (p, params) => {
  const url = new URL(SAGE_API + p);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sage API ${p} failed (${res.status}): ${await res.text()}`);
  return res.json();
};

const data = await fetchPeriodData(get, period.from, period.to);
const r = computePartialExemption(data.buckets, period.from, period.to);

const f = n => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12);
console.log(`\nVAT partial exemption ${period.from} to ${period.to}  (${data.counts.receipts} receipts, ${data.counts.payments} payments)\n`);
console.log('Supplies');
for (const s of r.supplies.rows) console.log(`  ${s.account.padEnd(40)} ${s.rateLabel.padEnd(11)} ${s.classification.padEnd(14)} ${f(s.net)} ${f(s.tax)}`);
console.log(`  taxable ${f(r.supplies.taxable)}  exempt ${f(r.supplies.exempt)}  total ${f(r.supplies.total)}  output tax ${f(r.supplies.outputTax)}`);
console.log('Input tax');
for (const i of r.inputs.rows) console.log(`  ${i.account.padEnd(40)} ${i.attribution.padEnd(9)} ${f(i.net)} ${f(i.tax)}`);
console.log(`  taxable ${f(r.inputs.taxable)}  exempt ${f(r.inputs.exempt)}  residual ${f(r.inputs.residual)}  total ${f(r.inputs.total)}`);
console.log(`\nRecovery ${r.method.rawPct.toFixed(2)}% → ${r.method.recoveryPct}%   residual recoverable ${f(r.method.residualRecoverable)}  exempt share ${f(r.method.residualExempt)}`);
console.log(`Exempt input tax ${f(r.exemptInputTax)} (${r.exemptInputPct.toFixed(2)}% of input tax), exempt supplies ${r.supplies.exemptPct.toFixed(2)}%, limit ${f(r.deMinimis.limit)}`);
for (const t of r.deMinimis.tests) console.log(`  ${t.pass ? 'PASS' : 'fail'}  ${t.name.padEnd(22)} ${f(t.amount)} vs ${f(t.amountLimit)}   ${t.share.toFixed(2)}% vs ${t.shareLimit}%`);
console.log(`\nOutput tax ${f(r.vat.outputTax)}  Input tax ${f(r.vat.inputTax)}  Adjustment ${f(r.vat.adjustment)}  Box 4 ${f(r.vat.box4)}  Box 5 ${f(r.vat.payable)}  (unrestricted ${f(r.vat.unrestrictedPayable)})`);
console.log(`\nTrial balance: ${data.reconciliation.agrees ? 'every account agrees' : data.reconciliation.differences.length + ' account(s) differ'}`);
for (const p of data.review) console.log(`  [${p.level}] ${p.text}`);
for (const p of data.vatPayments) console.log(`  VAT paid ${p.date} ${f(p.amount)} ${p.reference} (${p.bank})`);

const out = args.out ?? path.join(REPO, 'data', `vat-partial-exemption-${period.key}.json`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ period, data, result: r }, null, 1));
console.log(`\nSaved ${out}`);
