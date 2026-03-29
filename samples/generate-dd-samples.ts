/**
 * Generate sample DD renewal emails for each subscription level
 * Run with: npx tsx samples/generate-dd-samples.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { calculateDDSchedule, generateDDRenewalEmail } from '../src/lib/dd-renewal-email';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDir = join(__dirname, 'dd-renewal-emails');
mkdirSync(outputDir, { recursive: true });

const YEAR = 2026;

// Subscription categories with their annual fees (from migration 012)
const categories = [
  {
    filename: '01-full-home',
    member: {
      title: 'Mr',
      first_name: 'John',
      surname: 'Smith',
      club_number: '1001',
      category: 'Full Home',
      email: 'john.smith@example.com',
      direct_debit_member_id: 'EAV10001',
      locker_number: '',
      national_id: 'CDH123456',
      home_away: 'H',
      handicap_index: 14.2,
    },
    fee: 432,
    description: 'Full Home member with EGU + County fees, no locker',
  },
  {
    filename: '02-full-home-with-locker',
    member: {
      title: 'Mrs',
      first_name: 'Jane',
      surname: 'Wilson',
      club_number: '1002',
      category: 'Full Home',
      email: 'jane.wilson@example.com',
      direct_debit_member_id: 'EAV10002',
      locker_number: '42',
      national_id: 'CDH234567',
      home_away: 'H',
      handicap_index: 22.5,
    },
    fee: 432,
    description: 'Full Home member with EGU + County fees + locker',
  },
  {
    filename: '03-under-30-home',
    member: {
      title: 'Mr',
      first_name: 'James',
      surname: 'Taylor',
      club_number: '1003',
      category: 'Under 30 Home',
      email: 'james.taylor@example.com',
      direct_debit_member_id: 'EAV10003',
      locker_number: '',
      national_id: 'CDH345678',
      home_away: 'H',
      handicap_index: 8.1,
    },
    fee: 327.5,
    description: 'Under 30 Home member with EGU + County fees',
  },
  {
    filename: '04-senior-loyalty-home',
    member: {
      title: 'Mr',
      first_name: 'Robert',
      surname: 'Brown',
      club_number: '1004',
      category: 'Senior Loyalty Home',
      email: 'robert.brown@example.com',
      direct_debit_member_id: 'EAV10004',
      locker_number: '',
      national_id: 'CDH456789',
      home_away: 'H',
      handicap_index: 18.3,
    },
    fee: 321,
    description: 'Senior Loyalty Home member with EGU + County fees',
  },
  {
    filename: '05-over-80-home',
    member: {
      title: 'Mr',
      first_name: 'Edward',
      surname: 'Thompson',
      club_number: '1005',
      category: 'Over 80 Home',
      email: 'edward.thompson@example.com',
      direct_debit_member_id: 'EAV10005',
      locker_number: '',
      national_id: 'CDH567890',
      home_away: 'H',
      handicap_index: 24.1,
    },
    fee: 186,
    description: 'Over 80 Home member with EGU + County fees',
  },
  {
    filename: '06-intermediate-home',
    member: {
      title: 'Mr',
      first_name: 'Oliver',
      surname: 'Davis',
      club_number: '1006',
      category: 'Intermediate Home',
      email: 'oliver.davis@example.com',
      direct_debit_member_id: 'EAV10006',
      locker_number: '',
      national_id: 'CDH678901',
      home_away: 'H',
      handicap_index: 12.0,
    },
    fee: 139,
    description: 'Intermediate (18-20) Home member with EGU + County fees',
  },
  {
    filename: '08-out-of-county-under-100',
    member: {
      title: 'Dr',
      first_name: 'Sarah',
      surname: 'Mitchell',
      club_number: '1008',
      category: 'Out Of County (<100 miles)',
      email: 'sarah.mitchell@example.com',
      direct_debit_member_id: 'EAV10008',
      locker_number: '',
      national_id: 'CDH890123',
      home_away: 'H',
      handicap_index: 16.7,
    },
    fee: 301.5,
    description: 'Out Of County (<100 miles) with EGU fee only (no county)',
  },
  {
    filename: '09-out-of-county-100-plus',
    member: {
      title: 'Mr',
      first_name: 'David',
      surname: 'Clark',
      club_number: '1009',
      category: 'Out Of County (100+ miles)',
      email: 'david.clark@example.com',
      direct_debit_member_id: 'EAV10009',
      locker_number: '',
      national_id: 'CDH901234',
      home_away: 'H',
      handicap_index: 11.4,
    },
    fee: 224.5,
    description: 'Out Of County (100+ miles) with EGU fee only (no county)',
  },
  {
    filename: '10-twilight-home',
    member: {
      title: 'Ms',
      first_name: 'Helen',
      surname: 'Walker',
      club_number: '1010',
      category: 'Twilight',
      email: 'helen.walker@example.com',
      direct_debit_member_id: 'EAV10010',
      locker_number: '',
      national_id: 'CDH012345',
      home_away: 'H',
      handicap_index: 20.3,
    },
    fee: 207,
    description: 'Twilight Home member with EGU + County fees',
  },
  // Away members - no county fees, no EGU fees (not home club)
  {
    filename: '13-full-away',
    member: {
      title: 'Mr',
      first_name: 'Andrew',
      surname: 'Robertson',
      club_number: '2001',
      category: 'Full Away',
      email: 'andrew.robertson@example.com',
      direct_debit_member_id: 'EAV20001',
      locker_number: '',
      national_id: 'CDH200001',
      home_away: 'A',
      handicap_index: 10.5,
    },
    fee: 432,
    description: 'Full Away member, no EGU/county fees (away club)',
  },
  {
    filename: '14-under-30-away',
    member: {
      title: 'Miss',
      first_name: 'Emma',
      surname: 'Patterson',
      club_number: '2002',
      category: 'Under 30 Away',
      email: 'emma.patterson@example.com',
      direct_debit_member_id: 'EAV20002',
      locker_number: '',
      national_id: 'CDH200002',
      home_away: 'A',
      handicap_index: 15.3,
    },
    fee: 327.5,
    description: 'Under 30 Away member, no EGU/county fees (away club)',
  },
  {
    filename: '15-senior-loyalty-away',
    member: {
      title: 'Mr',
      first_name: 'George',
      surname: 'Armstrong',
      club_number: '2003',
      category: 'Senior Loyalty Away',
      email: 'george.armstrong@example.com',
      direct_debit_member_id: 'EAV20003',
      locker_number: '',
      national_id: 'CDH200003',
      home_away: 'A',
      handicap_index: 21.0,
    },
    fee: 321,
    description: 'Senior Loyalty Away member, no EGU/county fees (away club)',
  },
  {
    filename: '16-over-80-away',
    member: {
      title: 'Mr',
      first_name: 'Arthur',
      surname: 'Henderson',
      club_number: '2004',
      category: 'Over 80 Away',
      email: 'arthur.henderson@example.com',
      direct_debit_member_id: 'EAV20004',
      locker_number: '',
      national_id: 'CDH200004',
      home_away: 'A',
      handicap_index: 26.2,
    },
    fee: 186,
    description: 'Over 80 Away member, no EGU/county fees (away club)',
  },
  {
    filename: '17-intermediate-away',
    member: {
      title: 'Mr',
      first_name: 'Charlie',
      surname: 'Robson',
      club_number: '2005',
      category: 'Intermediate Away',
      email: 'charlie.robson@example.com',
      direct_debit_member_id: 'EAV20005',
      locker_number: '',
      national_id: 'CDH200005',
      home_away: 'A',
      handicap_index: 18.0,
    },
    fee: 139,
    description: 'Intermediate Away member, no EGU/county fees (away club)',
  },
];

console.log('Generating DD renewal sample emails...\n');
console.log('='.repeat(80));

for (const cat of categories) {
  const schedule = calculateDDSchedule(cat.member, cat.fee, YEAR);
  const html = generateDDRenewalEmail(cat.member, schedule);

  const filepath = join(outputDir, `${cat.filename}.html`);
  writeFileSync(filepath, html, 'utf-8');

  const annualTotal = schedule.initialCollectionTotal + 11 * schedule.monthlyPayment;

  console.log(`\n${cat.description}`);
  console.log(`  Category: ${cat.member.category}`);
  console.log(`  Subscription: £${cat.fee.toFixed(2)}`);
  if (schedule.lockerFee > 0) console.log(`  Locker: £${schedule.lockerFee.toFixed(2)}`);
  if (schedule.englandGolfFee > 0) console.log(`  England Golf: £${schedule.englandGolfFee.toFixed(2)}`);
  if (schedule.countyFee > 0) console.log(`  County: £${schedule.countyFee.toFixed(2)}`);
  console.log(`  Annual total: £${annualTotal.toFixed(2)}`);
  console.log(`  Initial payment (Apr): £${schedule.initialCollectionTotal.toFixed(2)}`);
  console.log(`    - First month membership: £${schedule.firstMonthPayment.toFixed(2)}`);
  console.log(`  Monthly payments (May-Mar): £${schedule.monthlyPayment.toFixed(2)} x 11`);
  console.log(`  File: ${filepath}`);
}

console.log('\n' + '='.repeat(80));
console.log(`\nGenerated ${categories.length} sample emails in ${outputDir}`);
