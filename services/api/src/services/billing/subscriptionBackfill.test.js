import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertApplyGate,
  buildRosterRows,
  formatDryRunReport,
  formatPlansStdout,
  parseBackfillArgs,
  parseCsv,
  parseExportArgs,
  runBackfill,
  runExport,
  stringifyCsv,
  ROSTER_COLUMNS,
} from './subscriptionBackfill.js';

const TODAY = '2026-11-13';
const ADA = '11111111-1111-4111-8111-111111111111';
const ALAN = '22222222-2222-4222-8222-222222222222';
const GRACE = '33333333-3333-4333-8333-333333333333';
const BABBAGE = '44444444-4444-4444-8444-444444444444';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const ACC_ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC_ALAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACC_GRACE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACC_BABBAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PLAN_GROUP_100 = 'e1111111-e111-4111-8111-111111111111';
const PLAN_GROUP_150 = 'e2222222-e222-4222-8222-222222222222';
const PLAN_PRIVATE_150 = 'e3333333-e333-4333-8333-333333333333';
const PLAN_CONTRACT_135 = 'e4444444-e444-4444-8444-444444444444';
const PLAN_INACTIVE = 'e5555555-e555-4555-8555-555555555555';
const SUB_GRACE = 'f1111111-f111-4111-8111-111111111111';

const PLANS = [
  {
    id: PLAN_GROUP_100,
    name: 'Basic Group Plan',
    plan_category: 'group',
    billing_cadence: 'monthly',
    price_cents: 10000,
    is_active: true,
  },
  {
    id: PLAN_GROUP_150,
    name: 'Core Group Plan',
    plan_category: 'group',
    billing_cadence: 'monthly',
    price_cents: 15000,
    is_active: true,
  },
  {
    id: PLAN_PRIVATE_150,
    name: 'Private Basic Plan',
    plan_category: 'private',
    billing_cadence: 'monthly',
    price_cents: 15000,
    is_active: true,
  },
  {
    id: PLAN_CONTRACT_135,
    name: 'Contract Group Plan',
    plan_category: 'group',
    billing_cadence: 'contract',
    price_cents: 13500,
    is_active: true,
  },
  {
    id: PLAN_INACTIVE,
    name: 'Retired Drop-In',
    plan_category: 'group',
    billing_cadence: 'per_session',
    price_cents: 2500,
    is_active: false,
  },
];

const MEMBERSHIPS = [
  { account_id: ACC_ADA, participant_id: ADA, display_name: 'Ada Lovelace', email: 'ada@example.test' },
  { account_id: ACC_ALAN, participant_id: ALAN, display_name: 'Alan Turing', email: 'alan@example.test' },
  { account_id: ACC_GRACE, participant_id: GRACE, display_name: 'Grace Hopper', email: 'grace@example.test' },
  { account_id: ACC_BABBAGE, participant_id: BABBAGE, display_name: 'Charles Babbage', email: 'charles@example.test' },
];

function graceSubscription() {
  return {
    id: SUB_GRACE,
    account_id: ACC_GRACE,
    participant_id: GRACE,
    status: 'active',
    starts_at: '2026-01-01',
    ends_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    plan_definition_id: PLAN_PRIVATE_150,
    plan_definitions: PLANS.find((plan) => plan.id === PLAN_PRIVATE_150),
  };
}

function snapshot(overrides = {}) {
  return {
    today: TODAY,
    plans: PLANS,
    memberships: MEMBERSHIPS,
    subscriptions: [graceSubscription()],
    ...overrides,
  };
}

function rosterCsv(fills) {
  const rows = buildRosterRows({
    memberships: MEMBERSHIPS,
    subscriptions: [graceSubscription()],
    today: TODAY,
  });
  for (const row of rows) {
    const fill = fills[row.participant_id];
    if (!fill) continue;
    row.plan = fill.plan ?? '';
    row.start_date = fill.start_date ?? '';
    row.note = fill.note ?? '';
  }
  return stringifyCsv(rows, ROSTER_COLUMNS);
}

function createMemorySupabase({
  accounts,
  members,
  participants,
  subscriptions,
  plans = PLANS,
} = {}) {
  const tables = {
    accounts,
    account_members: members,
    participants,
    subscriptions,
    plan_definitions: plans,
  };
  const rpc = vi.fn(async (name, args) => {
    if (name !== 'create_subscription') throw new Error(`unexpected rpc ${name}`);
    const id = `sub-${args.p_participant_id}`;
    const plan = plans.find((row) => row.id === args.p_plan_definition_id);
    tables.subscriptions.push({
      id,
      account_id: args.p_account_id,
      participant_id: args.p_participant_id,
      status: 'active',
      starts_at: args.p_starts_at,
      ends_at: args.p_ends_at,
      created_at: '2026-11-13T12:00:00.000Z',
      plan_definition_id: args.p_plan_definition_id,
      plan_definitions: plan,
    });
    return {
      data: {
        subscription_id: id,
        account_id: args.p_account_id,
        participant_id: args.p_participant_id,
        plan_definition_id: args.p_plan_definition_id,
        initial_charge_id: null,
        automatic_billing_starts_at: null,
      },
      error: null,
    };
  });

  return {
    tables,
    rpc,
    from(table) {
      const state = { eq: {}, in: null };
      const builder = {
        select: () => builder,
        eq: (column, value) => {
          state.eq[column] = value;
          return builder;
        },
        in: (column, values) => {
          state.in = { column, values: new Set(values) };
          return builder;
        },
        order: () => builder,
        maybeSingle: async () => {
          const rows = apply();
          return { data: rows[0] ?? null, error: null };
        },
        then: (resolve, reject) => Promise.resolve({ data: apply(), error: null }).then(resolve, reject),
      };
      function apply() {
        let rows = [...(tables[table] || [])];
        for (const [column, value] of Object.entries(state.eq)) {
          rows = rows.filter((row) => row[column] === value);
        }
        if (state.in) {
          rows = rows.filter((row) => state.in.values.has(row[state.in.column]));
        }
        return rows;
      }
      return builder;
    },
  };
}

function liveDb() {
  const subscriptions = [graceSubscription()];
  return createMemorySupabase({
    accounts: [
      { id: ACC_ADA, status: 'active', primary_contact_name: 'Ada Lovelace' },
      { id: ACC_ALAN, status: 'active', primary_contact_name: 'Alan Turing' },
      { id: ACC_GRACE, status: 'active', primary_contact_name: 'Grace Hopper' },
      { id: ACC_BABBAGE, status: 'active', primary_contact_name: 'Charles Babbage' },
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'inactive', primary_contact_name: 'Inactive' },
    ],
    members: [
      { account_id: ACC_ADA, participant_id: ADA, role: 'member', created_at: '2026-01-01T00:00:00.000Z' },
      { account_id: ACC_ALAN, participant_id: ALAN, role: 'member', created_at: '2026-01-02T00:00:00.000Z' },
      { account_id: ACC_GRACE, participant_id: GRACE, role: 'member', created_at: '2026-01-03T00:00:00.000Z' },
      { account_id: ACC_BABBAGE, participant_id: BABBAGE, role: 'member', created_at: '2026-01-04T00:00:00.000Z' },
    ],
    participants: [
      { id: ADA, full_name: 'Ada Lovelace', email: 'ada@example.test' },
      { id: ALAN, full_name: 'Alan Turing', email: 'alan@example.test' },
      { id: GRACE, full_name: 'Grace Hopper', email: 'grace@example.test' },
      { id: BABBAGE, full_name: 'Charles Babbage', email: 'charles@example.test' },
    ],
    subscriptions,
    plans: PLANS,
  });
}

function filledCsv() {
  return rosterCsv({
    [ADA]: { plan: 'Basic Group Plan', start_date: '2026-11-01', note: 'cash monthly' },
    [ALAN]: { plan: PLAN_GROUP_150, start_date: '2026-11-01' },
    [GRACE]: { plan: 'Basic Group Plan', start_date: '2026-11-01' },
    [BABBAGE]: { plan: '', start_date: '' },
  });
}

describe('CSV helpers', () => {
  it('round-trips commas, quotes, and a BOM', () => {
    const csv = `\uFEFFparticipant_id,display_name,plan\n${ADA},"Lovelace, Ada","Plan ""Gold"""\n`;
    const parsed = parseCsv(csv);
    expect(parsed.records).toEqual([
      {
        __row: 2,
        participant_id: ADA,
        display_name: 'Lovelace, Ada',
        plan: 'Plan "Gold"',
      },
    ]);
    const text = stringifyCsv(parsed.records, ['participant_id', 'display_name', 'plan']);
    expect(text).toContain('"Lovelace, Ada"');
    expect(text).toContain('"Plan ""Gold"""');
  });
});

describe('roster export', () => {
  it('writes one row per active account/participant with blank plan columns and a plans list', async () => {
    const exported = await runExport({
      supabase: liveDb(),
      supabaseUrl: 'http://127.0.0.1:54321',
      today: TODAY,
    });

    expect(exported.rosterRows).toHaveLength(4);
    expect(exported.rosterCsv.split('\n')[0]).toBe(ROSTER_COLUMNS.join(','));
    expect(exported.rosterRows.map((row) => row.participant_id).sort()).toEqual(
      [ADA, ALAN, BABBAGE, GRACE].sort(),
    );
    expect(exported.rosterRows.every((row) => row.plan === '' && row.start_date === '' && row.note === '')).toBe(
      true,
    );
    const grace = exported.rosterRows.find((row) => row.participant_id === GRACE);
    expect(grace.current_plan).toBe('Private Basic Plan');
    const ada = exported.rosterRows.find((row) => row.participant_id === ADA);
    expect(ada.current_plan).toBe('');
    expect(exported.plans.map((plan) => plan.name)).toEqual([
      'Basic Group Plan',
      'Contract Group Plan',
      'Core Group Plan',
      'Private Basic Plan',
    ]);
    expect(exported.plansText).toContain('Basic Group Plan');
    expect(exported.plansText).not.toContain('Retired Drop-In');
    expect(formatPlansStdout(PLANS)).toContain('id=' + PLAN_GROUP_100);
  });
});

const FEYNMAN = '55555555-5555-4555-8555-555555555555';
const KNUTH = '66666666-6666-4666-8666-666666666666';
const GAUSS = '77777777-7777-4777-8777-777777777777';
const NEUMANN = '88888888-8888-4888-8888-888888888888';
const ACC_FEYNMAN = 'abababab-abab-4aba-8aba-abababababab';
const ACC_KNUTH = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
const ACC_GAUSS = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const ACC_NEUMANN = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

const SAMPLE_EXTRA_MEMBERSHIPS = [
  { account_id: ACC_FEYNMAN, participant_id: FEYNMAN, display_name: 'Richard Feynman', email: 'rf@example.test' },
  { account_id: ACC_KNUTH, participant_id: KNUTH, display_name: 'Donald Knuth', email: 'dk@example.test' },
  { account_id: ACC_GAUSS, participant_id: GAUSS, display_name: 'Carl Gauss', email: 'gauss@example.test' },
  { account_id: ACC_NEUMANN, participant_id: NEUMANN, display_name: 'John von Neumann', email: 'jvn@example.test' },
];

function sampleDryRunCsv() {
  const rows = buildRosterRows({
    memberships: [...MEMBERSHIPS, ...SAMPLE_EXTRA_MEMBERSHIPS],
    subscriptions: [graceSubscription()],
    today: TODAY,
  });
  const byId = Object.fromEntries(rows.map((row) => [row.participant_id, row]));
  byId[ADA].plan = 'Basic Group Plan';
  byId[ADA].start_date = '2026-11-01';
  byId[ADA].note = 'cash monthly';
  byId[ALAN].plan = PLAN_GROUP_150;
  byId[ALAN].start_date = '2026-11-01';
  byId[GRACE].plan = 'Basic Group Plan';
  byId[GRACE].start_date = '2026-11-01';
  byId[FEYNMAN].plan = 'not-a-plan';
  byId[FEYNMAN].start_date = '2026-11-01';
  byId[KNUTH].plan = 'Retired Drop-In';
  byId[KNUTH].start_date = '2026-11-01';
  byId[NEUMANN].plan = 'Basic Group Plan';
  byId[NEUMANN].start_date = '13/11/2026';
  byId[GAUSS].plan = 'Basic Group Plan';
  byId[GAUSS].start_date = '2026-11-01';
  const header = stringifyCsv(rows, ROSTER_COLUMNS).trim();
  return [
    header,
    `${UNKNOWN},,No Such Person,nobody@example.test,,Basic Group Plan,2026-11-01,`,
    `${GAUSS},${ACC_GAUSS},Carl Gauss,gauss@example.test,,Core Group Plan,2026-11-01,`,
  ].join('\n');
}

describe('backfill validation', () => {
  it('classifies create / skip / error rows and monthly revenue from fake data', async () => {
    const { result, report, mode, gate } = await runBackfill({
      supabase: { from: () => { throw new Error('dry-run must use the fixture snapshot'); }, rpc: vi.fn() },
      csvText: sampleDryRunCsv(),
      snapshot: snapshot({ memberships: [...MEMBERSHIPS, ...SAMPLE_EXTRA_MEMBERSHIPS] }),
      supabaseUrl: 'http://127.0.0.1:54321',
    });

    expect(mode).toBe('dry-run');
    expect(gate).toEqual({ ok: true, mode: 'dry-run' });
    expect(result.would_create.map((row) => row.display_name).sort()).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(result.skipped.map((row) => row.reason).sort()).toEqual(['already_enrolled', 'blank_plan']);
    expect(result.errors.map((row) => row.error).sort()).toEqual([
      'duplicate_participant',
      'duplicate_participant',
      'inactive_plan',
      'invalid_start_date',
      'unknown_person',
      'unknown_plan',
    ]);
    expect(result.totals).toEqual({
      csv_rows: 10,
      would_create: 2,
      skipped: 2,
      errors: 6,
      monthly_revenue_cents: 25000,
      non_monthly_price_cents: 0,
    });
    expect(report).toContain('Mode: dry-run (no writes)');
    expect(report).toContain('monthly_revenue_cents: 25000  ($250.00 / month implied)');
    expect(report).toContain('already_enrolled  current=Private Basic Plan');
    expect(report).toContain('--yes-i-reviewed=2');
  });

  it('skips blank plans and existing enrollments without treating them as errors', async () => {
    const { result } = await runBackfill({
      supabase: liveDb(),
      csvText: filledCsv(),
      snapshot: snapshot(),
      supabaseUrl: 'http://localhost:54321',
    });
    expect(result.errors).toEqual([]);
    expect(result.would_create).toHaveLength(2);
    expect(result.skipped.map((row) => `${row.reason}:${row.participant_id}`).sort()).toEqual(
      [`already_enrolled:${GRACE}`, `blank_plan:${BABBAGE}`].sort(),
    );
  });

  it('includes non-monthly catalog price separately from monthly revenue', async () => {
    const csv = rosterCsv({
      [ADA]: { plan: 'Contract Group Plan', start_date: '2026-11-01' },
    });
    const { result, report } = await runBackfill({
      supabase: liveDb(),
      csvText: csv,
      snapshot: snapshot(),
      supabaseUrl: 'http://localhost:54321',
    });
    expect(result.totals.would_create).toBe(1);
    expect(result.totals.monthly_revenue_cents).toBe(0);
    expect(result.totals.non_monthly_price_cents).toBe(13500);
    expect(report).toContain('non_monthly_price_cents: 13500');
  });
});

describe('apply gate', () => {
  it('refuses without --apply and does not enroll', async () => {
    const db = liveDb();
    const ran = await runBackfill({
      supabase: db,
      csvText: filledCsv(),
      apply: false,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(ran.mode).toBe('dry-run');
    expect(db.rpc).not.toHaveBeenCalled();
    expect(assertApplyGate({ apply: false, confirmedCount: 2, wouldCreateCount: 2, errorCount: 0 }).mode).toBe(
      'dry-run',
    );
  });

  it('refuses --apply without a matching reviewed count', async () => {
    const db = liveDb();
    const missing = await runBackfill({
      supabase: db,
      csvText: filledCsv(),
      apply: true,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(missing.mode).toBe('dry-run');
    expect(missing.gate).toEqual({
      ok: false,
      error: 'apply_confirmation_required',
      wouldCreateCount: 2,
    });
    expect(missing.report).toContain('Apply gate: --apply requires --yes-i-reviewed=2');
    expect(db.rpc).not.toHaveBeenCalled();

    const mismatch = await runBackfill({
      supabase: db,
      csvText: filledCsv(),
      apply: true,
      confirmedCount: 99,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(mismatch.gate).toEqual({
      ok: false,
      error: 'apply_confirmation_mismatch',
      expected: 2,
      received: 99,
    });
    expect(mismatch.report).toContain('typed 99, expected 2');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('refuses --apply when the CSV has errors even if the count matches would_create', async () => {
    const csv = `${filledCsv().trim()}\n${UNKNOWN},,Nobody,x@example.test,,Basic Group Plan,2026-11-01,`;
    const db = liveDb();
    const ran = await runBackfill({
      supabase: db,
      csvText: csv,
      apply: true,
      confirmedCount: 2,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(ran.gate.error).toBe('apply_blocked_by_errors');
    expect(ran.mode).toBe('dry-run');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('applies only with --apply and a matching count, using enrollment-only create_subscription', async () => {
    const db = liveDb();
    const ran = await runBackfill({
      supabase: db,
      csvText: filledCsv(),
      apply: true,
      confirmedCount: 2,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(ran.mode).toBe('apply');
    expect(ran.gate).toEqual({ ok: true, mode: 'apply' });
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc.mock.calls.map((call) => call[1].p_participant_id).sort()).toEqual([ADA, ALAN].sort());
    for (const [, args] of db.rpc.mock.calls) {
      expect(args.p_create_initial_charge).toBe(false);
      expect(args.p_created_by).toBe('subscription_backfill');
      expect(args.p_ends_at).toBeNull();
    }
    expect(ran.applied.created).toHaveLength(2);
    expect(ran.applied.created.every((row) => row.initial_charge_id == null)).toBe(true);
    expect(ran.log.notes.join(' ')).toMatch(/create_initial_charge is always false/i);
  });
});

describe('idempotency', () => {
  it('reruns create no duplicates after a successful apply', async () => {
    const db = liveDb();
    const csv = filledCsv();
    const first = await runBackfill({
      supabase: db,
      csvText: csv,
      apply: true,
      confirmedCount: 2,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(first.applied.created).toHaveLength(2);
    expect(db.rpc).toHaveBeenCalledTimes(2);

    const second = await runBackfill({
      supabase: db,
      csvText: csv,
      apply: true,
      confirmedCount: 0,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    expect(second.result.totals.would_create).toBe(0);
    expect(second.result.skipped.filter((row) => row.reason === 'already_enrolled')).toHaveLength(3);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
});

describe('CLI args', () => {
  it('parses export and backfill flags', () => {
    expect(parseExportArgs(['--out', 'roster.csv', '--plans-out=plans.csv'])).toEqual({
      help: false,
      outPath: 'roster.csv',
      plansOutPath: 'plans.csv',
    });
    expect(parseBackfillArgs(['--csv=roster.csv', '--apply', '--yes-i-reviewed', '12', '--log', 'out.json'])).toEqual({
      help: false,
      apply: true,
      csvPath: 'roster.csv',
      logPath: 'out.json',
      confirmedCount: 12,
    });
  });
});

describe('secret hygiene', () => {
  const original = process.env.SUPABASE_SECRET_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = original;
  });

  it('does not print configured secrets in the dry-run report or result log', async () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_FAKE_DO_NOT_PRINT_12345';
    const ran = await runBackfill({
      supabase: liveDb(),
      csvText: filledCsv(),
      supabaseUrl: `https://${'jhxzecxkccqlgyazhsnb'}.supabase.co`,
    });
    expect(ran.report).toContain('PRODUCTION project jhxzecxkccqlgyazhsnb');
    expect(ran.report).not.toContain('sb_secret_FAKE_DO_NOT_PRINT_12345');
    expect(JSON.stringify(ran.log)).not.toContain('sb_secret_FAKE_DO_NOT_PRINT_12345');
    expect(formatDryRunReport({ result: ran.result, target: ran.target })).not.toContain('sb_secret');
  });
});
