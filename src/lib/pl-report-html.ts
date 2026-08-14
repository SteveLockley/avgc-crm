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

function varianceChip(pct: number | null, style: 'income' | 'expense' | 'net'): string {
  if (pct === null) return '<span style="color:#999;">–</span>';
  const goodDirection = style === 'expense' ? pct < 0 : pct > 0;
  const color = pct === 0 ? MUTED : (goodDirection ? GREEN : RED);
  const arrow = pct === 0 ? '' : (pct > 0 ? '▲ ' : '▼ ');
  return `<span style="color:${color};font-weight:600;">${arrow}${Math.abs(pct)}%</span>`;
}

function row(l: PLLine, style: 'income' | 'expense' | 'net', opts: { bold?: boolean; shaded?: boolean } = {}): string {
  const weight = opts.bold ? '700' : '400';
  const bg = opts.shaded ? '#f4f8f5' : '#fff';
  return `
    <tr style="background:${bg};">
      <td style="padding:7px 12px;font-weight:${weight};border-bottom:1px solid ${BORDER};">${l.label}</td>
      <td style="padding:7px 12px;text-align:right;font-weight:${weight};font-variant-numeric:tabular-nums;border-bottom:1px solid ${BORDER};">${money(l.thisYear, style)}</td>
      <td style="padding:7px 12px;text-align:right;color:${MUTED};font-variant-numeric:tabular-nums;border-bottom:1px solid ${BORDER};">${money(l.lastYear, style)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;border-bottom:1px solid ${BORDER};">${varianceChip(l.variancePct, style)}</td>
    </tr>`;
}

function sectionTable(title: string, rows: string, headerRow = true): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;color:#222;margin-bottom:20px;">
      ${headerRow ? `
      <tr>
        <td style="padding:6px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">${title}</td>
        <td style="padding:6px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">This Year</td>
        <td style="padding:6px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Last Year</td>
        <td style="padding:6px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};">Variance</td>
      </tr>` : ''}
      ${rows}
    </table>`;
}

export function renderPLReportHtml(data: PLReportData): string {
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

  const courseRows =
    row(data.course.wages, 'expense') +
    row(data.course.maintenance, 'expense') +
    row(data.course.subtotal, 'net', { bold: true, shaded: true });

  const otherCostsRows =
    row(data.otherCosts.utilities, 'expense') +
    row(data.otherCosts.otherOverheads, 'expense');

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
              <h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${MUTED};margin:14px 0 4px 0;">Clubhouse</h2>
              ${sectionTable('', clubhouseRows, false)}
              <h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${MUTED};margin:14px 0 4px 0;">Course</h2>
              ${sectionTable('', courseRows, false)}
              <h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${MUTED};margin:14px 0 4px 0;">Other Costs</h2>
              ${sectionTable('', otherCostsRows, false)}
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
