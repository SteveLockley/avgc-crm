-- Alnmouth Village Golf Club CRM Database Schema
-- Based on AVGC Members Export structure

-- Members table (core member information)
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Identity
    surname TEXT NOT NULL,
    middle_initials TEXT,
    first_name TEXT NOT NULL,
    title TEXT,
    gender TEXT CHECK(gender IN ('M', 'F', NULL)),
    date_of_birth TEXT,
    pin TEXT,

    -- Contact
    address_1 TEXT,
    address_2 TEXT,
    address_3 TEXT,
    address_4 TEXT,
    address_5 TEXT,
    telephone_1 TEXT,
    telephone_2 TEXT,
    telephone_3 TEXT,
    email TEXT,

    -- Membership
    club_number TEXT,
    category TEXT,
    age_group TEXT,
    home_away TEXT CHECK(home_away IN ('H', 'A', 'V', NULL)),
    home_club TEXT DEFAULT 'Alnmouth Village',
    subscription_template TEXT,
    officer_title TEXT,

    -- Golf/WHS
    handicap_index REAL,
    national_id_country TEXT,
    national_id TEXT,
    card_number TEXT,

    -- Dates
    date_joined TEXT,
    date_renewed TEXT,
    date_expires TEXT,
    date_subscription_paid TEXT,

    -- Financial
    default_payment_method TEXT,
    account_balance REAL DEFAULT 0,
    competition_fee_purse REAL DEFAULT 0,

    -- Admin
    locker_number TEXT,
    additional_locker TEXT,
    send_invoice_by TEXT DEFAULT 'Email',
    account_notes TEXT,
    notes TEXT,

    -- Consent/GDPR
    electronic_communication_consent TEXT DEFAULT 'No',
    date_communication_consent_changed TEXT,
    parental_consent TEXT,
    data_protection_notes TEXT,

    -- User fields
    user_field_2 TEXT,
    user_field_3 TEXT,
    account_id TEXT,

    -- System
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date TEXT DEFAULT (date('now')),
    payment_method TEXT,
    payment_type TEXT CHECK(payment_type IN ('subscription', 'competition_fee', 'bar', 'shop', 'other')),
    reference TEXT,
    notes TEXT,
    recorded_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- Subscription history table
CREATE TABLE IF NOT EXISTS subscription_history (
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
    FOREIGN KEY (payment_id) REFERENCES payments(id)
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'viewer')),
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_members_surname ON members(surname);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_category ON members(category);
CREATE INDEX IF NOT EXISTS idx_members_date_expires ON members(date_expires);
CREATE INDEX IF NOT EXISTS idx_members_home_away ON members(home_away);
CREATE INDEX IF NOT EXISTS idx_payments_member_id ON payments(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

-- Full text search virtual table for member search
CREATE VIRTUAL TABLE IF NOT EXISTS members_fts USING fts5(
    surname,
    first_name,
    email,
    address_1,
    content='members',
    content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS members_ai AFTER INSERT ON members BEGIN
    INSERT INTO members_fts(rowid, surname, first_name, email, address_1)
    VALUES (new.id, new.surname, new.first_name, new.email, new.address_1);
END;

CREATE TRIGGER IF NOT EXISTS members_ad AFTER DELETE ON members BEGIN
    INSERT INTO members_fts(members_fts, rowid, surname, first_name, email, address_1)
    VALUES('delete', old.id, old.surname, old.first_name, old.email, old.address_1);
END;

CREATE TRIGGER IF NOT EXISTS members_au AFTER UPDATE ON members BEGIN
    INSERT INTO members_fts(members_fts, rowid, surname, first_name, email, address_1)
    VALUES('delete', old.id, old.surname, old.first_name, old.email, old.address_1);
    INSERT INTO members_fts(rowid, surname, first_name, email, address_1)
    VALUES (new.id, new.surname, new.first_name, new.email, new.address_1);
END;
