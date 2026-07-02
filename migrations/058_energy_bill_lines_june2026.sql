-- Add May/June 2026 bill lines for Kitchen (1591023079509) and Clubhouse (1591123079504)
-- from invoice-export.csv invoices IN0003807357 and IN0003807358.
-- Tractor Shed is excluded (accurate half-hourly readings in chart.csv).
-- Uses INSERT OR IGNORE so re-running is safe.

INSERT OR IGNORE INTO energy_bill_lines
  (mpan, invoice_number, invoice_date, due_date,
   opening_read, opening_read_date, opening_read_type,
   closing_read, closing_read_date, closing_read_type,
   register_id, advance_units_kwh, net_amount, vat_amount,
   invoice_amount, vat_rate, ccl_amount, status)
VALUES
  -- IN0003807357 row 1: Kitchen, 01/05/2026 → 26/05/2026
  ('1591023079509', 'IN0003807357', '2026-06-09', '2026-06-19',
   34835, '2026-05-01', 'E',
   36668, '2026-05-26', 'R',
   'A1', 1833.0, 565.30, 113.06,
   678.36, 20.00, 17.78, 'Cleared'),

  -- IN0003807357 row 2: Kitchen, 26/05/2026 → 01/06/2026
  ('1591023079509', 'IN0003807357', '2026-06-09', '2026-06-19',
   36668, '2026-05-26', 'R',
   37055, '2026-06-01', 'E',
   'A1', 387.0, 565.30, 113.06,
   678.36, 20.00, 17.78, 'Cleared'),

  -- IN0003807358 row 1: Clubhouse, 01/05/2026 → 26/05/2026
  ('1591123079504', 'IN0003807358', '2026-06-09', '2026-06-19',
   76868, '2026-05-01', 'E',
   78832, '2026-05-26', 'R',
   '00', 1964.0, 534.80, 106.96,
   641.76, 20.00, 17.48, 'Cleared'),

  -- IN0003807358 row 2: Clubhouse, 26/05/2026 → 01/06/2026
  ('1591123079504', 'IN0003807358', '2026-06-09', '2026-06-19',
   78832, '2026-05-26', 'R',
   79050, '2026-06-01', 'E',
   '00', 218.0, 534.80, 106.96,
   641.76, 20.00, 17.48, 'Cleared');
