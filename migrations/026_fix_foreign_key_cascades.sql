-- Fix missing ON DELETE CASCADE / SET NULL on foreign keys
-- SQLite cannot ALTER foreign keys, so we must recreate affected tables

PRAGMA foreign_keys=OFF;

-- 1. invoices: add ON DELETE CASCADE for member_id
CREATE TABLE invoices_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    member_id INTEGER NOT NULL,
    invoice_date TEXT NOT NULL DEFAULT (date('now')),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    subtotal REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'cancelled')),
    sent_at TEXT,
    sent_to_email TEXT,
    custom_message TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
INSERT INTO invoices_new SELECT * FROM invoices;
DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;
CREATE INDEX idx_invoices_member ON invoices(member_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_period ON invoices(period_start, period_end);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);

-- 2. subscription_history: add ON DELETE SET NULL for payment_id
CREATE TABLE subscription_history_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    subscription_template TEXT,
    category TEXT,
    start_date TEXT,
    end_date TEXT,
    amount_paid REAL,
    payment_id INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
);
INSERT INTO subscription_history_new SELECT * FROM subscription_history;
DROP TABLE subscription_history;
ALTER TABLE subscription_history_new RENAME TO subscription_history;

-- 3. member_registration_tokens: add ON DELETE CASCADE for member_id
CREATE TABLE member_registration_tokens_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
INSERT INTO member_registration_tokens_new SELECT * FROM member_registration_tokens;
DROP TABLE member_registration_tokens;
ALTER TABLE member_registration_tokens_new RENAME TO member_registration_tokens;

-- 4. member_password_resets: add ON DELETE CASCADE for member_id
CREATE TABLE member_password_resets_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
INSERT INTO member_password_resets_new SELECT * FROM member_password_resets;
DROP TABLE member_password_resets;
ALTER TABLE member_password_resets_new RENAME TO member_password_resets;

-- 5. sent_emails: add ON DELETE CASCADE for member_id
CREATE TABLE sent_emails_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    email_type TEXT NOT NULL,
    email_address TEXT NOT NULL,
    year INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    error TEXT,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
INSERT INTO sent_emails_new SELECT * FROM sent_emails;
DROP TABLE sent_emails;
ALTER TABLE sent_emails_new RENAME TO sent_emails;
CREATE INDEX idx_sent_emails_type_year ON sent_emails(email_type, year);
CREATE INDEX idx_sent_emails_member ON sent_emails(member_id);

-- 6. payments: add ON DELETE SET NULL for invoice_id (payment record survives invoice deletion)
--    and keep ON DELETE CASCADE for member_id
CREATE TABLE payments_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    invoice_id INTEGER,
    amount REAL NOT NULL,
    payment_date TEXT DEFAULT (date('now')),
    payment_method TEXT,
    payment_type TEXT CHECK(payment_type IN ('subscription', 'competition_fee', 'bar', 'shop', 'other')),
    reference TEXT,
    notes TEXT,
    recorded_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
);
INSERT INTO payments_new SELECT id, member_id, invoice_id, amount, payment_date, payment_method, payment_type, reference, notes, recorded_by, created_at FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- 7. payment_line_items: add ON DELETE SET NULL for invoice_item_id
CREATE TABLE payment_line_items_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL,
    invoice_item_id INTEGER,
    payment_item_id INTEGER,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE SET NULL,
    FOREIGN KEY (payment_item_id) REFERENCES payment_items(id)
);
INSERT INTO payment_line_items_new SELECT * FROM payment_line_items;
DROP TABLE payment_line_items;
ALTER TABLE payment_line_items_new RENAME TO payment_line_items;
CREATE INDEX idx_payment_line_items_payment ON payment_line_items(payment_id);
CREATE INDEX idx_payment_line_items_payment_item ON payment_line_items(payment_item_id);

PRAGMA foreign_keys=ON;
