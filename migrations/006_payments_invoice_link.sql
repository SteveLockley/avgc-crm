-- Add invoice_id to payments table to link payments to invoices
ALTER TABLE payments ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);

-- Add period_start setting to invoice_settings
INSERT OR IGNORE INTO invoice_settings (setting_key, setting_value)
VALUES ('period_start_month', '4');

INSERT OR IGNORE INTO invoice_settings (setting_key, setting_value)
VALUES ('period_start_day', '1');

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
