import type { APIRoute } from 'astro';
import {
  checkDay, postReceipt, deleteReceipt, loadConfig, saveConfig, loadMappings,
  isIsoDate, dateRange, addDays, todayInLondon, TAX_RATES,
  type Mode, type DayRow, type CheckResult,
} from '@/lib/daily-takings';
import type { SageRole } from '@/lib/sage';

/**
 * Daily takings: TouchOffice → Sage Other Receipt, one per trading day.
 *
 * GET  → config, mappings, recent rows
 * POST { action: 'config',  bank_nominal?, mode?, live_from? }
 *      { action: 'mapping', op: 'add'|'update'|'delete'|'toggle', ... }
 *      { action: 'check',   dates: string[] | from, to, role? }        dry run, never writes to Sage
 *      { action: 'post',    date, role: 'test'|'live', confirm?, force? }
 *      { action: 'void',    date, role }                                delete a receipt we created
 *      { action: 'cron' }                                               yesterday + catch-up, per mode
 *
 * Admins reach this through Cloudflare Access. The scheduled caller presents
 * `Authorization: Bearer <CRON_SECRET>` and may only run 'cron' and 'check'.
 */

const MAX_DAYS_PER_CALL = 8;        // ~3 upstream requests per day; stays under the subrequest limit
const CRON_MAX_CHECKS = 6;
const CRON_MAX_POSTS = 2;
const LIVE_CONFIRM = 'POST TO LIVE';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function identify(locals: any, request: Request, env: any): { actor: string | null; viaCron: boolean } {
  if (locals.user?.email) return { actor: locals.user.email, viaCron: false };
  const auth = request.headers.get('authorization') || '';
  if (env?.CRON_SECRET && auth === `Bearer ${env.CRON_SECRET}`) return { actor: 'cron', viaCron: true };
  if (import.meta.env.DEV) return { actor: 'dev@alnmouthvillage.golf', viaCron: false };
  return { actor: null, viaCron: false };
}

async function getRow(db: any, date: string): Promise<DayRow | null> {
  return db.prepare('SELECT * FROM daily_takings WHERE takings_date = ?').bind(date).first<DayRow>();
}

async function audit(db: any, actor: string, action: string, date: string, details: unknown) {
  const row = await getRow(db, date);
  await db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details) VALUES (?, ?, 'daily_takings', ?, ?)`
  ).bind(actor, action, (row as any)?.id ?? null, JSON.stringify({ date, ...(details as object) })).run();
}

async function appendNote(db: any, date: string, note: string) {
  await db.prepare(
    `UPDATE daily_takings SET notes = TRIM(COALESCE(notes, '') || char(10) || ?), updated_at = datetime('now') WHERE takings_date = ?`
  ).bind(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${note}`, date).run();
}

// ─── GET ─────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ url, locals, request }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'DB not configured' }, 500);
  const { actor } = identify(locals, request, env);
  if (!actor) return json({ error: 'Not authorised' }, 403);

  const days = Math.min(Number(url.searchParams.get('days')) || 120, 400);
  const [config, mappings, rows] = await Promise.all([
    loadConfig(db),
    loadMappings(db),
    db.prepare(`SELECT * FROM daily_takings WHERE takings_date >= date('now', ?) ORDER BY takings_date DESC`)
      .bind(`-${days} days`).all(),
  ]);
  return json({ config, mappings, rows: rows.results ?? [], taxRates: TAX_RATES });
};

// ─── POST ────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'DB not configured' }, 500);

  const { actor, viaCron } = identify(locals, request, env);
  if (!actor) return json({ error: 'Not authorised' }, 403);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const action = body?.action;

  if (viaCron && action !== 'cron' && action !== 'check') {
    return json({ error: 'The scheduled caller may only run cron and check' }, 403);
  }

  try {
    switch (action) {
      case 'config':  return await handleConfig(db, body, actor);
      case 'mapping': return await handleMapping(db, body);
      case 'check':   return await handleCheck(db, env, body);
      case 'post':    return await handlePost(db, env, body, actor);
      case 'void':    return await handleVoid(db, env, body, actor);
      case 'cron':    return await handleCron(db, env, actor);
      default:        return json({ error: `Unknown action "${action}"` }, 400);
    }
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
};

// ─── Settings ────────────────────────────────────────────────────────

async function handleConfig(db: any, body: any, actor: string) {
  const patch: any = {};
  if (body.bank_nominal !== undefined) {
    const n = Number(body.bank_nominal);
    if (!Number.isInteger(n) || n < 1000 || n > 1999) return json({ error: 'Bank nominal must be a 1xxx code' }, 400);
    patch.bank_nominal = n;
  }
  if (body.mode !== undefined) {
    if (!['dry_run', 'test', 'live'].includes(body.mode)) return json({ error: 'mode must be dry_run, test or live' }, 400);
    patch.mode = body.mode as Mode;
  }
  if (body.live_from !== undefined) {
    if (body.live_from && !isIsoDate(body.live_from)) return json({ error: 'live_from must be YYYY-MM-DD' }, 400);
    patch.live_from = body.live_from || null;
  }
  const before = await loadConfig(db);
  if (patch.mode === 'live' && !(patch.live_from ?? before.live_from)) {
    return json({ error: 'Set the go-live date before switching to live mode' }, 400);
  }
  await saveConfig(db, patch);
  const config = await loadConfig(db);
  await db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, details) VALUES (?, 'daily_takings_config', 'daily_takings', ?)`
  ).bind(actor, JSON.stringify({ before, after: config })).run();
  return json({ ok: true, config });
}

// ─── Mapping ─────────────────────────────────────────────────────────

async function handleMapping(db: any, body: any) {
  const op = body.op;
  if (op === 'add' || op === 'update') {
    const pattern = String(body.dept_pattern ?? '').trim();
    const nominal = Number(body.nominal_code);
    const tax = String(body.tax_rate_id ?? '');
    const name = body.ledger_name ? String(body.ledger_name).trim() : null;
    if (!pattern) return json({ error: 'Department name is required' }, 400);
    if (!Number.isInteger(nominal) || nominal < 1000 || nominal > 9999) return json({ error: 'Nominal code must be a 4-digit code' }, 400);
    if (!TAX_RATES[tax]) return json({ error: 'Unknown VAT rate' }, 400);
    try {
      if (op === 'add') {
        await db.prepare(
          `INSERT INTO daily_takings_mapping (dept_pattern, nominal_code, ledger_name, tax_rate_id, sort_order)
           VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) FROM daily_takings_mapping), 0) + 10)`
        ).bind(pattern, nominal, name, tax).run();
      } else {
        if (!body.id) return json({ error: 'id is required' }, 400);
        await db.prepare(
          `UPDATE daily_takings_mapping SET dept_pattern = ?, nominal_code = ?, ledger_name = ?, tax_rate_id = ? WHERE id = ?`
        ).bind(pattern, nominal, name, tax, Number(body.id)).run();
      }
    } catch (e: any) {
      if (/UNIQUE/i.test(e?.message ?? '')) return json({ error: `"${pattern}" is already mapped` }, 409);
      throw e;
    }
  } else if (op === 'toggle') {
    await db.prepare(`UPDATE daily_takings_mapping SET enabled = ? WHERE id = ?`).bind(body.enabled ? 1 : 0, Number(body.id)).run();
  } else if (op === 'delete') {
    await db.prepare(`DELETE FROM daily_takings_mapping WHERE id = ?`).bind(Number(body.id)).run();
  } else {
    return json({ error: `Unknown mapping op "${op}"` }, 400);
  }
  return json({ ok: true, mappings: await loadMappings(db) });
}

// ─── Dry run ─────────────────────────────────────────────────────────

function summarise(r: CheckResult) {
  return {
    date: r.date,
    status: r.comparison.status,
    proposed_total: r.proposed.total,
    sage_total: r.comparison.sage_total,
    delta: r.comparison.delta,
    issues: r.comparison.diffs.filter(d => d.issues.length).map(d => `${d.ledger_name}: ${d.issues.join(', ')}`),
    notes: r.comparison.notes,
  };
}

async function handleCheck(db: any, env: any, body: any) {
  let dates: string[] = [];
  if (Array.isArray(body.dates)) dates = body.dates.filter(isIsoDate);
  else if (isIsoDate(body.from) && isIsoDate(body.to) && body.from <= body.to) dates = dateRange(body.from, body.to);
  if (!dates.length) return json({ error: 'Give dates[] or from/to as YYYY-MM-DD' }, 400);
  if (dates.length > MAX_DAYS_PER_CALL) return json({ error: `At most ${MAX_DAYS_PER_CALL} days per call` }, 400);
  const today = todayInLondon();
  if (dates.some(d => d >= today)) return json({ error: 'Only completed days can be checked' }, 400);
  const role: SageRole = body.role === 'test' ? 'test' : 'live';

  const results: any[] = [];
  for (const date of dates) {
    try {
      results.push(summarise(await checkDay(db, env, date, role)));
    } catch (e: any) {
      results.push({ date, status: 'error', error: e?.message ?? String(e) });
      // A dead TouchOffice session or Sage outage will fail every day the same way.
      if (/session|Not authorised|NO_SAGE/i.test(e?.message ?? '')) break;
    }
  }
  return json({ ok: true, role, results });
}

// ─── Posting ─────────────────────────────────────────────────────────

/**
 * Posts one day to one business. Re-runs the check against that business
 * first, so the decision is made on fresh data, and refuses when Sage already
 * holds a till receipt for the day.
 */
async function postDay(db: any, env: any, date: string, role: SageRole, actor: string, force = false) {
  const check = await checkDay(db, env, date, role);
  const { status } = check.comparison;
  if (status === 'unmapped') return { ok: false, status: 400, error: 'A department with sales has no budget head. Fix the mapping first.', check: summarise(check) };
  if (status === 'no_sales') return { ok: false, status: 400, error: 'TouchOffice shows no sales for this day.', check: summarise(check) };
  if (check.existing.length && !force) {
    return { ok: false, status: 409, error: `Sage (${role}) already holds ${check.existing.length} till receipt(s) for ${date} totalling £${check.comparison.sage_total.toFixed(2)}.`, check: summarise(check) };
  }
  const row = await getRow(db, date);
  const idCol = role === 'live' ? 'live_sage_id' : 'test_sage_id';
  if ((row as any)?.[idCol]) return { ok: false, status: 409, error: `${date} was already posted to ${role} by the CRM (${(row as any)[idCol]}). Void it first.` };

  const posted = await postReceipt(env, role, check.proposed);
  const atCol = role === 'live' ? 'live_posted_at' : 'test_posted_at';
  await db.prepare(
    `UPDATE daily_takings SET ${idCol} = ?, ${atCol} = datetime('now'), posted_by = ?, error = NULL, updated_at = datetime('now') WHERE takings_date = ?`
  ).bind(posted.sage_id, actor, date).run();
  await appendNote(db, date, `posted to ${role} £${posted.total.toFixed(2)} (${posted.sage_id}) by ${actor}${force ? ' [forced]' : ''}`);
  await audit(db, actor, `daily_takings_posted_${role}`, date, { sage_id: posted.sage_id, total: posted.total, force });

  // Store the post-write picture for the day against the business we wrote to.
  let after: CheckResult | null = null;
  try { after = await checkDay(db, env, date, role); } catch { /* the post succeeded; the re-check is cosmetic */ }
  return { ok: true, status: 200, sage_id: posted.sage_id, total: posted.total, role, check: after ? summarise(after) : summarise(check) };
}

async function handlePost(db: any, env: any, body: any, actor: string) {
  const date = body.date;
  const role: SageRole = body.role === 'live' ? 'live' : 'test';
  if (!isIsoDate(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
  if (date >= todayInLondon()) return json({ error: 'Only completed days can be posted' }, 400);

  if (role === 'live') {
    if (body.confirm !== LIVE_CONFIRM) return json({ error: `Type ${LIVE_CONFIRM} to confirm` }, 400);
    const config = await loadConfig(db);
    if (!config.live_from) return json({ error: 'Set the go-live date in settings before posting to live' }, 400);
    if (date < config.live_from) return json({ error: `${date} is before the go-live date ${config.live_from}. Days before it stay with the manual entries.` }, 400);
  }

  const r = await postDay(db, env, date, role, actor, body.force === true);
  return json(r, r.status);
}

async function handleVoid(db: any, env: any, body: any, actor: string) {
  const date = body.date;
  const role: SageRole = body.role === 'live' ? 'live' : 'test';
  if (!isIsoDate(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
  const row: any = await getRow(db, date);
  const idCol = role === 'live' ? 'live_sage_id' : 'test_sage_id';
  const atCol = role === 'live' ? 'live_posted_at' : 'test_posted_at';
  const sageId = row?.[idCol];
  if (!sageId) return json({ error: `Nothing posted to ${role} for ${date} by the CRM` }, 404);

  await deleteReceipt(env, role, sageId);
  await db.prepare(
    `UPDATE daily_takings SET ${idCol} = NULL, ${atCol} = NULL, updated_at = datetime('now') WHERE takings_date = ?`
  ).bind(date).run();
  await appendNote(db, date, `voided ${role} receipt ${sageId} by ${actor}`);
  await audit(db, actor, `daily_takings_voided_${role}`, date, { sage_id: sageId });
  let check: CheckResult | null = null;
  try { check = await checkDay(db, env, date, role); } catch { /* cosmetic */ }
  return json({ ok: true, voided: sageId, check: check ? summarise(check) : null });
}

// ─── Scheduled run ───────────────────────────────────────────────────

/**
 * Yesterday first, then any recent day still unresolved. What happens after the
 * check depends on the mode:
 *   dry_run – record the comparison only (the "tandem" period)
 *   test    – also post to the test business when it has nothing for the day
 *   live    – post to live when Sage has nothing for the day and the day is on
 *             or after the go-live date; days with a manual entry are left alone
 */
async function handleCron(db: any, env: any, actor: string) {
  const config = await loadConfig(db);
  const yesterday = addDays(todayInLondon(), -1);
  const window = dateRange(addDays(yesterday, -6), yesterday).reverse();   // newest first

  const existing = await db.prepare(
    `SELECT * FROM daily_takings WHERE takings_date BETWEEN ? AND ?`
  ).bind(window[window.length - 1], window[0]).all();
  const rows = new Map<string, any>((existing.results ?? []).map((r: any) => [r.takings_date, r]));

  const candidates = window.filter(d => {
    const r = rows.get(d);
    if (d === yesterday) return true;
    if (!r) return true;                                            // never looked at
    if (r.error || r.comparison === 'error') return true;            // try again
    if (r.comparison === 'missing_in_sage' && !r.live_sage_id) return true;   // still waiting to be posted
    return false;
  }).slice(0, CRON_MAX_CHECKS);

  const summary: any = { mode: config.mode, live_from: config.live_from, checked: [] as any[], posted: [] as any[], skipped: [] as any[], errors: [] as any[] };
  let posts = 0;

  for (const date of candidates) {
    let check: CheckResult;
    try {
      check = await checkDay(db, env, date, 'live');
    } catch (e: any) {
      summary.errors.push({ date, error: e?.message ?? String(e) });
      if (/session/i.test(e?.message ?? '')) break;
      continue;
    }
    summary.checked.push(summarise(check));
    const row: any = await getRow(db, date);

    if (config.mode === 'live') {
      if (check.comparison.status !== 'missing_in_sage') { summary.skipped.push({ date, reason: check.comparison.status }); continue; }
      if (!config.live_from || date < config.live_from) { summary.skipped.push({ date, reason: 'before go-live date' }); continue; }
      if (row?.live_sage_id) { summary.skipped.push({ date, reason: 'already posted' }); continue; }
      if (posts >= CRON_MAX_POSTS) { summary.skipped.push({ date, reason: 'post limit for this run' }); continue; }
      posts++;
      const r = await postDay(db, env, date, 'live', actor);
      (r.ok ? summary.posted : summary.errors).push({ date, ...(r.ok ? { sage_id: r.sage_id, total: r.total } : { error: r.error }) });
    } else if (config.mode === 'test') {
      if (row?.test_sage_id) { summary.skipped.push({ date, reason: 'already in test' }); continue; }
      if (check.comparison.status === 'no_sales' || check.comparison.status === 'unmapped') { summary.skipped.push({ date, reason: check.comparison.status }); continue; }
      if (posts >= CRON_MAX_POSTS) { summary.skipped.push({ date, reason: 'post limit for this run' }); continue; }
      posts++;
      const r = await postDay(db, env, date, 'test', actor);
      (r.ok ? summary.posted : summary.errors).push({ date, ...(r.ok ? { sage_id: r.sage_id, total: r.total } : { error: r.error }) });
      // Leave the stored comparison pointing at live, where the manual entries are.
      try { await checkDay(db, env, date, 'live'); } catch { /* cosmetic */ }
    }
  }

  await db.prepare(
    `INSERT INTO audit_log (user_email, action, entity_type, details) VALUES (?, 'daily_takings_cron', 'daily_takings', ?)`
  ).bind(actor, JSON.stringify(summary).slice(0, 4000)).run();
  return json({ ok: summary.errors.length === 0, ...summary });
}
