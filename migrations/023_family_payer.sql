-- Migration: Add family payer relationship for DD family memberships
-- The primary payer has family_payer_id = NULL, dependants point to the payer

ALTER TABLE members ADD COLUMN family_payer_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX idx_members_family_payer ON members(family_payer_id);
