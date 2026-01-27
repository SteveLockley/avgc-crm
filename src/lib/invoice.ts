// Invoice calculation logic
import type { Member, PaymentItem } from './db';

export interface InvoiceLineItem {
  paymentItemId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface InvoiceCalculation {
  memberId: number;
  periodStart: string;
  periodEnd: string;
  items: InvoiceLineItem[];
  subtotal: number;
  total: number;
}

/**
 * Find the subscription payment item for a member based on their subscription_template
 * The subscription_template field now contains the payment item name directly (e.g., "Full", "Senior Loyalty")
 */
function findSubscriptionForMember(
  member: Member,
  paymentItems: PaymentItem[]
): InvoiceLineItem | null {
  if (!member.subscription_template) {
    return null;
  }

  // Match by name (subscription_template now stores the payment item name)
  const subscriptionItem = paymentItems.find(
    item =>
      item.category === 'Subscription' &&
      item.name.toLowerCase() === member.subscription_template!.toLowerCase() &&
      item.active
  );

  if (!subscriptionItem) {
    return null;
  }

  return {
    paymentItemId: subscriptionItem.id,
    description: subscriptionItem.name,
    quantity: 1,
    unitPrice: subscriptionItem.fee,
    lineTotal: subscriptionItem.fee,
  };
}

/**
 * Find a fee payment item by name
 */
function findFeeItem(
  name: string,
  paymentItems: PaymentItem[]
): PaymentItem | null {
  return paymentItems.find(
    item =>
      item.category === 'Fee' &&
      item.name.toLowerCase() === name.toLowerCase() &&
      item.active
  ) || null;
}

/**
 * Check if member is considered "Out of County"
 * Based on subscription template containing "Out Of County"
 */
function isOutOfCounty(member: Member): boolean {
  const template = member.subscription_template?.toLowerCase() || '';
  return template.includes('out of county') || template.includes('out_of_county');
}

/**
 * Check if member has a CDH (Central Database of Handicaps) number
 * This is the national_id field
 */
function hasCDH(member: Member): boolean {
  return !!member.national_id && member.national_id.trim() !== '';
}

/**
 * Check if member has a handicap index registered (home handicap)
 */
function hasHomeHandicap(member: Member): boolean {
  return member.handicap_index !== null && member.handicap_index !== undefined;
}

/**
 * Check if member is a home member
 */
function isHomeMember(member: Member): boolean {
  return member.home_away === 'H';
}

/**
 * Calculate the invoice for a member
 *
 * Fee rules:
 * - Home members with CDH (not out of county) → England Golf (£12) + Northumberland County (£6.50)
 * - Out of county members with home handicap + CDH → England Golf (£12) only
 * - Members without CDH → No golf fees
 * - Members with locker → Locker fee (£10)
 */
export function calculateInvoiceForMember(
  member: Member,
  paymentItems: PaymentItem[],
  periodStart: string,
  periodEnd: string
): InvoiceCalculation | null {
  const items: InvoiceLineItem[] = [];

  // 1. Add subscription fee (exactly one)
  const subscriptionItem = findSubscriptionForMember(member, paymentItems);
  if (!subscriptionItem) {
    // Cannot create invoice without a subscription
    return null;
  }
  items.push(subscriptionItem);

  // 2. Check fee eligibility based on CDH and membership type
  const memberHasCDH = hasCDH(member);
  const memberIsHome = isHomeMember(member);
  const memberIsOutOfCounty = isOutOfCounty(member);
  const memberHasHomeHandicap = hasHomeHandicap(member);

  if (memberHasCDH) {
    if (memberIsHome && !memberIsOutOfCounty) {
      // Home member with CDH (not out of county) → England Golf + Northumberland
      const englandGolf = findFeeItem('England Golf', paymentItems);
      if (englandGolf) {
        items.push({
          paymentItemId: englandGolf.id,
          description: englandGolf.name,
          quantity: 1,
          unitPrice: englandGolf.fee,
          lineTotal: englandGolf.fee,
        });
      }

      const northumberland = findFeeItem('Northumberland County', paymentItems);
      if (northumberland) {
        items.push({
          paymentItemId: northumberland.id,
          description: northumberland.name,
          quantity: 1,
          unitPrice: northumberland.fee,
          lineTotal: northumberland.fee,
        });
      }
    } else if (memberIsOutOfCounty && memberHasHomeHandicap) {
      // Out of county with home handicap + CDH → England Golf only
      const englandGolf = findFeeItem('England Golf', paymentItems);
      if (englandGolf) {
        items.push({
          paymentItemId: englandGolf.id,
          description: englandGolf.name,
          quantity: 1,
          unitPrice: englandGolf.fee,
          lineTotal: englandGolf.fee,
        });
      }
    }
  }

  // 3. Add locker fee if member has a locker
  if (member.locker_number && member.locker_number.trim() !== '') {
    const lockerFee = findFeeItem('Locker', paymentItems);
    if (lockerFee) {
      items.push({
        paymentItemId: lockerFee.id,
        description: lockerFee.name,
        quantity: 1,
        unitPrice: lockerFee.fee,
        lineTotal: lockerFee.fee,
      });
    }
  }

  // Calculate totals
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);

  return {
    memberId: member.id,
    periodStart,
    periodEnd,
    items,
    subtotal: total,
    total,
  };
}

/**
 * Check if a member is eligible for invoice generation
 * Member must have:
 * - Valid subscription template
 * - Email address (unless send_invoice_by is not 'Email')
 */
export function isMemberEligibleForInvoice(member: Member): {
  eligible: boolean;
  reason?: string;
} {
  if (!member.subscription_template) {
    return { eligible: false, reason: 'No subscription template assigned' };
  }

  // Check if member has email (required for email invoices)
  if (member.send_invoice_by === 'Email' || !member.send_invoice_by) {
    if (!member.email || member.email.trim() === '') {
      return { eligible: false, reason: 'No email address for email invoice' };
    }
  }

  return { eligible: true };
}

/**
 * Get a summary description of what fees will apply to a member
 */
export function getFeeSummary(member: Member): string[] {
  const fees: string[] = [];

  const memberHasCDH = hasCDH(member);
  const memberIsHome = isHomeMember(member);
  const memberIsOutOfCounty = isOutOfCounty(member);
  const memberHasHomeHandicap = hasHomeHandicap(member);

  if (memberHasCDH) {
    if (memberIsHome && !memberIsOutOfCounty) {
      fees.push('England Golf');
      fees.push('Northumberland County');
    } else if (memberIsOutOfCounty && memberHasHomeHandicap) {
      fees.push('England Golf');
    }
  }

  if (member.locker_number) {
    fees.push('Locker');
  }

  return fees;
}
