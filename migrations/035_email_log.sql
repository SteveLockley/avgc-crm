-- Batch email summary log - stores overall results instead of per-member success records
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_type TEXT NOT NULL,
  subject TEXT,
  sender TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
