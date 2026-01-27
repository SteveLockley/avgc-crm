-- Invoice system tables
-- Migration 004: Add payment items catalog and invoice tracking

-- Payment items catalog (subscription types and fees)
CREATE TABLE IF NOT EXISTS payment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK(category IN ('Subscription', 'Fee')),
    name TEXT NOT NULL,
    fee REAL NOT NULL,
    description TEXT,
    subscription_template TEXT,  -- Links to SUBSCRIPTION_TEMPLATES for subscriptions
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    member_id INTEGER NOT NULL,
    invoice_date TEXT NOT NULL DEFAULT (date('now')),
    period_start TEXT NOT NULL,  -- e.g., '2025-04-01'
    period_end TEXT NOT NULL,    -- e.g., '2026-03-31'
    subtotal REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'cancelled')),
    sent_at TEXT,
    sent_to_email TEXT,
    custom_message TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Invoice line items
CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    payment_item_id INTEGER,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price REAL NOT NULL,
    line_total REAL NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_item_id) REFERENCES payment_items(id)
);

-- Invoice settings (payment instructions, etc.)
CREATE TABLE IF NOT EXISTS invoice_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_invoices_member ON invoices(member_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_category ON payment_items(category);
CREATE INDEX IF NOT EXISTS idx_payment_items_template ON payment_items(subscription_template);

-- Seed default payment items based on subscription templates
INSERT OR IGNORE INTO payment_items (category, name, fee, description, subscription_template) VALUES
    ('Subscription', 'Full Home Membership', 0, 'Full playing membership (Home)', 'A) Full Home'),
    ('Subscription', 'Full Away Membership', 0, 'Full playing membership (Away)', 'B) Full Away'),
    ('Subscription', 'Under 30 Home Membership', 0, 'Under 30 playing membership (Home)', 'C) Under 30 Home'),
    ('Subscription', 'Under 30 Away Membership', 0, 'Under 30 playing membership (Away)', 'D) Under 30 Away'),
    ('Subscription', 'Senior Home Membership', 0, 'Senior playing membership (Home)', 'E) Senior Home'),
    ('Subscription', 'Senior Away Membership', 0, 'Senior playing membership (Away)', 'F) Senior Away'),
    ('Subscription', 'Over 80 Home Membership', 0, 'Over 80 playing membership (Home)', 'G) Over 80 Home'),
    ('Subscription', 'Junior Home Membership', 0, 'Junior playing membership (Home)', 'M) Junior Home'),
    ('Subscription', 'Junior Academy Membership', 0, 'Junior Academy membership', 'O) Junior Academy'),
    ('Subscription', 'Social Membership', 0, 'Social (non-playing) membership', 'S) Social Membership'),
    ('Subscription', 'Twilight Membership', 0, 'Twilight playing membership', 'T) Twilight Member'),
    ('Subscription', 'Out Of County (Less than 100 miles)', 0, 'Out of county membership (<100 miles)', 'U) Out Of County (Less than 100 miles) Home Member'),
    ('Subscription', 'Out Of County (100 miles or more)', 0, 'Out of county membership (>=100 miles)', 'W) Out Of County (100 miles or more) Away Member'),
    ('Subscription', '18 Month Full Membership', 0, '18 month full membership package', '3) 18 Month Full Membership');

-- Seed default fee items
INSERT OR IGNORE INTO payment_items (category, name, fee, description) VALUES
    ('Fee', 'England Golf', 12.00, 'England Golf affiliation fee'),
    ('Fee', 'Northumberland County', 6.50, 'Northumberland County Golf Union fee'),
    ('Fee', 'Locker', 10.00, 'Annual locker rental fee');

-- Seed default invoice settings
INSERT OR IGNORE INTO invoice_settings (setting_key, setting_value) VALUES
    ('bank_name', 'Barclays Bank'),
    ('sort_code', ''),
    ('account_number', ''),
    ('account_name', 'Alnmouth Village Golf Club'),
    ('direct_debit_instructions', 'If you pay by Direct Debit via Clubwise, your subscription will be collected automatically. Please contact the office if you have any questions about your Direct Debit arrangement.'),
    ('pay_at_club_instructions', 'Visit the clubhouse to pay in person. We accept cash, card, and cheque payments.'),
    ('payment_due_days', '30'),
    ('default_custom_message', 'Thank you for your continued membership of Alnmouth Village Golf Club. Please find enclosed your subscription invoice for the upcoming membership year.');
