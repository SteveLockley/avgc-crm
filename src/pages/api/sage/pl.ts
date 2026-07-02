import type { APIRoute } from 'astro';
import { createSageClient } from '@/lib/sage';

const incomeTypes = new Set(['SALES', 'OTHER_INCOME']);
const expenseTypes = new Set(['DIRECT_EXPENSES', 'DIRECT_COSTS', 'OVERHEADS', 'DEPRECIATION']);

export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime?.env;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!from || !to || !env?.DB || !env?.SAGE_CLIENT_ID || !env?.SAGE_CLIENT_SECRET) {
    return json({ error: 'Missing parameters' }, 400);
  }

  try {
    const client = createSageClient(env);

    const [ledgerAccountList, entries] = await Promise.all([
      client.getLedgerAccounts() as Promise<any[]>,
      client.getAllParallel<any>('/ledger_entries', { from_date: from, to_date: to }),
    ]);

    // DEBUG: probe alternative endpoints
    if (url.searchParams.get('debug') === '1') {
      const [tbToOnly, journals, transactions, entryFull, acctFull] = await Promise.all([
        client.get('/trial_balance', { to_date: to }).catch((e: any) => ({ error: e.message })),
        client.get('/journals', { from_date: from, to_date: to, items_per_page: '2' }).catch((e: any) => ({ error: e.message })),
        client.get('/transactions', { from_date: from, to_date: to, items_per_page: '2' }).catch((e: any) => ({ error: e.message })),
        // Fetch full detail for first entry
        entries[0] ? client.get(`/ledger_entries/${entries[0].id}`).catch((e: any) => ({ error: e.message })) : null,
        // Fetch full detail for first ledger account
        ledgerAccountList[0] ? client.get(`/ledger_accounts/${ledgerAccountList[0].id}`).catch((e: any) => ({ error: e.message })) : null,
      ]);
      return json({ debug: true, tbToOnly, journalsSample: journals, transactionsSample: transactions, entryFull, acctFull });
    }

    const typeMap = new Map<string, { type: string; name: string }>(
      ledgerAccountList.map((a: any) => [
        a.id,
        { type: a.ledger_account_type?.id ?? '', name: a.displayed_as ?? '—' },
      ])
    );

    const byAccount = new Map<string, { name: string; type: string; debit: number; credit: number }>();

    for (const entry of entries) {
      if (entry.deleted) continue;
      const accountId = entry.ledger_account?.id;
      if (!accountId) continue;
      const acct = typeMap.get(accountId);
      if (!acct || (!incomeTypes.has(acct.type) && !expenseTypes.has(acct.type))) continue;

      const d = parseFloat(entry.debit) || 0;
      const c = parseFloat(entry.credit) || 0;

      if (!byAccount.has(accountId)) {
        byAccount.set(accountId, { name: acct.name, type: acct.type, debit: 0, credit: 0 });
      }
      const row = byAccount.get(accountId)!;
      row.debit += d;
      row.credit += c;
    }

    const income: any[] = [];
    const expenses: any[] = [];

    for (const [, row] of byAccount) {
      if (incomeTypes.has(row.type)) {
        const value = row.credit - row.debit;
        if (value !== 0) income.push({ name: row.name, value });
      } else {
        const value = row.debit - row.credit;
        if (value !== 0) expenses.push({ name: row.name, value });
      }
    }

    income.sort((a, b) => b.value - a.value);
    expenses.sort((a, b) => b.value - a.value);

    const totalIncome = income.reduce((s, i) => s + i.value, 0);
    const totalExpenses = expenses.reduce((s, i) => s + i.value, 0);

    return json({ income, expenses, totalIncome, totalExpenses, surplus: totalIncome - totalExpenses });

  } catch (e: any) {
    const msg = e.message?.includes('NO_SAGE_CONNECTION') ? 'Not connected to Sage.' : e.message;
    return json({ error: msg }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
