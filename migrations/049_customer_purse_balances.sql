-- Customer purse balances fetched from TouchOffice Customer Balance report
-- All customer groups: MEMBERS (1), SOCIAL MEMBER (2), Dead Cards (3), STAFF DISCOUNT (4)
CREATE TABLE IF NOT EXISTS customer_purse_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_number INTEGER NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  account_number TEXT DEFAULT '',
  account_balance REAL NOT NULL DEFAULT 0,
  customer_group TEXT NOT NULL DEFAULT '',   -- 'MEMBERS' | 'SOCIAL MEMBER' | 'Dead Cards' | 'STAFF DISCOUNT'
  member_id INTEGER REFERENCES members(id),  -- matched member (manual or auto)
  auto_matched INTEGER NOT NULL DEFAULT 0,   -- 1 = auto-matched by name; 0 = manual or unmatched
  fetched_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cpb_group   ON customer_purse_balances(customer_group);
CREATE INDEX IF NOT EXISTS idx_cpb_member  ON customer_purse_balances(member_id);
CREATE INDEX IF NOT EXISTS idx_cpb_balance  ON customer_purse_balances(account_balance);
