-- Daily takings: TouchOffice department totals posted to Sage as an Other
-- Receipt into the till bank account, one per trading day, with VAT itemised
-- per budget head. Replaces the never-used journal-based POS import
-- (migration 053), which could not carry VAT.
--
-- Nothing is posted without a stored dry run for the day, and a day that
-- already has a till receipt in Sage is never posted twice.

-- TouchOffice department → Sage budget head. Nominal codes, not Sage ids, so
-- the same mapping resolves against the live business and a test business.
CREATE TABLE IF NOT EXISTS daily_takings_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_pattern TEXT NOT NULL UNIQUE,        -- TouchOffice department name (exact, case-insensitive; falls back to "contains")
  nominal_code INTEGER NOT NULL,            -- Sage ledger account nominal code, e.g. 4000
  ledger_name TEXT,                         -- for display, e.g. "Bar Sales (4000)"
  tax_rate_id TEXT NOT NULL                 -- Sage tax rate id
    CHECK (tax_rate_id IN ('GB_STANDARD', 'GB_LOWER', 'GB_ZERO', 'GB_EXEMPT', 'GB_NO_TAX')),
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- The budget heads the bookkeeper has used all year (verified against every
-- 2026 till receipt in Sage: 32 of 38 weeks match TouchOffice to the penny).
INSERT OR IGNORE INTO daily_takings_mapping (dept_pattern, nominal_code, ledger_name, tax_rate_id, sort_order) VALUES
  ('Bar Sales',          4000, 'Bar Sales (4000)',            'GB_STANDARD', 10),
  ('Food Sales',         4010, 'Food Sales (4010)',           'GB_STANDARD', 20),
  ('Coffee Machine',     4020, 'Coffee Machine Sales (4020)', 'GB_STANDARD', 30),
  ('Memberships',        4030, 'Members Subscription (4030)', 'GB_EXEMPT',   40),
  ('Social Memberships', 4030, 'Members Subscription (4030)', 'GB_EXEMPT',   41),
  ('Visitors Fees',      4040, 'Visiting Green Fees (4040)',  'GB_EXEMPT',   50),
  ('Buggies',            4050, 'Buggies (4050)',              'GB_STANDARD', 60),
  ('Lockers',            4060, 'Locker Sales (4060)',         'GB_STANDARD', 70),
  ('Merchandise',        4070, 'Merchandise sales (4070)',    'GB_STANDARD', 80);

-- One row per trading day: what TouchOffice reported, what we would post,
-- what Sage already holds, how they compare, and what (if anything) was posted.
CREATE TABLE IF NOT EXISTS daily_takings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  takings_date TEXT NOT NULL UNIQUE,        -- YYYY-MM-DD

  touchoffice_json TEXT,                    -- [{name, quantity, value}] every department, gross
  proposed_json TEXT,                       -- ProposedReceipt (see src/lib/daily-takings.ts)
  proposed_total REAL,
  sage_json TEXT,                           -- till receipts already in Sage for the day, normalised
  sage_total REAL,
  comparison TEXT,                          -- match | mismatch | missing_in_sage | sage_only | no_sales | unmapped | error
  diff_json TEXT,                           -- DayComparison
  checked_at TEXT,
  check_role TEXT,                          -- which Sage business the comparison was made against

  test_sage_id TEXT,                        -- other_payment id created in the test business
  test_posted_at TEXT,
  live_sage_id TEXT,                        -- other_payment id created in the live business
  live_posted_at TEXT,
  posted_by TEXT,
  error TEXT,
  notes TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_takings_date ON daily_takings(takings_date DESC);

-- Settings (app_settings): daily_takings_bank_nominal (default 1230),
-- daily_takings_mode (dry_run | test | live), daily_takings_live_from (YYYY-MM-DD).
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('daily_takings_bank_nominal', '1230');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('daily_takings_mode', 'dry_run');

-- The journal-based import is superseded.
DROP TABLE IF EXISTS touchoffice_sage_imports;
DROP TABLE IF EXISTS dept_sage_mapping;
DELETE FROM app_settings WHERE key = 'sage_sales_debit_account_id';
