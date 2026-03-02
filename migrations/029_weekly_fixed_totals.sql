CREATE TABLE IF NOT EXISTS weekly_totals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  week_number INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  category TEXT NOT NULL,        -- 'fixed' or 'transaction'
  name TEXT NOT NULL,
  quantity REAL DEFAULT 0,
  value REAL DEFAULT 0,
  fetched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(year, week_number, category, name)
);

CREATE INDEX IF NOT EXISTS idx_weekly_totals_year_week ON weekly_totals(year, week_number);
