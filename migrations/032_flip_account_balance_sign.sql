-- Flip account_balance sign convention:
-- Old: positive = debt, negative = credit
-- New: negative = debt, positive = credit (like a bank account)
UPDATE members SET account_balance = -account_balance WHERE account_balance != 0;
