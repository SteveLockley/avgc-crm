-- Special hours for Google Business Profile (holidays, closures, etc.)
CREATE TABLE IF NOT EXISTS google_special_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  open_time TEXT,
  close_time TEXT,
  is_closed INTEGER DEFAULT 0,
  label TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
