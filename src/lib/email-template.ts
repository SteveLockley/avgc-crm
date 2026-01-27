// HTML email template generation for invoices

import type { Member, Invoice, InvoiceItem } from './db';
import { formatCurrency, formatDate, getFullName, getFullAddress } from './db';

interface InvoiceSettings {
  bank_name?: string;
  sort_code?: string;
  account_number?: string;
  account_name?: string;
  direct_debit_instructions?: string;
  pay_at_club_instructions?: string;
  payment_due_days?: string;
}

interface InvoiceEmailData {
  member: Member;
  invoice: Invoice;
  items: InvoiceItem[];
  settings: InvoiceSettings;
  customMessage?: string;
}

/**
 * Generate HTML email for an invoice
 */
export function generateInvoiceEmail(data: InvoiceEmailData): string {
  const { member, invoice, items, settings, customMessage } = data;

  const periodStart = new Date(invoice.period_start).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const periodEnd = new Date(invoice.period_end).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const invoiceDate = formatDate(invoice.invoice_date);
  const dueDays = parseInt(settings.payment_due_days || '30');
  const dueDate = new Date(invoice.invoice_date);
  dueDate.setDate(dueDate.getDate() + dueDays);
  const formattedDueDate = dueDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Generate line items rows
  const itemsHtml = items
    .map(
      (item) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; font-size: 14px;">
            ${escapeHtml(item.description)}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-size: 14px;">
            ${formatCurrency(item.unit_price)}
          </td>
        </tr>
      `
    )
    .join('');

  // Payment instructions
  const bankTransferHtml = settings.sort_code && settings.account_number
    ? `
      <div style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 10px 0; color: #1e5631; font-size: 14px;">Bank Transfer (BACS)</h4>
        <p style="margin: 0; font-size: 14px; line-height: 1.6;">
          Bank: ${escapeHtml(settings.bank_name || 'N/A')}<br>
          Account Name: ${escapeHtml(settings.account_name || 'Alnmouth Village Golf Club')}<br>
          Sort Code: ${escapeHtml(settings.sort_code)}<br>
          Account Number: ${escapeHtml(settings.account_number)}<br>
          Reference: <strong>${escapeHtml(invoice.invoice_number)}</strong>
        </p>
      </div>
    `
    : '';

  const directDebitHtml = settings.direct_debit_instructions
    ? `
      <div style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 10px 0; color: #1e5631; font-size: 14px;">Direct Debit</h4>
        <p style="margin: 0; font-size: 14px; line-height: 1.6;">
          ${escapeHtml(settings.direct_debit_instructions)}
        </p>
      </div>
    `
    : '';

  const payAtClubHtml = settings.pay_at_club_instructions
    ? `
      <div style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 10px 0; color: #1e5631; font-size: 14px;">Pay at Club</h4>
        <p style="margin: 0; font-size: 14px; line-height: 1.6;">
          ${escapeHtml(settings.pay_at_club_instructions)}
        </p>
      </div>
    `
    : '';

  // Highlight preferred payment method if set
  const preferredMethodNote = member.default_payment_method
    ? `<p style="margin: 15px 0 0 0; font-size: 13px; color: #666; font-style: italic;">
        Your preferred payment method: ${escapeHtml(member.default_payment_method)}
       </p>`
    : '';

  // Custom message
  const customMessageHtml = customMessage || invoice.custom_message
    ? `
      <div style="background: #f8f9fa; border-left: 4px solid #1e5631; padding: 15px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; line-height: 1.6;">
          ${escapeHtml(customMessage || invoice.custom_message || '')}
        </p>
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Membership Renewal - ${escapeHtml(invoice.invoice_number)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Main container -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #1e5631; padding: 30px; border-radius: 8px 8px 0 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                      Alnmouth Village Golf Club
                    </h1>
                    <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
                      Membership Renewal
                    </p>
                  </td>
                  <td align="right" style="color: #ffffff;">
                    <p style="margin: 0; font-size: 14px;">Invoice No:</p>
                    <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600;">
                      ${escapeHtml(invoice.invoice_number)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Member & Invoice Details -->
          <tr>
            <td style="padding: 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%" valign="top">
                    <h3 style="margin: 0 0 10px 0; color: #333; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
                      Invoice To
                    </h3>
                    <p style="margin: 0; font-size: 16px; font-weight: 600; color: #333;">
                      ${escapeHtml(getFullName(member))}
                    </p>
                    <p style="margin: 5px 0 0 0; font-size: 14px; color: #666; line-height: 1.5;">
                      ${escapeHtml(getFullAddress(member)).replace(/, /g, '<br>')}
                    </p>
                    ${member.email ? `<p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">${escapeHtml(member.email)}</p>` : ''}
                  </td>
                  <td width="50%" valign="top" align="right">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 5px 20px 5px 0; font-size: 14px; color: #666;">Member No:</td>
                        <td style="padding: 5px 0; font-size: 14px; font-weight: 600;">${escapeHtml(member.pin || member.club_number || '-')}</td>
                      </tr>
                      <tr>
                        <td style="padding: 5px 20px 5px 0; font-size: 14px; color: #666;">Category:</td>
                        <td style="padding: 5px 0; font-size: 14px;">${escapeHtml(member.category || '-')}</td>
                      </tr>
                      <tr>
                        <td style="padding: 5px 20px 5px 0; font-size: 14px; color: #666;">Invoice Date:</td>
                        <td style="padding: 5px 0; font-size: 14px;">${invoiceDate}</td>
                      </tr>
                      <tr>
                        <td style="padding: 5px 20px 5px 0; font-size: 14px; color: #666;">Due Date:</td>
                        <td style="padding: 5px 0; font-size: 14px; font-weight: 600; color: #dc3545;">${formattedDueDate}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Period -->
          <tr>
            <td style="padding: 0 30px;">
              <div style="background: #f8f9fa; border-radius: 6px; padding: 15px; text-align: center;">
                <p style="margin: 0; font-size: 14px; color: #666;">
                  Membership Period: <strong style="color: #333;">${periodStart} - ${periodEnd}</strong>
                </p>
              </div>
            </td>
          </tr>

          <!-- Custom Message -->
          ${customMessageHtml ? `
          <tr>
            <td style="padding: 20px 30px 0 30px;">
              ${customMessageHtml}
            </td>
          </tr>
          ` : ''}

          <!-- Line Items -->
          <tr>
            <td style="padding: 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8f9fa;">
                    <th style="padding: 15px; text-align: left; font-size: 14px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">
                      Description
                    </th>
                    <th style="padding: 15px; text-align: right; font-size: 14px; font-weight: 600; color: #333; border-bottom: 2px solid #1e5631;">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
                <tfoot>
                  <tr style="background-color: #1e5631;">
                    <td style="padding: 15px; font-size: 16px; font-weight: 600; color: #ffffff;">
                      Total Amount Due
                    </td>
                    <td style="padding: 15px; text-align: right; font-size: 18px; font-weight: 700; color: #ffffff;">
                      ${formatCurrency(invoice.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Payment Instructions -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <h3 style="margin: 0 0 20px 0; color: #333; font-size: 16px; border-bottom: 2px solid #e0e0e0; padding-bottom: 10px;">
                Payment Options
              </h3>
              ${bankTransferHtml}
              ${directDebitHtml}
              ${payAtClubHtml}
              ${preferredMethodNote}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 20px 30px; border-radius: 0 0 8px 8px; border-top: 1px solid #e0e0e0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 13px; color: #666; line-height: 1.6;">
                    <p style="margin: 0;"><strong>Alnmouth Village Golf Club</strong></p>
                    <p style="margin: 5px 0 0 0;">Marine Road, Alnmouth, Northumberland, NE66 2RZ</p>
                    <p style="margin: 5px 0 0 0;">Tel: 01665 830231 | Email: <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #1e5631;">subscriptions@AlnmouthVillage.Golf</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

        <!-- Disclaimer -->
        <p style="margin: 20px 0 0 0; font-size: 12px; color: #999; text-align: center;">
          This email was sent from <a href="mailto:subscriptions@AlnmouthVillage.Golf" style="color: #999;">subscriptions@AlnmouthVillage.Golf</a>. If you have any questions about this invoice, please contact us.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate a plain text version of the invoice for preview
 */
export function generateInvoiceText(data: InvoiceEmailData): string {
  const { member, invoice, items, settings } = data;

  const lines = [
    'ALNMOUTH VILLAGE GOLF CLUB',
    'SUBSCRIPTION INVOICE',
    '========================',
    '',
    `Invoice Number: ${invoice.invoice_number}`,
    `Invoice Date: ${formatDate(invoice.invoice_date)}`,
    '',
    'MEMBER DETAILS',
    '--------------',
    `Name: ${getFullName(member)}`,
    `Member No: ${member.pin || member.club_number || '-'}`,
    `Category: ${member.category || '-'}`,
    '',
    'INVOICE PERIOD',
    '--------------',
    `${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}`,
    '',
    'ITEMS',
    '-----',
  ];

  items.forEach((item) => {
    lines.push(`${item.description}: ${formatCurrency(item.unit_price)}`);
  });

  lines.push('');
  lines.push(`TOTAL: ${formatCurrency(invoice.total)}`);
  lines.push('');
  lines.push('PAYMENT OPTIONS');
  lines.push('---------------');

  if (settings.sort_code && settings.account_number) {
    lines.push('Bank Transfer:');
    lines.push(`  Bank: ${settings.bank_name || 'N/A'}`);
    lines.push(`  Sort Code: ${settings.sort_code}`);
    lines.push(`  Account: ${settings.account_number}`);
    lines.push(`  Reference: ${invoice.invoice_number}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate the email subject line for an invoice
 */
export function generateInvoiceSubject(invoice: Invoice, periodYear: number): string {
  return `Alnmouth Village Golf Club - Membership Renewal ${periodYear}/${periodYear + 1} (${invoice.invoice_number})`;
}

/**
 * Escape HTML characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}
