CREATE TABLE IF NOT EXISTS weekly_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  week_number INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  department TEXT NOT NULL,
  department_id TEXT,
  quantity REAL DEFAULT 0,
  value REAL DEFAULT 0,
  percentage REAL DEFAULT 0,
  fetched_at TEXT DEFAULT (datetime('now')),
  UNIQUE(year, week_number, department)
);

CREATE INDEX IF NOT EXISTS idx_weekly_sales_year_week ON weekly_sales(year, week_number);
