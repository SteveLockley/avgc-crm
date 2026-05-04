-- Allow individual purse entries to be locked (protected from force-sync overwrite)
-- and linked to a parent entry when they are split sub-entries.
ALTER TABLE seniors_purse_entries ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE seniors_purse_entries ADD COLUMN split_from_id INTEGER REFERENCES seniors_purse_entries(id);
