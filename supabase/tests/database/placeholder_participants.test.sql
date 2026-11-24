begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_column('public', 'participants', 'is_placeholder', 'is_placeholder exists');
select has_column('public', 'participants', 'placeholder_reason', 'placeholder_reason exists');
select has_column('public', 'participants', 'dob_is_placeholder', 'dob_is_placeholder exists');
select has_column('public', 'participants', 'dob_placeholder_reason', 'dob_placeholder_reason exists');
select col_not_null('public', 'participants', 'is_placeholder', 'is_placeholder is required');
select col_not_null('public', 'participants', 'dob_is_placeholder', 'dob_is_placeholder is required');
select col_is_null('public', 'participants', 'email', 'email may be omitted for placeholders');
select col_is_null('public', 'participants', 'placeholder_reason', 'placeholder_reason is null for real members');
select is(
  public.placeholder_date_of_birth(),
  date '1900-01-01',
  'unknown DOB stand-in is 1900-01-01'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.participants'::regclass),
  'participants still has RLS enabled'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_placeholder_participant(text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text)',
    'execute'
  ),
  'anonymous cannot create placeholders'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_placeholder_participant(text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text)',
    'execute'
  ),
  'authenticated cannot create placeholders'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_placeholder_participant(text, text, text, text, text, date, boolean, text, uuid, text, uuid, date, text)',
    'execute'
  ),
  'service_role can create placeholders'
);
select ok(
  not has_function_privilege('anon', 'public.placeholder_date_of_birth()', 'execute'),
  'anonymous cannot read the DOB sentinel helper'
);
select ok(
  has_function_privilege('service_role', 'public.placeholder_date_of_birth()', 'execute'),
  'service_role can read the DOB sentinel helper'
);

select throws_ok(
  $$insert into public.participants (full_name, date_of_birth, email, is_placeholder, placeholder_reason)
    values ('Casey Placeholder', '1990-01-01', 'casey-placeholder@tu-test.invalid', true, null)$$,
  '23514',
  NULL,
  'placeholder requires a trimmed reason'
);

select throws_ok(
  $$insert into public.participants (full_name, date_of_birth, email, is_placeholder, placeholder_reason)
    values ('Casey Placeholder', '1990-01-01', 'casey-placeholder@tu-test.invalid', true, '   ')$$,
  '23514',
  NULL,
  'placeholder reason cannot be blank'
);

select throws_ok(
  $$insert into public.participants (
      full_name, date_of_birth, email, is_placeholder, placeholder_reason,
      dob_is_placeholder, dob_placeholder_reason
    ) values (
      'Casey Placeholder', '1900-01-01', null, false, null, true, null
    )$$,
  '23514',
  NULL,
  'stand-in DOB requires a reason'
);

select lives_ok(
  $$insert into public.participants (
      full_name, date_of_birth, email, is_placeholder, placeholder_reason
    ) values (
      'Riley Realmember', '1991-04-04', 'riley-realmember@tu-test.invalid', false, null
    )$$,
  'non-placeholder insert still works with email'
);

insert into public.plan_definitions (
  id, name, plan_category, billing_cadence, price_cents, currency, is_active
) values (
  'a1000000-0000-4000-8000-000000000001',
  '[PLACEHOLDER TEST] Monthly',
  'group',
  'monthly',
  10000,
  'USD',
  true
), (
  'a1000000-0000-4000-8000-000000000002',
  '[PLACEHOLDER TEST] Inactive',
  'group',
  'monthly',
  10000,
  'USD',
  false
);

insert into public.accounts (id, status, primary_contact_name)
values ('a2000000-0000-4000-8000-000000000001', 'active', 'Jordan Faketest Household');

select is(
  (
    public.create_placeholder_participant(
      'Casey',
      'Placeholder',
      'name only; no waiver yet',
      null,
      null,
      null,
      true,
      'DOB unknown at desk',
      null,
      'Casey Placeholder household',
      'a1000000-0000-4000-8000-000000000001',
      date '2026-11-01',
      'staff:test'
    )->>'account_id'
  ) is not null,
  true,
  'RPC creates account + optional enrollment'
);

select is(
  (select count(*)::integer from public.participants where full_name = 'Casey Placeholder' and is_placeholder),
  1,
  'one placeholder row for Casey Placeholder'
);

select is(
  (select email from public.participants where full_name = 'Casey Placeholder'),
  null,
  'placeholder email may be null'
);

select is(
  (select date_of_birth from public.participants where full_name = 'Casey Placeholder'),
  date '1900-01-01',
  'omitted DOB stores the documented stand-in'
);

select is(
  (select count(*)::integer from public.charges),
  0,
  'enrollment does not create an initial charge'
);

select is(
  (
    select s.status
    from public.subscriptions s
    join public.participants p on p.id = s.participant_id
    where p.full_name = 'Casey Placeholder'
  ),
  'active',
  'optional plan enrolls as active'
);

select throws_ok(
  $$select public.create_placeholder_participant(
      'Casey', 'Placeholder', 'duplicate check',
      null, null, date '1990-01-01', false, null,
      null, null, null, null, 'staff:test'
    )$$,
  'P0001',
  'duplicate_name',
  'exact name match is rejected'
);

select throws_ok(
  $$select public.create_placeholder_participant(
      'A', 'X', 'too short',
      null, null, date '1990-01-01', false, null,
      null, null, null, null, null
    )$$,
  'P0001',
  'invalid_first_name',
  'first name must be at least 2 characters'
);

select throws_ok(
  $$select public.create_placeholder_participant(
      'Avery', 'Norecord', 'needs a plan that does not exist',
      null, null, date '1992-02-02', false, null,
      null, null, 'a1000000-0000-4000-8000-000000000002', date '2026-11-01', 'staff:test'
    )$$,
  'P0001',
  NULL,
  'inactive plan rolls back the whole create'
);

select is(
  (select count(*)::integer from public.participants where full_name = 'Avery Norecord'),
  0,
  'failed enroll does not leave a participant'
);

select is(
  (select count(*)::integer from public.accounts where primary_contact_name = 'Avery Norecord'),
  0,
  'failed enroll does not leave an account'
);

select lives_ok(
  $$select public.create_placeholder_participant(
      'Jordan',
      'Faketest',
      'existing household',
      'jordan-faketest@tu-test.invalid',
      '555-0100',
      date '1993-03-03',
      false,
      null,
      'a2000000-0000-4000-8000-000000000001',
      null,
      null,
      null,
      'staff:test'
    )$$,
  'existing account_id is reused'
);

select is(
  (
    select count(*)::integer
    from public.account_members am
    join public.participants p on p.id = am.participant_id
    where p.full_name = 'Jordan Faketest'
      and am.account_id = 'a2000000-0000-4000-8000-000000000001'
  ),
  1,
  'membership links the placeholder to the supplied account'
);

insert into public.classes (
  id, name, instructor, day_of_week, start_time, duration_minutes, capacity
) values (
  'a3000000-0000-4000-8000-000000000001',
  'Placeholder Class',
  'Coach Test',
  1,
  '19:00',
  90,
  8
);

insert into public.sessions (
  id, starts_at, ends_at, session_label, class_id
) values (
  'a4000000-0000-4000-8000-000000000001',
  '2026-12-01 23:00:00+00',
  '2026-12-02 00:30:00+00',
  'Placeholder Class',
  'a3000000-0000-4000-8000-000000000001'
);

select is(
  public.book_session(
    'a4000000-0000-4000-8000-000000000001',
    (select id from public.participants where full_name = 'Casey Placeholder'),
    'staff:test',
    timestamptz '2026-11-01 12:00:00+00'
  )->>'status',
  'booked',
  'placeholder without a waiver can book'
);

select is(
  public.check_in_booking(
    (
      select id from public.bookings
      where participant_id = (select id from public.participants where full_name = 'Casey Placeholder')
    ),
    'staff:test',
    timestamptz '2026-12-01 23:05:00+00'
  )->>'status',
  'attended',
  'placeholder without a waiver can check in'
);

select is(
  (select count(*)::integer from public.waivers
    where participant_id = (select id from public.participants where full_name = 'Casey Placeholder')),
  0,
  'booking did not require a waiver row'
);

select * from finish();
rollback;
