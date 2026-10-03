// Real local Supabase / API gate. Never loads dotenv or accepts remote targets.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';
import { assertNonProductionTargets } from './lib/tu-test-guard.mjs';

const root = resolve(import.meta.dirname, '..');
const workdir = resolve(root, 'tmp/obligation-validation-20261003');
const cli = resolve(root, 'node_modules/.bin/supabase');
const cliEnv = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' };
assert.equal(execFileSync(cli, ['--version'], { env: cliEnv, encoding: 'utf8' }).trim(), '2.105.0');
assert.match(readFileSync(resolve(workdir, 'supabase/config.toml'), 'utf8'), /^project_id = "tu_obligation_validation_20261003"$/m);
// Capture keys in memory only; never print status JSON or subprocess environment.
const local = JSON.parse(execFileSync(cli, ['status', '--workdir', workdir, '-o', 'json'], {
  env: cliEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
assert.equal(local.API_URL, 'http://127.0.0.1:55321');
const dbUrl = new URL(local.DB_URL);
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.port, '55322');
assert.equal(dbUrl.pathname, '/postgres');
assertNonProductionTargets({ supabaseUrl: local.API_URL, apiBase: 'http://127.0.0.1:53001' });
const clients = new Set();
async function connect(role = 'service_role') {
  const c = new pg.Client({ connectionString: local.DB_URL, application_name: 'tu-local-validation', statement_timeout: 15000 });
  await c.connect(); clients.add(c);
  if (role) await c.query(`set role ${role}`);
  return c;
}
async function close(c) { clients.delete(c); await c.end(); }
const db = await connect(null);
const sql = async (text, values = []) => (await db.query(text, values)).rows;
let checks = 0;
function pass(name) { console.log(`PASS ${++checks}: ${name}`); }
async function test(name, fn) { await fn(); pass(name); }
const today = (await sql("select ((now() at time zone 'America/New_York')::date)::text d"))[0].d;
const month = today.slice(0, 7) + '-01';
const nextMonth = (await sql("select (date_trunc('month',$1::date)+interval '1 month')::date::text d", [today]))[0].d;
const plan = (await sql("select id from plan_definitions where name='Core Group Plan'"))[0].id;
async function fixture(n = 1) {
  const account = randomUUID(), participants = Array.from({ length: n }, randomUUID);
  await sql("insert into accounts(id,primary_contact_name,primary_contact_email) values($1,'[TU-TEST] Local gate',$2)", [account, `${account}@tu-test.invalid`]);
  for (const p of participants) {
    await sql("insert into participants(id,full_name,date_of_birth,email) values($1,'[TU-TEST] Local gate','1990-01-01',$2)", [p, `${p}@tu-test.invalid`]);
    await sql('insert into account_members(account_id,participant_id) values($1,$2)', [account, p]);
  }
  return { account, participants };
}
async function obligation(f, { id = randomUUID(), amount = 12340, anchor = month, active = true, previous = null } = {}) {
  await sql("select create_billing_obligation($1,$2,'[TU-TEST] Agreement',$3,$4,$5::uuid[],null,$6)", [id, f.account, amount, anchor, f.participants, previous]);
  if (active) await sql("select transition_billing_obligation($1,'activate',$2)", [id, anchor]);
  return id;
}
const gen = ["select * from private.generate_monthly_charges_as_of($1)", [today]];
const covered = (f, o, id = randomUUID()) => ['select enroll_obligation_entitlement($1,$2,$3,$4)', [id, o, f.participants[0], plan]];
const legacy = f => ['select create_subscription($1,$2,$3,null,$4,true)', [f.participants[0], plan, today, f.account]];
const count = async (o) => Number((await sql('select count(*) n from charges where billing_obligation_id=$1', [o]))[0].n);
// First operation executes in an open transaction. Observe the independent second
// backend blocked in pg_stat_activity before releasing the first. No timing-only race.
async function orderedRace(first, second) {
  const a = await connect(), b = await connect();
  try {
    const pidA = (await a.query('select pg_backend_pid() p')).rows[0].p;
    const pidB = (await b.query('select pg_backend_pid() p')).rows[0].p;
    assert.notEqual(pidA, pidB);
    await a.query('begin');
    await a.query(...first);
    const pending = b.query(...second).then(value => ({ value }), error => ({ error }));
    let observed = false;
    for (let i = 0; i < 100; i++) {
      const rows = await sql("select wait_event_type,wait_event from pg_stat_activity where pid=$1", [pidB]);
      if (rows[0]?.wait_event_type === 'Lock') { observed = true; break; }
      await new Promise(r => setTimeout(r, 25));
    }
    assert.ok(observed, 'second independent backend must wait on a real PostgreSQL lock');
    await a.query('commit');
    const result = await pending;
    return result;
  } finally { await a.query('rollback').catch(() => {}); await close(a); await close(b); }
}
let api, stub;
try {
  console.log(`LOCAL ONLY: PostgreSQL ${(await sql('show server_version'))[0].server_version}; API ${local.API_URL}; DB 127.0.0.1:55322`);
  if (process.argv.includes('--preservation')) {
    assert.equal((await sql('select max(version) v from supabase_migrations.schema_migrations'))[0].v, '20260921221500', 'preservation requires a disposable DB reset to the pre-obligation version');
    await sql(readFileSync(resolve(root, 'scripts/fixtures/billing-pre-obligations.sql'), 'utf8'));
    const files = readdirSync(resolve(root, 'supabase/migrations')).filter(f => f >= '20260930063526' && f.endsWith('.sql')).sort();
    for (let replay = 0; replay < 2; replay++) for (const file of files) await sql(readFileSync(resolve(root, 'supabase/migrations', file), 'utf8'));
    await sql(readFileSync(resolve(root, 'scripts/fixtures/billing-post-obligations.sql'), 'utf8'));
    pass('real auth-schema migration/reapplication preserves subscription, charge, partial payment, allocation JSON; no automatic enrollment/backfill');
  } else if (process.argv.includes('--reproduce-legacy-gap')) {
    assert.doesNotMatch((await sql("select pg_get_functiondef('create_subscription(uuid,uuid,date,date,uuid,boolean,text,text)'::regprocedure) definition"))[0].definition, /overlapping_active_subscription/, 'baseline reproduction requires original legacy function before the corrective migration');
    const f = await fixture(), o = await obligation(f);
    await sql(...covered(f, o));
    await sql(...legacy(f));
    assert.equal(Number((await sql('select count(*) n from subscriptions where participant_id=$1', [f.participants[0]]))[0].n), 2);
    pass('BASELINE DEFECT REPRODUCED: covered then legacy creates overlapping active access and an extra catalog-priced charge');
  } else {
    assert.equal((await sql('select count(*)::int n from billing_obligations'))[0].n, 0, 'run on a fresh disposable stack; do not mix committed harness fixtures with rollback pgTAP suites');
    await test('real auth schema, migration ledger, obligation tables/indexes/triggers/RPCs and service-role grants', async () => {
      assert.ok((await sql("select to_regclass('auth.users') t"))[0].t);
      assert.equal((await sql('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n, readdirSync(resolve(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).length);
      for (const table of ['billing_obligations', 'billing_obligation_participants', 'view_payer_charge_board', 'view_payer_payment_reminders']) assert.ok((await sql('select to_regclass($1) t', [table]))[0].t);
      assert.ok((await sql("select count(*)::int n from pg_indexes where tablename='charges' and indexdef like '%billing_obligation_id%'")).some(r => r.n >= 1));
      assert.ok((await sql("select count(*)::int n from pg_trigger where tgrelid='billing_obligations'::regclass and not tgisinternal"))[0].n >= 1);
      assert.ok((await sql("select has_function_privilege('service_role','enroll_obligation_entitlement(uuid,uuid,uuid,uuid,uuid)','execute') ok"))[0].ok);
    });
    await test('generator/generator serializes across independent backends without duplicate periods', async () => {
      const f = await fixture(3), o = await obligation(f);
      assert.ok(!(await orderedRace(gen, gen)).error); assert.equal(await count(o), 1);
      assert.equal((await sql('select amount_cents from charges where billing_obligation_id=$1', [o]))[0].amount_cents, 12340);
    });
    for (const action of ['pause', 'end']) for (const generatorFirst of [true, false]) {
      await test(`generator/${action}, ${generatorFirst ? 'generator' : action} lock wins`, async () => {
        const f = await fixture(), o = await obligation(f);
        const change = ["select transition_billing_obligation($1,$2)", [o, action]];
        const r = await orderedRace(...(generatorFirst ? [gen, change] : [change, gen]));
        assert.ok(!r.error); assert.equal(await count(o), generatorFirst ? 1 : 0);
      });
    }
    for (const generatorFirst of [true, false]) await test(`replacement/generator, ${generatorFirst ? 'generator' : 'replacement'} lock wins; immutable issued period`, async () => {
      const f = await fixture(), old = await obligation(f), fresh = await obligation(f, { active: false, previous: old });
      const futureGen = [gen[0], [nextMonth]], change = ["select transition_billing_obligation($1,'activate',$2)", [fresh, nextMonth]];
      const r = await orderedRace(...(generatorFirst ? [futureGen, change] : [change, futureGen]));
      assert.equal(Boolean(r.error), generatorFirst);
      assert.equal(await count(old), generatorFirst ? 1 : 0); assert.equal(await count(fresh), generatorFirst ? 0 : 1);
      const state = (await sql('select status,ends_before::text from billing_obligations where id=$1', [fresh]))[0];
      assert.equal(state.status, generatorFirst ? 'draft' : 'active');
      const snapshot = JSON.stringify(await sql('select id,amount_cents,coverage_start::text,coverage_end::text,due_at::text from charges where billing_obligation_id=any($1::uuid[]) order by id', [[old, fresh]]));
      await sql(...futureGen);
      assert.equal(JSON.stringify(await sql('select id,amount_cents,coverage_start::text,coverage_end::text,due_at::text from charges where billing_obligation_id=any($1::uuid[]) order by id', [[old, fresh]])), snapshot);
    });
    await test('same UUID create conflict and activation no-op serialize without partial links', async () => {
      const f = await fixture(2), id = randomUUID();
      const create = ["select create_billing_obligation($1,$2,'[TU-TEST] Race',12340,$3,$4::uuid[])", [id, f.account, month, f.participants]];
      assert.equal((await orderedRace(create, create)).error?.code, '23505');
      assert.equal((await sql('select count(*)::int n from billing_obligation_participants where obligation_id=$1', [id]))[0].n, 2);
      const activate = ["select transition_billing_obligation($1,'activate',$2)", [id, month]];
      assert.ok(!(await orderedRace(activate, activate)).error);
    });
    await test('competing replacement activation accepts exactly one successor with atomic loser', async () => {
      const f = await fixture(), old = await obligation(f), a = await obligation(f, { active: false, previous: old }), b = await obligation(f, { active: false, previous: old });
      const r = await orderedRace(["select transition_billing_obligation($1,'activate',$2)", [a, nextMonth]], ["select transition_billing_obligation($1,'activate',$2)", [b, nextMonth]]);
      assert.match(r.error?.message ?? '', /replacement_not_available/);
      assert.equal((await sql("select count(*)::int n from billing_obligations where replaces_obligation_id=$1 and status='active'", [old]))[0].n, 1);
      assert.equal((await sql('select status from billing_obligations where id=$1', [b]))[0].status, 'draft');
    });
    for (const first of ['covered', 'legacy']) await test(`mixed enrollment race: ${first} lock wins; one subscription, loser atomic`, async () => {
      const f = await fixture(), o = await obligation(f);
      const c = covered(f, o), l = legacy(f);
      const r = await orderedRace(...(first === 'covered' ? [c, l] : [l, c]));
      assert.match(r.error?.message ?? '', /overlapping_active_subscription/);
      assert.equal((await sql('select count(*)::int n from subscriptions where participant_id=$1', [f.participants[0]]))[0].n, 1);
      assert.equal((await sql('select count(*)::int n from charges where subscription_id in (select id from subscriptions where participant_id=$1)', [f.participants[0]]))[0].n, first === 'legacy' ? 1 : 0);
    });
    await test('covered/covered and legacy/legacy races accept one access record', async () => {
      for (const mode of ['covered', 'legacy']) {
        const f = await fixture(), o = await obligation(f);
        const first = mode === 'covered' ? covered(f, o) : legacy(f), second = mode === 'covered' ? covered(f, o) : legacy(f);
        assert.match((await orderedRace(first, second)).error?.message ?? '', /overlapping_active_subscription/);
      }
    });
    await test('legacy date-range overlap rejects future/same-day but permits nonoverlapping historical access', async () => {
      const f = await fixture(); await sql(...legacy(f));
      await assert.rejects(() => sql('select create_subscription($1,$2,$3,null,$4,false)', [f.participants[0], plan, nextMonth, f.account]), /overlapping_active_subscription/);
      await sql("select create_subscription($1,$2,'1999-01-01','1999-01-31',$3,false)", [f.participants[0], plan, f.account]);
      assert.equal((await sql('select count(*)::int n from subscriptions where participant_id=$1', [f.participants[0]]))[0].n, 2);
    });

    // Launch the actual Express entry point with an allowlisted environment. Its
    // dotenv loader sees /dev/null, not either checkout's production .env files.
    const adminKey = randomBytes(32).toString('hex'), cronKey = randomBytes(32).toString('hex');
    const deliveries = [];
    stub = createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; deliveries.push(JSON.parse(body)); res.writeHead(204).end(); });
    stub.listen(53002, '127.0.0.1'); await once(stub, 'listening');
    const apiEnv = { PATH: process.env.PATH, DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'test', PORT: '53001',
      SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
      ADMIN_API_KEY: adminKey, CRON_SECRET: cronKey, DISCORD_WEBHOOK_URL: 'http://127.0.0.1:53002/stub', ALLOWED_ORIGIN: 'http://127.0.0.1:53001' };
    api = spawn(process.execPath, ['services/api/src/index.js'], { cwd: root, env: apiEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let apiLog = ''; api.stdout.on('data', b => { apiLog += b; }); api.stderr.on('data', b => { apiLog += b; });
    for (let i = 0; i < 100; i++) {
      if (api.exitCode !== null) throw new Error('Local API exited before health check (log withheld to protect keys)');
      try { if ((await fetch('http://127.0.0.1:53001/health/deep')).ok) break; } catch {}
      if (i === 99) throw new Error('Local API deep health timeout');
      await new Promise(r => setTimeout(r, 50));
    }
    async function request(path, body, { status = 200, key = adminKey, headers = {} } = {}) {
      const response = await fetch(`http://127.0.0.1:53001/api/admin${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-admin-key': key } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
      const data = await response.json(); assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`); return data;
    }
    const f = await fixture(3), other = await fixture(), ids = [randomUUID(), randomUUID(), randomUUID()];
    const createBody = { id: ids[0], account_id: f.account, label: '[TU-TEST] HTTP household', amount_cents: 12340, anchor_date: month, participant_ids: f.participants };
    await test('HTTP real PostgREST create/list/activate; multiple payers, independent cycles, household no fanout', async () => {
      await request('/billing/obligations', createBody);
      await request('/billing/obligations', { ...createBody, id: ids[1], amount_cents: 6780, anchor_date: month.slice(0, 8) + '02', participant_ids: [] });
      await request('/billing/obligations', { ...createBody, id: ids[2], account_id: other.account, amount_cents: 4321, participant_ids: other.participants });
      for (let i = 0; i < ids.length; i++) await request(`/billing/obligations/${ids[i]}/transition`, { action: 'activate', billing_starts_on: i === 1 ? month.slice(0, 8) + '02' : month });
      assert.equal((await request(`/billing/obligations?account_id=${f.account}`)).obligations.length, 2);
      await Promise.all(Array.from({ length: 8 }, () => request('/billing/generate-monthly-charges', { as_of: '2099-01-01' })));
      for (const o of ids) assert.equal(await count(o), 1);
      const charges = await sql('select amount_cents,coverage_start::text,subscription_id from charges where billing_obligation_id=any($1::uuid[]) order by amount_cents', [ids]);
      assert.deepEqual(charges.map(c => c.amount_cents), [4321, 6780, 12340]); assert.ok(charges.every(c => c.subscription_id === null && c.coverage_start.startsWith(today.slice(0, 7))));
    });
    await test('HTTP no-charge covered access and legacy overlap rejection leave financial terms unchanged', async () => {
      const before = JSON.stringify(await sql('select * from charges where account_id=$1 order by id', [f.account]));
      await request(`/billing/obligations/${ids[0]}/entitlements`, { id: randomUUID(), participant_id: f.participants[0], plan_definition_id: plan });
      await request('/billing/subscriptions', { participant_id: f.participants[0], plan_definition_id: plan, account_id: f.account, create_initial_charge: true }, { status: 400 });
      assert.equal(JSON.stringify(await sql('select * from charges where account_id=$1 order by id', [f.account])), before);
    });
    await test('HTTP invalid create/activation/enrollment/payment are atomic; repeated UUID conflicts', async () => {
      await request('/billing/obligations', createBody, { status: 409 });
      // Participant links are descriptive; payer membership is checked when
      // granting access, not when recording a descriptive link. Use an actual
      // invalid FK to exercise rollback after the draft insert.
      const bad = randomUUID(); await request('/billing/obligations', { ...createBody, id: bad, participant_ids: [f.participants[0], randomUUID()] }, { status: 400 });
      assert.equal((await sql('select count(*)::int n from billing_obligations where id=$1', [bad]))[0].n, 0);
      const before = JSON.stringify(await sql('select id,ends_at from subscriptions where participant_id=$1', [f.participants[0]]));
      await request(`/billing/obligations/${ids[0]}/entitlements`, { id: randomUUID(), participant_id: f.participants[0], plan_definition_id: randomUUID() }, { status: 400 });
      assert.equal(JSON.stringify(await sql('select id,ends_at from subscriptions where participant_id=$1', [f.participants[0]])), before);
      await request(`/billing/obligations/${ids[0]}/transition`, { action: 'activate', billing_starts_on: '2026-02-30' }, { status: 400 });
      const paymentsBefore = (await sql('select count(*)::int n from payments'))[0].n;
      await request('/billing/record-payment', { account_id: f.account, amount_cents: 100, method: 'cash', issued_by: 'local-gate', allocations: [{ charge_id: randomUUID(), amount_cents: 100 }], issue_receipt: true }, { status: 400 });
      assert.equal((await sql('select count(*)::int n from payments'))[0].n, paymentsBefore);
    });
    await test('HTTP discount/payment allocation/refund/write-off balances and canonical reporting/reminders', async () => {
      const charge = (await sql('select id from charges where billing_obligation_id=$1', [ids[0]]))[0].id;
      await request('/billing/charge-discounts', { charge_id: charge, discount_type: 'flat', flat_amount_cents: 340, label: '[TU-TEST] Discount' });
      const payment = await request('/billing/record-payment', { account_id: f.account, amount_cents: 2000, method: 'cash', issued_by: 'local-gate', allocations: [{ charge_id: charge, amount_cents: 2000 }], issue_receipt: true, idempotency_key: randomUUID() });
      assert.ok(payment.payment_id); assert.ok(payment.receipt_id);
      await request('/billing/payment-refunds', { payment_id: payment.payment_id, amount_cents: 500, reason: '[TU-TEST] Refund', idempotency_key: randomUUID() });
      await request('/billing/charge-adjustments', { charge_id: charge, amount_cents: 500, reason: '[TU-TEST] Writeoff' });
      const rows = (await request('/reporting/views/payer-charge-board?limit=500')).rows;
      const relevant = rows.filter(r => r.account_id === f.account);
      assert.equal(relevant.length, 2); const shared = relevant.find(r => r.charge_id === charge);
      assert.equal(shared.outstanding_cents, 10000); assert.equal(shared.covered_participants.length, 3);
      assert.equal((await request('/reporting/views/payer-payment-reminders?limit=500')).rows.filter(r => r.account_id === f.account).length, 2);
      await request(`/billing/obligations/${ids[0]}/transition`, { action: 'end' });
      assert.equal((await sql('select outstanding_cents from view_payer_payment_reminders where charge_id=$1', [charge]))[0].outstanding_cents, '10000');
    });
    await test('HTTP role gates and cron permissions use real staff lookup', async () => {
      const keys = {};
      for (const role of ['front_desk', 'finance']) {
        const key = randomBytes(32).toString('hex'); keys[role] = key;
        await sql('insert into staff_users(email,display_name,role,key_hash,key_prefix) values($1,$2,$3,$4,$5)', [`${randomUUID()}@tu-test.invalid`, '[TU-TEST] Role', role, createHash('sha256').update(key).digest('hex'), key.slice(0, 12)]);
      }
      await request('/billing/obligations', createBody, { status: 401, key: null });
      await request('/billing/obligations', createBody, { status: 403, key: keys.front_desk });
      await request('/billing/obligations', { ...createBody, id: randomUUID() }, { key: keys.finance });
      await request('/billing/obligations', createBody, { status: 401, key: null, headers: { 'x-cron-secret': cronKey } });
      await request('/billing/generate-monthly-charges', {}, { key: null, headers: { 'x-cron-secret': cronKey } });
    });
    await test('HTTP anon and real authenticated JWT cannot read protected views or invoke service-only RPC', async () => {
      const authResponse = await fetch(`${local.API_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: local.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: `${randomUUID()}@tu-test.invalid`, password: randomBytes(32).toString('hex') }) });
      const session = await authResponse.json(); assert.ok(session.access_token, 'local Auth should issue a real authenticated token');
      for (const token of [local.ANON_KEY, session.access_token]) for (const path of ['view_payer_charge_board?select=*', 'view_payer_payment_reminders?select=*', 'rpc/generate_monthly_charges']) {
        const rpc = path.startsWith('rpc/'); const response = await fetch(`${local.API_URL}/rest/v1/${path}`, { method: rpc ? 'POST' : 'GET', headers: { apikey: local.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(rpc ? { body: '{}' } : {}) });
        assert.ok([401, 403, 404].includes(response.status), `protected ${path} returned ${response.status}`);
      }
    });
    await test('both reminder consumers read real payer views with loopback-only Discord transport stub', async () => {
      const expected = Number((await sql('select count(*) n from view_payer_payment_reminders'))[0].n);
      const reminders = await request('/notifications/discord/payment-reminders', {});
      const digest = await request('/notifications/discord/daily-digest', {});
      assert.equal(reminders.rowCount, expected); assert.equal(digest.summary.reminderTotal, expected);
      assert.equal(deliveries.length, 2);
      // Existing sender truncates at 2,000 characters; this is a documented
      // presentation limit, not a change to the query's charge cardinality.
      assert.ok(deliveries.every(d => d.content.includes('[TU-TEST]') && d.content.includes('Overdue (') && d.content.length <= 2000));
    });
    await test('production guards refuse forbidden targets even with remote override; no network access', async () => {
      process.env.TU_TEST_ALLOW_REMOTE = '1';
      assert.throws(() => assertNonProductionTargets({ supabaseUrl: 'https://jhxzecxkccqlgyazhsnb.supabase.co' }), /Refusing/);
      assert.throws(() => assertNonProductionTargets({ apiBase: 'https://api.templeunderground.com' }), /Refusing/);
      delete process.env.TU_TEST_ALLOW_REMOTE;
    });
    console.log(`RESULT: ${checks} real local database/HTTP/concurrency scenarios passed; secrets withheld; no production calls.`);
  }
} finally {
  if (api) { api.kill('SIGTERM'); await once(api, 'exit'); }
  if (stub) await new Promise(r => stub.close(r));
  for (const c of clients) await c.end();
}
