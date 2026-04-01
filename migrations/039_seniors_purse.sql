-- Seniors' Competition Purse entries fetched from TouchOffice Customer Statement (customer 1035)
CREATE TABLE IF NOT EXISTS seniors_purse_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL UNIQUE,        -- TouchOffice sale ID — dedup key
  sale_date TEXT NOT NULL,             -- ISO datetime: YYYY-MM-DD HH:MM:SS
  balance_adj REAL NOT NULL DEFAULT 0, -- (£) Balance Adj from the statement (positive = credit in)
  running_balance REAL NOT NULL DEFAULT 0, -- (£) Balance at this transaction
  year INTEGER NOT NULL,               -- Financial year (YYYY)
  receipt_text TEXT,                   -- Raw receipt text from viewsinglesale
  receipt_items TEXT,                  -- JSON: [{description, qty, amount}]
  fetched_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seniors_purse_year ON seniors_purse_entries(year);
CREATE INDEX IF NOT EXISTS idx_seniors_purse_date ON seniors_purse_entries(sale_date);
