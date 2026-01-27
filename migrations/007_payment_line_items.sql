-- Payment line items - breaks down each payment into its component invoice items
CREATE TABLE IF NOT EXISTS payment_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL,
    invoice_item_id INTEGER,
    payment_item_id INTEGER,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id),
    FOREIGN KEY (payment_item_id) REFERENCES payment_items(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_line_items_payment ON payment_line_items(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_line_items_payment_item ON payment_line_items(payment_item_id);
