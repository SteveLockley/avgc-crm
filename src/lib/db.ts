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
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  member_id: number;
  amount: number;
  payment_date: string;
  payment_method: string | null;
  payment_type: string | null;
  reference: string | null;
  notes: string | null;
  recorded_by: string | null;
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

// Member categories
export const MEMBER_CATEGORIES = [
  'Full',
  'Senior',
  'Social',
  'Under 30',
  'Junior',
  'Junior Academy',
  'Over 80',
  'Twilight',
  'Out Of County (100 Miles or More)',
  'Out Of County (Less than 100 miles)'
] as const;

// Subscription templates from your data
export const SUBSCRIPTION_TEMPLATES = [
  'A) Full Home',
  'B) Full Away',
  'C) Under 30 Home',
  'D) Under 30 Away',
  'E) Senior Home',
  'F) Senior Away',
  'G) Over 80 Home',
  'M) Junior Home',
  'O) Junior Academy',
  'S) Social Membership',
  'T) Twilight Member',
  'U) Out Of County (Less than 100 miles) Home Member',
  'W) Out Of County (100 miles or more) Away Member',
  '3) 18 Month Full Membership'
] as const;

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
