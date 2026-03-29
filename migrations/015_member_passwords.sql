-- Add password-based authentication for members
-- Replaces magic link auth with email/password login

-- Add password hash to members table
ALTER TABLE members ADD COLUMN password_hash TEXT;

-- Registration tokens (stores password until email verified)
CREATE TABLE IF NOT EXISTS member_registration_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS member_password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id)
);
