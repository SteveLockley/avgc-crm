-- Add columns for coalescing multiple TouchOffice sales into one candidate payment
ALTER TABLE candidate_payments ADD COLUMN coalesced_into INTEGER REFERENCES candidate_payments(id);
ALTER TABLE candidate_payments ADD COLUMN coalesced_sale_ids TEXT;  -- JSON array of sale_ids merged into this row
