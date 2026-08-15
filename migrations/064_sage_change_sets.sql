-- Staged writes to Sage.
--
-- Nothing is ever written straight to Sage. A generator proposes changes into
-- sage_change, an admin reviews them field by field, they are applied to a test
-- business first, and only then to the live one. before_json is captured from
-- Sage immediately before each write and is the rollback for that row.

-- Which Sage business a token row belongs to. 'live' is the club's real
-- accounts; 'test' is a trial business used to rehearse changes.
ALTER TABLE sage_tokens ADD COLUMN role TEXT NOT NULL DEFAULT 'live';

CREATE TABLE IF NOT EXISTS sage_change_set (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  phase TEXT,                              -- e.g. '1-create-totalenergies'
  target_role TEXT NOT NULL DEFAULT 'test' CHECK (target_role IN ('test', 'live')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'applying', 'applied', 'partial', 'failed', 'rolled_back')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  applied_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS sage_change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_set_id INTEGER NOT NULL REFERENCES sage_change_set(id) ON DELETE CASCADE,
  entity TEXT NOT NULL DEFAULT 'contact',  -- room for other entities later
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'deactivate', 'reactivate', 'delete')),
  sage_id TEXT,                            -- null for create; filled in with the new id once applied
  label TEXT NOT NULL,                     -- human-readable target, e.g. the contact name
  payload_json TEXT NOT NULL,              -- what we intend to send
  before_json TEXT,                        -- record as it was immediately before the write (rollback source)
  after_json TEXT,                         -- record as Sage returned it
  diff_json TEXT,                          -- field-level diff shown in the review UI
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'applied', 'failed', 'skipped', 'rolled_back')),
  applied_at TEXT,
  error TEXT,
  UNIQUE (change_set_id, entity, action, label)
);

CREATE INDEX IF NOT EXISTS idx_sage_change_set ON sage_change(change_set_id, status);

-- Point-in-time snapshots taken before and after each applied set, so there is
-- always a copy of the prior state independent of the per-row before_json.
CREATE TABLE IF NOT EXISTS sage_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_set_id INTEGER REFERENCES sage_change_set(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  taken_at TEXT NOT NULL DEFAULT (datetime('now')),
  stage TEXT NOT NULL CHECK (stage IN ('before', 'after')),
  entity TEXT NOT NULL DEFAULT 'contact',
  item_count INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL                        -- JSON array of the full entity list
);
