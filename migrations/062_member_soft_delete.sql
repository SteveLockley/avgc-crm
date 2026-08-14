-- Soft-delete for members: "Delete" now archives the member instead of removing
-- the row, so invoices/payments/purse balances keep a valid member to join against.
ALTER TABLE members ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_members_deleted_at ON members(deleted_at);
