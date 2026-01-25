import { readFileSync } from 'fs';

// Read and parse CSV
const csvContent = readFileSync('./AVGC Members Export.csv', 'utf-8');
const lines = csvContent.split('\n').filter(line => line.trim());

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Column mapping
const columnMap = {
  'SURNAME': 'surname',
  'MIDDLE INITIALS': 'middle_initials',
  'FIRST NAME': 'first_name',
  'GENDER': 'gender',
  'AGE GROUP': 'age_group',
  'HANDICAP INDEX': 'handicap_index',
  'HOME/AWAY/VISITOR': 'home_away',
  'HOME CLUB': 'home_club',
  'PIN': 'pin',
  'TITLE': 'title',
  'ADDRESS 1': 'address_1',
  'ADDRESS 2': 'address_2',
  'ADDRESS 3': 'address_3',
  'ADDRESS 4': 'address_4',
  'ADDRESS 5': 'address_5',
  'TELEPHONE 1': 'telephone_1',
  'TELEPHONE 2': 'telephone_2',
  'TELEPHONE 3': 'telephone_3',
  'E-MAIL ADDRESS': 'email',
  'CLUB NUMBER': 'club_number',
  'CATEGORY': 'category',
  'OFFICER TITLE': 'officer_title',
  'DATE JOINED': 'date_joined',
  'DATE RENEWED': 'date_renewed',
  'DATE EXPIRES': 'date_expires',
  'DATE SUBSCRIPTION PAID': 'date_subscription_paid',
  'NATIONAL ID COUNTRY': 'national_id_country',
  'NATIONAL ID': 'national_id',
  'CARD NUMBER': 'card_number',
  'DATE OF BIRTH': 'date_of_birth',
  'LOCKER NUMBER': 'locker_number',
  'DEFAULT PAYMENT METHOD': 'default_payment_method',
  'SUBSCRIPTION TEMPLATE': 'subscription_template',
  'ACCOUNT BALANCE': 'account_balance',
  'ACCOUNT NOTES': 'account_notes',
  'SEND INVOICE BY': 'send_invoice_by',
  'COMPETITION FEE PURSE': 'competition_fee_purse',
  'NOTES': 'notes',
  'ELECTRONIC COMMUNICATION CONSENT': 'electronic_communication_consent',
  'DATE COMMUNICATION CONSENT CHANGED': 'date_communication_consent_changed',
  'PARENTAL CONSENT': 'parental_consent',
  'DATA PROTECTION NOTES': 'data_protection_notes',
  'ADDITIONAL LOCKER': 'additional_locker',
  'USER FIELD 2': 'user_field_2',
  'USER FIELD 3': 'user_field_3',
  'ACCOUNT ID': 'account_id'
};

// Parse header
const header = parseCSVLine(lines[0]);

// Convert date from DD/MM/YYYY to YYYY-MM-DD
function convertDate(dateStr) {
  if (!dateStr || !dateStr.includes('/')) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

// Clean currency value
function cleanCurrency(val) {
  if (!val) return 0;
  // Remove £, -, and other non-numeric chars except . and -
  const cleaned = val.replace(/[£,]/g, '').replace(/[^\d.\-]/g, '').trim();
  return parseFloat(cleaned) || 0;
}

// Generate SQL statements
const sqlStatements = [];

for (let i = 1; i < lines.length; i++) {
  const values = parseCSVLine(lines[i]);
  if (values.length < 3) continue;

  const member = {};

  for (let j = 0; j < header.length; j++) {
    const csvCol = header[j].trim();
    const dbCol = columnMap[csvCol];
    if (dbCol && values[j] !== undefined) {
      let value = values[j].trim();
      if (!value) continue;

      // Handle special fields
      if (dbCol === 'account_balance' || dbCol === 'competition_fee_purse') {
        member[dbCol] = cleanCurrency(value);
      } else if (dbCol === 'handicap_index') {
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) member[dbCol] = parsed;
      } else if (dbCol.startsWith('date_')) {
        member[dbCol] = convertDate(value);
      } else {
        member[dbCol] = value;
      }
    }
  }

  // Skip if no surname or first_name
  if (!member.surname || !member.first_name) continue;

  // Set defaults
  if (member.account_balance === undefined) member.account_balance = 0;
  if (member.competition_fee_purse === undefined) member.competition_fee_purse = 0;

  // Build INSERT statement
  const columns = Object.keys(member);
  const vals = columns.map(col => {
    const v = member[col];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return v;
    // Escape single quotes
    return `'${String(v).replace(/'/g, "''")}'`;
  });

  sqlStatements.push(`INSERT INTO members (${columns.join(', ')}) VALUES (${vals.join(', ')});`);
}

// Output SQL
console.log('-- Import ' + sqlStatements.length + ' members');
console.log(sqlStatements.join('\n'));
