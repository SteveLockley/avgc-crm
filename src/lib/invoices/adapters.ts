// Per-supplier parsing.
//
// The generic adapter handles most UK utility and trade invoices, which follow
// the same conventions: a labelled invoice number, a date, and a VAT summary.
// Supplier-specific adapters override only what the generic one gets wrong,
// so adding a supplier is usually a row in invoice_suppliers, not code.

import type { Adapter, ParsedInvoice, ParsedLine, SupplierRule } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Normalise the date formats UK invoices actually use into yyyy-mm-dd. */
export function parseDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();

  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // 05/06/2026 or 5-6-26 — day first, as everything here is UK-issued.
  m = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) <= 31) return `${y}-${mo}-${d}`;
  }

  // 5 June 2026 / 05 Jun 26
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})\b/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${y}-${mo}-${m[1].padStart(2, '0')}`;
    }
  }
  return undefined;
}

/** Money as printed on an invoice: 1,234.56 / £1,234.56 / (1,234.56) for credits. */
export function parseMoney(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const neg = /^\s*\(.*\)\s*$/.test(raw) || /-\s*£?\d/.test(raw);
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return undefined;
  return neg ? -n : n;
}

/** First capture group of the first pattern that hits. */
function first(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return undefined;
}

// ─── Generic adapter ─────────────────────────────────────────────────

export const genericAdapter: Adapter = (text, rule): ParsedInvoice => {
  const warnings: string[] = [];
  const flat = text.replace(/\r/g, '');

  const invoiceNumber = first(flat, [
    /(?:invoice|tax\s+invoice|bill|document)\s*(?:number|no\.?|ref(?:erence)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\/\-]{3,})/i,
    /\bIN\d{6,}\b/,
    /\b(?:INV|BILL)[\-\/ ]?\d{4,}\b/i,
  ]);

  const invoiceDate = parseDate(first(flat, [
    /(?:invoice|bill|issue|statement)\s*date\s*[:#]?\s*([0-9A-Za-z\/\-. ]{6,20})/i,
    /\bdate(?:d)?\s*[:#]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i,
    // Bare "Date: 12 July 2026", common on trade invoices.
    /\bdate(?:d)?\s*[:#]?\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{2,4})/i,
  ]));

  const dueDate = parseDate(first(flat, [
    /(?:payment\s+)?due\s*(?:date|by|on)?\s*[:#]?\s*([0-9A-Za-z\/\-. ]{6,20})/i,
    /(?:date\s+)?payable\s*(?:by|on)\s*[:#]?\s*([0-9A-Za-z\/\-. ]{6,20})/i,
  ]));

  const accountReference = first(flat, [
    /(?:account|customer|supply)\s*(?:number|no\.?|ref(?:erence)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/i,
  ]);

  const vatAmount = parseMoney(first(flat, [
    /(?:total\s+)?vat(?:\s+(?:amount|at\s+[\d.]+%|charged))?\s*[:#]?\s*£?\s*([\d,]+\.\d{2})/i,
  ]));
  const netAmount = parseMoney(first(flat, [
    /(?:total\s+)?(?:net|goods|subtotal|sub-total)(?:\s+(?:amount|total))?\s*(?:excluding\s+vat)?\s*[:#]?\s*£?\s*([\d,]+\.\d{2})/i,
    /total\s+before\s+vat\s*[:#]?\s*£?\s*([\d,]+\.\d{2})/i,
  ]));
  const grossAmount = parseMoney(first(flat, [
    /(?:total\s+(?:amount\s+)?(?:due|payable)|amount\s+due|balance\s+due|total\s+including\s+vat|invoice\s+total)\s*[:#]?\s*£?\s*([\d,]+\.\d{2})/i,
    /total\s*[:#]?\s*£?\s*([\d,]+\.\d{2})\s*$/im,
  ]));

  // Billing period — utilities always print one, trade invoices rarely do.
  let periodFrom: string | undefined, periodTo: string | undefined;
  const period = flat.match(
    /(?:period|from)\s*[:#]?\s*([0-9]{1,2}[\/\-. ][0-9A-Za-z]{1,9}[\/\-. ][0-9]{2,4})\s*(?:to|-|–|until)\s*([0-9]{1,2}[\/\-. ][0-9A-Za-z]{1,9}[\/\-. ][0-9]{2,4})/i
  );
  if (period) {
    periodFrom = parseDate(period[1]);
    periodTo = parseDate(period[2]);
  }

  const lines: ParsedLine[] = [];
  if (netAmount !== undefined || grossAmount !== undefined) {
    lines.push({
      description: rule.display_name + (periodFrom ? ` — ${periodFrom} to ${periodTo ?? ''}` : ''),
      netAmount: netAmount ?? (grossAmount !== undefined && vatAmount !== undefined ? grossAmount - vatAmount : undefined),
      vatAmount,
      ledgerAccountCode: rule.default_ledger_code ?? undefined,
    });
  }

  // Confidence: the fields that matter for posting to Sage.
  let confidence = 0;
  if (invoiceNumber) confidence += 0.3; else warnings.push('No invoice number found');
  if (invoiceDate) confidence += 0.25; else warnings.push('No invoice date found');
  if (grossAmount !== undefined) confidence += 0.3; else warnings.push('No total amount found');
  if (vatAmount !== undefined) confidence += 0.15; else warnings.push('No VAT amount found');

  // Arithmetic check — the strongest signal that the parse is right.
  if (netAmount !== undefined && vatAmount !== undefined && grossAmount !== undefined) {
    if (Math.abs(netAmount + vatAmount - grossAmount) > 0.02) {
      warnings.push(`Net ${netAmount.toFixed(2)} + VAT ${vatAmount.toFixed(2)} does not equal gross ${grossAmount.toFixed(2)}`);
      confidence = Math.min(confidence, 0.5);
    } else {
      confidence = Math.min(1, confidence + 0.1);
    }
  }

  return {
    supplierKey: rule.supplier_key,
    supplierName: rule.display_name,
    invoiceNumber, invoiceDate, dueDate, periodFrom, periodTo,
    netAmount, vatAmount, grossAmount, accountReference,
    lines, confidence: Math.min(1, confidence), warnings,
    parser: 'generic',
  };
};

// ─── Supplier-specific adapters ──────────────────────────────────────

/** TotalEnergies bill the Tractor Shed supply; account numbers look like A-1C748198. */
const totalEnergiesAdapter: Adapter = (text, rule) => {
  const base = genericAdapter(text, rule);
  base.parser = 'totalenergies';

  const acct = text.match(/\b(A-[0-9A-Z]{7,})\b/);
  if (acct) base.accountReference = acct[1];

  const mpan = text.match(/\b(\d{13})\b/);
  if (mpan && !base.warnings.length) base.lines[0] && (base.lines[0].description += ` (MPAN ${mpan[1]})`);

  if (!base.invoiceNumber) {
    const alt = text.match(/\b(IN\d{6,})\b/);
    if (alt) {
      base.invoiceNumber = alt[1];
      base.confidence = Math.min(1, base.confidence + 0.3);
      base.warnings = base.warnings.filter(w => w !== 'No invoice number found');
    }
  }
  return base;
};

/** Corona Energy — gas, billed monthly against the clubhouse supply. */
const coronaAdapter: Adapter = (text, rule) => {
  const base = genericAdapter(text, rule);
  base.parser = 'corona';
  const mprn = text.match(/MPRN\s*[:#]?\s*(\d{6,10})/i);
  if (mprn && base.lines[0]) base.lines[0].description += ` (MPRN ${mprn[1]})`;
  return base;
};

export const ADAPTERS: Record<string, Adapter> = {
  generic: genericAdapter,
  totalenergies: totalEnergiesAdapter,
  corona: coronaAdapter,
};

export function pickAdapter(name: string | null | undefined): Adapter {
  return ADAPTERS[name || 'generic'] || genericAdapter;
}

/** Identify the supplier from the PDF text, or the sender address if we have one. */
export function identifySupplier(
  text: string,
  rules: SupplierRule[],
  sender?: string | null,
): SupplierRule | null {
  if (sender) {
    for (const r of rules) {
      if (r.sender_pattern && new RegExp(r.sender_pattern, 'i').test(sender)) return r;
    }
  }
  for (const r of rules) {
    if (r.text_pattern && new RegExp(r.text_pattern, 'i').test(text)) return r;
  }
  return null;
}
