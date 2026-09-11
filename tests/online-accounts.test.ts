import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/lib/vault';
import {
  mirrorFromSageContact, buildPushPayload, aggregateSupplierTotals, changedSince, mirrorFromRow,
} from '../src/lib/online-accounts';
import { diffFields } from '../src/lib/sage-changes';

const KEY = Buffer.alloc(32, 7).toString('base64');
const env = { ACCOUNTS_VAULT_KEY: KEY };

describe('vault', () => {
  it('round-trips a secret', async () => {
    const stored = await encryptSecret(env, 'S3cret-p@ss');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('S3cret');
    expect(await decryptSecret(env, stored)).toBe('S3cret-p@ss');
  });

  it('uses a fresh IV each time', async () => {
    const a = await encryptSecret(env, 'same');
    const b = await encryptSecret(env, 'same');
    expect(a).not.toBe(b);
  });

  it('refuses the wrong key', async () => {
    const stored = await encryptSecret(env, 'x');
    const other = { ACCOUNTS_VAULT_KEY: Buffer.alloc(32, 9).toString('base64') };
    await expect(decryptSecret(other, stored)).rejects.toThrow(/vault key has changed/);
  });

  it('fails clearly when unconfigured', async () => {
    await expect(encryptSecret({}, 'x')).rejects.toThrow('VAULT_NOT_CONFIGURED');
  });
});

describe('mirrorFromSageContact', () => {
  const contact = {
    id: 'abc',
    displayed_as: 'Corona Energy',
    name: 'Corona Energy',
    reference: 'CE-123',
    email: 'billing@coronaenergy.co.uk',
    telephone: '0800 1',
    main_contact_person: { mobile: '07700' },
    main_address: { address_line_1: '1 High St', city: 'Watford', postal_code: 'WD1' },
    notes: 'Half-hourly meter',
    default_purchase_ledger_account: { id: 'led-7200', displayed_as: 'Electricity (7200)' },
    updated_at: '2026-09-01T10:00:00Z',
    is_active: true,
    contact_types: [{ id: 'VENDOR' }],
    links: [{ href: 'https://accounts-extra.sageone.com/contacts/suppliers/99', rel: 'alternate', type: 'text/html' }],
  };

  it('maps the mirrored fields and the web link', () => {
    const m = mirrorFromSageContact(contact);
    expect(m.mirror.name).toBe('Corona Energy');
    expect(m.mirror.reference).toBe('CE-123');
    expect(m.mirror.mobile).toBe('07700');            // falls back to main_contact_person
    expect(m.mirror.city).toBe('Watford');
    expect(m.mirror.sage_ledger_account_id).toBe('led-7200');
    expect(m.ledgerAccountName).toBe('Electricity (7200)');
    expect(m.webUrl).toBe('https://accounts-extra.sageone.com/contacts/suppliers/99');
    expect(m.contactTypes).toEqual(['VENDOR']);
  });

  it('copes with a bare record', () => {
    const m = mirrorFromSageContact({ displayed_as: 'X' });
    expect(m.mirror.name).toBe('X');
    expect(m.mirror.email).toBeNull();
    expect(m.webUrl).toBeNull();
  });
});

describe('buildPushPayload', () => {
  const pulled = mirrorFromSageContact({
    name: 'Crown Gas & Power', reference: 'CGP1', email: 'a@b.c', telephone: '1',
    main_address: { address_line_1: 'Old', city: 'Bury' },
    default_purchase_ledger_account: { id: 'led-7210' },
  }).mirror;

  it('sends only the fields changed since the last pull', () => {
    const row = { ...pulled, sage_contact_id: 'sid', pulled_json: JSON.stringify(pulled), email: 'new@b.c', city: 'Bury', address_line_1: 'New' };
    const { action, payload, fields } = buildPushPayload(row);
    expect(action).toBe('update');
    expect(fields).toEqual(['email', 'address_line_1']);
    expect(payload.email).toBe('new@b.c');
    expect(payload.name).toBeUndefined();
    expect(payload.main_address.address_line_1).toBe('New');
    expect(payload.main_address.city).toBe('Bury');
  });

  it('builds a full VENDOR create for an unlinked row', () => {
    const row = { ...pulled, sage_contact_id: null, pulled_json: null };
    const { action, payload } = buildPushPayload(row);
    expect(action).toBe('create');
    expect(payload.contact_type_ids).toEqual(['VENDOR']);
    expect(payload.name).toBe('Crown Gas & Power');
    expect(payload.default_purchase_ledger_account_id).toBe('led-7210');
  });

  it('reports nothing changed when the mirror matches', () => {
    expect(changedSince(pulled, mirrorFromRow(pulled))).toEqual([]);
  });
});

describe('diffFields', () => {
  it('compares *_id payload fields against the nested object on the record', () => {
    const before = { default_purchase_ledger_account: { id: 'led-7200', displayed_as: 'Electricity (7200)' }, main_address: { address_line_1: 'Old', city: 'Bury' } };
    expect(diffFields(before, { default_purchase_ledger_account_id: 'led-7200' })).toEqual([]);
    expect(diffFields(before, { default_purchase_ledger_account_id: 'led-7210' })).toHaveLength(1);
    expect(diffFields(before, { main_address: { address_line_1: 'Old', city: 'Bury' } })).toEqual([]);
    expect(diffFields(before, { main_address: { address_line_1: 'New', city: 'Bury' } })).toHaveLength(1);
  });
});

describe('aggregateSupplierTotals', () => {
  it('sums bills less credit notes and payments less refunds, split by year', () => {
    const t = aggregateSupplierTotals('2026-01-01', {
      invoices: [
        { date: '2025-11-01', total_amount: '100.00' },
        { date: '2026-02-01', total_amount: '250.50' },
        { date: '2026-03-01', total_amount: '999', status: { id: 'VOID' } },
      ],
      creditNotes: [{ date: '2026-02-15', total_amount: '50.50' }],
      contactPayments: [
        { date: '2025-12-01', total_amount: '100', transaction_type: { id: 'VENDOR_PAYMENT' } },
        { date: '2026-02-20', total_amount: '200', transaction_type: { id: 'VENDOR_PAYMENT' } },
        { date: '2026-02-21', total_amount: '20', transaction_type: { id: 'VENDOR_REFUND' } },
        { date: '2026-02-22', total_amount: '5000', transaction_type: { id: 'CUSTOMER_RECEIPT' } },
      ],
      otherPayments: [
        { date: '2026-04-01', total_amount: '75', transaction_type: { id: 'OTHER_PAYMENT' } },
        { date: '2026-04-02', total_amount: '25', transaction_type: { id: 'OTHER_RECEIPT' } },
      ],
    });
    expect(t.billsTotal).toBe(300);       // 100 + 250.5 - 50.5
    expect(t.billsYtd).toBe(200);         // 250.5 - 50.5
    expect(t.paymentsTotal).toBe(330);    // 100 + 200 - 20 + 75 - 25
    expect(t.paymentsYtd).toBe(230);      // 200 - 20 + 75 - 25
    expect(t.counts.invoices).toBe(3);
  });
});
