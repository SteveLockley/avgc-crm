// Shared shape every supplier adapter produces.

export interface ParsedLine {
  description?: string;
  quantity?: number;
  unit?: string;
  netAmount?: number;
  vatRate?: number;
  vatAmount?: number;
  ledgerAccountCode?: string;
}

export interface ParsedInvoice {
  supplierKey: string;
  supplierName: string;
  invoiceNumber?: string;
  invoiceDate?: string;      // ISO yyyy-mm-dd
  dueDate?: string;
  periodFrom?: string;
  periodTo?: string;
  netAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
  accountReference?: string;
  lines: ParsedLine[];
  /** 0–1. Below the review threshold the invoice is flagged rather than trusted. */
  confidence: number;
  warnings: string[];
  parser: string;
}

export interface SupplierRule {
  supplier_key: string;
  display_name: string;
  parser: string;
  sender_pattern: string | null;
  text_pattern: string | null;
  sage_contact_id: string | null;
  default_ledger_code: string | null;
}

export type Adapter = (text: string, rule: SupplierRule) => ParsedInvoice;
