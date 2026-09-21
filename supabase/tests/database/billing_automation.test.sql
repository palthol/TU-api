begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into public.participants (id, full_name, date_of_birth, email)
select
  format('10000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('[BILLING TEST] Participant %s', n),
  date '1990-01-01',
  format('billing-test-%s@tu-test.invalid', n)
from generate_series(1, 12) n;

insert into public.accounts (id, status, primary_contact_name)
select
  format('20000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'active',
  format('[BILLING TEST] Account %s', n)
from generate_series(1, 12) n;

insert into public.account_members (account_id, participant_id, role)
select
  format('20000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('10000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'member'
from generate_series(1, 12) n;

insert into public.plan_definitions (
  id,
  name,
  description,
  plan_category,
  billing_cadence,
  price_cents,
  currency,
  is_active
)
values (
  '30000000-0000-4000-8000-000000000001',
  '[BILLING TEST] Free Monthly Trial',
  'Free monthly plan used to prove no monetary charge is generated.',
  'group',
  'monthly',
  0,
  'USD',
  true
);

create temp table initial_results (
  plan_name text primary key,
  account_id uuid not null,
  result jsonb not null
);

insert into initial_results (plan_name, account_id, result)
values
  (
    'Basic Group Plan',
    '20000000-0000-4000-8000-000000000001',
    public.create_subscription(
      '10000000-0000-4000-8000-000000000001',
      (select id from public.plan_definitions where name = 'Basic Group Plan'),
      date '2026-09-15',
      null,
      '20000000-0000-4000-8000-000000000001',
      true,
      'billing lifecycle test',
      'pgtap'
    )
  ),
  (
    'Core Group Plan',
    '20000000-0000-4000-8000-000000000002',
    public.create_subscription(
      '10000000-0000-4000-8000-000000000002',
      (select id from public.plan_definitions where name = 'Core Group Plan'),
      date '2026-09-15',
      null,
      '20000000-0000-4000-8000-000000000002',
      true,
      'billing lifecycle test',
      'pgtap'
    )
  ),
  (
    'Unlimited Group Plan',
    '20000000-0000-4000-8000-000000000003',
    public.create_subscription(
      '10000000-0000-4000-8000-000000000003',
      (select id from public.plan_definitions where name = 'Unlimited Group Plan'),
      date '2026-09-15',
      null,
      '20000000-0000-4000-8000-000000000003',
      true,
      'billing lifecycle test',
      'pgtap'
    )
  ),
  (
    'Basic Group Plan - disabled',
    '20000000-0000-4000-8000-000000000004',
    public.create_subscription(
      '10000000-0000-4000-8000-000000000004',
      (select id from public.plan_definitions where name = 'Basic Group Plan'),
      date '2026-09-15',
      null,
      '20000000-0000-4000-8000-000000000004',
      false,
      'billing lifecycle test',
      'pgtap'
    )
  );

select is((select count(*) from initial_results), 4::bigint, 'four subscription RPC calls return results');
select is(
  (
    select count(*)
    from initial_results r
    join public.subscriptions s on s.id = (r.result->>'subscription_id')::uuid
  ),
  4::bigint,
  'each initial-charge scenario creates its subscription'
);
select is(
  (select count(*) from initial_results where plan_name not like '%disabled' and result->>'initial_charge_id' is not null),
  3::bigint,
  'all three paid monthly plans return an initial charge id'
);
select is(
  (select result->>'initial_charge_id' from initial_results where plan_name like '%disabled'),
  null,
  'disabled initial-charge generation returns no charge id'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled'
  ),
  3::bigint,
  'paid monthly subscriptions each have exactly one charge'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c
      on c.subscription_id = (r.result->>'subscription_id')::uuid
     and c.account_id = r.account_id
    where r.plan_name not like '%disabled'
  ),
  3::bigint,
  'initial charges have the correct account and subscription ids'
);
select results_eq(
  $$
    select c.amount_cents
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled'
    order by c.amount_cents
  $$,
  array[10000, 15000, 20000],
  'Basic, Core, and Unlimited initial charges use $100, $150, and $200 amounts'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled' and c.coverage_start = date '2026-09-15'
  ),
  3::bigint,
  'initial charge coverage starts on the subscription start date'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled' and c.coverage_end = date '2026-09-30'
  ),
  3::bigint,
  'initial charge coverage ends at month end'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled' and c.due_at = date '2026-09-15'
  ),
  3::bigint,
  'initial charges are due on the coverage start date'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled' and c.status = 'open'
  ),
  3::bigint,
  'initial charges are open'
);

create temp table free_result as
select public.create_subscription(
  '10000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000001',
  date '2026-09-15',
  null,
  '20000000-0000-4000-8000-000000000005',
  true,
  'free trial',
  'pgtap'
) as result;

select is(
  (select result->>'initial_charge_id' from free_result),
  null,
  'a free monthly plan never returns a monetary initial charge'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select (result->>'subscription_id')::uuid from free_result)
  ),
  0::bigint,
  'a free monthly plan creates no charge row'
);

-- Keep initial-charge scenarios out of recurring-generator assertions.
update public.subscriptions
set status = 'paused'
where id in (
  select (result->>'subscription_id')::uuid from initial_results
  union all
  select (result->>'subscription_id')::uuid from free_result
);

insert into public.subscriptions (
  id,
  account_id,
  participant_id,
  plan_definition_id,
  status,
  starts_at,
  ends_at,
  notes
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000006',
    (select id from public.plan_definitions where name = 'Basic Group Plan'),
    'active',
    date '2026-01-15',
    null,
    'historical bootstrap baseline'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000007',
    (select id from public.plan_definitions where name = 'Basic Group Plan'),
    'cancelled',
    date '2026-01-15',
    null,
    'cancelled'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000008',
    (select id from public.plan_definitions where name = 'Basic Group Plan'),
    'paused',
    date '2026-01-15',
    null,
    'paused'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000009',
    (select id from public.plan_definitions where name = 'Basic Group Plan'),
    'expired',
    date '2026-01-15',
    null,
    'expired'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000010',
    (select id from public.plan_definitions where name = 'Basic Group Plan'),
    'active',
    date '2026-01-15',
    date '2026-06-09',
    'ended before billing date'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000011',
    (select id from public.plan_definitions where name = 'Jennifer Hill Unlimited Plan'),
    'active',
    date '2026-01-15',
    null,
    'non-monthly'
  ),
  (
    '40000000-0000-4000-8000-000000000007',
    '20000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000001',
    'active',
    date '2026-01-15',
    null,
    'free monthly'
  );

create temp table first_run as
select * from private.generate_monthly_charges_as_of(date '2026-06-10');

select is((select count(*) from first_run), 1::bigint, 'first eligible execution creates one due charge');
select is(
  (select subscription_id from first_run),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'the first run only charges the active paid monthly subscription'
);
select is(
  (select coverage_start from first_run),
  date '2026-06-10',
  'historical subscription begins at the current bootstrap baseline, not its old start date'
);
select is(
  (select coverage_end from first_run),
  date '2026-06-30',
  'historical bootstrap charge covers only the remaining current month'
);
select is(
  (
    select count(*)
    from first_run
    where amount_cents = 10000 and due_at = date '2026-06-10'
  ),
  1::bigint,
  'generated charge has the expected amount and due date'
);

create temp table second_run as
select * from private.generate_monthly_charges_as_of(date '2026-06-10');
select is((select count(*) from second_run), 0::bigint, 'second same-day execution creates nothing');

create temp table third_run as
select * from private.generate_monthly_charges_as_of(date '2026-06-10');
select is((select count(*) from third_run), 0::bigint, 'repeated same-day execution remains safe');

create temp table future_run as
select * from private.generate_monthly_charges_as_of(date '2026-07-01');
select is((select count(*) from future_run), 1::bigint, 'future billing period creates exactly one new charge');
select is(
  (
    select count(*)
    from future_run
    where coverage_start = date '2026-07-01'
      and coverage_end = date '2026-07-31'
      and due_at = date '2026-07-01'
  ),
  1::bigint,
  'future charge has the correct coverage and due dates'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = '40000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'eligible subscription has exactly one charge for each tested period'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id in (
      '40000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000007'
    )
  ),
  0::bigint,
  'cancelled, paused, expired, ended, non-monthly, and free subscriptions create no charges'
);
select throws_ok(
  $$
    insert into public.charges (
      account_id,
      subscription_id,
      amount_cents,
      coverage_start,
      coverage_end,
      due_at,
      status
    )
    values (
      '20000000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000001',
      10000,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      'open'
    )
  $$,
  '23505',
  null,
  'database invariant rejects a duplicate non-void subscription coverage period'
);

select * from finish();
rollback;
