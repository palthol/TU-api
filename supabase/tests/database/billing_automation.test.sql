begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

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

-- The obligation generator must ignore legacy enrollment automation flags.
select is((select count(*) from private.generate_monthly_charges_as_of(current_date)),
  0::bigint, 'legacy subscriptions without obligations create no recurring charges');
select is((select count(*) from private.generate_monthly_charges_as_of((current_date + interval '1 month')::date)),
  0::bigint, 'legacy subscriptions remain unbilled next month without obligations');
select throws_ok(
  $$ insert into public.charges(account_id,subscription_id,amount_cents,coverage_start,coverage_end,due_at,charge_kind)
     select account_id,subscription_id,amount_cents,coverage_start,coverage_end,due_at,charge_kind
     from public.charges where account_id = '20000000-0000-4000-8000-000000000001' $$,
  '23505', null, 'legacy subscription monthly-period uniqueness is preserved');
select lives_ok(
  $$ insert into public.charges(account_id,subscription_id,amount_cents,coverage_start,coverage_end,due_at,charge_kind)
     select account_id,subscription_id,100,coverage_start,coverage_end,due_at,'manual'
     from public.charges where account_id = '20000000-0000-4000-8000-000000000001' $$,
  'manual charges remain outside legacy monthly-period uniqueness');

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
  0::bigint,
  'converted subscriptions require explicit obligations for future recurring charges'
);
select is(
  (
    select count(*)
    from conversion_next_period
    where coverage_start = (
      date_trunc('month', current_date::timestamp) + interval '1 month'
    )::date
  ),
  0::bigint,
  'legacy conversion anchors alone do not authorize recurring charges'
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
  1::bigint,
  'conversion retains its one-off initial charge only'
);
select is(
  (
    select count(*)
    from public.charges
    where subscription_id = (select new_subscription_id from conversion_without_charge)
  ),
  0::bigint,
  'conversion without an initial charge remains unbilled without an obligation'
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
