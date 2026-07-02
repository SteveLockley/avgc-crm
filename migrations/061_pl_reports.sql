CREATE TABLE IF NOT EXISTS pl_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_end TEXT NOT NULL UNIQUE,   -- last day of the reporting month, e.g. '2026-05-31'
  data TEXT NOT NULL,                -- JSON snapshot of the computed report
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by TEXT,
  sent_at TEXT,
  sent_to TEXT                       -- comma-separated recipient list actually sent to (audit trail)
);

CREATE TABLE IF NOT EXISTS pl_report_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
