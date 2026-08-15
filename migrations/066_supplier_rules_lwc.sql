-- Supplier recognition rules for the trade suppliers the club actually uses,
-- taken from the two-year contact analysis. text_pattern is matched against the
-- extracted PDF text; sender_pattern against the From address once the mailbox
-- reader is connected.
--
-- Nominal codes follow the club's existing coding: 5000 bar purchases,
-- 5020 food purchases, 5065 merchandise, 7200 electricity, 7210 gas & oil,
-- 7110 water rates, 7400 course maintenance.

INSERT INTO invoice_suppliers (supplier_key, display_name, parser, sender_pattern, text_pattern, default_ledger_code)
VALUES
  ('lwc',            'LWC Drinks Limited',        'generic', 'lwc-drinks\.co\.uk',    'LWC\s*Drinks',              '5000'),
  ('booker',         'Booker Limited',            'generic', 'booker\.co\.uk',        '\bBooker\b',                '5020'),
  ('pioneer',        'Pioneer Food Service',      'generic', 'pioneerfoodservice',    'Pioneer Food',              '5020'),
  ('cityfresh',      'City Fresh',                'generic', 'cityfresh',             'City\s*Fresh',              '5020'),
  ('rijo42',         'Rijo42',                    'generic', 'rijo42',                'Rijo\s*42',                 '5020'),
  ('alnwickbakery',  'The Alnwick Bakery',        'generic', 'alnwickbakery',         'Alnwick Bakery',            '5020'),
  ('bfs',            'BFS Group Limited',         'generic', 'bfsgroup|bidfood',      'BFS Group|Bidfood',         '5020'),
  ('heineken',       'Heineken UK Limited',       'generic', 'heineken',              'HEINEKEN',                  '5000'),
  ('agrovista',      'Agrovista UK Limited',      'generic', 'agrovista',             'Agrovista',                 '7400'),
  ('oakland',        'Oakland Amenity',           'generic', 'oaklandamenity',        'Oakland Amenity',           '7400'),
  ('srixon',         'Srixon Sports Europe',      'generic', 'srixon|dunlopsports',   'Srixon',                    '5065')
ON CONFLICT(supplier_key) DO UPDATE SET
  display_name        = excluded.display_name,
  text_pattern        = excluded.text_pattern,
  sender_pattern      = excluded.sender_pattern,
  default_ledger_code = excluded.default_ledger_code;
