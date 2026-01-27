-- Add direct debit member ID field to members table
-- This stores the member number from the Clubwise Direct Debit system

ALTER TABLE members ADD COLUMN direct_debit_member_id TEXT;

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_members_dd_member_id ON members(direct_debit_member_id);
