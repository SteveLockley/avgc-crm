/**
 * Generate a single DD renewal email for a specific member
 * Run with: npx tsx samples/generate-single-renewal.ts
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { calculateDDSchedule, generateDDRenewalEmail } from '../src/lib/dd-renewal-email';

const __dirname = dirname(fileURLToPath(import.meta.url));

const YEAR = 2026;

// Stephen Lockley - Full Home, CDH registered, no locker
const member = {
  title: 'Mr',
  first_name: 'Stephen',
  surname: 'Lockley',
  club_number: '295',
  category: 'Full Home',
  email: 'srlockley@gmail.com',
  direct_debit_member_id: '',
  locker_number: '',
  national_id: '1011792638',
  home_away: 'H',
  handicap_index: 23.8,
};

const schedule = calculateDDSchedule(member, 432, YEAR);
const html = generateDDRenewalEmail(member, schedule);

const filepath = join(__dirname, 'dd-renewal-emails', 'stephen-lockley-renewal.html');
writeFileSync(filepath, html, 'utf-8');

const annualTotal = schedule.initialCollectionTotal + 11 * schedule.monthlyPayment;

console.log('Stephen Lockley - DD Renewal 2026/2027');
console.log('='.repeat(50));
console.log(`Category: ${member.category}`);
console.log(`Subscription: £${schedule.annualSubscription.toFixed(2)}`);
console.log(`England Golf: £${schedule.englandGolfFee.toFixed(2)}`);
console.log(`County: £${schedule.countyFee.toFixed(2)}`);
console.log(`Annual total: £${annualTotal.toFixed(2)}`);
console.log(`Initial payment (1st Apr): £${schedule.initialCollectionTotal.toFixed(2)}`);
console.log(`  - EGU: £${schedule.englandGolfFee.toFixed(2)}`);
console.log(`  - County: £${schedule.countyFee.toFixed(2)}`);
console.log(`  - First month: £${schedule.firstMonthPayment.toFixed(2)}`);
console.log(`Monthly (May-Mar): £${schedule.monthlyPayment.toFixed(2)} x 11`);
console.log(`\nFile: ${filepath}`);
