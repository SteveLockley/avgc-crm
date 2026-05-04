-- Link seniors purse entries to the payments record created when a member is attributed
ALTER TABLE seniors_purse_entries ADD COLUMN payment_id INTEGER REFERENCES payments(id);
