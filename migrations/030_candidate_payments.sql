CREATE TABLE IF NOT EXISTS candidate_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL UNIQUE,
  sale_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  member_name TEXT,
  discount_card TEXT,
  payment_type TEXT CHECK(payment_type IN ('cash', 'card')) DEFAULT 'cash',
  line_items TEXT,          -- JSON: [{description, qty, amount}]
  receipt_text TEXT,        -- raw receipt for debugging
  matched_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  match_status TEXT DEFAULT 'no_match',
  amount_matches_invoice INTEGER DEFAULT 0,
  matched_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  processed INTEGER DEFAULT 0,
  processed_at TEXT,
  notes TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cp_sale_date ON candidate_payments(sale_date);
CREATE INDEX IF NOT EXISTS idx_cp_processed ON candidate_payments(processed);

ALTER TABLE members ADD COLUMN discount_card TEXT;
