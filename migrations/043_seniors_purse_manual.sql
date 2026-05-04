-- Allow manual (non-TouchOffice) purse transactions — e.g. debit payments for prizes/trophies
-- Manual entries use a generated sale_id ('manual-...') and is_manual = 1
ALTER TABLE seniors_purse_entries ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0;
