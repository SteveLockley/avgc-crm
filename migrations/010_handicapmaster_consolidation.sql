-- Migration: Add HandicapMaster consolidation table

CREATE TABLE IF NOT EXISTS handicapmaster_consolidation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  imported_by TEXT,
  matched_count INTEGER NOT NULL DEFAULT 0,
  hm_not_in_crm_count INTEGER NOT NULL DEFAULT 0,
  crm_not_in_hm_count INTEGER NOT NULL DEFAULT 0,
  -- Store full results as JSON for easy retrieval
  matched_json TEXT,
  hm_not_in_crm_json TEXT,
  crm_not_in_hm_json TEXT,
  errors_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_handicapmaster_consolidation_imported_at ON handicapmaster_consolidation(imported_at DESC);
