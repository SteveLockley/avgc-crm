-- Email send log for tracking bulk sends and enabling batch resume
CREATE TABLE IF NOT EXISTS sent_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  email_type TEXT NOT NULL,
  email_address TEXT NOT NULL,
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_id) REFERENCES members(id)
);
CREATE INDEX idx_sent_emails_type_year ON sent_emails(email_type, year);
CREATE INDEX idx_sent_emails_member ON sent_emails(member_id);
