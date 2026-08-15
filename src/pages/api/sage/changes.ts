import type { APIRoute } from 'astro';
import { createSageClient } from '@/lib/sage';
import {
  createChangeSet, dryRunChangeSet, applyChangeSet, rollbackChangeSet, getChangeSet,
} from '@/lib/sage-changes';
import { proposeTotalEnergies, findLedgerAccountId } from '@/lib/sage-contact-proposals';

/**
 * Staged Sage writes.
 * POST /api/sage/changes
 *   { action: 'propose-totalenergies', taxNumber?, postcode?, addressLine1? }
 *   { action: 'approve', setId, changeIds?: number[] }   — omit changeIds to approve all
 *   { action: 'reject',  setId, changeIds: number[] }
 *   { action: 'dry-run', setId, role }
 *   { action: 'apply',   setId, role, confirm: 'APPLY TO LIVE' when role is live }
 *   { action: 'rollback', setId }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Not configured' }, 500);

  const user = locals.user;
  if (!user && !import.meta.env.DEV) return json({ error: 'Not authorised' }, 403);
  const actor = user?.email || 'system';

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = body?.action;
  const setId = Number(body?.setId);
  const role = body?.role === 'live' ? 'live' : 'test';

  try {
    if (action === 'propose-totalenergies') {
      // Resolve the Electricity ledger account from the live business so the
      // reference data matches production even when applying to test.
      let ledgerAccountId: string | undefined;
      try {
        const client = createSageClient(env, { role: 'live' });
        ledgerAccountId = (await findLedgerAccountId(client, '7200')) || undefined;
      } catch { /* proceed without it; it can be set in Sage afterwards */ }

      const changes = proposeTotalEnergies({
        ledgerAccountId,
        taxNumber: body.taxNumber || undefined,
        postcode: body.postcode || undefined,
        addressLine1: body.addressLine1 || undefined,
      });

      const id = await createChangeSet(db, {
        name: 'Phase 1 — create TotalEnergies Gas & Power Limited',
        description: 'New electricity supplier for the Tractor Shed supply, from the August 2026 letter.',
        phase: '1-create-totalenergies',
        createdBy: actor,
      }, changes);

      return json({ ok: true, setId: id, changes: changes.length, ledgerAccountId: ledgerAccountId ?? null });
    }

    if (action === 'approve' || action === 'reject') {
      if (!setId) return json({ error: 'setId is required' }, 400);
      const status = action === 'approve' ? 'approved' : 'rejected';
      const ids: number[] = Array.isArray(body.changeIds) ? body.changeIds.map(Number) : [];

      if (ids.length) {
        for (const id of ids) {
          await db.prepare(
            `UPDATE sage_change SET status = ? WHERE id = ? AND change_set_id = ? AND status IN ('proposed','approved','rejected')`
          ).bind(status, id, setId).run();
        }
      } else {
        await db.prepare(
          `UPDATE sage_change SET status = ? WHERE change_set_id = ? AND status IN ('proposed','approved','rejected')`
        ).bind(status, setId).run();
      }

      if (action === 'approve') {
        await db.prepare(
          `UPDATE sage_change_set SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`
        ).bind(actor, setId).run();
      }
      return json({ ok: true });
    }

    if (action === 'dry-run') {
      if (!setId) return json({ error: 'setId is required' }, 400);
      const result = await dryRunChangeSet(db, env, setId, role);
      return json(result);
    }

    if (action === 'apply') {
      if (!setId) return json({ error: 'setId is required' }, 400);

      if (role === 'live') {
        // Live requires an explicit typed confirmation and a clean test run first.
        if (body.confirm !== 'APPLY TO LIVE') {
          return json({ error: 'Applying to the live business requires confirm: "APPLY TO LIVE"' }, 400);
        }
        const prior = await db.prepare(
          `SELECT COUNT(*) AS n FROM sage_snapshot WHERE change_set_id = ? AND role = 'test' AND stage = 'after'`
        ).bind(setId).first<{ n: number }>();
        if (!prior?.n) {
          return json({ error: 'This change set has not been applied to the test business yet.' }, 409);
        }
      }

      const result = await applyChangeSet(db, env, setId, role, actor);
      return json(result, result.ok ? 200 : 502);
    }

    if (action === 'rollback') {
      if (!setId) return json({ error: 'setId is required' }, 400);
      const result = await rollbackChangeSet(db, env, setId, actor);
      return json(result);
    }

    if (action === 'get') {
      const data = await getChangeSet(db, setId);
      return json(data ?? { error: 'Not found' }, data ? 200 : 404);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e: any) {
    return json({ error: String(e.message).slice(0, 800) }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
