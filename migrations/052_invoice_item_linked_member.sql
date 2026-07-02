-- Add linked_member_id to invoice_items to track which line items belong to a linked family member
ALTER TABLE invoice_items ADD COLUMN linked_member_id INTEGER REFERENCES members(id);
