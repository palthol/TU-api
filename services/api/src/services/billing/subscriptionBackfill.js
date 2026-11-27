import { parseIsoDate, parseUuid } from '../../lib/adminRequestValidation.js';
import { nyCalendarDate } from '../../lib/gymTime.js';
import { isCurrentlyEffective, subscriptionRangeOverlaps } from '../../lib/subscriptionCurrent.js';
import { enrollSubscription } from './enrollSubscription.js';

export const PRODUCTION_SUPABASE_PROJECT_REF = 'jhxzecxkccqlgyazhsnb';
export const BACKFILL_CREATED_BY = 'subscription_backfill';

export const ROSTER_COLUMNS = Object.freeze([
  'participant_id',
  'account_id',
  'display_name',
  'email',
  'current_plan',
  'plan',
  'start_date',
  'note',
]);

export const PLAN_REFERENCE_COLUMNS = Object.freeze([
  'id',
  'name',
  'plan_category',
  'billing_cadence',
  'price_cents',
  'price_usd',
]);

const SECRET_ENV_NAMES = Object.freeze([
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_API_KEY',
  'CRON_SECRET',
  'STRIPE_WEBHOOK_SECRET',
  'SESSION_SECRET',
  'SESSION_SECRET_PREVIOUS',
  'TURNSTILE_SECRET_KEY',
  'DISCORD_WEBHOOK_URL',
  'SLACK_WEBHOOK_URL',
]);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function formatUsdFromCents(cents) {
  const n = Number(cents);
  if (!Number.isInteger(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function describeSupabaseTarget(supabaseUrl) {
  const raw = String(supabaseUrl || '').trim();
  let host = '';
  try {
    host = raw ? new URL(raw).hostname.toLowerCase() : '';
  } catch {
    host = raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  }
  const isProduction =
    raw.toLowerCase().includes(PRODUCTION_SUPABASE_PROJECT_REF) ||
    host === `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
  return {
    host: host || '(unknown)',
    isProduction,
    label: isProduction
      ? `PRODUCTION project ${PRODUCTION_SUPABASE_PROJECT_REF}`
      : 'non-production',
  };
}

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function stringifyCsv(rows, columns) {
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function parseCsv(text) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      if (field.endsWith('\r')) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (inQuotes) {
    const error = new Error('csv_unclosed_quote');
    error.code = 'csv_unclosed_quote';
    throw error;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length && rows[rows.length - 1].every((cell) => String(cell ?? '').trim() === '')) {
    rows.pop();
  }
  if (rows.length === 0) {
    const error = new Error('csv_empty');
    error.code = 'csv_empty';
    throw error;
  }

  const headers = rows[0].map((h) => String(h ?? '').trim());
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (cells.every((cell) => String(cell ?? '').trim() === '')) continue;
    const record = { __row: i + 1 };
    headers.forEach((header, idx) => {
      if (!header) return;
      record[header] = cells[idx] == null ? '' : String(cells[idx]);
    });
    records.push(record);
  }
  return { headers, records };
}

function takeArg(argv, index, current, name) {
  if (current.includes('=')) return { value: current.slice(current.indexOf('=') + 1), next: index };
  const next = argv[index + 1];
  if (next == null || next.startsWith('--')) {
    const error = new Error(`${name}_required`);
    error.code = `${name}_required`;
    throw error;
  }
  return { value: next, next: index + 1 };
}

export function parseExportArgs(argv) {
  const out = { help: false, outPath: null, plansOutPath: null };
  const args = argv.slice();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--out' || a.startsWith('--out=')) {
      const taken = takeArg(args, i, a, 'out');
      out.outPath = taken.value;
      i = taken.next;
    } else if (a === '--plans-out' || a.startsWith('--plans-out=')) {
      const taken = takeArg(args, i, a, 'plans_out');
      out.plansOutPath = taken.value;
      i = taken.next;
    } else {
      const error = new Error(`unknown_argument:${a}`);
      error.code = 'unknown_argument';
      throw error;
    }
  }
  return out;
}

export function parseBackfillArgs(argv) {
  const out = {
    help: false,
    apply: false,
    csvPath: null,
    logPath: null,
    confirmedCount: null,
  };
  const args = argv.slice();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--csv' || a.startsWith('--csv=')) {
      const taken = takeArg(args, i, a, 'csv');
      out.csvPath = taken.value;
      i = taken.next;
    } else if (a === '--log' || a.startsWith('--log=')) {
      const taken = takeArg(args, i, a, 'log');
      out.logPath = taken.value;
      i = taken.next;
    } else if (a === '--yes-i-reviewed' || a.startsWith('--yes-i-reviewed=')) {
      const taken = takeArg(args, i, a, 'yes_i_reviewed');
      const n = Number.parseInt(String(taken.value).trim(), 10);
      if (!Number.isInteger(n) || String(n) !== String(taken.value).trim()) {
        const error = new Error('invalid_confirmation_count');
        error.code = 'invalid_confirmation_count';
        throw error;
      }
      out.confirmedCount = n;
      i = taken.next;
    } else {
      const error = new Error(`unknown_argument:${a}`);
      error.code = 'unknown_argument';
      throw error;
    }
  }
  return out;
}

function nestedPlan(row) {
  const raw = row?.plan_definitions;
  const plan = Array.isArray(raw) ? raw[0] : raw;
  return plan && typeof plan === 'object' ? plan : null;
}

export function publicPlan(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  if (typeof row.plan_category !== 'string' || typeof row.billing_cadence !== 'string') return null;
  const price = Number(row.price_cents);
  if (!Number.isInteger(price) || price < 0) return null;
  return {
    id: row.id,
    name: row.name,
    plan_category: row.plan_category,
    billing_cadence: row.billing_cadence,
    price_cents: price,
    is_active: row.is_active === true,
  };
}

export function buildRosterRows({ memberships, subscriptions, today }) {
  const currentByParticipant = new Map();
  for (const sub of subscriptions ?? []) {
    if (!isCurrentlyEffective(sub, today)) continue;
    const existing = currentByParticipant.get(sub.participant_id);
    if (
      !existing ||
      sub.starts_at > existing.starts_at ||
      (sub.starts_at === existing.starts_at && String(sub.created_at || '') > String(existing.created_at || ''))
    ) {
      currentByParticipant.set(sub.participant_id, sub);
    }
  }

  const rows = [];
  for (const member of memberships ?? []) {
    const current = currentByParticipant.get(member.participant_id);
    const plan = current ? publicPlan(nestedPlan(current)) : null;
    rows.push({
      participant_id: member.participant_id,
      account_id: member.account_id,
      display_name: member.display_name || '',
      email: member.email || '',
      current_plan: plan?.name || '',
      current_plan_id: plan?.id || '',
      plan: '',
      start_date: '',
      note: '',
    });
  }
  rows.sort((a, b) => {
    const name = a.display_name.localeCompare(b.display_name);
    if (name !== 0) return name;
    return a.participant_id.localeCompare(b.participant_id);
  });
  return rows;
}

export function formatPlansReference(plans) {
  const active = (plans ?? []).filter((plan) => plan.is_active).map((plan) => ({
    ...plan,
    price_usd: formatUsdFromCents(plan.price_cents),
  }));
  active.sort((a, b) => {
    const cat = a.plan_category.localeCompare(b.plan_category);
    if (cat !== 0) return cat;
    if (a.price_cents !== b.price_cents) return a.price_cents - b.price_cents;
    return a.name.localeCompare(b.name);
  });
  return active;
}

export function formatPlansStdout(plans) {
  const active = formatPlansReference(plans);
  if (active.length === 0) return 'Active plans: (none)\n';
  const lines = ['Active plans (fill `plan` with name or id):'];
  for (const plan of active) {
    lines.push(
      `  ${plan.name}  ${plan.plan_category}  ${plan.billing_cadence}  ${plan.price_usd}  id=${plan.id}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function planKey(name) {
  return String(name || '').trim().toLowerCase();
}

export function resolvePlan(value, plans) {
  const raw = String(value ?? '').trim();
  if (!raw) return { status: 'blank' };
  const uuid = parseUuid(raw);
  if (uuid) {
    const match = (plans ?? []).find((plan) => plan.id === uuid);
    if (!match) return { status: 'error', error: 'unknown_plan', value: uuid };
    if (!match.is_active) return { status: 'error', error: 'inactive_plan', plan: match };
    return { status: 'ok', plan: match };
  }
  const key = planKey(raw);
  const activeMatches = (plans ?? []).filter((plan) => plan.is_active && planKey(plan.name) === key);
  if (activeMatches.length === 1) return { status: 'ok', plan: activeMatches[0] };
  if (activeMatches.length > 1) return { status: 'error', error: 'ambiguous_plan', value: raw };
  const inactiveMatches = (plans ?? []).filter((plan) => !plan.is_active && planKey(plan.name) === key);
  if (inactiveMatches.length > 0) return { status: 'error', error: 'inactive_plan', plan: inactiveMatches[0] };
  return { status: 'error', error: 'unknown_plan', value: raw };
}

function overlappingForParticipant(subscriptions, participantId, startDate) {
  return (subscriptions ?? []).find(
    (sub) => sub.participant_id === participantId && subscriptionRangeOverlaps(sub, startDate, null),
  );
}

export function validateBackfill({ records, snapshot }) {
  const memberships = snapshot.memberships ?? [];
  const subscriptions = snapshot.subscriptions ?? [];
  const plans = snapshot.plans ?? [];
  const today = snapshot.today || nyCalendarDate();

  const byParticipant = new Map();
  for (const member of memberships) {
    const list = byParticipant.get(member.participant_id) || [];
    list.push(member);
    byParticipant.set(member.participant_id, list);
  }

  const filledCounts = new Map();
  for (const record of records) {
    const id = parseUuid(record.participant_id);
    if (!id) continue;
    if (!String(record.plan ?? '').trim()) continue;
    filledCounts.set(id, (filledCounts.get(id) || 0) + 1);
  }

  const wouldCreate = [];
  const skipped = [];
  const errors = [];

  for (const record of records) {
    const row = record.__row;
    const participantId = parseUuid(record.participant_id);
    const planRaw = String(record.plan ?? '').trim();
    const startRaw = String(record.start_date ?? '').trim();
    const note = String(record.note ?? '').trim();
    const displayName = String(record.display_name ?? '').trim();
    const email = String(record.email ?? '').trim();

    if (!participantId) {
      errors.push({
        row,
        error: 'unknown_person',
        participant_id: String(record.participant_id ?? '').trim() || null,
        display_name: displayName,
        email,
        detail: 'participant_id is missing or not a UUID',
      });
      continue;
    }

    if (planRaw && filledCounts.get(participantId) > 1) {
      errors.push({
        row,
        error: 'duplicate_participant',
        participant_id: participantId,
        display_name: displayName,
        email,
      });
      continue;
    }

    const people = byParticipant.get(participantId);
    if (!people || people.length === 0) {
      errors.push({
        row,
        error: 'unknown_person',
        participant_id: participantId,
        display_name: displayName,
        email,
      });
      continue;
    }

    const csvAccountId = parseUuid(record.account_id);
    const member =
      (csvAccountId && people.find((m) => m.account_id === csvAccountId)) || people[0];

    if (!planRaw) {
      skipped.push({
        row,
        reason: 'blank_plan',
        participant_id: participantId,
        account_id: member.account_id,
        display_name: displayName || member.display_name,
        email: email || member.email,
      });
      continue;
    }

    const resolved = resolvePlan(planRaw, plans);
    if (resolved.status !== 'ok') {
      errors.push({
        row,
        error: resolved.error,
        participant_id: participantId,
        account_id: member.account_id,
        display_name: displayName || member.display_name,
        email: email || member.email,
        plan: planRaw,
        detail: resolved.plan ? `${resolved.plan.name} (${resolved.plan.id})` : resolved.value,
      });
      continue;
    }

    const startDate = parseIsoDate(startRaw);
    if (!startDate) {
      errors.push({
        row,
        error: 'invalid_start_date',
        participant_id: participantId,
        account_id: member.account_id,
        display_name: displayName || member.display_name,
        email: email || member.email,
        plan: resolved.plan.name,
        detail: startRaw || '(blank)',
      });
      continue;
    }

    const overlap = overlappingForParticipant(subscriptions, participantId, startDate);
    if (overlap) {
      const current = publicPlan(nestedPlan(overlap));
      skipped.push({
        row,
        reason: 'already_enrolled',
        participant_id: participantId,
        account_id: member.account_id,
        display_name: displayName || member.display_name,
        email: email || member.email,
        current_plan: current?.name || overlap.plan_definition_id,
        existing_subscription_id: overlap.id || null,
        start_date: startDate,
        plan: resolved.plan.name,
      });
      continue;
    }

    wouldCreate.push({
      row,
      participant_id: participantId,
      account_id: member.account_id,
      display_name: displayName || member.display_name,
      email: email || member.email,
      plan: resolved.plan,
      start_date: startDate,
      note: note || '',
      today,
    });
  }

  const monthlyRevenueCents = wouldCreate
    .filter((item) => item.plan.billing_cadence === 'monthly')
    .reduce((sum, item) => sum + item.plan.price_cents, 0);
  const nonMonthlyPriceCents = wouldCreate
    .filter((item) => item.plan.billing_cadence !== 'monthly')
    .reduce((sum, item) => sum + item.plan.price_cents, 0);

  return {
    today,
    csv_rows: records.length,
    would_create: wouldCreate,
    skipped,
    errors,
    totals: {
      csv_rows: records.length,
      would_create: wouldCreate.length,
      skipped: skipped.length,
      errors: errors.length,
      monthly_revenue_cents: monthlyRevenueCents,
      non_monthly_price_cents: nonMonthlyPriceCents,
    },
  };
}

export function assertApplyGate({ apply, confirmedCount, wouldCreateCount, errorCount }) {
  if (!apply) return { ok: true, mode: 'dry-run' };
  if (errorCount > 0) {
    return { ok: false, error: 'apply_blocked_by_errors', errorCount, wouldCreateCount };
  }
  if (confirmedCount == null) {
    return { ok: false, error: 'apply_confirmation_required', wouldCreateCount };
  }
  if (!Number.isInteger(confirmedCount) || confirmedCount !== wouldCreateCount) {
    return {
      ok: false,
      error: 'apply_confirmation_mismatch',
      expected: wouldCreateCount,
      received: confirmedCount,
    };
  }
  return { ok: true, mode: 'apply' };
}

function personLabel(item) {
  return item.display_name || item.email || item.participant_id;
}

export function formatDryRunReport({ result, target, mode = 'dry-run', gate = null }) {
  const lines = [];
  lines.push('Subscription backfill');
  lines.push(`Target: ${target.host} (${target.label})`);
  lines.push(`Mode: ${mode === 'apply' ? 'APPLY' : 'dry-run (no writes)'}`);
  lines.push(`Today (America/New_York): ${result.today}`);
  lines.push('');

  lines.push(`Would create (${result.would_create.length}):`);
  if (result.would_create.length === 0) lines.push('  (none)');
  for (const item of result.would_create) {
    lines.push(
      `  row ${item.row}  ${personLabel(item)}  ${item.plan.name}  ${formatUsdFromCents(item.plan.price_cents)}  start ${item.start_date}  cadence ${item.plan.billing_cadence}`,
    );
  }
  lines.push('');

  lines.push(`Skipped (${result.skipped.length}):`);
  if (result.skipped.length === 0) lines.push('  (none)');
  for (const item of result.skipped) {
    const extra =
      item.reason === 'already_enrolled' && item.current_plan
        ? `  current=${item.current_plan}`
        : '';
    lines.push(`  row ${item.row}  ${personLabel(item)}  ${item.reason}${extra}`);
  }
  lines.push('');

  lines.push(`Errors (${result.errors.length}):`);
  if (result.errors.length === 0) lines.push('  (none)');
  for (const item of result.errors) {
    const extra = item.detail ? `  ${item.detail}` : '';
    lines.push(`  row ${item.row}  ${personLabel(item)}  ${item.error}${extra}`);
  }
  lines.push('');

  const t = result.totals;
  lines.push('Totals');
  lines.push(`  csv_rows: ${t.csv_rows}`);
  lines.push(`  would_create: ${t.would_create}`);
  lines.push(`  skipped: ${t.skipped}`);
  lines.push(`  errors: ${t.errors}`);
  lines.push(
    `  monthly_revenue_cents: ${t.monthly_revenue_cents}  (${formatUsdFromCents(t.monthly_revenue_cents)} / month implied)`,
  );
  if (t.non_monthly_price_cents > 0) {
    lines.push(
      `  non_monthly_price_cents: ${t.non_monthly_price_cents}  (${formatUsdFromCents(t.non_monthly_price_cents)} catalog, not monthly)`,
    );
  }
  lines.push('');

  if (mode === 'apply' && gate?.ok) {
    lines.push(`Apply gate: matched would_create=${t.would_create}.`);
  } else if (gate && !gate.ok) {
    if (gate.error === 'apply_confirmation_mismatch') {
      lines.push(
        `Apply gate: refused (typed ${gate.received}, expected ${gate.expected}). No writes.`,
      );
    } else if (gate.error === 'apply_blocked_by_errors') {
      lines.push(`Apply gate: refused because ${gate.errorCount} row error(s). No writes.`);
    } else if (gate.error === 'apply_confirmation_required') {
      lines.push(
        `Apply gate: --apply requires --yes-i-reviewed=${t.would_create} (or type that count). No writes.`,
      );
    } else {
      lines.push(`Apply gate: refused (${gate.error}). No writes.`);
    }
  } else {
    lines.push(
      `Apply gate: not requested. After review, re-run with --apply --yes-i-reviewed=${t.would_create}.`,
    );
  }

  lines.push('Enrollment only: create_initial_charge=false. No obligations, charges, or cron.');
  return `${lines.join('\n')}\n`;
}

function isOverlapRpcError(error) {
  const text = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''}`.toLowerCase();
  return text.includes('overlapping_active_subscription');
}

export async function applyEnrollments({ supabase, wouldCreate }) {
  const created = [];
  const skipped = [];
  const errors = [];

  for (const item of wouldCreate) {
    const enrolled = await enrollSubscription(supabase, {
      participant_id: item.participant_id,
      plan_definition_id: item.plan.id,
      starts_at: item.start_date,
      ends_at: null,
      account_id: item.account_id,
      create_initial_charge: false,
      notes: item.note || null,
      created_by: BACKFILL_CREATED_BY,
    });

    if (enrolled.error) {
      if (isOverlapRpcError(enrolled.error)) {
        skipped.push({
          row: item.row,
          reason: 'already_enrolled',
          participant_id: item.participant_id,
          account_id: item.account_id,
          display_name: item.display_name,
        });
        continue;
      }
      errors.push({
        row: item.row,
        error: 'enroll_failed',
        participant_id: item.participant_id,
        account_id: item.account_id,
        display_name: item.display_name,
        detail: enrolled.stage,
      });
      continue;
    }

    const payload = enrolled.data && typeof enrolled.data === 'object' ? enrolled.data : {};
    created.push({
      row: item.row,
      participant_id: item.participant_id,
      account_id: payload.account_id ?? item.account_id,
      plan_definition_id: item.plan.id,
      plan_name: item.plan.name,
      start_date: item.start_date,
      subscription_id: payload.subscription_id ?? null,
      initial_charge_id: payload.initial_charge_id ?? null,
      create_initial_charge: enrolled.create_initial_charge,
    });
  }

  return { created, skipped, errors };
}

export function buildResultLog({ result, target, mode, gate, applied = null }) {
  return {
    ok: mode !== 'apply' || (gate?.ok === true && (applied?.errors.length ?? 0) === 0),
    mode,
    target: { host: target.host, label: target.label, isProduction: target.isProduction },
    today: result.today,
    totals: result.totals,
    gate: gate
      ? { ok: gate.ok, error: gate.error || null, expected: gate.expected ?? result.totals.would_create, received: gate.received ?? null }
      : null,
    would_create: result.would_create.map((item) => ({
      row: item.row,
      participant_id: item.participant_id,
      account_id: item.account_id,
      display_name: item.display_name,
      plan_id: item.plan.id,
      plan_name: item.plan.name,
      price_cents: item.plan.price_cents,
      billing_cadence: item.plan.billing_cadence,
      start_date: item.start_date,
      note: item.note,
    })),
    skipped: result.skipped,
    errors: result.errors,
    applied: applied
      ? {
          created: applied.created,
          skipped: applied.skipped,
          errors: applied.errors,
        }
      : null,
    notes: [
      'Enrollment only. create_initial_charge is always false.',
      'No billing obligations or monthly-charge generation.',
    ],
  };
}

export function assertNoSecrets(text, env = process.env) {
  const haystack = String(text || '');
  for (const name of SECRET_ENV_NAMES) {
    const value = nonEmptyString(env[name]);
    if (value && haystack.includes(value)) {
      const error = new Error(`refusing_to_print_secret:${name}`);
      error.code = 'refusing_to_print_secret';
      throw error;
    }
  }
}

async function selectRows(supabase, table, { columns, eq, inFilter, order } = {}) {
  let query = supabase.from(table).select(columns);
  if (eq) {
    for (const [column, value] of Object.entries(eq)) query = query.eq(column, value);
  }
  if (inFilter) query = query.in(inFilter.column, inFilter.values);
  if (order) {
    for (const item of order) {
      query = query.order(item.column, { ascending: item.ascending !== false });
    }
  }
  const { data, error } = await query;
  if (error) {
    const err = new Error(`${table}_query_failed`);
    err.cause = error;
    throw err;
  }
  return data ?? [];
}

export async function loadBackfillSnapshot(supabase, { today } = {}) {
  const calendarToday = today || nyCalendarDate();
  const planRows = await selectRows(supabase, 'plan_definitions', {
    columns: 'id, name, plan_category, billing_cadence, price_cents, is_active',
    order: [
      { column: 'plan_category', ascending: true },
      { column: 'price_cents', ascending: true },
      { column: 'name', ascending: true },
    ],
  });
  const plans = planRows.map(publicPlan).filter(Boolean);

  const accounts = await selectRows(supabase, 'accounts', {
    columns: 'id, status, primary_contact_name',
    eq: { status: 'active' },
  });
  const accountIds = accounts.map((row) => row.id);
  const accountById = new Map(accounts.map((row) => [row.id, row]));

  const memberRows = accountIds.length
    ? await selectRows(supabase, 'account_members', {
        columns: 'account_id, participant_id, role, created_at',
        inFilter: { column: 'account_id', values: accountIds },
        order: [{ column: 'created_at', ascending: true }],
      })
    : [];

  const participantIds = [...new Set(memberRows.map((row) => row.participant_id))];
  const people = participantIds.length
    ? await selectRows(supabase, 'participants', {
        columns: 'id, full_name, email',
        inFilter: { column: 'id', values: participantIds },
      })
    : [];
  const personById = new Map(people.map((row) => [row.id, row]));

  const memberships = memberRows
    .filter((row) => accountById.has(row.account_id) && personById.has(row.participant_id))
    .map((row) => {
      const person = personById.get(row.participant_id);
      return {
        account_id: row.account_id,
        participant_id: row.participant_id,
        role: row.role,
        display_name: person.full_name,
        email: person.email,
      };
    });

  const subscriptions = participantIds.length
    ? await selectRows(supabase, 'subscriptions', {
        columns:
          'id, account_id, participant_id, status, starts_at, ends_at, created_at, plan_definition_id, plan_definitions(id, name, plan_category, billing_cadence, price_cents, is_active)',
        eq: { status: 'active' },
        inFilter: { column: 'participant_id', values: participantIds },
        order: [
          { column: 'starts_at', ascending: false },
          { column: 'created_at', ascending: false },
        ],
      })
    : [];

  return { today: calendarToday, plans, memberships, subscriptions };
}

export function runValidationFromCsv(csvText, snapshot) {
  const { records } = parseCsv(csvText);
  return validateBackfill({ records, snapshot });
}

export async function runBackfill({
  supabase,
  csvText,
  apply = false,
  confirmedCount = null,
  supabaseUrl = '',
  snapshot = null,
}) {
  const target = describeSupabaseTarget(supabaseUrl);
  const loaded = snapshot || (await loadBackfillSnapshot(supabase));
  const result = runValidationFromCsv(csvText, loaded);
  const gate = assertApplyGate({
    apply,
    confirmedCount,
    wouldCreateCount: result.totals.would_create,
    errorCount: result.totals.errors,
  });

  let applied = null;
  let mode = 'dry-run';
  if (apply && gate.ok) {
    mode = 'apply';
    applied = await applyEnrollments({ supabase, wouldCreate: result.would_create });
  }

  const report = formatDryRunReport({ result, target, mode, gate });
  assertNoSecrets(report);
  const log = buildResultLog({ result, target, mode, gate, applied });
  assertNoSecrets(JSON.stringify(log));
  return { result, target, gate, mode, applied, report, log };
}

export async function runExport({ supabase, supabaseUrl = '', snapshot = null, today } = {}) {
  const target = describeSupabaseTarget(supabaseUrl);
  const loaded = snapshot || (await loadBackfillSnapshot(supabase, { today }));
  const rosterRows = buildRosterRows({
    memberships: loaded.memberships,
    subscriptions: loaded.subscriptions,
    today: loaded.today,
  });
  const plans = formatPlansReference(loaded.plans);
  const rosterCsv = stringifyCsv(rosterRows, ROSTER_COLUMNS);
  const plansCsv = stringifyCsv(plans, PLAN_REFERENCE_COLUMNS);
  const plansText = formatPlansStdout(loaded.plans);
  assertNoSecrets(rosterCsv);
  assertNoSecrets(plansCsv);
  assertNoSecrets(plansText);
  return {
    target,
    today: loaded.today,
    rosterRows,
    plans,
    rosterCsv,
    plansCsv,
    plansText,
  };
}
