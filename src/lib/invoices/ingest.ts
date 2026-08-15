// Turns a PDF into a staged supplier invoice.
//
// Source-agnostic: the manual upload path and (later) the mailbox reader both
// call ingestPdf. Everything it produces lands in supplier_invoices with a
// status, never straight into Sage.

import { extractPdfText, sha256Hex } from './extract';
import { identifySupplier, pickAdapter } from './adapters';
import type { ParsedInvoice, SupplierRule } from './types';

/** Below this, an invoice is flagged for a human rather than trusted. */
export const REVIEW_THRESHOLD = 0.8;

export interface IngestInput {
  bytes: ArrayBuffer;
  fileName: string;
  source?: 'upload' | 'email';
  sender?: string | null;
  subject?: string | null;
  messageId?: string | null;
}

export interface IngestResult {
  outcome: 'parsed' | 'duplicate' | 'unknown_supplier' | 'parse_failed' | 'scanned' | 'error';
  invoiceId?: number;
  parsed?: ParsedInvoice;
  status?: string;
  detail?: string;
}

async function loadRules(db: D1Database): Promise<SupplierRule[]> {
  const rows = await db.prepare(
    `SELECT supplier_key, display_name, parser, sender_pattern, text_pattern,
            sage_contact_id, default_ledger_code
       FROM invoice_suppliers WHERE active = 1`
  ).all<SupplierRule>();
  return rows.results || [];
}

async function log(
  db: D1Database,
  row: { source: string; messageId?: string | null; sender?: string | null; subject?: string | null;
         fileName: string; outcome: string; invoiceId?: number | null; detail?: string },
): Promise<void> {
  await db.prepare(
    `INSERT INTO invoice_ingestion_log (source, message_id, sender, subject, file_name, outcome, invoice_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.source, row.messageId ?? null, row.sender ?? null, row.subject ?? null,
    row.fileName, row.outcome, row.invoiceId ?? null, row.detail ?? null,
  ).run();
}

export async function ingestPdf(db: D1Database, input: IngestInput): Promise<IngestResult> {
  const source = input.source ?? 'upload';
  const base = { source, messageId: input.messageId, sender: input.sender, subject: input.subject, fileName: input.fileName };

  try {
    const hash = await sha256Hex(input.bytes);

    // Same attachment seen before — the mailbox reader will re-see messages.
    const seen = await db.prepare(
      `SELECT invoice_id FROM invoice_documents WHERE sha256 = ? LIMIT 1`
    ).bind(hash).first<{ invoice_id: number }>();
    if (seen) {
      await log(db, { ...base, outcome: 'duplicate', invoiceId: seen.invoice_id, detail: 'Identical file already ingested' });
      return { outcome: 'duplicate', invoiceId: seen.invoice_id, detail: 'This exact PDF has already been ingested.' };
    }

    const { text, looksScanned } = await extractPdfText(input.bytes);
    if (looksScanned) {
      await log(db, { ...base, outcome: 'parse_failed', detail: 'PDF appears to be a scan — no extractable text' });
      return { outcome: 'scanned', detail: 'This PDF has no extractable text, so it is probably a scan. OCR would be needed.' };
    }

    const rules = await loadRules(db);
    const rule = identifySupplier(text, rules, input.sender);
    if (!rule) {
      await log(db, { ...base, outcome: 'unknown_supplier', detail: 'No supplier rule matched' });
      return {
        outcome: 'unknown_supplier',
        detail: 'No supplier matched this document. Add a rule in invoice_suppliers with a text or sender pattern.',
      };
    }

    const parsed = pickAdapter(rule.parser)(text, rule);

    // Same supplier and invoice number already staged.
    if (parsed.invoiceNumber) {
      const dup = await db.prepare(
        `SELECT id FROM supplier_invoices WHERE supplier_key = ? AND invoice_number = ?`
      ).bind(parsed.supplierKey, parsed.invoiceNumber).first<{ id: number }>();
      if (dup) {
        await log(db, { ...base, outcome: 'duplicate', invoiceId: dup.id, detail: `Invoice ${parsed.invoiceNumber} already staged` });
        return { outcome: 'duplicate', invoiceId: dup.id, detail: `Invoice ${parsed.invoiceNumber} is already staged.` };
      }
    }

    // Compare against the same supplier's last bill; a big swing needs a human.
    const prior = await db.prepare(
      `SELECT gross_amount FROM supplier_invoices
        WHERE supplier_key = ? AND gross_amount IS NOT NULL AND status != 'rejected'
        ORDER BY invoice_date DESC LIMIT 1`
    ).bind(parsed.supplierKey).first<{ gross_amount: number }>();
    if (prior?.gross_amount && parsed.grossAmount) {
      const change = Math.abs(parsed.grossAmount - prior.gross_amount) / Math.abs(prior.gross_amount);
      if (change > 0.5) {
        parsed.warnings.push(
          `Total is ${(change * 100).toFixed(0)}% different from the previous ${parsed.supplierName} invoice ` +
          `(£${prior.gross_amount.toFixed(2)} → £${parsed.grossAmount.toFixed(2)})`
        );
      }
    }

    const status = parsed.confidence >= REVIEW_THRESHOLD && parsed.warnings.length === 0
      ? 'parsed'
      : 'needs_review';

    const res = await db.prepare(
      `INSERT INTO supplier_invoices
         (supplier_key, supplier_name, sage_contact_id, invoice_number, invoice_date, due_date,
          period_from, period_to, net_amount, vat_amount, gross_amount, account_reference,
          source, source_message_id, file_name, parser, confidence, parse_warnings, raw_text, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      parsed.supplierKey, parsed.supplierName, rule.sage_contact_id,
      parsed.invoiceNumber ?? null, parsed.invoiceDate ?? null, parsed.dueDate ?? null,
      parsed.periodFrom ?? null, parsed.periodTo ?? null,
      parsed.netAmount ?? null, parsed.vatAmount ?? null, parsed.grossAmount ?? null,
      parsed.accountReference ?? null,
      source, input.messageId ?? null, input.fileName, parsed.parser,
      parsed.confidence, JSON.stringify(parsed.warnings), text.slice(0, 60_000), status,
    ).run();

    const invoiceId = res.meta.last_row_id as number;

    for (const [i, line] of parsed.lines.entries()) {
      await db.prepare(
        `INSERT INTO supplier_invoice_lines
           (invoice_id, line_no, description, quantity, unit, net_amount, vat_rate, vat_amount, ledger_account_code)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(
        invoiceId, i, line.description ?? null, line.quantity ?? null, line.unit ?? null,
        line.netAmount ?? null, line.vatRate ?? null, line.vatAmount ?? null,
        line.ledgerAccountCode ?? null,
      ).run();
    }

    // The PDF itself is not held in D1. This row is the placeholder that the
    // OneDrive step will fill in once Files.ReadWrite.All is granted.
    await db.prepare(
      `INSERT INTO invoice_documents (invoice_id, file_name, byte_size, sha256, storage)
       VALUES (?, ?, ?, ?, 'pending')`
    ).bind(invoiceId, input.fileName, input.bytes.byteLength, hash).run();

    await log(db, { ...base, outcome: 'parsed', invoiceId, detail: `${parsed.parser}, confidence ${parsed.confidence.toFixed(2)}` });

    return { outcome: 'parsed', invoiceId, parsed, status };
  } catch (e: any) {
    const detail = String(e.message).slice(0, 500);
    await log(db, { ...base, outcome: 'error', detail });
    return { outcome: 'error', detail };
  }
}
