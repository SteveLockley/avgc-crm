-- Member documents table for AGM minutes, committee minutes, and general documents
CREATE TABLE member_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  document_url TEXT NOT NULL,
  document_date DATE NOT NULL,
  published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE INDEX idx_member_documents_category ON member_documents(category);
CREATE INDEX idx_member_documents_date ON member_documents(document_date);
CREATE INDEX idx_member_documents_published ON member_documents(published);
