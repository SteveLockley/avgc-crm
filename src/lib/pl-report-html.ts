// Renders a PLReportData object (see pl-report.ts) as a self-contained,
// email-safe HTML document. Used both for the admin preview page and for
// the HTML email that gets sent out.

import type { PLReportData, PLLine } from './pl-report';

const GREEN = '#1e5631';
const RED = '#b91c1c';
const MUTED = '#666';
const BORDER = '#e0e0e0';

function fmt(n: number): string {
  return Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function money(n: number, style: 'income' | 'expense' | 'net'): string {
  if (style === 'expense') return `<span style="color:${RED};">(${fmt(n)})</span>`;
  if (style === 'net') return n < 0 ? `<span style="color:${RED};">(${fmt(n)})</span>` : fmt(n);
  return fmt(n);
}

// Last year first, then this year. No variance column.
function row(l: PLLine, style: 'income' | 'expense' | 'net', opts: { bold?: boolean; shaded?: boolean } = {}): string {
  const weight = opts.bold ? '700' : '400';
  const bg = opts.shaded ? '#f4f8f5' : '#fff';
  return `
    <tr style="background:${bg};">
      <td style="padding:7px 12px;font-weight:${weight};border-bottom:1px solid ${BORDER};">${l.label}</td>
      <td style="padding:7px 12px;text-align:right;color:${MUTED};font-variant-numeric:tabular-nums;border-bottom:1px solid ${BORDER};">${money(l.lastYear, style)}</td>
      <td style="padding:7px 12px;text-align:right;font-weight:${weight};font-variant-numeric:tabular-nums;border-bottom:1px solid ${BORDER};">${money(l.thisYear, style)}</td>
    </tr>`;
}

function sectionHeading(text: string): string {
  return `<h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${MUTED};margin:14px 0 4px 0;">${text}</h2>`;
}

function sectionTable(title: string, rows: string, headerRow = true): string {
  const th = (text: string, align: 'left' | 'right') =>
    `<td style="padding:6px 12px;text-align:${align};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">${text}</td>`;
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;color:#222;margin-bottom:20px;">
      ${headerRow ? `<tr>${th(title, 'left')}${th('Last Year', 'right')}${th('This Year', 'right')}</tr>` : ''}
      ${rows}
    </table>`;
}

/**
 * Snapshots saved before the Membership/Other split have no `membership` or
 * `other` sections. Derive them from the summary figures so historic reports
 * still render, and still tie back to the summary.
 */
function withSections(data: PLReportData): PLReportData {
  if (data.membership && data.other) return data;

  const derive = (label: string, thisYear: number, lastYear: number): PLLine => ({
    label,
    thisYear,
    lastYear,
    variancePct: lastYear ? Math.round(((thisYear - lastYear) / Math.abs(lastYear)) * 100) : null,
  });

  const utilities = data.other?.utilities ?? data.otherCosts?.utilities
    ?? derive('Utilities', 0, 0);
  const overheads = data.other?.otherOverheads ?? data.otherCosts?.otherOverheads
    ?? derive('Other Overheads', 0, 0);
  const otherIncome = data.income.otherIncome;

  return {
    ...data,
    // Older snapshots left the section subtotals unlabelled.
    clubhouse: { ...data.clubhouse, subtotal: { ...data.clubhouse.subtotal, label: data.clubhouse.subtotal.label || 'Clubhouse Total' } },
    course: { ...data.course, subtotal: { ...data.course.subtotal, label: data.course.subtotal.label || 'Course Total' } },
    membership: data.membership ?? {
      subscriptions: { ...data.income.membership, label: 'Members Subscriptions' },
      subtotal: derive('Membership Total', data.income.membership.thisYear, data.income.membership.lastYear),
    },
    other: data.other ?? {
      otherIncome,
      utilities,
      otherOverheads: overheads,
      subtotal: derive(
        'Other Total',
        otherIncome.thisYear - utilities.thisYear - overheads.thisYear,
        otherIncome.lastYear - utilities.lastYear - overheads.lastYear
      ),
    },
  };
}

export function renderPLReportHtml(input: PLReportData): string {
  const data = withSections(input);

  const summaryRows =
    row(data.income.clubhouseSales, 'income') +
    row(data.income.membership, 'income') +
    row(data.income.otherIncome, 'income') +
    row(data.income.total, 'income', { bold: true, shaded: true }) +
    row(data.costOfSales, 'expense') +
    row(data.wages, 'expense') +
    row(data.otherExpenses, 'expense') +
    row(data.totalExpenses, 'expense', { bold: true, shaded: true }) +
    // Snapshots generated before the rename carry the old label, so force it here.
    row({ ...data.netProfit, label: 'Surplus /(Deficit)' }, 'net', { bold: true, shaded: true });

  const clubhouseRows =
    row(data.clubhouse.sales, 'income') +
    row(data.clubhouse.purchases, 'expense') +
    row(data.clubhouse.wages, 'expense') +
    row(data.clubhouse.subtotal, 'net', { bold: true, shaded: true });

  const membershipRows =
    row(data.membership.subscriptions, 'income') +
    row(data.membership.subtotal, 'net', { bold: true, shaded: true });

  const courseRows =
    row(data.course.wages, 'expense') +
    row(data.course.maintenance, 'expense') +
    row(data.course.subtotal, 'net', { bold: true, shaded: true });

  const otherRows =
    row(data.other.otherIncome, 'income') +
    row(data.other.utilities, 'expense') +
    row(data.other.otherOverheads, 'expense') +
    row(data.other.subtotal, 'net', { bold: true, shaded: true });

  const runDate = new Date(data.runDate).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AVGC Income &amp; Expenditure (Cash Based) — ${data.periodLabel}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="background-color:#ffffff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">
          <tr>
            <td style="background-color:${GREEN};padding:22px 28px;">
              <h1 style="margin:0;color:#ffffff;font-size:19px;font-weight:600;">Alnmouth Village Golf Club</h1>
              <p style="margin:4px 0 0 0;color:#d7e8da;font-size:13px;">Income &amp; Expenditure (Cash Based) &middot; ${data.periodLabel}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 8px 28px;">
              ${sectionTable('Summary', summaryRows)}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 8px 28px;">
              ${sectionHeading('Clubhouse')}
              ${sectionTable('', clubhouseRows, false)}
              ${sectionHeading('Membership')}
              ${sectionTable('', membershipRows, false)}
              ${sectionHeading('Course')}
              ${sectionTable('', courseRows, false)}
              ${sectionHeading('Other')}
              ${sectionTable('', otherRows, false)}
              <p style="margin:0 0 8px 12px;font-size:11px;color:${MUTED};">
                Clubhouse + Membership + Course + Other = Surplus /(Deficit) above.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8f9fa;padding:16px 28px;border-top:1px solid ${BORDER};">
              <p style="margin:0;font-size:11px;color:${MUTED};">Generated from Sage Business Cloud Accounting &middot; ${runDate}</p>
              <p style="margin:6px 0 0 0;font-size:13px;color:${MUTED};"><strong>Alnmouth Village Golf Club</strong> &middot; Marine Road, Alnmouth, Northumberland, NE66 2RZ</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
