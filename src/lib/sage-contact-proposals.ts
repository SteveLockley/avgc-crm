// Generators that propose contact changes. They only build payloads — nothing
// here talks to Sage. The change-set engine reviews and applies them.

import type { ProposedChange } from './sage-changes';

/** Sage ledger account for electricity, used as the default purchase account. */
export const LEDGER_ELECTRICITY_CODE = '7200';

export interface ContactPayload {
  name: string;
  contact_type_ids: string[];       // 'CUSTOMER' | 'VENDOR'
  reference?: string;
  email?: string;
  telephone?: string;
  notes?: string;
  tax_number?: string;
  credit_days?: number;
  main_address?: {
    address_type_id: string;        // 'ACCOUNTS' | 'DELIVERY' | 'SALES' | 'PURCHASING'
    address_line_1?: string;
    address_line_2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country_id?: string;
  };
  default_purchase_ledger_account_id?: string;
}

/**
 * Phase 1 — TotalEnergies Gas & Power Limited.
 *
 * Taken from the supplier's letter of August 2026 notifying a new account
 * number for the Tractor Shed supply (MPAN 1591023060154).
 *
 * Deliberately omitted:
 *   - Bank details. The letter changes them, which is the standard shape of a
 *     mandate-fraud attempt. They go in only after someone has confirmed the
 *     sort code and account number by phoning a number the club already holds.
 *   - Registered office street and postcode: cut off in the scan.
 *   - tax_number: the letter shows 689638949 as "registration No." — needs
 *     confirming as the VAT number before it goes on the record.
 */
export function proposeTotalEnergies(opts: {
  ledgerAccountId?: string;         // Sage id of Electricity (7200), if known
  taxNumber?: string;               // pass once confirmed
  postcode?: string;                // pass once legible
  addressLine1?: string;
}): ProposedChange[] {
  const payload: ContactPayload = {
    name: 'TotalEnergies Gas & Power Limited',
    contact_type_ids: ['VENDOR'],
    reference: 'A-1C748198',
    email: 'contactus@business.totalenergies.uk',
    telephone: '0333 051 0333',
    notes: [
      'Electricity supplier from July 2026.',
      'Site: Tractor Shed, Marine Road, Alnmouth NE66 2RZ (MPAN 1591023060154).',
      'Account A-1C748198 (previous account 3009945257).',
      'Bank details supplied by letter Aug 2026 — NOT entered here until verified by',
      'phone on a number held independently of that letter.',
      'Registered in England no. 2172239.',
    ].join('\n'),
  };

  if (opts.taxNumber) payload.tax_number = opts.taxNumber;
  if (opts.ledgerAccountId) payload.default_purchase_ledger_account_id = opts.ledgerAccountId;

  if (opts.addressLine1 || opts.postcode) {
    payload.main_address = {
      address_type_id: 'ACCOUNTS',
      address_line_1: opts.addressLine1 || 'Kingswood Fields, Millfield Lane',
      address_line_2: 'Lower Kingswood',
      city: 'Tadworth',
      region: 'Surrey',
      ...(opts.postcode ? { postal_code: opts.postcode } : {}),
      country_id: 'GB',
    };
  }

  return [{
    entity: 'contact',
    action: 'create',
    sageId: null,
    label: 'TotalEnergies Gas & Power Limited',
    payload: payload as unknown as Record<string, any>,
  }];
}

/** Look up the Sage ledger account id for a nominal code, e.g. '7200'. */
export async function findLedgerAccountId(client: any, nominalCode: string): Promise<string | null> {
  const accounts = await client.getAll('/ledger_accounts');
  const hit = accounts.find((a: any) =>
    a.nominal_code === nominalCode || (a.displayed_as || '').includes(`(${nominalCode})`)
  );
  return hit?.id ?? null;
}
