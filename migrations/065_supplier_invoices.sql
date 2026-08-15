-- Supplier invoices ingested from PDFs.
--
-- Bills arrive as PDF attachments (later from the treasurer's mailbox via
-- Graph, for now by manual upload), are parsed by a per-supplier adapter,
-- staged here for review, and only then proposed into Sage through the
-- change-set engine in migration 064.

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Who it's from. sage_contact_id is filled once matched to a Sage contact.
  supplier_key TEXT NOT NULL,              -- normalised, e.g. 'totalenergies'
  supplier_name TEXT NOT NULL,             -- as printed on the invoice
  sage_contact_id TEXT,

  -- Header figures
  invoice_number TEXT,
  invoice_date TEXT,
  due_date TEXT,
  period_from TEXT,
  period_to TEXT,
  net_amount REAL,
  vat_amount REAL,
  gross_amount REAL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  account_reference TEXT,                  -- supplier's account number for the club

  -- Where it came from and how well it parsed
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'email')),
  source_message_id TEXT,                  -- Graph message id when source = 'email'
  file_name TEXT,
  parser TEXT,                             -- adapter that produced this
  confidence REAL NOT NULL DEFAULT 0,      -- 0-1, drives "needs a decision"
  parse_warnings TEXT,                     -- JSON array of strings
  raw_text TEXT,                           -- extracted text, kept for re-parsing

  status TEXT NOT NULL DEFAULT 'parsed'
    CHECK (status IN ('parsed', 'needs_review', 'approved', 'rejected', 'pushed', 'duplicate')),

  -- Review trail
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  notes TEXT,

  -- Link to the Sage change that pushed it
  change_id INTEGER REFERENCES sage_change(id) ON DELETE SET NULL,

  UNIQUE (supplier_key, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status ON supplier_invoices(status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier ON supplier_invoices(supplier_key, invoice_date DESC);

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  quantity REAL,
  unit TEXT,
  net_amount REAL,
  vat_rate REAL,
  vat_amount REAL,
  ledger_account_code TEXT                 -- suggested nominal, e.g. '7200'
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines ON supplier_invoice_lines(invoice_id, line_no);

-- Where the PDF itself lives. Local bytes are never stored in D1; this holds
-- the pointer to OneDrive once B3 lands, and the mail message meanwhile.
CREATE TABLE IF NOT EXISTS invoice_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  byte_size INTEGER,
  sha256 TEXT,                             -- dedupe identical attachments
  storage TEXT NOT NULL DEFAULT 'pending' CHECK (storage IN ('pending', 'onedrive', 'mailbox')),
  onedrive_item_id TEXT,
  web_url TEXT,
  stored_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_documents_sha ON invoice_documents(sha256);

-- Every message or file the ingester looked at, parsed or not, with the reason.
CREATE TABLE IF NOT EXISTS invoice_ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,                    -- 'upload' | 'email'
  message_id TEXT,
  sender TEXT,
  subject TEXT,
  file_name TEXT,
  outcome TEXT NOT NULL,                   -- 'parsed' | 'duplicate' | 'no_attachment' | 'unknown_supplier' | 'parse_failed' | 'error'
  invoice_id INTEGER REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_ingestion_log ON invoice_ingestion_log(run_at DESC);

-- Maps a sender address or PDF fingerprint to a parser and a Sage contact, so
-- the ingester knows what to do with mail it has seen before.
CREATE TABLE IF NOT EXISTS invoice_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  parser TEXT NOT NULL DEFAULT 'generic',
  sender_pattern TEXT,                     -- regex against the From address
  text_pattern TEXT,                       -- regex against the PDF text, for identification
  sage_contact_id TEXT,
  default_ledger_code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO invoice_suppliers (supplier_key, display_name, parser, sender_pattern, text_pattern, default_ledger_code) VALUES
  ('totalenergies', 'TotalEnergies Gas & Power Limited', 'totalenergies', 'totalenergies\.(uk|com)', 'TotalEnergies', '7200'),
  ('corona',        'Corona Energy',                     'corona',        'coronaenergy\.co\.uk',    'Corona Energy', '7200'),
  ('crown',         'Crown Gas & Power',                 'generic',       'crowngas\.co\.uk',        'Crown Gas',     '7210'),
  ('anglian',       'Anglian Water',                     'generic',       'anglianwater\.co\.uk',    'Anglian Water', '7110'),
  ('certas',        'Certas Energy',                     'generic',       'certasenergy\.co\.uk',    'Certas',        '7210');
