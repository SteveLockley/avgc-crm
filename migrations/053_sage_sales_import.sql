-- TouchOffice department → Sage ledger account mapping
CREATE TABLE IF NOT EXISTS dept_sage_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_pattern TEXT NOT NULL,           -- case-insensitive partial match against TouchOffice dept name
  sage_ledger_account_id TEXT NOT NULL, -- credit-side nominal account ID in Sage
  sage_ledger_account_name TEXT,        -- denormalised display name
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Audit log of daily TouchOffice → Sage import runs
CREATE TABLE IF NOT EXISTS touchoffice_sage_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_date TEXT NOT NULL UNIQUE,     -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'pending', -- pending | imported | error
  sage_journal_id TEXT,                 -- Sage journal ID after successful creation
  total_amount REAL,
  dept_breakdown_json TEXT,             -- JSON snapshot of dept name → amount
  error_message TEXT,
  imported_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
