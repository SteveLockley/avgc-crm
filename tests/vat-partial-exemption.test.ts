/**
 * VAT partial exemption — the pure calculation, on invented figures.
 * Checks against the club's real quarters live in tests/private/, which is not
 * committed because this repository is public. No network.
 */
import { describe, it, expect } from 'vitest';
import {
  computePartialExemption, bucketOtherPayments, mergeBuckets, reconcile, reviewPoints,
  classifySupply, attributeInput, recoveryPercentage, codeOf,
  vatQuarter, lastCompletedQuarter, returnDueDate, partialExemptionYearTo,
  type Bucket,
} from '../src/lib/vat-partial-exemption';

const b = (code: number, account: string, rate: string, side: 'supply' | 'input', net: number, tax: number): Bucket =>
  ({ code, account: `${account} (${code})`, rate, side, net, tax, lines: 1 });

// A quarter shaped like the club's: bar and food taxable, subscriptions and
// green fees exempt, course costs exempt, overheads residual.
const QUARTER: Bucket[] = [
  b(4000, 'Bar Sales', 'GB_STANDARD', 'supply', 40000, 8000),
  b(4010, 'Food Sales', 'GB_STANDARD', 'supply', 30000, 6000),
  b(4020, 'Coffee Machine Sales', 'GB_ZERO', 'supply', 1000, 0),
  b(4030, 'Members Subscription', 'GB_EXEMPT', 'supply', 25000, 0),
  b(4040, 'Visiting Green Fees', 'GB_EXEMPT', 'supply', 20000, 0),
  b(4940, 'Rental Income', 'GB_NO_TAX', 'supply', 2000, 0),
  b(4910, 'Donations Received', 'GB_EXEMPT', 'supply', 300, 0),
  b(4970, 'Bank Interest Received', 'GB_EXEMPT', 'supply', 50, 0),
  b(5000, 'Bar Purchases', 'GB_STANDARD', 'input', 20000, 4000),
  b(5020, 'Food Purchases', 'GB_STANDARD', 'input', 5000, 1000),
  b(7400, 'Course Maintenance', 'GB_STANDARD', 'input', 6000, 1200),
  b(7010, 'Course Wages', 'GB_NO_TAX', 'input', 15000, 0),
  b(7200, 'Electricity', 'GB_STANDARD', 'input', 2500, 500),
  b(7100, 'Rent', 'GB_STANDARD', 'input', 1500, 300),
  b(2202, 'VAT Liability', 'GB_NO_TAX', 'input', 9000, 0),
];

describe('a typical quarter', () => {
  const r = computePartialExemption(QUARTER, '2026-07-01', '2026-09-30');

  it('classifies and totals supplies, leaving out donations and bank interest', () => {
    expect(r.supplies.taxable).toBe(71000);
    expect(r.supplies.exempt).toBe(47000);          // subscriptions, green fees, rental
    expect(r.supplies.total).toBe(118000);
    expect(r.supplies.outsideScope).toBe(300);
    expect(r.supplies.incidental).toBe(50);
    expect(r.supplies.outputTax).toBe(14000);
  });

  it('attributes input tax and leaves out the VAT payment', () => {
    expect(r.inputs.taxable).toBe(5000);
    expect(r.inputs.exempt).toBe(1200);
    expect(r.inputs.residual).toBe(800);
    expect(r.inputs.total).toBe(7000);
    expect(r.inputs.excludedNet).toBe(9000);
  });

  it('applies the standard method and the tests', () => {
    expect(r.method.rawPct.toFixed(2)).toBe('60.17');
    expect(r.method.recoveryPct).toBe(61);
    expect(r.method.residualRecoverable).toBe(488);
    expect(r.method.residualExempt).toBe(312);
    expect(r.exemptInputTax).toBe(1512);
    expect(r.deMinimis.limit).toBe(1875);
    expect(r.deMinimis.tests.map(t => t.amount)).toEqual([7000, 2000, 1512]);
  });

  it('passes the limit at £1,512 — so this quarter meets de minimis', () => {
    expect(r.deMinimis.tests.find(t => t.key === 'standard')!.pass).toBe(true);
    expect(r.deMinimis.passed).toBe(true);
    expect(r.restriction).toBe(0);
    expect(r.vat.payable).toBe(7000);
  });

  it('fails once course maintenance VAT rises', () => {
    const more = QUARTER.map(x => x.code === 7400 ? { ...x, net: 9000, tax: 1800 } : x);
    const f = computePartialExemption(more, '2026-07-01', '2026-09-30');
    expect(f.exemptInputTax).toBe(2112);
    expect(f.deMinimis.passed).toBe(false);
    expect(f.restriction).toBe(2112);
    expect(f.vat.adjustment).toBe(-2112);
    expect(f.recoverable).toBe(5488);
    expect(f.vat.payable).toBe(8512);
    expect(f.vat.unrestrictedPayable).toBe(6400);
  });
});

describe('partial exemption year', () => {
  it('merges quarters and scales the limit by months', () => {
    const r = computePartialExemption(mergeBuckets(QUARTER, QUARTER), '2026-04-01', '2026-09-30');
    expect(r.months).toBe(6);
    expect(r.deMinimis.limit).toBe(3750);
    expect(r.supplies.taxable).toBe(142000);
    expect(r.exemptInputTax).toBe(3024);
  });

  it('lists the quarters from 1 April', () => {
    expect(partialExemptionYearTo(vatQuarter(2026, 3)).map(q => q.key)).toEqual(['2026-Q2', '2026-Q3']);
    expect(partialExemptionYearTo(vatQuarter(2027, 1)).map(q => q.key)).toEqual(['2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1']);
    expect(partialExemptionYearTo(vatQuarter(2026, 2)).map(q => q.key)).toEqual(['2026-Q2']);
  });
});

describe('rules', () => {
  it('classifies supplies as the working papers do', () => {
    expect(classifySupply(4030, 'GB_EXEMPT')).toBe('exempt');
    expect(classifySupply(4030, 'GB_ZERO')).toBe('taxable');
    expect(classifySupply(4940, 'GB_NO_TAX')).toBe('exempt');        // rental — exempt supply of land
    expect(classifySupply(4920, 'GB_NO_TAX')).toBe('outside_scope');
    expect(classifySupply(4910, 'GB_EXEMPT')).toBe('outside_scope');  // donations
    expect(classifySupply(4970, 'GB_EXEMPT')).toBe('incidental');     // bank interest
  });

  it('attributes input tax by account', () => {
    expect(attributeInput(5000)).toBe('taxable');
    expect(attributeInput(7801)).toBe('taxable');
    expect(attributeInput(7400)).toBe('exempt');
    expect(attributeInput(7100)).toBe('residual');
    expect(attributeInput(20)).toBe('residual');
    expect(attributeInput(2202)).toBe('excluded');
  });

  it('rounds the recovery percentage up, but not an exact whole number', () => {
    expect(recoveryPercentage(594, 1000, 100, 3).recoveryPct).toBe(60);
    expect(recoveryPercentage(600, 1000, 100, 3).recoveryPct).toBe(60);
    expect(recoveryPercentage(0.6, 1, 100, 3).recoveryPct).toBe(60);
    expect(recoveryPercentage(594, 1000, 3_000_000, 3).recoveryPct).toBe(59.4);   // over £400k a month
  });

  it('passes de minimis when exempt input tax is small', () => {
    const buckets: Bucket[] = [
      { code: 4000, account: 'Bar Sales (4000)', rate: 'GB_STANDARD', side: 'supply', net: 50000, tax: 10000, lines: 1 },
      { code: 4030, account: 'Members Subscription (4030)', rate: 'GB_EXEMPT', side: 'supply', net: 30000, tax: 0, lines: 1 },
      { code: 5000, account: 'Bar Purchases (5000)', rate: 'GB_STANDARD', side: 'input', net: 20000, tax: 4000, lines: 1 },
      { code: 7400, account: 'Course Maintenance (7400)', rate: 'GB_STANDARD', side: 'input', net: 3000, tax: 600, lines: 1 },
      { code: 7200, account: 'Electricity (7200)', rate: 'GB_STANDARD', side: 'input', net: 2000, tax: 400, lines: 1 },
    ];
    const r = computePartialExemption(buckets, '2026-07-01', '2026-09-30');
    expect(r.exemptInputTax).toBe(748);   // 600 + 400 × 37% (62.5% recovery rounded up to 63%)
    expect(r.deMinimis.passed).toBe(true);
    expect(r.restriction).toBe(0);
    expect(r.vat.payable).toBe(5000);
  });
});

describe('bucketing Sage records', () => {
  it('nets refunds, including a refund of a payment, against the right side', () => {
    const line = (account: string, rate: string, net: number, tax = 0) => ({ ledger_account: { displayed_as: account }, tax_rate: { id: rate }, net_amount: String(net), tax_amount: String(tax) });
    const b = bucketOtherPayments([
      { transaction_type: { id: 'OTHER_RECEIPT' }, payment_lines: [line('Members Subscription (4030)', 'GB_EXEMPT', 500)] },
      { transaction_type: { id: 'OTHER_PAYMENT' }, payment_lines: [line('Members Subscription (4030)', 'GB_EXEMPT', 55)] },
      { transaction_type: { id: 'OTHER_PAYMENT_REFUND' }, payment_lines: [line('Members Subscription (4030)', 'GB_EXEMPT', 40)] },
      { transaction_type: { id: 'OTHER_PAYMENT' }, payment_lines: [line('Computer & Software (7550)', 'GB_STANDARD', 630, 126)] },
      { transaction_type: { id: 'OTHER_PAYMENT_REFUND' }, payment_lines: [line('Computer & Software (7550)', 'GB_STANDARD', 630, 126)] },
    ]);
    expect(b.find(x => x.code === 4030)!.net).toBe(485);
    expect(b.find(x => x.code === 7550)).toMatchObject({ net: 0, tax: 0, lines: 2 });
  });

  it('reads Sage account codes with or without leading zeros', () => {
    expect(codeOf('Plant and Machinery - Cost (0020)')).toBe(20);
    expect(codeOf('Plant and Machinery - Cost (20)')).toBe(20);
    expect(codeOf('No code')).toBeNull();
  });
});

describe('reconciliation and review points', () => {
  const buckets: Bucket[] = [
    { code: 4030, account: 'Members Subscription (4030)', rate: 'GB_EXEMPT', side: 'supply', net: 1000, tax: 0, lines: 2 },
    { code: 7000, account: 'Club house Wages (7000)', rate: 'GB_STANDARD', side: 'input', net: 500, tax: 83.33, lines: 1 },
  ];

  it('flags an account the trial balance disagrees with, and an overpaid VAT liability', () => {
    const rec = reconcile(buckets, [
      { displayed_as: 'Members Subscription (4030)', debit: '0', credit: '1268' },
      { displayed_as: 'Club house Wages (7000)', debit: '500', credit: '0' },
      { displayed_as: 'VAT Liability (2202)', debit: '20000', credit: '0', closing_balance: { debit: '9999.50', credit: '0' } },
    ]);
    expect(rec.differences.map(d => d.code)).toEqual([4030]);
    expect(rec.differences[0].difference).toBe(-268);
    const points = reviewPoints(buckets, rec).map(p => p.text);
    expect(points.some(t => t.includes('Members Subscription') && t.includes('£1,268.00'))).toBe(true);
    expect(points.some(t => t.includes('recorded twice'))).toBe(true);
    expect(points.some(t => t.includes('Wages carry no VAT'))).toBe(true);
  });
});

describe('VAT quarter dates', () => {
  it('knows the last completed quarter and the filing deadline', () => {
    expect(lastCompletedQuarter('2026-10-30').key).toBe('2026-Q3');
    expect(lastCompletedQuarter('2027-01-05').key).toBe('2026-Q4');
    expect(returnDueDate(vatQuarter(2026, 2))).toBe('2026-08-07');
    expect(returnDueDate(vatQuarter(2026, 3))).toBe('2026-11-07');
    expect(returnDueDate(vatQuarter(2026, 4))).toBe('2027-02-07');
    expect(returnDueDate(vatQuarter(2027, 1))).toBe('2027-05-07');
  });
});
