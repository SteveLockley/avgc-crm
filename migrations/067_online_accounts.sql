-- Online accounts register.
--
-- One row per external account the club holds (energy suppliers first, then
-- water, telecoms, software, banking...). The supplier's contact details are
-- mirrored from its Sage contact and can be pushed back through the change-set
-- engine (migration 064), so Sage stays the system of record for the supplier
-- while the CRM adds what Sage cannot hold: what the account is for, where to
-- log in, and the credentials.
--
-- Credentials are stored encrypted (AES-256-GCM under ACCOUNTS_VAULT_KEY, see
-- src/lib/vault.ts) and are only decrypted for admins holding the
-- accounts.credentials capability. Every reveal is written to audit_log.

CREATE TABLE IF NOT EXISTS online_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- What it is (local to the CRM)
  name TEXT NOT NULL,                        -- supplier name; mirrored to/from the Sage contact name
  account_type TEXT NOT NULL DEFAULT 'other'
    CHECK (account_type IN ('electricity', 'gas', 'water', 'oil', 'telecoms', 'software', 'banking', 'insurance', 'other')),
  description TEXT,                          -- what the account is for, e.g. "Clubhouse electricity, MPAN ..."
  login_url TEXT,                            -- where to sign in
  notes TEXT,                                -- local notes, never sent to Sage
  active INTEGER NOT NULL DEFAULT 1,

  -- Credentials (encrypted, see above)
  login_id_enc TEXT,
  password_enc TEXT,
  credentials_updated_at TEXT,
  credentials_updated_by TEXT,

  -- Link to Sage
  sage_contact_id TEXT,                      -- Sage contact id; NULL until linked
  sage_web_url TEXT,                         -- the contact's page in the Sage web app (from the API's links)
  sage_ledger_account_id TEXT,               -- default purchase ledger account = "Sage category"
  sage_ledger_account_name TEXT,             -- displayed_as at last sync, e.g. "Electricity (7200)"

  -- Contact details mirrored with the Sage contact
  reference TEXT,                            -- the supplier's account number for the club
  email TEXT,
  telephone TEXT,
  mobile TEXT,
  website TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  sage_notes TEXT,                           -- the Sage contact's notes field

  -- Sync state. pulled_json is the mirrored fields exactly as last read from
  -- Sage, so a push only sends what has changed locally since.
  sage_pulled_at TEXT,
  sage_updated_at TEXT,                      -- Sage's own updated_at at last pull
  pulled_json TEXT,
  local_changed_at TEXT,                     -- set when a mirrored field is edited here; cleared on push/pull
  last_change_set_id INTEGER REFERENCES sage_change_set(id) ON DELETE SET NULL,

  -- Bills and payments from Sage, cached (refreshed on demand)
  bills_ytd REAL,
  payments_ytd REAL,
  bills_total REAL,
  payments_total REAL,
  totals_fy_start TEXT,                      -- first day of the financial year the *_ytd figures cover
  totals_synced_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_online_accounts_sage_contact ON online_accounts(sage_contact_id);
CREATE INDEX IF NOT EXISTS idx_online_accounts_type ON online_accounts(account_type, name);

-- Admins are identified by their Cloudflare Access email, not a member record,
-- so admin-level permissions hang off the email. Same shape as
-- member_permission_groups; emails are stored lower-case.
CREATE TABLE IF NOT EXISTS admin_permission_groups (
  email TEXT NOT NULL,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by TEXT,
  PRIMARY KEY (email, group_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_permission_groups_group ON admin_permission_groups(group_id);

INSERT OR IGNORE INTO permission_groups (key, name, description, mail_group)
VALUES (
  'account_credentials',
  'Online account credentials',
  'Can see and change the login details held for the club''s online accounts. Everyone else sees the account but not the credentials.',
  NULL
);

INSERT OR IGNORE INTO permission_group_capabilities (group_id, capability)
SELECT id, 'accounts.credentials' FROM permission_groups WHERE key = 'account_credentials';

-- Initial holders: IT Manager, Treasurer, Manager, Secretary. These are the
-- Cloudflare Access sign-in addresses, which are the club M365 accounts rather
-- than the personal addresses on the membership records.
INSERT OR IGNORE INTO admin_permission_groups (email, group_id, added_by)
SELECT e.email, g.id, 'migration 067'
  FROM permission_groups g,
       (SELECT 'steve.lockley@alnmouthvillage.golf' AS email
         UNION ALL SELECT 'treasurer@alnmouthvillage.golf'
         UNION ALL SELECT 'manager@alnmouthvillage.golf'
         UNION ALL SELECT 'secretary@alnmouthvillage.golf') e
 WHERE g.key = 'account_credentials';

-- The energy suppliers, to be linked to their Sage contacts from the page.
INSERT INTO online_accounts (name, account_type, description, login_url, website, reference, created_by)
SELECT 'TotalEnergies Gas & Power Limited', 'electricity',
       'Electricity — Tractor Shed, Marine Road (MPAN 1591023060154). Supplier from July 2026; previous account 3009945257.',
       'https://business.totalenergies.uk/', 'https://business.totalenergies.uk/', 'A-1C748198', 'migration 067'
 WHERE NOT EXISTS (SELECT 1 FROM online_accounts WHERE name = 'TotalEnergies Gas & Power Limited');

INSERT INTO online_accounts (name, account_type, description, login_url, website, created_by)
SELECT 'Corona Energy', 'electricity', 'Electricity supply.',
       'https://www.coronaenergy.co.uk/', 'https://www.coronaenergy.co.uk/', 'migration 067'
 WHERE NOT EXISTS (SELECT 1 FROM online_accounts WHERE name = 'Corona Energy');

INSERT INTO online_accounts (name, account_type, description, login_url, website, created_by)
SELECT 'Crown Gas & Power', 'gas', 'Gas supply.',
       'https://www.crowngas.co.uk/', 'https://www.crowngas.co.uk/', 'migration 067'
 WHERE NOT EXISTS (SELECT 1 FROM online_accounts WHERE name = 'Crown Gas & Power');
