-- Add payment_source column to distinguish TouchOffice vs BACS candidate payments
ALTER TABLE candidate_payments ADD COLUMN payment_source TEXT DEFAULT 'touchoffice';
