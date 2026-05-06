-- Sage Business Cloud Accounting integration
-- OAuth tokens and cached data for financial analysis

CREATE TABLE IF NOT EXISTS sage_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sage_business_id TEXT NOT NULL UNIQUE,
  sage_business_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  refresh_token_expires_at TEXT NOT NULL,
  resource_owner_id TEXT,
  scope TEXT DEFAULT 'full_access',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sage_ledger_accounts (
  id TEXT PRIMARY KEY,
  nominal_code INTEGER,
  name TEXT NOT NULL,
  displayed_as TEXT,
  ledger_account_type TEXT,
  ledger_account_group TEXT,
  tax_rate_id TEXT,
  balance TEXT,
  is_visible_in_banking INTEGER DEFAULT 0,
  is_visible_in_expenses INTEGER DEFAULT 0,
  is_visible_in_journals INTEGER DEFAULT 0,
  is_visible_in_other_payments INTEGER DEFAULT 0,
  is_visible_in_other_receipts INTEGER DEFAULT 0,
  is_visible_in_reporting INTEGER DEFAULT 0,
  is_visible_in_sales INTEGER DEFAULT 0,
  raw_json TEXT,
  last_synced TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sage_bank_accounts (
  id TEXT PRIMARY KEY,
  displayed_as TEXT,
  nominal_code INTEGER,
  account_name TEXT,
  account_number TEXT,
  sort_code TEXT,
  balance TEXT,
  bank_account_type TEXT,
  raw_json TEXT,
  last_synced TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sage_contacts (
  id TEXT PRIMARY KEY,
  displayed_as TEXT,
  name TEXT,
  contact_type TEXT,
  email TEXT,
  reference TEXT,
  balance TEXT,
  raw_json TEXT,
  last_synced TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sage_tax_rates (
  id TEXT PRIMARY KEY,
  displayed_as TEXT,
  name TEXT,
  percentage REAL,
  is_visible INTEGER DEFAULT 1,
  raw_json TEXT,
  last_synced TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sage_transactions (
  id TEXT PRIMARY KEY,
  transaction_type TEXT,
  date TEXT,
  description TEXT,
  amount REAL,
  ledger_account_id TEXT,
  ledger_account_name TEXT,
  contact_id TEXT,
  contact_name TEXT,
  reference TEXT,
  raw_json TEXT,
  last_synced TEXT DEFAULT (datetime('now'))
);
