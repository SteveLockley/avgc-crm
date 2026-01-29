// Database utility functions for the CRM

export interface Member {
  id: number;
  surname: string;
  middle_initials: string | null;
  first_name: string;
  title: string | null;
  gender: 'M' | 'F' | null;
  date_of_birth: string | null;
  pin: string | null;
  address_1: string | null;
  address_2: string | null;
  address_3: string | null;
  address_4: string | null;
  address_5: string | null;
  telephone_1: string | null;
  telephone_2: string | null;
  telephone_3: string | null;
  email: string | null;
  club_number: string | null;
  category: string | null;
  age_group: string | null;
  home_away: 'H' | 'A' | 'V' | null;
  home_club: string | null;
  subscription_template: string | null;
  officer_title: string | null;
  handicap_index: number | null;
  national_id_country: string | null;
  national_id: string | null;
  card_number: string | null;
  date_joined: string | null;
  date_renewed: string | null;
  date_expires: string | null;
  date_subscription_paid: string | null;
  default_payment_method: string | null;
  account_balance: number;
  competition_fee_purse: number;
  locker_number: string | null;
  additional_locker: string | null;
  send_invoice_by: string | null;
  account_notes: string | null;
  notes: string | null;
  electronic_communication_consent: string | null;
  date_communication_consent_changed: string | null;
  parental_consent: string | null;
  data_protection_notes: string | null;
  user_field_2: string | null;
  user_field_3: string | null;
  account_id: string | null;
  direct_debit_member_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  member_id: number;
  invoice_id: number | null;
  amount: number;
  payment_date: string;
  payment_method: string | null;
  payment_type: string | null;
  reference: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface PaymentLineItem {
  id: number;
  payment_id: number;
  invoice_item_id: number | null;
  payment_item_id: number | null;
  description: string;
  amount: number;
  created_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: 'admin' | 'viewer';
  last_login: string | null;
  created_at: string;
}

export interface PaymentItem {
  id: number;
  category: 'Subscription' | 'Fee';
  name: string;
  fee: number;
  description: string | null;
  subscription_template: string | null;
  active: number;
  created_at: string;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  member_id: number;
  invoice_date: string;
  period_start: string;
  period_end: string;
  subtotal: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  sent_at: string | null;
  sent_to_email: string | null;
  custom_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  payment_item_id: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface InvoiceSetting {
  id: number;
  setting_key: string;
  setting_value: string;
  updated_at: string;
}

// Invoice statuses
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'cancelled'] as const;

// Zero-cost subscription types (Life, Honorary, Gratis)
// These may still have fees (EGU, County, Locker) depending on member circumstances
export const ZERO_COST_SUBSCRIPTIONS = ['Life', 'Honorary', 'Gratis'] as const;

// Fee templates for zero-cost subscriptions
// Used when a Life/Honorary/Gratis member still owes fees
export const FEE_TEMPLATES = [
  'England Golf and County Fees',
  'England Golf and County Fees and Locker',
  'Locker'
] as const;

// Legacy - kept for backwards compatibility during migration
export const SUBSCRIPTION_TEMPLATES = FEE_TEMPLATES;

// Payment methods
export const PAYMENT_METHODS = [
  'Clubwise Direct Debit',
  'BACS',
  'Over the Till',
  'Cheque',
  'Card'
] as const;

// Age groups
export const AGE_GROUPS = [
  'Junior',
  'Adult',
  'Senior',
  'Playing Ladies'
] as const;

// Format date for display (DD/MM/YYYY)
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB');
  } catch {
    return dateStr;
  }
}

// Format currency
export function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '£0.00';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(amount);
}

// Get full name
export function getFullName(member: Pick<Member, 'title' | 'first_name' | 'surname'>): string {
  const parts = [member.title, member.first_name, member.surname].filter(Boolean);
  return parts.join(' ');
}

// Get full address
export function getFullAddress(member: Pick<Member, 'address_1' | 'address_2' | 'address_3' | 'address_4' | 'address_5'>): string {
  const parts = [
    member.address_1,
    member.address_2,
    member.address_3,
    member.address_4,
    member.address_5
  ].filter(Boolean);
  return parts.join(', ');
}

// Check if membership is expired
export function isExpired(dateExpires: string | null): boolean {
  if (!dateExpires) return false;
  try {
    const expires = new Date(dateExpires);
    return expires < new Date();
  } catch {
    return false;
  }
}

// Check if membership expires soon (within 30 days)
export function expiresSoon(dateExpires: string | null): boolean {
  if (!dateExpires) return false;
  try {
    const expires = new Date(dateExpires);
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    return expires <= thirtyDays && expires >= new Date();
  } catch {
    return false;
  }
}

// Get renewal period based on current date
// Period runs from 1st April to 31st March
export function getRenewalPeriod(referenceDate?: Date): { start: string; end: string; year: number } {
  const date = referenceDate || new Date();
  const month = date.getMonth(); // 0-indexed (0=Jan, 3=April)
  const year = date.getFullYear();

  // If we're before April, the renewal period is current year Apr to next year Mar
  // If we're April or after, renewal period is next year Apr to year after Mar
  const startYear = month < 3 ? year : year + 1;
  const endYear = startYear + 1;

  return {
    start: `${startYear}-04-01`,
    end: `${endYear}-03-31`,
    year: startYear
  };
}

// Generate invoice number: YEAR/M{PIN}/SEQUENCE
export function generateInvoiceNumber(year: number, memberPin: string, sequence: number): string {
  const paddedPin = (memberPin || '0000').padStart(4, '0');
  const paddedSeq = String(sequence).padStart(3, '0');
  return `${year}/M${paddedPin}/${paddedSeq}`;
}

// Format invoice period for display
export function formatInvoicePeriod(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} - ${endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

// Get invoice status badge class
export function getInvoiceStatusBadge(status: string): string {
  switch (status) {
    case 'draft': return 'badge-warning';
    case 'sent': return 'badge-info';
    case 'paid': return 'badge-success';
    case 'cancelled': return 'badge-danger';
    default: return 'badge-info';
  }
}

// Northumberland golf clubs (for EGU category calculation)
export const NORTHUMBERLAND_CLUBS = [
  'alnmouth',
  'alnmouth village',
  'alnwick castle',
  'arcot hall',
  'bamburgh',
  'bedlingtonshire',
  'bellingham',
  'berwick',
  'blyth',
  'burgham park',
  'burgham',
  'close house',
  'dunstanburgh castle',
  'dunstanburgh',
  'goswick',
  'hexham',
  'linden hall',
  'longhirst',
  'magdalene fields',
  'matfen hall',
  'matfen',
  'morpeth',
  'newbiggin',
  'newcastle united',
  'northumberland',
  'parklands',
  'percy wood',
  'ponteland',
  'prudhoe',
  'rothbury',
  'seahouses',
  'slaley hall',
  'stocksfield',
  'tynedale',
  'warkworth',
  'westerhope',
  'wooler'
] as const;

// EGU Categories
export const EGU_CATEGORIES = [
  'Male members over 18, home club',
  'Male members over 18, away club outside Northumberland',
  'Male members over 18, away club within Northumberland',
  'Male members under 18, home club',
  'Male members under 18, away club outside Northumberland',
  'Male members under 18, away club within Northumberland',
  'Female members over 18, home club',
  'Female members over 18, away club outside Northumberland',
  'Female members over 18, away club within Northumberland',
  'Female members under 18, home club',
  'Female members under 18, away club outside Northumberland',
  'Female members under 18, away club within Northumberland'
] as const;

/**
 * Calculate age from date of birth
 */
export function calculateAge(dateOfBirth: string | null, referenceDate?: Date): number | null {
  if (!dateOfBirth) return null;

  try {
    const dob = new Date(dateOfBirth);
    const ref = referenceDate || new Date();

    let age = ref.getFullYear() - dob.getFullYear();
    const monthDiff = ref.getMonth() - dob.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < dob.getDate())) {
      age--;
    }

    return age;
  } catch {
    return null;
  }
}

/**
 * Check if a club name is a Northumberland club
 */
export function isNorthumberlandClub(clubName: string | null): boolean {
  if (!clubName) return false;

  const normalizedClub = clubName.toLowerCase().trim();

  return NORTHUMBERLAND_CLUBS.some(nc =>
    normalizedClub.includes(nc) || nc.includes(normalizedClub)
  );
}

/**
 * Calculate EGU category for a member based on sex, age, and home/away status
 */
export function calculateEguCategory(member: Pick<Member, 'gender' | 'date_of_birth' | 'home_away' | 'home_club'>): string | null {
  const age = calculateAge(member.date_of_birth);

  if (age === null || !member.gender) {
    return null;
  }

  const isMale = member.gender === 'M';
  const isOver18 = age >= 18;
  const isHome = member.home_away === 'H';
  const isAway = member.home_away === 'A';

  const genderStr = isMale ? 'Male' : 'Female';
  const ageStr = isOver18 ? 'over 18' : 'under 18';

  if (isHome) {
    return `${genderStr} members ${ageStr}, home club`;
  } else if (isAway) {
    const inNorthumberland = isNorthumberlandClub(member.home_club);
    const locationStr = inNorthumberland ? 'within Northumberland' : 'outside Northumberland';
    return `${genderStr} members ${ageStr}, away club ${locationStr}`;
  }

  return null;
}
