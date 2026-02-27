// Subscription type calculation rules
// Rules are evaluated based on age on 1st April and years of membership

export interface MemberForSubscription {
  id: number;
  first_name: string;
  surname: string;
  date_of_birth: string | null;
  date_joined: string | null;
  home_away: 'H' | 'A' | 'V' | null;
  category: string | null; // Subscription type is stored in category field
}

export interface SubscriptionChange {
  memberId: number;
  memberName: string;
  currentSubscription: string | null;
  newSubscription: string;
  reason: string;
  ageOnApril1: number | null;
  yearsOfMembership: number | null;
}

// Subscription type base names (without Home/Away suffix)
export const SUBSCRIPTION_BASE_TYPES = {
  JUNIOR: 'Junior',
  INTERMEDIATE: 'Intermediate',
  UNDER_30: 'Under 30',
  FULL: 'Full',
  SENIOR_LOYALTY: 'Senior Loyalty',
  OVER_80: 'Over 80',
  LIFE: 'Life'
} as const;

/**
 * Get the 1st April of the current membership year
 * If we're before April, use 1st April of current year
 * If we're April or after, use 1st April of current year
 */
export function getApril1stOfCurrentYear(referenceDate?: Date): Date {
  const date = referenceDate || new Date();
  return new Date(date.getFullYear(), 3, 1); // Month is 0-indexed, so 3 = April
}

/**
 * Calculate age as of a specific date
 */
export function calculateAgeOnDate(dateOfBirth: string | null, asOfDate: Date): number | null {
  if (!dateOfBirth) return null;

  try {
    const dob = new Date(dateOfBirth);
    let age = asOfDate.getFullYear() - dob.getFullYear();
    const monthDiff = asOfDate.getMonth() - dob.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && asOfDate.getDate() < dob.getDate())) {
      age--;
    }

    return age;
  } catch {
    return null;
  }
}

/**
 * Calculate years of membership as of a specific date
 */
export function calculateYearsOfMembership(dateJoined: string | null, asOfDate: Date): number | null {
  if (!dateJoined) return null;

  try {
    const joined = new Date(dateJoined);
    let years = asOfDate.getFullYear() - joined.getFullYear();
    const monthDiff = asOfDate.getMonth() - joined.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && asOfDate.getDate() < joined.getDate())) {
      years--;
    }

    return Math.max(0, years);
  } catch {
    return null;
  }
}

/**
 * Calculate years of membership at any point in the current year (use end of year)
 */
export function calculateYearsOfMembershipInYear(dateJoined: string | null, year: number): number | null {
  if (!dateJoined) return null;

  try {
    const joined = new Date(dateJoined);
    const endOfYear = new Date(year, 11, 31); // December 31st

    let years = endOfYear.getFullYear() - joined.getFullYear();
    const monthDiff = endOfYear.getMonth() - joined.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && endOfYear.getDate() < joined.getDate())) {
      years--;
    }

    return Math.max(0, years);
  } catch {
    return null;
  }
}

/**
 * Get the subscription type name (base type only, Home/Away is tracked separately)
 */
export function getFullSubscriptionName(baseType: string, homeAway: 'H' | 'A' | 'V' | null): string {
  // Just return the base type - Home/Away is tracked in the home_away field
  return baseType;
}

/**
 * Extract the base subscription type from a category value
 */
export function getBaseSubscriptionType(category: string | null): string | null {
  if (!category) return null;

  // Remove common prefixes like "A) ", "B) ", etc. (legacy data)
  let base = category.replace(/^[A-Z0-9]\)\s*/i, '');

  // Remove Home/Away suffix
  base = base.replace(/\s+(Home|Away)$/i, '');

  // Normalize variants to standard base types
  if (base === 'Junior Academy') base = 'Junior';

  return base;
}

/**
 * Check if a subscription type is one that should be auto-managed
 * (excludes Social, Twilight, Out of County, Honorary, Gratis, etc.)
 */
export function isAutoManagedSubscription(category: string | null): boolean {
  if (!category) return true; // New members without subscription

  const lower = category.toLowerCase();

  // Exclude these from auto-management - these categories never change
  const excludedTypes = [
    'social',
    'twilight',
    'out of county',
    'honorary',
    'gratis',
    'retention',
    'resigned',
    'winter',
    'pga professional',
    'international',
    'life',
  ];

  return !excludedTypes.some(excluded => lower.includes(excluded));
}

/**
 * Determine the appropriate subscription type based on age and membership rules
 *
 * Rules (in priority order):
 * 1. Life Member: 50+ years of membership at any time in current year
 * 2. Over 80: Age 80+ on 1st April
 * 3. Seniors Loyalty: Age 65+ AND 25+ years of membership
 * 4. Under 30 → Full: Age 30+ on 1st April (only if currently Under 30)
 * 5. Intermediate → Under 30: Age 21+ on 1st April (only if currently Intermediate)
 * 6. Junior → Intermediate: Age 18+ on 1st April (only if currently Junior)
 * 7. New member default: Based on age
 */
export function calculateSubscriptionType(
  member: MemberForSubscription,
  referenceDate?: Date
): { newType: string | null; reason: string } {
  const now = referenceDate || new Date();
  const april1st = getApril1stOfCurrentYear(now);
  const currentYear = now.getFullYear();

  const ageOnApril1 = calculateAgeOnDate(member.date_of_birth, april1st);
  const yearsOfMembershipOnApril1 = calculateYearsOfMembership(member.date_joined, april1st);
  const yearsOfMembershipInYear = calculateYearsOfMembershipInYear(member.date_joined, currentYear);

  const currentBase = getBaseSubscriptionType(member.category);
  const homeAway = member.home_away;

  // Can't calculate without date of birth
  if (ageOnApril1 === null) {
    return { newType: null, reason: 'No date of birth' };
  }

  // Rule 1: Life - 50+ years of membership at any time in current year
  if (yearsOfMembershipInYear !== null && yearsOfMembershipInYear >= 50) {
    if (currentBase === 'Life') {
      return { newType: null, reason: 'Already Life member' };
    }
    return { newType: SUBSCRIPTION_BASE_TYPES.LIFE, reason: `50+ years of membership (${yearsOfMembershipInYear} years)` };
  }

  // Rule 2: Over 80 - Age 80+ on 1st April
  if (ageOnApril1 >= 80) {
    if (currentBase === 'Over 80') {
      return { newType: null, reason: 'Already Over 80' };
    }
    const newType = getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.OVER_80, homeAway);
    return { newType, reason: `Age 80+ on 1st April (age ${ageOnApril1})` };
  }

  // Rule 3: Senior Loyalty - Age 65+ AND 25+ years of membership on 1st April
  // Skip if already Life, Over 80, or Senior Loyalty
  if (ageOnApril1 >= 65 && yearsOfMembershipOnApril1 !== null && yearsOfMembershipOnApril1 >= 25) {
    if (currentBase === 'Life' || currentBase === 'Over 80' || currentBase === 'Senior Loyalty') {
      return { newType: null, reason: 'Already Senior Loyalty or higher' };
    }
    const newType = getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.SENIOR_LOYALTY, homeAway);
    return { newType, reason: `Age 65+ (${ageOnApril1}) with 25+ years membership (${yearsOfMembershipOnApril1} years) on 1st April` };
  }

  // Determine the correct age-based category and compare with current
  // This catches both upgrades AND corrections (e.g. Full member who should be Under 30)
  let correctBase: string;
  let ageReason: string;

  if (ageOnApril1 >= 30) {
    correctBase = SUBSCRIPTION_BASE_TYPES.FULL;
    ageReason = `Age 30+ on 1st April (age ${ageOnApril1})`;
  } else if (ageOnApril1 >= 21) {
    correctBase = SUBSCRIPTION_BASE_TYPES.UNDER_30;
    ageReason = `Age 21-29 on 1st April (age ${ageOnApril1})`;
  } else if (ageOnApril1 >= 18) {
    correctBase = SUBSCRIPTION_BASE_TYPES.INTERMEDIATE;
    ageReason = `Age 18-20 on 1st April (age ${ageOnApril1})`;
  } else {
    correctBase = SUBSCRIPTION_BASE_TYPES.JUNIOR;
    ageReason = `Under 18 on 1st April (age ${ageOnApril1})`;
  }

  if (currentBase !== correctBase) {
    const newType = getFullSubscriptionName(correctBase, homeAway);
    return { newType, reason: `${currentBase || 'None'} → ${correctBase}: ${ageReason}` };
  }

  // No change needed
  return { newType: null, reason: 'No change required' };
}

/**
 * Calculate default subscription type for a new member
 */
export function calculateDefaultSubscriptionType(
  dateOfBirth: string | null,
  dateJoined: string | null,
  homeAway: 'H' | 'A' | 'V' | null,
  referenceDate?: Date
): { subscriptionType: string; reason: string } {
  const now = referenceDate || new Date();
  const april1st = getApril1stOfCurrentYear(now);
  const currentYear = now.getFullYear();

  const ageOnApril1 = calculateAgeOnDate(dateOfBirth, april1st);
  const ageNow = calculateAgeOnDate(dateOfBirth, now);
  const yearsOfMembershipInYear = calculateYearsOfMembershipInYear(dateJoined, currentYear);
  const yearsOfMembership = calculateYearsOfMembership(dateJoined, now);

  // Can't calculate without date of birth - default to Full
  if (ageOnApril1 === null || ageNow === null) {
    return {
      subscriptionType: getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.FULL, homeAway),
      reason: 'No date of birth - defaulting to Full'
    };
  }

  // Check for Life Member first (unlikely for new members but possible for re-joining)
  if (yearsOfMembershipInYear !== null && yearsOfMembershipInYear >= 50) {
    return {
      subscriptionType: SUBSCRIPTION_BASE_TYPES.LIFE,
      reason: `50+ years of membership (${yearsOfMembershipInYear} years)`
    };
  }

  // Over 80
  if (ageOnApril1 >= 80) {
    return {
      subscriptionType: getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.OVER_80, homeAway),
      reason: `Age 80+ on 1st April (age ${ageOnApril1})`
    };
  }

  // Seniors Loyalty
  if (ageOnApril1 >= 65 && yearsOfMembership !== null && yearsOfMembership >= 25) {
    return {
      subscriptionType: getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.SENIOR_LOYALTY, homeAway),
      reason: `Age 65+ (${ageOnApril1}) with 25+ years membership (${yearsOfMembership} years)`
    };
  }

  // Full (30+)
  if (ageOnApril1 >= 30) {
    return {
      subscriptionType: getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.FULL, homeAway),
      reason: `Age 30+ on 1st April (age ${ageOnApril1})`
    };
  }

  // Under 30 (21-29)
  if (ageOnApril1 >= 21) {
    return {
      subscriptionType: getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.UNDER_30, homeAway),
      reason: `Age 21-29 on 1st April (age ${ageOnApril1})`
    };
  }

  // Intermediate (18-20)
  if (ageOnApril1 >= 18) {
    return {
      subscriptionType: getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.INTERMEDIATE, homeAway),
      reason: `Age 18-20 on 1st April (age ${ageOnApril1})`
    };
  }

  // Junior (under 18)
  return {
    subscriptionType: getFullSubscriptionName(SUBSCRIPTION_BASE_TYPES.JUNIOR, homeAway),
    reason: `Under 18 on 1st April (age ${ageOnApril1})`
  };
}

/**
 * Process all members and return list of subscription changes needed
 */
export function reviewSubscriptionChanges(
  members: MemberForSubscription[],
  referenceDate?: Date
): SubscriptionChange[] {
  const changes: SubscriptionChange[] = [];
  const now = referenceDate || new Date();
  const april1st = getApril1stOfCurrentYear(now);
  const currentYear = now.getFullYear();

  for (const member of members) {
    // Skip members with non-auto-managed subscriptions
    if (!isAutoManagedSubscription(member.category)) {
      continue;
    }

    const result = calculateSubscriptionType(member, now);

    if (result.newType !== null) {
      const ageOnApril1 = calculateAgeOnDate(member.date_of_birth, april1st);
      const yearsOfMembership = calculateYearsOfMembershipInYear(member.date_joined, currentYear);

      changes.push({
        memberId: member.id,
        memberName: `${member.first_name} ${member.surname}`,
        currentSubscription: member.category,
        newSubscription: result.newType,
        reason: result.reason,
        ageOnApril1,
        yearsOfMembership
      });
    }
  }

  return changes;
}
