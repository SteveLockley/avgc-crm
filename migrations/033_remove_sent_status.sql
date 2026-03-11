-- Migration 033: Remove 'sent' as an invoice status
-- 'Sent' is not a meaningful status — an invoice is either paid or unpaid.
-- The sent_at column already tracks when an email was sent.

UPDATE invoices SET status = 'draft' WHERE status = 'sent';
