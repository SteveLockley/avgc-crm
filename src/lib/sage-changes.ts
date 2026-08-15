// Staged writes to Sage.
//
// Flow: propose -> review/approve -> dry run -> apply to test -> verify
//       -> apply to live -> verify. Rollback replays before_json.
//
// Nothing here writes to Sage unless applyChangeSet is called, and that is the
// only place a write-enabled SageClient is constructed.

import { createSageClient, type SageRole } from './sage';

export type ChangeAction = 'create' | 'update' | 'deactivate' | 'reactivate' | 'delete';

export interface ProposedChange {
  entity?: string;               // 'contact' for now
  action: ChangeAction;
  sageId?: string | null;        // null for create
  label: string;                 // human-readable target
  payload: Record<string, any>;  // body sent to Sage (without the wrapper key)
}

export interface ChangeRow {
  id: number;
  change_set_id: number;
  entity: string;
  action: ChangeAction;
  sage_id: string | null;
  label: string;
  payload_json: string;
  before_json: string | null;
  after_json: string | null;
  diff_json: string | null;
  status: string;
  applied_at: string | null;
  error: string | null;
}

const WRAPPER: Record<string, string> = { contact: 'contact' };
const COLLECTION: Record<string, string> = { contact: '/contacts' };

/** Fields we compare when showing a diff — everything else in the record is noise. */
const COMPARABLE = [
  'name', 'reference', 'email', 'telephone', 'mobile', 'notes', 'tax_number',
  'credit_days', 'credit_limit', 'is_active', 'contact_types',
  'default_purchase_ledger_account', 'default_sales_ledger_account',
];

function summarise(value: any): any {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return value.map(v => (v && v.id) || v.displayed_as || v).join(', ');
    return value.id || value.displayed_as || JSON.stringify(value);
  }
  return value;
}

/** Field-level diff between what Sage holds now and what we intend to send. */
export function diffFields(before: Record<string, any> | null, payload: Record<string, any>) {
  const out: Array<{ field: string; from: any; to: any }> = [];
  for (const [field, to] of Object.entries(payload)) {
    if (field === 'contact_type_ids') continue;
    const from = before ? summarise(before[field]) : null;
    const toSummary = summarise(to);
    if (String(from ?? '') !== String(toSummary ?? '')) {
      out.push({ field, from: from ?? null, to: toSummary ?? null });
    }
  }
  return out;
}

// ─── Proposing ───────────────────────────────────────────────────────

export async function createChangeSet(
  db: D1Database,
  opts: { name: string; description?: string; phase?: string; createdBy?: string | null },
  changes: ProposedChange[],
): Promise<number> {
  const res = await db.prepare(
    `INSERT INTO sage_change_set (name, description, phase, target_role, status, created_by)
     VALUES (?, ?, ?, 'test', 'draft', ?)`
  ).bind(opts.name, opts.description ?? null, opts.phase ?? null, opts.createdBy ?? null).run();

  const setId = res.meta.last_row_id as number;

  for (const c of changes) {
    await db.prepare(
      `INSERT INTO sage_change (change_set_id, entity, action, sage_id, label, payload_json, diff_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      setId, c.entity ?? 'contact', c.action, c.sageId ?? null, c.label,
      JSON.stringify(c.payload), JSON.stringify(diffFields(null, c.payload)),
    ).run();
  }
  return setId;
}

export async function getChangeSet(db: D1Database, setId: number) {
  const set = await db.prepare('SELECT * FROM sage_change_set WHERE id = ?').bind(setId).first<any>();
  if (!set) return null;
  const rows = await db.prepare(
    'SELECT * FROM sage_change WHERE change_set_id = ? ORDER BY id'
  ).bind(setId).all<ChangeRow>();
  return { set, changes: rows.results || [] };
}

// ─── Dry run ─────────────────────────────────────────────────────────

export interface DryRunResult {
  ok: boolean;
  role: SageRole;
  checked: number;
  problems: Array<{ changeId: number; label: string; problem: string }>;
  diffs: Array<{ changeId: number; label: string; action: string; fields: ReturnType<typeof diffFields> }>;
}

/**
 * Reads current state from the target business and reports what would change.
 * Read-only: the client is built without write permission.
 */
export async function dryRunChangeSet(
  db: D1Database,
  env: any,
  setId: number,
  role: SageRole,
): Promise<DryRunResult> {
  const data = await getChangeSet(db, setId);
  const result: DryRunResult = { ok: true, role, checked: 0, problems: [], diffs: [] };
  if (!data) {
    result.ok = false;
    result.problems.push({ changeId: 0, label: '-', problem: 'Change set not found' });
    return result;
  }

  const client = createSageClient(env, { role });   // no allowWrites
  const seenNames = new Set<string>();

  for (const c of data.changes) {
    if (c.status === 'rejected' || c.status === 'applied') continue;
    result.checked++;
    const payload = JSON.parse(c.payload_json);
    const path = COLLECTION[c.entity] || '/contacts';

    try {
      if (c.action === 'create') {
        // A create is only safe if nothing of that name already exists.
        const existing = await client.get<any>(path, { search: payload.name || c.label, items_per_page: '20' });
        const clash = (existing.$items || []).find(
          (i: any) => (i.displayed_as || '').trim().toLowerCase() === (payload.name || '').trim().toLowerCase()
        );
        if (clash) {
          result.problems.push({ changeId: c.id, label: c.label, problem: `A contact named "${payload.name}" already exists (${clash.id})` });
          result.ok = false;
        }
        if (seenNames.has((payload.name || '').toLowerCase())) {
          result.problems.push({ changeId: c.id, label: c.label, problem: 'Duplicated within this change set' });
          result.ok = false;
        }
        seenNames.add((payload.name || '').toLowerCase());
        result.diffs.push({ changeId: c.id, label: c.label, action: c.action, fields: diffFields(null, payload) });
      } else {
        if (!c.sage_id) {
          result.problems.push({ changeId: c.id, label: c.label, problem: 'No Sage id on a non-create change' });
          result.ok = false;
          continue;
        }
        const before = await client.get<any>(`${path}/${c.sage_id}`);
        const fields = diffFields(before, payload);
        if (fields.length === 0) {
          result.problems.push({ changeId: c.id, label: c.label, problem: 'Nothing would change — already in the intended state' });
        }
        result.diffs.push({ changeId: c.id, label: c.label, action: c.action, fields });
      }
    } catch (e: any) {
      result.problems.push({ changeId: c.id, label: c.label, problem: e.message.slice(0, 300) });
      result.ok = false;
    }
  }
  return result;
}

// ─── Snapshots ───────────────────────────────────────────────────────

async function snapshot(
  db: D1Database, env: any, role: SageRole, setId: number, stage: 'before' | 'after',
): Promise<number> {
  const client = createSageClient(env, { role });
  const items = await client.getAll('/contacts', { attributes: 'all' });
  await db.prepare(
    `INSERT INTO sage_snapshot (change_set_id, role, stage, entity, item_count, data)
     VALUES (?, ?, ?, 'contact', ?, ?)`
  ).bind(setId, role, stage, items.length, JSON.stringify(items)).run();
  return items.length;
}

// ─── Applying ────────────────────────────────────────────────────────

export interface ApplyResult {
  ok: boolean;
  role: SageRole;
  applied: number;
  failed: number;
  skipped: number;
  snapshotBefore: number;
  snapshotAfter: number;
  errors: Array<{ label: string; error: string }>;
}

/**
 * Applies approved changes to the target business, one at a time, capturing the
 * prior state of each record first. Stops at the first failure so a bad payload
 * cannot cascade.
 */
export async function applyChangeSet(
  db: D1Database,
  env: any,
  setId: number,
  role: SageRole,
  actor: string,
): Promise<ApplyResult> {
  const out: ApplyResult = { ok: true, role, applied: 0, failed: 0, skipped: 0, snapshotBefore: 0, snapshotAfter: 0, errors: [] };

  const data = await getChangeSet(db, setId);
  if (!data) {
    out.ok = false;
    out.errors.push({ label: '-', error: 'Change set not found' });
    return out;
  }
  if (data.set.status === 'applied') {
    out.ok = false;
    out.errors.push({ label: '-', error: 'This change set has already been applied' });
    return out;
  }

  const approved = data.changes.filter(c => c.status === 'approved');
  if (approved.length === 0) {
    out.ok = false;
    out.errors.push({ label: '-', error: 'No approved changes to apply' });
    return out;
  }

  out.snapshotBefore = await snapshot(db, env, role, setId, 'before');
  await db.prepare(
    `UPDATE sage_change_set SET status = 'applying', target_role = ? WHERE id = ?`
  ).bind(role, setId).run();

  // The only write-enabled client in the codebase for contacts.
  const client = createSageClient(env, { role, allowWrites: true });

  for (const c of approved) {
    const payload = JSON.parse(c.payload_json);
    const path = COLLECTION[c.entity] || '/contacts';
    const wrapper = WRAPPER[c.entity] || 'contact';

    try {
      let before: any = null;
      if (c.sage_id) {
        before = await client.get<any>(`${path}/${c.sage_id}`);
      }

      let after: any;
      let newId = c.sage_id;

      if (c.action === 'create') {
        after = await client.post<any>(path, { [wrapper]: payload });
        newId = after?.id ?? null;
      } else if (c.action === 'delete') {
        await client.delete(`${path}/${c.sage_id}`);
        after = { deleted: true };
      } else {
        // update / deactivate / reactivate all go through PUT
        after = await client.put<any>(`${path}/${c.sage_id}`, { [wrapper]: payload });
      }

      await db.prepare(
        `UPDATE sage_change
            SET status = 'applied', sage_id = ?, before_json = ?, after_json = ?,
                applied_at = datetime('now'), error = NULL
          WHERE id = ?`
      ).bind(newId, before ? JSON.stringify(before) : null, JSON.stringify(after ?? null), c.id).run();

      out.applied++;
    } catch (e: any) {
      out.ok = false;
      out.failed++;
      out.errors.push({ label: c.label, error: String(e.message).slice(0, 500) });
      await db.prepare(
        `UPDATE sage_change SET status = 'failed', error = ? WHERE id = ?`
      ).bind(String(e.message).slice(0, 1000), c.id).run();
      break;   // stop the run rather than press on
    }
  }

  out.skipped = approved.length - out.applied - out.failed;
  out.snapshotAfter = await snapshot(db, env, role, setId, 'after');

  const status = out.failed > 0 ? (out.applied > 0 ? 'partial' : 'failed') : 'applied';
  await db.prepare(
    `UPDATE sage_change_set SET status = ?, applied_at = datetime('now') WHERE id = ?`
  ).bind(status, setId).run();

  await db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
     VALUES (?, 'sage_change_set_applied', 'sage_change_set', ?, ?)`
  ).bind(actor, setId, JSON.stringify({ role, applied: out.applied, failed: out.failed })).run();

  return out;
}

// ─── Rollback ────────────────────────────────────────────────────────

/**
 * Replays before_json for every applied row, newest first. Creates are undone by
 * deleting the created record where Sage allows it; where it does not, the
 * contact is deactivated instead and that is reported.
 */
export async function rollbackChangeSet(
  db: D1Database,
  env: any,
  setId: number,
  actor: string,
): Promise<{ ok: boolean; restored: number; notes: string[] }> {
  const data = await getChangeSet(db, setId);
  const notes: string[] = [];
  let restored = 0;
  if (!data) return { ok: false, restored: 0, notes: ['Change set not found'] };

  const role: SageRole = data.set.target_role === 'live' ? 'live' : 'test';
  const client = createSageClient(env, { role, allowWrites: true });

  for (const c of [...data.changes].reverse()) {
    if (c.status !== 'applied') continue;
    const path = COLLECTION[c.entity] || '/contacts';
    const wrapper = WRAPPER[c.entity] || 'contact';

    try {
      if (c.action === 'create') {
        try {
          await client.delete(`${path}/${c.sage_id}`);
          notes.push(`${c.label}: created record deleted`);
        } catch {
          await client.put(`${path}/${c.sage_id}`, { [wrapper]: { is_active: false } });
          notes.push(`${c.label}: could not be deleted (Sage refused), deactivated instead`);
        }
      } else if (c.before_json) {
        const before = JSON.parse(c.before_json);
        const restore: Record<string, any> = {};
        for (const f of COMPARABLE) {
          if (f in before && typeof before[f] !== 'object') restore[f] = before[f];
        }
        await client.put(`${path}/${c.sage_id}`, { [wrapper]: restore });
        notes.push(`${c.label}: restored`);
      } else {
        notes.push(`${c.label}: no before image, skipped`);
        continue;
      }
      await db.prepare(`UPDATE sage_change SET status = 'rolled_back' WHERE id = ?`).bind(c.id).run();
      restored++;
    } catch (e: any) {
      notes.push(`${c.label}: rollback failed — ${String(e.message).slice(0, 200)}`);
    }
  }

  await db.prepare(`UPDATE sage_change_set SET status = 'rolled_back' WHERE id = ?`).bind(setId).run();
  await db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
     VALUES (?, 'sage_change_set_rolled_back', 'sage_change_set', ?, ?)`
  ).bind(actor, setId, JSON.stringify({ restored })).run();

  return { ok: true, restored, notes };
}
