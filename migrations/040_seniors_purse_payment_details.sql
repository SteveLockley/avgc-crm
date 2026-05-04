-- Add payment detail fields to seniors_purse_entries
-- payment_member_id: FK to members (for credit entries assigned to a senior male member)
-- payment_description: free-text (for expense entries, or "Other" credit payments)
ALTER TABLE seniors_purse_entries ADD COLUMN payment_member_id INTEGER REFERENCES members(id);
ALTER TABLE seniors_purse_entries ADD COLUMN payment_description TEXT;
