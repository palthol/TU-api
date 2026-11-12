begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  public.ny_wall_clock_to_utc(timestamp '2026-11-01 01:30:00'),
  timestamptz '2026-11-01 05:30:00+00',
  'fall-back 01:30 uses the earlier Eastern instant'
);

select is(
  public.ny_wall_clock_to_utc(timestamp '2026-11-01 01:00:00'),
  timestamptz '2026-11-01 05:00:00+00',
  'fall-back 01:00 uses the earlier Eastern instant'
);

select ok(
  public.ny_wall_clock_to_utc(timestamp '2027-03-14 02:30:00') is null,
  'spring-forward 02:30 does not exist'
);

select ok(
  public.ny_wall_clock_to_utc(timestamp '2027-03-14 02:00:00') is null,
  'spring-forward 02:00 does not exist'
);

select is(
  public.ny_wall_clock_to_utc(timestamp '2027-03-14 01:30:00'),
  timestamptz '2027-03-14 06:30:00+00',
  '01:30 before the spring-forward is EST'
);

select is(
  public.ny_wall_clock_to_utc(timestamp '2027-03-14 03:30:00'),
  timestamptz '2027-03-14 07:30:00+00',
  '03:30 after the spring-forward is EDT'
);

select is(
  public.ny_wall_clock_to_utc(timestamp '2026-06-01 19:00:00'),
  timestamptz '2026-06-01 23:00:00+00',
  'summer 19:00 Eastern is 23:00 UTC'
);

select is(
  public.ny_wall_clock_to_utc(timestamp '2026-01-05 19:00:00'),
  timestamptz '2026-01-06 00:00:00+00',
  'winter 19:00 Eastern is 00:00 UTC the next day'
);

select is(
  public.ny_wall_clock_to_utc(timestamp '2026-06-07 02:30:00'),
  timestamptz '2026-06-07 06:30:00+00',
  '02:30 exists on a normal Eastern day'
);

select ok(
  not has_function_privilege('anon', 'public.ny_wall_clock_to_utc(timestamp)', 'execute'),
  'anonymous cannot convert wall clocks'
);
select ok(
  not has_function_privilege('authenticated', 'public.ny_wall_clock_to_utc(timestamp)', 'execute'),
  'authenticated cannot convert wall clocks'
);
select ok(
  has_function_privilege('service_role', 'public.ny_wall_clock_to_utc(timestamp)', 'execute'),
  'service_role can convert wall clocks'
);

insert into public.schedule_templates (id, name, day_of_week, start_time, duration_minutes, notes)
values
  ('a2000000-0000-4000-8000-000000000010', 'Summer Class', 1, '19:00', 60, 'monday'),
  ('a2000000-0000-4000-8000-000000000011', 'Winter Class', 1, '19:00', 60, null),
  ('a2000000-0000-4000-8000-000000000012', 'Fold Class', 7, '01:30', 60, null),
  ('a2000000-0000-4000-8000-000000000013', 'Gap Class', 7, '02:30', 45, null),
  ('a2000000-0000-4000-8000-000000000014', 'After Gap', 7, '03:30', 30, null),
  ('a2000000-0000-4000-8000-000000000015', 'Inactive', 1, '19:00', 60, null);

update public.schedule_templates
set is_active = false
where id = 'a2000000-0000-4000-8000-000000000015';

select is(
  (public.generate_sessions('2026-06-01', '2026-06-01', 'a2000000-0000-4000-8000-000000000010')->>'created_count')::integer,
  1,
  'summer template creates one session'
);

select is(
  (select starts_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000010'),
  timestamptz '2026-06-01 23:00:00+00',
  'generated summer start is 19:00 Eastern'
);

select is(
  (select ends_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000010'),
  timestamptz '2026-06-02 00:00:00+00',
  'duration is elapsed minutes from the Eastern instant'
);

select is(
  (public.generate_sessions('2026-06-01', '2026-06-01', 'a2000000-0000-4000-8000-000000000010')->>'created_count')::integer,
  0,
  'generating the same Eastern instant again creates nothing'
);

select is(
  (public.generate_sessions('2026-06-01', '2026-06-01', 'a2000000-0000-4000-8000-000000000010')->>'skipped_count')::integer,
  1,
  'the existing Eastern instant is skipped'
);

select is(
  (select count(*) from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000010'),
  1::bigint,
  'retries do not duplicate the summer session'
);

update public.sessions
set cancelled_at = clock_timestamp()
where schedule_template_id = 'a2000000-0000-4000-8000-000000000010';

select is(
  (public.generate_sessions('2026-06-01', '2026-06-01', 'a2000000-0000-4000-8000-000000000010')->>'created_count')::integer,
  0,
  'a cancelled occurrence still occupies its Eastern slot'
);

select ok(
  (select starts_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000011') is null,
  'winter session is not created until generation runs'
);

select is(
  (public.generate_sessions('2026-01-05', '2026-01-05', 'a2000000-0000-4000-8000-000000000011')->>'created_count')::integer,
  1,
  'winter template creates one session'
);

select is(
  (select starts_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000011'),
  timestamptz '2026-01-06 00:00:00+00',
  'generated winter start is 19:00 EST'
);

select is(
  (public.generate_sessions('2026-11-01', '2026-11-01', 'a2000000-0000-4000-8000-000000000012')->>'created_count')::integer,
  1,
  'fall-back occurrence is created'
);

select is(
  (select starts_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000012'),
  timestamptz '2026-11-01 05:30:00+00',
  'generated fall-back start is the earlier instant'
);

select is(
  (select ends_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000012'),
  timestamptz '2026-11-01 06:30:00+00',
  'fall-back duration is 60 elapsed minutes'
);

select is(
  (public.generate_sessions('2027-03-14', '2027-03-14', 'a2000000-0000-4000-8000-000000000013')->>'created_count')::integer,
  0,
  'spring-forward gap creates no session'
);

select is(
  (public.generate_sessions('2027-03-14', '2027-03-14', 'a2000000-0000-4000-8000-000000000013')->>'skipped_count')::integer,
  0,
  'spring-forward gap is omitted rather than counted as skipped'
);

select is(
  (select count(*) from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000013'),
  0::bigint,
  'spring-forward gap inserts no row'
);

select ok(
  (select starts_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000014') is null,
  'post-gap session is absent before generation'
);

select is(
  (public.generate_sessions('2027-03-14', '2027-03-14', 'a2000000-0000-4000-8000-000000000014')->>'created_count')::integer,
  1,
  '03:30 after spring-forward creates one session'
);

select is(
  (select starts_at from public.sessions where schedule_template_id = 'a2000000-0000-4000-8000-000000000014'),
  timestamptz '2027-03-14 07:30:00+00',
  '03:30 after spring-forward is stored as 07:30 UTC'
);

select throws_ok(
  $$select public.generate_sessions('2026-06-01', '2026-06-01', 'a2000000-0000-4000-8000-000000000015')$$,
  'P0001',
  'template_inactive',
  'inactive templates are still rejected'
);

select throws_ok(
  $$select public.generate_sessions('2026-06-01', '2026-06-01', 'a2000000-0000-4000-8000-0000000000ff')$$,
  'P0001',
  'template_not_found',
  'unknown templates are still rejected'
);

select ok(
  not has_function_privilege('anon', 'public.generate_sessions(date, date, uuid)', 'execute'),
  'anonymous cannot generate sessions'
);
select ok(
  has_function_privilege('service_role', 'public.generate_sessions(date, date, uuid)', 'execute'),
  'service_role can generate sessions'
);

insert into public.sessions (id, starts_at, ends_at, session_label)
values (
  'a2000000-0000-4000-8000-000000000099',
  timestamptz '2026-06-01 23:00:00+00',
  timestamptz '2026-06-02 00:00:00+00',
  'Cancel me'
);

select is(
  (select count(*) from public.event_ledger
    where entity_id = 'a2000000-0000-4000-8000-000000000099'
      and event_name = 'session.cancelled'),
  0::bigint,
  'inserting a session does not record a cancel event'
);

select is(
  (public.cancel_session('a2000000-0000-4000-8000-000000000099')->>'already_cancelled')::boolean,
  false,
  'first cancel is not a repeat'
);

select ok(
  (select cancelled_at is not null from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  'first cancel sets cancelled_at'
);

select is(
  (select reason_code from public.event_ledger
    where entity_id = 'a2000000-0000-4000-8000-000000000099'
      and event_name = 'session.cancelled'),
  'manual_cancellation',
  'first cancel appends one manual_cancellation event'
);

select is(
  (select count(*) from public.event_ledger
    where entity_id = 'a2000000-0000-4000-8000-000000000099'
      and event_name = 'session.cancelled'),
  1::bigint,
  'first cancel appends exactly one event'
);

create temp table a2_cancel_snapshot as
select ctid::text as row_ctid, cancelled_at, updated_at
from public.sessions
where id = 'a2000000-0000-4000-8000-000000000099';

select is(
  (public.cancel_session('a2000000-0000-4000-8000-000000000099')->>'already_cancelled')::boolean,
  true,
  'second cancel reports already cancelled'
);

select is(
  (select ctid::text from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  (select row_ctid from a2_cancel_snapshot),
  'second cancel does not rewrite the row'
);

select is(
  (select cancelled_at from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  (select cancelled_at from a2_cancel_snapshot),
  'second cancel keeps the original cancelled_at'
);

select is(
  (select updated_at from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  (select updated_at from a2_cancel_snapshot),
  'second cancel keeps the original updated_at'
);

select is(
  (select count(*) from public.event_ledger
    where entity_id = 'a2000000-0000-4000-8000-000000000099'
      and event_name = 'session.cancelled'),
  1::bigint,
  'second cancel does not append an event'
);

update public.sessions
set cancelled_at = clock_timestamp()
where id = 'a2000000-0000-4000-8000-000000000099';

select is(
  (select ctid::text from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  (select row_ctid from a2_cancel_snapshot),
  'direct re-cancel is a no-op'
);

update public.sessions
set notes = 'edited', cancelled_at = clock_timestamp()
where id = 'a2000000-0000-4000-8000-000000000099';

select is(
  (select notes from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  'edited',
  'other edits still apply to a cancelled session'
);

select is(
  (select cancelled_at from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  (select cancelled_at from a2_cancel_snapshot),
  'an edit does not move cancelled_at'
);

select is(
  (select count(*) from public.event_ledger
    where entity_id = 'a2000000-0000-4000-8000-000000000099'
      and event_name = 'session.cancelled'),
  1::bigint,
  'an edit does not append a cancel event'
);

update public.sessions
set cancelled_at = null
where id = 'a2000000-0000-4000-8000-000000000099';

select ok(
  (select cancelled_at is null from public.sessions where id = 'a2000000-0000-4000-8000-000000000099'),
  'clearing cancelled_at still uncancels'
);

select is(
  (select count(*) from public.event_ledger
    where entity_id = 'a2000000-0000-4000-8000-000000000099'
      and event_name = 'session.cancelled'),
  1::bigint,
  'uncancel does not append session.cancelled'
);

select is(
  (public.cancel_session('a2000000-0000-4000-8000-000000000099')->>'already_cancelled')::boolean,
  false,
  'cancel after uncancel is a new cancellation'
);

select is(
  (select count(*) from public.event_ledger
    where entity_id = 'a2000000-0000-4000-8000-000000000099'
      and event_name = 'session.cancelled'),
  2::bigint,
  'a later cancel appends one new event'
);

select throws_ok(
  $$select public.cancel_session('a2000000-0000-4000-8000-0000000000ee')$$,
  'P0001',
  'session_not_found',
  'missing session raises session_not_found'
);

select throws_ok(
  $$select public.cancel_session(null)$$,
  'P0001',
  'session_not_found',
  'null session id raises session_not_found'
);

select ok(
  not has_function_privilege('anon', 'public.cancel_session(uuid)', 'execute'),
  'anonymous cannot cancel sessions'
);
select ok(
  not has_function_privilege('authenticated', 'public.cancel_session(uuid)', 'execute'),
  'authenticated cannot cancel sessions'
);
select ok(
  has_function_privilege('service_role', 'public.cancel_session(uuid)', 'execute'),
  'service_role can cancel sessions'
);

select * from finish();
rollback;
