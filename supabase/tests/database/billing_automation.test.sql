begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(50);

insert into public.participants (id, full_name, date_of_birth, email)
select
  format('10000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('[BILLING TEST] Participant %s', n),
  date '1990-01-01',
  format('billing-test-%s@tu-test.invalid', n)
from generate_series(1, 13) n;

insert into public.accounts (id, status, primary_contact_name)
select
  format('20000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'active',
  format('[BILLING TEST] Account %s', n)
from generate_series(1, 13) n;

insert into public.account_members (account_id, participant_id, role)
select
  format('20000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('10000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'member'
from generate_series(1, 13) n;

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
      current_date,
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
      current_date,
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
      current_date,
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
      current_date,
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
  (select (result->>'automatic_billing_starts_at')::date from initial_results where plan_name like '%disabled'),
  (date_trunc('month', current_date::timestamp) + interval '1 month')::date,
  'disabled initial-charge generation persists the next-period automation baseline'
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
    where r.plan_name not like '%disabled' and c.coverage_start = current_date
  ),
  3::bigint,
  'initial charge coverage starts on the subscription start date'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled'
      and c.coverage_end = (
        date_trunc('month', current_date::timestamp) + interval '1 month' - interval '1 day'
      )::date
  ),
  3::bigint,
  'initial charge coverage ends at month end'
);
select is(
  (
    select count(*)
    from initial_results r
    join public.charges c on c.subscription_id = (r.result->>'subscription_id')::uuid
    where r.plan_name not like '%disabled' and c.due_at = current_date
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
  current_date,
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
select is(
  (select result->>'automatic_billing_starts_at' from free_result),
  null,
  'a free monthly plan leaves automatic monetary billing disabled'
);

-- Paid plans with an initial charge and the free plan are not part of the
-- explicit-false regression below. Leave the opted-out subscription active.
update public.subscriptions
set status = 'paused'
where id in (
  select (result->>'subscription_id')::uuid
  from initial_results
  where plan_name not like '%disabled'
  union all
  select (result->>'subscription_id')::uuid from free_result
);

create temp table opted_out_same_period as
select * from private.generate_monthly_charges_as_of(current_date);
select is(
  (select count(*) from opted_out_same_period),
  0::bigint,
  'create_initial_charge false remains uncharged during the current period'
);

create temp table opted_out_next_period as
select *
from private.generate_monthly_charges_as_of(
  (date_trunc('month', current_date::timestamp) + interval '1 month')::date
);
select is(
  (select count(*) from opted_out_next_period),
  1::bigint,
  'create_initial_charge false generates exactly one charge in the next period'
);
select is(
  (
    select coverage_start
    from opted_out_next_period
  ),
  (date_trunc('month', current_date::timestamp) + interval '1 month')::date,
  'opted-out subscription first recurring charge starts at its persisted baseline'
);

update public.subscriptions
set status = 'paused'
where id = (
  select (result->>'subscription_id')::uuid
  from initial_results
  where plan_name like '%disabled'
);

insert into public.subscriptions (
  id,
  account_id,
  participant_id,
  plan_definition_id,
  status,
  starts_at,
  ends_at,
  automatic_billing_starts_at,
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
    date '2026-01-15',
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
    date '2026-01-15',
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
    date '2026-01-15',
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
    date '2026-01-15',
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
    date '2026-01-15',
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
    date '2026-01-15',
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
    date '2026-01-15',
    'free monthly'
  ),
  (
    '40000000-0000-4000-8000-000000000008',
    '20000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000013',
    (select id from public.plan_definitions where name = 'Basic Group Plan'),
    'active',
    date '2026-01-15',
    null,
    null,
    'existing subscription without an operator-approved automation baseline'
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
      '40000000-0000-4000-8000-000000000007',
      '40000000-0000-4000-8000-000000000008'
    )
  ),
  0::bigint,
  'cancelled, paused, expired, ended, non-monthly, free, and unanchored subscriptions create no charges'
);
select is(
  (
    select charge_kind
    from public.charges
    where subscription_id = '40000000-0000-4000-8000-000000000001'
      and coverage_start = date '2026-07-01'
  ),
  'monthly_period',
  'generated recurring charges are classified as monthly period charges'
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
      status,
      charge_kind
    )
    values (
      '20000000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000001',
      10000,
      date '2026-07-01',
      date '2026-07-31',
      date '2026-07-01',
      'open',
      'monthly_period'
    )
  $$,
  '23505',
  null,
  'database invariant rejects a duplicate non-void monthly period'
);
select lives_ok(
  $$
    insert into public.charges (
      account_id,
      subscription_id,
      amount_cents,
      coverage_start,
      coverage_end,
      due_at,
      status,
      charge_kind
    )
    values (
      '20000000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000001',
      2500,
      date '2026-07-01',
      date '2026-07-01',
      date '2026-07-01',
      'open',
      'per_class'
    )
  $$,
  'a per-class charge may share a coverage start with a monthly period charge'
);

insert into public.participants (id, full_name, date_of_birth, email)
select
  format('10000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('[BILLING TEST] Participant %s', n),
  date '1990-01-01',
  format('billing-test-%s@tu-test.invalid', n)
from generate_series(14, 17) n;

insert into public.accounts (id, status, primary_contact_name)
select
  format('20000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'active',
  format('[BILLING TEST] Account %s', n)
from generate_series(14, 17) n;

insert into public.account_members (account_id, participant_id, role)
select
  format('20000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('10000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'member'
from generate_series(14, 17) n;

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
  '30000000-0000-4000-8000-000000000002',
  '[BILLING TEST] Drop-in Class',
  'Per-session plan used to prove same-day attendance charges are allowed.',
  'group',
  'per_session',
  2500,
  'USD',
  true
);

select public.create_subscription(
  '10000000-0000-4000-8000-000000000014',
  '30000000-0000-4000-8000-000000000002',
  current_date,
  null,
  '20000000-0000-4000-8000-000000000014',
  false,
  'drop-in enrollment',
  'pgtap'
);

insert into public.sessions (id, starts_at, ends_at, session_label)
values
  (
    '50000000-0000-4000-8000-000000000001',
    current_date + time '09:00',
    current_date + time '10:00',
    'morning drop-in'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    current_date + time '18:00',
    current_date + time '19:00',
    'evening drop-in'
  );

insert into public.attendance_records (id, session_id, participant_id, status, recorded_by)
values
  (
    '60000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000014',
    'present',
    'pgtap'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000014',
    'present',
    'pgtap'
  );

select public.create_pay_per_class_charge(
  '60000000-0000-4000-8000-000000000001',
  null,
  null,
  'pgtap'
);
select public.create_pay_per_class_charge(
  '60000000-0000-4000-8000-000000000002',
  null,
  null,
  'pgtap'
);

select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (
      select id
      from public.subscriptions
      where participant_id = '10000000-0000-4000-8000-000000000014'
        and status = 'active'
    )
      and charge_kind = 'per_class'
  ),
  2::bigint,
  'two same-day per-class attendance charges are both stored'
);
select is(
  (
    select count(distinct coverage_start)
    from public.charges
    where subscription_id = (
      select id
      from public.subscriptions
      where participant_id = '10000000-0000-4000-8000-000000000014'
        and status = 'active'
    )
      and charge_kind = 'per_class'
  ),
  1::bigint,
  'same-day per-class charges share one coverage start'
);

update public.subscriptions
set status = 'paused'
where status = 'active';

select public.create_subscription(
  '10000000-0000-4000-8000-000000000015',
  '30000000-0000-4000-8000-000000000002',
  current_date,
  null,
  '20000000-0000-4000-8000-000000000015',
  false,
  'convert with initial charge',
  'pgtap'
);
select public.create_subscription(
  '10000000-0000-4000-8000-000000000016',
  '30000000-0000-4000-8000-000000000002',
  current_date,
  null,
  '20000000-0000-4000-8000-000000000016',
  false,
  'convert without initial charge',
  'pgtap'
);

create temp table conversion_with_charge as
select *
from public.upgrade_per_class_to_monthly(
  '10000000-0000-4000-8000-000000000015',
  (select id from public.plan_definitions where name = 'Basic Group Plan'),
  current_date,
  true,
  'billing follow-up',
  'no_credit'
);

create temp table conversion_without_charge as
select *
from public.upgrade_per_class_to_monthly(
  '10000000-0000-4000-8000-000000000016',
  (select id from public.plan_definitions where name = 'Basic Group Plan'),
  current_date,
  false,
  'billing follow-up',
  'no_credit'
);

select is(
  (
    select count(*)
    from public.subscriptions
    where id in (
      (select new_subscription_id from conversion_with_charge),
      (select new_subscription_id from conversion_without_charge)
    )
      and automatic_billing_starts_at = (
        date_trunc('month', current_date::timestamp) + interval '1 month'
      )::date
  ),
  2::bigint,
  'paid per-class conversions persist the next-period billing anchor'
);
select is(
  (select initial_charge_id is not null from conversion_with_charge),
  true,
  'conversion with an initial charge returns that charge id'
);
select is(
  (select initial_charge_id is null from conversion_without_charge),
  true,
  'conversion can skip the current-period charge'
);
select is(
  (
    select charge_kind
    from public.charges
    where id = (select initial_charge_id from conversion_with_charge)
  ),
  'monthly_period',
  'conversion initial charge is a monthly period charge'
);

create temp table conversion_same_period as
select *
from private.generate_monthly_charges_as_of(current_date);
select is(
  (select count(*) from conversion_same_period),
  0::bigint,
  'converted subscriptions are not charged again during the current period'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select new_subscription_id from conversion_with_charge)
  ),
  1::bigint,
  'conversion initial charge is not duplicated by the same-period generator'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select new_subscription_id from conversion_without_charge)
  ),
  0::bigint,
  'skipped conversion charge stays unbilled during the current period'
);

create temp table conversion_next_period as
select *
from private.generate_monthly_charges_as_of(
  (date_trunc('month', current_date::timestamp) + interval '1 month')::date
);
select is(
  (select count(*) from conversion_next_period),
  2::bigint,
  'each converted subscription receives one charge in the next period'
);
select is(
  (
    select count(*)
    from conversion_next_period
    where coverage_start = (
      date_trunc('month', current_date::timestamp) + interval '1 month'
    )::date
  ),
  2::bigint,
  'converted recurring charges start at the persisted anchor'
);

create temp table conversion_next_period_repeat as
select *
from private.generate_monthly_charges_as_of(
  (date_trunc('month', current_date::timestamp) + interval '1 month')::date
);
select is(
  (select count(*) from conversion_next_period_repeat),
  0::bigint,
  'converted subscriptions do not receive a second charge for that period'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select new_subscription_id from conversion_with_charge)
  ),
  2::bigint,
  'converted subscription with an initial charge gains exactly one later recurring charge'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select new_subscription_id from conversion_without_charge)
  ),
  1::bigint,
  'converted subscription without an initial charge gains exactly one recurring charge'
);

update public.subscriptions
set status = 'paused'
where status = 'active';

create temp table proration_subscription as
select public.create_subscription(
  '10000000-0000-4000-8000-000000000017',
  (select id from public.plan_definitions where name = 'Basic Group Plan'),
  current_date,
  null,
  '20000000-0000-4000-8000-000000000017',
  true,
  'proration coexistence',
  'pgtap'
) as result;

select lives_ok(
  'select public.upgrade_subscription_prorated('
    || quote_literal((select result->>'subscription_id' from proration_subscription))
    || ', '
    || quote_literal((select id::text from public.plan_definitions where name = 'Core Group Plan'))
    || ', current_date)',
  'prorated upgrade on the existing monthly coverage start is allowed'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select (result->>'subscription_id')::uuid from proration_subscription)
  ),
  2::bigint,
  'prorated upgrade adds a second charge on the current coverage start'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select (result->>'subscription_id')::uuid from proration_subscription)
      and charge_kind = 'monthly_period'
  ),
  1::bigint,
  'the original monthly charge remains beside the proration'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select (result->>'subscription_id')::uuid from proration_subscription)
      and charge_kind = 'proration'
      and coverage_start = current_date
  ),
  1::bigint,
  'the prorated delta is stored as its own charge kind'
);

select * from finish();
rollback;
