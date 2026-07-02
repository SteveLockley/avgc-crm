-- Add TouchOffice internal customer number to members
-- The TO num differs from CRM member ID and must be stored explicitly
ALTER TABLE members ADD COLUMN touchoffice_num INTEGER;
CREATE INDEX IF NOT EXISTS idx_members_touchoffice_num ON members(touchoffice_num);
