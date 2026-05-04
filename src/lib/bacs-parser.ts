/**
 * BACS payment file parser and member matching.
 * Parses tab-separated bank statement lines, extracts member names,
 * and matches to CRM members/invoices.
 */

export interface BacsRecord {
  date: string;         // YYYY-MM-DD
  description: string;  // primary description
  reference: string;    // secondary field (often has cleaner name)
  amount: number;
  rawLine: string;
  invoiceNumber: string | null;  // extracted from description if present
}

/** Patterns that indicate non-membership payments */
const SKIP_DESCRIPTION_PATTERNS = [
  /stripe payments/i,
  /ukgolfnow/i,
  /^brs golf/i,
  /^nayax/i,
  /^hf holidays/i,
  /countrywide golf/i,
  /brockwell golf/i,
  /nor uni of gol/i,   // Northumbria Uni golf society
];

const SKIP_REFERENCE_PATTERNS = [
  /tee off times/i,
  /hf holiday/i,
];

/**
 * Parse a single CSV line handling quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

/**
 * Parse cashbook CSV export into structured records.
 * Format: 3-line preamble (From, To, Bank Account) + column-header row, then data:
 *   Trx, Transaction Date, Date Entered, Contact, Type, Method, Currency,
 *   Reference, Money In (GBP £), Money Out (GBP £), Balance
 * Falls back to legacy tab-separated format if no CSV header is detected.
 */
export function parseBacsFile(text: string): BacsRecord[] {
  // Handle all line-ending styles: CRLF, CR-only, LF-only
  const lines = text.trim().split(/\r\n|\r|\n/);

  // Detect new CSV format by looking for the column-header row in the first 10 lines
  let dataStartLine = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (/Transaction Date/i.test(lines[i]) || /^Trx,/i.test(lines[i])) {
      dataStartLine = i + 1;
      break;
    }
  }

  if (dataStartLine === -1) {
    // Fall back to legacy tab-separated format
    return parseBacsFileLegacy(text);
  }

  const records: BacsRecord[] = [];

  for (let lineIdx = dataStartLine; lineIdx < lines.length; lineIdx++) {
    const trimmed = lines[lineIdx].trim();
    if (!trimmed) continue;

    const parts = parseCSVLine(trimmed);
    if (parts.length < 9) continue;

    const trx              = parts[0].trim();
    const transactionDate  = parts[1].trim();
    const contact          = parts[3].trim();   // Contact — sometimes a cleaner name
    const type             = parts[4].trim();
    const reference        = parts[7].trim();   // Reference — carries name / description
    const moneyInStr       = parts[8].trim();

    // Skip rows without a numeric transaction ID (e.g. opening balance row)
    if (!trx || !/^\d+$/.test(trx)) continue;

    // Only "Money in" entries (excludes Bank Transfer, Money out, etc.)
    if (!/^money in$/i.test(type)) continue;

    // Parse amount (strip commas)
    const amount = parseFloat(moneyInStr.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) continue;

    // Parse date DD/MM/YYYY → YYYY-MM-DD
    const dateParts = transactionDate.split('/');
    const isoDate = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : transactionDate;

    const invoiceNumber = extractInvoiceNumber(reference);

    records.push({
      date: isoDate,
      description: reference,   // Reference column carries name info (e.g. "P McCusker Peter McCusker")
      reference: contact,        // Contact column sometimes has a cleaner name
      amount,
      rawLine: trimmed,
      invoiceNumber,
    });
  }

  return records;
}

/**
 * Legacy parser for old tab-separated bank export format:
 *   date \t description \t reference \t type \t amount
 */
function parseBacsFileLegacy(text: string): BacsRecord[] {
  const lines = text.trim().split(/\r?\n/);
  const records: BacsRecord[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 5) continue;

    const [dateStr, description, reference, type, amountStr] = parts;

    if (type?.trim() !== 'Money in') continue;

    const amount = parseFloat(amountStr.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) continue;

    const dateParts = dateStr.trim().split('/');
    const isoDate = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : dateStr.trim();

    const invoiceNumber = extractInvoiceNumber(description || '');

    records.push({
      date: isoDate,
      description: (description || '').trim(),
      reference: (reference || '').trim(),
      amount,
      rawLine: trimmed,
      invoiceNumber,
    });
  }

  return records;
}

/**
 * Check if a BACS record is a non-membership payment (visitor fees, vending, etc.)
 */
export function isNonMembershipPayment(record: BacsRecord): boolean {
  for (const pattern of SKIP_DESCRIPTION_PATTERNS) {
    if (pattern.test(record.description)) return true;
  }
  for (const pattern of SKIP_REFERENCE_PATTERNS) {
    if (pattern.test(record.reference)) return true;
  }
  return false;
}

/**
 * Try to extract an invoice number from BACS description.
 * Matches patterns like "INV-2026-337", "VINV-202", etc.
 */
function extractInvoiceNumber(description: string): string | null {
  // Match INV-YYYY-NNN format
  const match = description.match(/INV-(\d{4})-(\d+)/i);
  if (match) {
    return `INV-${match[1]}-${match[2]}`;
  }
  return null;
}

/**
 * Match a BACS record to a CRM member.
 * Tries multiple strategies:
 * 1. Reference field (often "SURNAME FIRSTNAME" or "firstname surname")
 * 2. Description field (various messy formats)
 * Returns the best match result.
 */
export async function matchBacsMember(
  db: any,
  record: BacsRecord
): Promise<{ status: string; memberId: number | null; memberName: string | null }> {
  const noMatch = { status: 'no_match', memberId: null, memberName: null };

  // Strategy 1: If we have an invoice number, look up the invoice's member directly
  if (record.invoiceNumber) {
    const invoice = await db.prepare(
      `SELECT i.member_id, m.first_name, m.surname
       FROM invoices i JOIN members m ON i.member_id = m.id
       WHERE i.invoice_number = ?`
    ).bind(record.invoiceNumber).first<any>();
    if (invoice) {
      return {
        status: 'matched',
        memberId: invoice.member_id,
        memberName: `${invoice.first_name} ${invoice.surname}`,
      };
    }
  }

  // Collect candidate surnames to try
  const candidates = extractNameCandidates(record.description, record.reference);

  for (const candidate of candidates) {
    const result = await tryMatchByName(db, candidate.surname, candidate.firstName);
    if (result.status === 'matched') return result;
    if (result.status === 'ambiguous') return result;
  }

  return noMatch;
}

interface NameCandidate {
  surname: string;
  firstName: string;
}

/**
 * Extract possible name candidates from BACS description and reference fields.
 * Returns them in priority order (most likely first).
 */
function extractNameCandidates(description: string, reference: string): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  const seen = new Set<string>();

  function add(surname: string, firstName: string) {
    // Normalise for dedup
    const key = `${surname.toLowerCase()}|${firstName.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ surname, firstName });
  }

  // Try reference field first (usually cleaner)
  if (reference && reference.length >= 2) {
    const refCandidates = parseReferenceName(reference);
    for (const c of refCandidates) add(c.surname, c.firstName);
  }

  // Then try description
  const descCandidates = parseDescriptionName(description);
  for (const c of descCandidates) add(c.surname, c.firstName);

  return candidates;
}

/**
 * Parse reference field. Common formats:
 * "TATE HAZEL", "PATRICK RAY", "CARRUTHERS R", "lightley j",
 * "hammond p", "ross euan", "forrest g", "ALLINSON MARK"
 */
function parseReferenceName(ref: string): NameCandidate[] {
  const cleaned = ref.trim();
  if (!cleaned || /tee off|holiday|golf/i.test(cleaned)) return [];

  const parts = cleaned.split(/\s+/).filter(p => p.length > 0);
  if (parts.length === 0) return [];

  const results: NameCandidate[] = [];

  if (parts.length === 1) {
    results.push({ surname: parts[0], firstName: '' });
  } else if (parts.length === 2) {
    // "SURNAME FIRSTNAME" or "FIRSTNAME SURNAME"
    // Try both orderings — BACS typically has surname first
    results.push({ surname: parts[0], firstName: parts[1] });
    results.push({ surname: parts[1], firstName: parts[0] });
  } else {
    // Multiple parts — try first as surname, rest as firstName options
    results.push({ surname: parts[0], firstName: parts[1] });
    results.push({ surname: parts[parts.length - 1], firstName: parts[0] });
  }

  return results;
}

/**
 * Parse description field. Very messy — common patterns:
 * "M Tate H D Tate 568" — Initial + Surname
 * "WATSON DA JEFF WATSON" — Surname repeated at end
 * "OUTTERSON JOHN & VINV-202" — Surname + First
 * "J Lightley INV-2026-337" — Initial + Surname + invoice
 * "HAIG IAN & FRANCES211 HAI" — Surname + names
 * "Eric Young 527" — First + Surname + number
 * "MRS M H MAYFIELD MARGARET" — Title + initials + surname + first
 */
function parseDescriptionName(desc: string): NameCandidate[] {
  // Remove invoice numbers
  let cleaned = desc.replace(/INV-?\d{4}-?\d+/gi, '').trim();
  // Remove pure numbers (member IDs, PINs, years)
  cleaned = cleaned.replace(/\b\d{2,}\b/g, '').trim();
  // Remove titles
  cleaned = cleaned.replace(/\b(MR|MRS|MISS|MS|DR)\b/gi, '').trim();
  // Remove common separators
  cleaned = cleaned.replace(/[&+]/g, ' ').trim();
  // Remove trailing fragments (less than 3 chars, likely truncated)
  cleaned = cleaned.replace(/\s+\w{1,2}$/, '').trim();

  const parts = cleaned.split(/\s+/).filter(p => p.length > 0);
  if (parts.length === 0) return [];

  const results: NameCandidate[] = [];

  if (parts.length === 1) {
    results.push({ surname: parts[0], firstName: '' });
    return results;
  }

  // Pattern: "Initial Surname ..." (e.g., "M Tate ...", "J Lightley ...")
  if (parts[0].length === 1 && parts.length >= 2) {
    results.push({ surname: parts[1], firstName: parts[0] });
  }

  // Pattern: "SURNAME FIRSTNAME ..." with surname repeated at end
  const lastWord = parts[parts.length - 1];
  const firstWord = parts[0];
  if (parts.length > 2 && parts.slice(0, -1).some(p =>
    p.toUpperCase() === lastWord.toUpperCase() && p !== lastWord
  )) {
    // Surname at end, find first name
    const firstName = parts.find(p =>
      p.toUpperCase() !== lastWord.toUpperCase() && p.length > 1
    );
    results.push({ surname: lastWord, firstName: firstName || '' });
  }

  // Pattern: "SURNAME FIRSTNAME ..." (e.g., "OUTTERSON JOHN ...")
  if (firstWord.length > 1) {
    results.push({ surname: firstWord, firstName: parts.length > 1 ? parts[1] : '' });
  }

  // Pattern: "Firstname Surname" (e.g., "Eric Young", "Euan Ross")
  if (parts.length >= 2 && parts[0].length > 1 && parts[1].length > 1) {
    results.push({ surname: parts[1], firstName: parts[0] });
  }

  return results;
}

/**
 * Try to match a surname + firstName/initial to a CRM member.
 */
async function tryMatchByName(
  db: any,
  surname: string,
  firstName: string
): Promise<{ status: string; memberId: number | null; memberName: string | null }> {
  if (!surname || surname.length < 2) {
    return { status: 'no_match', memberId: null, memberName: null };
  }

  let results;
  if (firstName && firstName.length > 0) {
    // Match surname exactly, first name starts with
    results = await db.prepare(
      `SELECT id, first_name, surname FROM members
       WHERE LOWER(surname) = LOWER(?) AND LOWER(first_name) LIKE LOWER(?)`
    ).bind(surname, `${firstName}%`).all();
  } else {
    // Match surname only
    results = await db.prepare(
      `SELECT id, first_name, surname FROM members
       WHERE LOWER(surname) = LOWER(?)`
    ).bind(surname).all();
  }

  const members = results.results || [];

  if (members.length === 0) {
    return { status: 'no_match', memberId: null, memberName: null };
  }

  if (members.length === 1) {
    const m = members[0] as any;
    return { status: 'matched', memberId: m.id, memberName: `${m.first_name} ${m.surname}` };
  }

  // Multiple matches — ambiguous
  return { status: 'ambiguous', memberId: null, memberName: null };
}
