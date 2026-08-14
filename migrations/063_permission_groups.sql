-- Permission groups
--
-- A permission group bundles a set of capabilities and is granted to members.
-- The first group is the Committee, whose membership is kept in step with the
-- Microsoft 365 group committee@alnmouthvillage.golf in both directions.
--
-- members.is_committee is the flag on the membership record itself. It is a
-- denormalisation of "member is in the committee group" and is always written
-- in the same batch as member_permission_groups (see src/lib/permissions.ts).

CREATE TABLE IF NOT EXISTS permission_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,          -- stable identifier used in code, e.g. 'committee'
  name TEXT NOT NULL,                -- display name
  description TEXT,
  mail_group TEXT,                   -- M365 group address this group syncs with, NULL = manual only
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permission_group_capabilities (
  group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  PRIMARY KEY (group_id, capability)
);

CREATE TABLE IF NOT EXISTS member_permission_groups (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' (ticked in CRM) or 'sync' (from the mail group)
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by TEXT,
  PRIMARY KEY (member_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_member_permission_groups_group ON member_permission_groups(group_id);

-- Audit trail for each sync run, so drift between the CRM and the mail group is visible.
CREATE TABLE IF NOT EXISTS permission_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key TEXT NOT NULL,
  direction TEXT NOT NULL,           -- 'pull' (group -> CRM) or 'push' (CRM -> group)
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  run_by TEXT,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  unmatched INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  detail TEXT                        -- JSON: matched/unmatched addresses, errors
);

-- The flag on the membership record.
ALTER TABLE members ADD COLUMN is_committee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN committee_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_members_is_committee ON members(is_committee);

-- Seed the Committee group and its initial capabilities.
INSERT OR IGNORE INTO permission_groups (key, name, description, mail_group)
VALUES (
  'committee',
  'Committee',
  'Club committee members. Access to the committee portal: all member documents and the Income & Expenditure figures.',
  'committee@alnmouthvillage.golf'
);

INSERT OR IGNORE INTO permission_group_capabilities (group_id, capability)
SELECT id, 'committee.portal' FROM permission_groups WHERE key = 'committee';
INSERT OR IGNORE INTO permission_group_capabilities (group_id, capability)
SELECT id, 'documents.view_all' FROM permission_groups WHERE key = 'committee';
INSERT OR IGNORE INTO permission_group_capabilities (group_id, capability)
SELECT id, 'finance.income_expenditure' FROM permission_groups WHERE key = 'committee';
