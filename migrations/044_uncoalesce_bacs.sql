-- Recover BACS candidate records that were wrongly coalesced by an earlier bug.
-- BACS records are individual bank transactions and should never be merged together.
--
-- Step 1: Fix the amount on any primary record (any source) that had BACS records
--         merged into it — subtract the absorbed BACS amounts back out.
UPDATE candidate_payments
SET
  amount = amount - (
    SELECT COALESCE(SUM(absorbed.amount), 0)
    FROM candidate_payments AS absorbed
    WHERE absorbed.coalesced_into = candidate_payments.id
      AND absorbed.payment_source = 'bacs'
      AND absorbed.processed = 1
      AND absorbed.coalesced_into IS NOT NULL
  ),
  coalesced_sale_ids = NULL,
  -- Reset invoice match so it is re-evaluated when the user processes the record
  amount_matches_invoice = 0,
  matched_invoice_id = NULL,
  invoice_total = NULL,
  outstanding_items = NULL,
  extra_items = NULL
WHERE EXISTS (
  SELECT 1 FROM candidate_payments AS absorbed
  WHERE absorbed.coalesced_into = candidate_payments.id
    AND absorbed.payment_source = 'bacs'
    AND absorbed.processed = 1
    AND absorbed.coalesced_into IS NOT NULL
);

-- Step 2: Un-coalesce all absorbed BACS records so they reappear as unprocessed candidates.
UPDATE candidate_payments
SET
  processed = 0,
  coalesced_into = NULL,
  notes = NULL
WHERE payment_source = 'bacs'
  AND processed = 1
  AND coalesced_into IS NOT NULL;
