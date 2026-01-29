-- Migration: Add tables for persisting imported data
-- This allows subsequent visitors to see previously imported data

-- DD Consolidation Results
CREATE TABLE IF NOT EXISTS dd_consolidation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  imported_by TEXT,
  matched_count INTEGER NOT NULL DEFAULT 0,
  dd_not_in_crm_count INTEGER NOT NULL DEFAULT 0,
  crm_not_in_dd_count INTEGER NOT NULL DEFAULT 0,
  -- Store full results as JSON for easy retrieval
  matched_json TEXT,
  dd_not_in_crm_json TEXT,
  crm_not_in_dd_json TEXT,
  errors_json TEXT
);

-- BRS Consolidation Results
CREATE TABLE IF NOT EXISTS brs_consolidation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  imported_by TEXT,
  matched_count INTEGER NOT NULL DEFAULT 0,
  brs_not_in_crm_count INTEGER NOT NULL DEFAULT 0,
  crm_not_in_brs_count INTEGER NOT NULL DEFAULT 0,
  name_mismatch_count INTEGER NOT NULL DEFAULT 0,
  -- Store full results as JSON for easy retrieval
  matched_json TEXT,
  brs_not_in_crm_json TEXT,
  crm_not_in_brs_json TEXT,
  name_mismatches_json TEXT,
  errors_json TEXT
);

-- EGU Consolidation Results
CREATE TABLE IF NOT EXISTS egu_consolidation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  imported_by TEXT,
  matched_count INTEGER NOT NULL DEFAULT 0,
  egu_not_in_crm_count INTEGER NOT NULL DEFAULT 0,
  crm_not_in_egu_count INTEGER NOT NULL DEFAULT 0,
  total_discrepancies INTEGER NOT NULL DEFAULT 0,
  -- Store full results as JSON
  matched_json TEXT,
  egu_not_in_crm_json TEXT,
  crm_not_in_egu_json TEXT,
  errors_json TEXT
);

-- Clubhouse Financials
CREATE TABLE IF NOT EXISTS clubhouse_financials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  imported_by TEXT,
  -- Summary totals
  total_sales_2024 REAL NOT NULL DEFAULT 0,
  total_sales_2025 REAL NOT NULL DEFAULT 0,
  total_expenses_2024 REAL NOT NULL DEFAULT 0,
  total_expenses_2025 REAL NOT NULL DEFAULT 0,
  total_margin_2024 REAL NOT NULL DEFAULT 0,
  total_margin_2025 REAL NOT NULL DEFAULT 0,
  avg_margin_pct_2024 REAL NOT NULL DEFAULT 0,
  avg_margin_pct_2025 REAL NOT NULL DEFAULT 0,
  -- Store detailed data as JSON
  monthly_data_json TEXT,
  sales_breakdown_json TEXT,
  expenses_breakdown_json TEXT
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_dd_consolidation_imported_at ON dd_consolidation(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_brs_consolidation_imported_at ON brs_consolidation(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_egu_consolidation_imported_at ON egu_consolidation(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_clubhouse_financials_imported_at ON clubhouse_financials(imported_at DESC);
