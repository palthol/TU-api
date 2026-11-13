begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'bookings', 'bookings table exists');
select has_column('public', 'sessions', 'capacity', 'sessions.capacity exists');
select col_is_null('public', 'sessions', 'capacity', 'sessions.capacity may be omitted');
select col_not_null('public', 'bookings', 'session_id', 'session_id is required');
select col_not_null('public', 'bookings', 'participant_id', 'participant_id is required');
select col_not_null('public', 'bookings', 'status', 'status is required');
select col_not_null('public', 'bookings', 'created_at', 'created_at is required');
select col_not_null('public', 'bookings', 'updated_at', 'updated_at is required');
select col_is_null('public', 'bookings', 'cancelled_at', 'cancelled_at may be omitted');
select col_is_null('public', 'bookings', 'checked_in_at', 'checked_in_at may be omitted');
select col_is_null('public', 'bookings', 'no_show_at', 'no_show_at may be omitted');
select col_is_null('public', 'bookings', 'promoted_at', 'promoted_at may be omitted');
select fk_ok(
  'public', 'bookings', 'session_id',
  'public', 'sessions', 'id',
  'bookings.session_id references sessions.id'
);
select fk_ok(
  'public', 'bookings', 'participant_id',
  'public', 'participants', 'id',
  'bookings.participant_id references participants.id'
);
select has_index(
  'public',
  'bookings',
  'bookings_one_active_per_participant_session',
  'one active booking per participant per session'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bookings'::regclass),
  'bookings has RLS enabled'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bookings'
      and policyname = 'admin_all_bookings'
      and roles = array['authenticated']::name[]
  ),
  'admin policy targets authenticated and does not open anon'
);
select ok(not has_table_privilege('anon', 'public.bookings', 'SELECT'), 'anonymous cannot read bookings');
select ok(not has_table_privilege('anon', 'public.bookings', 'INSERT'), 'anonymous cannot insert bookings');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'SELECT'), 'authenticated cannot read bookings without GRANT');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'INSERT'), 'authenticated cannot insert bookings without GRANT');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'UPDATE'), 'authenticated cannot update bookings without GRANT');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'DELETE'), 'authenticated cannot delete bookings without GRANT');
select ok(has_table_privilege('service_role', 'public.bookings', 'SELECT'), 'service_role can read bookings');
select ok(has_table_privilege('service_role', 'public.bookings', 'INSERT'), 'service_role can insert bookings');
select ok(has_table_privilege('service_role', 'public.bookings', 'UPDATE'), 'service_role can update bookings');
select ok(has_table_privilege('service_role', 'public.bookings', 'DELETE'), 'service_role can delete bookings');

select ok(
  not has_function_privilege('anon', 'public.book_session(uuid, uuid, text, timestamptz)', 'execute'),
  'anonymous cannot book sessions'
);
select ok(
  not has_function_privilege('authenticated', 'public.book_session(uuid, uuid, text, timestamptz)', 'execute'),
  'authenticated cannot book sessions'
);
select ok(
  has_function_privilege('service_role', 'public.book_session(uuid, uuid, text, timestamptz)', 'execute'),
  'service_role can book sessions'
);
select ok(
  not has_function_privilege('anon', 'public.cancel_booking(uuid, text, timestamptz)', 'execute'),
  'anonymous cannot cancel bookings'
);
select ok(
  not has_function_privilege('authenticated', 'public.cancel_booking(uuid, text, timestamptz)', 'execute'),
  'authenticated cannot cancel bookings'
);
select ok(
  has_function_privilege('service_role', 'public.cancel_booking(uuid, text, timestamptz)', 'execute'),
  'service_role can cancel bookings'
);
select ok(
  not has_function_privilege('anon', 'public.check_in_booking(uuid, text, timestamptz)', 'execute'),
  'anonymous cannot check in'
);
select ok(
  has_function_privilege('service_role', 'public.check_in_booking(uuid, text, timestamptz)', 'execute'),
  'service_role can check in'
);
select ok(
  not has_function_privilege('anon', 'public.mark_booking_no_show(uuid, text, timestamptz)', 'execute'),
  'anonymous cannot mark no-show'
);
select ok(
  has_function_privilege('service_role', 'public.mark_booking_no_show(uuid, text, timestamptz)', 'execute'),
  'service_role can mark no-show'
);

insert into public.classes (
  id, name, instructor, day_of_week, start_time, duration_minutes, capacity
) values (
  'b1000000-0000-4000-8000-000000000001',
  'Class 1',
  'Alex',
  1,
  '19:00',
  90,
  2
);

insert into public.sessions (
  id, starts_at, ends_at, session_label, class_id
) values (
  'b2000000-0000-4000-8000-000000000001',
  '2026-06-01 23:00:00+00',
  '2026-06-02 00:30:00+00',
  'Class 1',
  'b1000000-0000-4000-8000-000000000001'
);

-- Fall-back adjacent: 2026-11-01 02:30 EST = 07:30 UTC. Naive wall-clock
-- 02:30 minus 3 hours is 23:30 EDT (03:30 UTC), which is the wrong cutoff.
insert into public.sessions (
  id, starts_at, ends_at, session_label, class_id
) values (
  'b2000000-0000-4000-8000-0000000000d1',
  '2026-11-01 07:30:00+00',
  '2026-11-01 09:00:00+00',
  'Class 1',
  'b1000000-0000-4000-8000-000000000001'
);

insert into public.sessions (
  id, starts_at, ends_at, session_label, capacity
) values (
  'b2000000-0000-4000-8000-0000000000c0',
  '2026-06-08 23:00:00+00',
  '2026-06-09 00:30:00+00',
  'No class cap',
  1
);

insert into public.sessions (
  id, starts_at, ends_at, session_label
) values (
  'b2000000-0000-4000-8000-0000000000c1',
  '2026-06-15 23:00:00+00',
  '2026-06-16 00:30:00+00',
  'No capacity'
);

insert into public.participants (id, full_name, date_of_birth, email)
values
  ('b3000000-0000-4000-8000-000000000001', 'Pat One', '1990-01-01', 'pat1@example.com'),
  ('b3000000-0000-4000-8000-000000000002', 'Pat Two', '1991-01-01', 'pat2@example.com'),
  ('b3000000-0000-4000-8000-000000000003', 'Pat Three', '1992-01-01', 'pat3@example.com'),
  ('b3000000-0000-4000-8000-000000000004', 'Pat Four', '1993-01-01', 'pat4@example.com'),
  ('b3000000-0000-4000-8000-000000000005', 'Pat Five', '1994-01-01', 'pat5@example.com'),
  ('b3000000-0000-4000-8000-0000000000d1', 'Dst One', '1990-01-01', 'dst1@example.com'),
  ('b3000000-0000-4000-8000-0000000000d2', 'Dst Two', '1990-01-01', 'dst2@example.com');

select is(
  public.book_session(
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'staff:test',
    timestamptz '2026-05-01 12:00:00+00'
  )->>'status',
  'booked',
  'first booking takes a seat from class capacity'
);

select is(
  public.book_session(
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    null,
    timestamptz '2026-05-01 12:00:01+00'
  )->>'status',
  'booked',
  'second booking fills class capacity of 2'
);

select is(
  public.book_session(
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000003',
    null,
    timestamptz '2026-05-01 12:00:02+00'
  )->>'status',
  'waitlisted',
  'third booking is waitlisted in FIFO order'
);

select is(
  public.book_session(
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000004',
    null,
    timestamptz '2026-05-01 12:00:03+00'
  )->>'status',
  'waitlisted',
  'fourth booking stays behind on the waitlist'
);

select throws_ok(
  $$select public.book_session(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      null,
      timestamptz '2026-05-01 12:00:04+00'
    )$$,
  'P0001',
  'already_booked',
  'duplicate active booking is rejected'
);

select throws_ok(
  $$insert into public.bookings (session_id, participant_id, status)
    values (
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000002',
      'waitlisted'
    )$$,
  '23505',
  NULL,
  'unique index blocks a second active row for the same participant'
);

select throws_ok(
  $$insert into public.bookings (session_id, participant_id, status)
    values (
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000005',
      'maybe'
    )$$,
  '23514',
  NULL,
  'status must be a known booking status'
);

select throws_ok(
  $$select public.book_session(
      'b2000000-0000-4000-8000-0000000000ee',
      'b3000000-0000-4000-8000-000000000005'
    )$$,
  'P0001',
  'session_not_found',
  'missing session raises session_not_found'
);

select throws_ok(
  $$select public.book_session(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-0000000000ee'
    )$$,
  'P0001',
  'participant_not_found',
  'missing participant raises participant_not_found'
);

select throws_ok(
  $$select public.book_session(
      'b2000000-0000-4000-8000-0000000000c1',
      'b3000000-0000-4000-8000-000000000005'
    )$$,
  'P0001',
  'capacity_not_configured',
  'a session with no capacity and no class is rejected'
);

select is(
  public.book_session(
    'b2000000-0000-4000-8000-0000000000c0',
    'b3000000-0000-4000-8000-000000000005',
    null,
    timestamptz '2026-05-01 12:00:00+00'
  )->>'status',
  'booked',
  'session.capacity is used when there is no class'
);

-- Promote the first waitlisted row (pat three) when a booked seat is cancelled.
create temp table b_cancel_a as
select public.cancel_booking(
  (select id from public.bookings
    where session_id = 'b2000000-0000-4000-8000-000000000001'
      and participant_id = 'b3000000-0000-4000-8000-000000000001'),
  'staff:test',
  timestamptz '2026-05-01 12:05:00+00'
) as payload;

select is(
  (select payload->'booking'->>'status' from b_cancel_a),
  'cancelled',
  'cancel more than 3 hours before start is cancelled'
);

select is(
  (select payload->'promoted'->>'participant_id' from b_cancel_a),
  'b3000000-0000-4000-8000-000000000003',
  'oldest waitlisted booking is promoted'
);

select is(
  (select payload->'promoted'->>'status' from b_cancel_a),
  'booked',
  'promoted waitlist row becomes booked'
);

select is(
  (select status from public.bookings
    where session_id = 'b2000000-0000-4000-8000-000000000001'
      and participant_id = 'b3000000-0000-4000-8000-000000000004'),
  'waitlisted',
  'later waitlisted row is not promoted'
);

select is(
  (select payload->'booking'->>'status' from b_cancel_a),
  (select (public.cancel_booking(
    (select id from public.bookings
      where session_id = 'b2000000-0000-4000-8000-000000000001'
        and participant_id = 'b3000000-0000-4000-8000-000000000001'),
    null,
    timestamptz '2026-05-01 12:06:00+00'
  )->'booking'->>'status')),
  'repeat cancel is a no-op and does not promote again'
);

select is(
  (select count(*) from public.bookings
    where session_id = 'b2000000-0000-4000-8000-000000000001'
      and status = 'booked'),
  2::bigint,
  'repeat cancel leaves occupancy unchanged'
);

-- Waitlist cancel does not promote the remaining waitlist.
select is(
  (select public.cancel_booking(
    (select id from public.bookings
      where session_id = 'b2000000-0000-4000-8000-000000000001'
        and participant_id = 'b3000000-0000-4000-8000-000000000004'),
    null,
    timestamptz '2026-05-01 12:07:00+00'
  )->'promoted'),
  'null'::jsonb,
  'cancelling a waitlisted row does not promote'
);

select is(
  public.book_session(
    'b2000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    null,
    timestamptz '2026-05-01 12:08:00+00'
  )->>'status',
  'waitlisted',
  'a cancelled participant may rebook and goes to the waitlist when full'
);

select throws_ok(
  $$select public.check_in_booking(
      (select id from public.bookings
        where session_id = 'b2000000-0000-4000-8000-000000000001'
          and participant_id = 'b3000000-0000-4000-8000-000000000001'
          and status = 'waitlisted')
    )$$,
  'P0001',
  'not_booked',
  'waitlisted rows cannot check in'
);

-- Late-cancel boundary: session starts 2026-06-01 23:00 UTC, cutoff 20:00 UTC.
select is(
  (select public.cancel_booking(
    (select id from public.bookings
      where session_id = 'b2000000-0000-4000-8000-000000000001'
        and participant_id = 'b3000000-0000-4000-8000-000000000002'),
    null,
    timestamptz '2026-06-01 20:00:00+00'
  )->'booking'->>'status'),
  'late_cancelled',
  'cancel at exactly 3 elapsed hours before start is late_cancelled'
);

-- DST-adjacent 3h boundary on the fall-back 02:30 EST session.
select is(
  public.book_session(
    'b2000000-0000-4000-8000-0000000000d1',
    'b3000000-0000-4000-8000-0000000000d1',
    null,
    timestamptz '2026-10-01 12:00:00+00'
  )->>'status',
  'booked',
  'dst session first booking is booked'
);

select is(
  public.book_session(
    'b2000000-0000-4000-8000-0000000000d1',
    'b3000000-0000-4000-8000-0000000000d2',
    null,
    timestamptz '2026-10-01 12:00:01+00'
  )->>'status',
  'booked',
  'dst session second booking is booked'
);

select is(
  (select public.cancel_booking(
    (select id from public.bookings
      where session_id = 'b2000000-0000-4000-8000-0000000000d1'
        and participant_id = 'b3000000-0000-4000-8000-0000000000d1'),
    null,
    timestamptz '2026-11-01 04:29:59.999+00'
  )->'booking'->>'status'),
  'cancelled',
  'one millisecond before the DST-adjacent cutoff is cancelled'
);

select is(
  (select public.cancel_booking(
    (select id from public.bookings
      where session_id = 'b2000000-0000-4000-8000-0000000000d1'
        and participant_id = 'b3000000-0000-4000-8000-0000000000d2'),
    null,
    timestamptz '2026-11-01 04:30:00+00'
  )->'booking'->>'status'),
  'late_cancelled',
  'exactly 3 elapsed hours before 02:30 EST (07:30 UTC) is late_cancelled'
);

-- Check-in and no-show.
select lives_ok(
  $$select public.check_in_booking(
      (select id from public.bookings
        where session_id = 'b2000000-0000-4000-8000-000000000001'
          and participant_id = 'b3000000-0000-4000-8000-000000000003'),
      'staff:test',
      timestamptz '2026-06-01 23:05:00+00'
    )$$,
  'check-in marks a booked row attended'
);

select is(
  (select status from public.bookings
    where session_id = 'b2000000-0000-4000-8000-000000000001'
      and participant_id = 'b3000000-0000-4000-8000-000000000003'),
  'attended',
  'checked-in booking is attended'
);

select throws_ok(
  $$select public.mark_booking_no_show(
      (select id from public.bookings
        where session_id = 'b2000000-0000-4000-8000-0000000000c0'
          and participant_id = 'b3000000-0000-4000-8000-000000000005'),
      null,
      timestamptz '2026-06-08 22:59:59+00'
    )$$,
  'P0001',
  'booking_closed',
  'no-show before the session start is rejected'
);

select is(
  public.mark_booking_no_show(
    (select id from public.bookings
      where session_id = 'b2000000-0000-4000-8000-0000000000c0'
        and participant_id = 'b3000000-0000-4000-8000-000000000005'),
    'staff:test',
    timestamptz '2026-06-08 23:00:00+00'
  )->>'status',
  'no_show',
  'no-show at session start is allowed'
);

select throws_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where session_id = 'b2000000-0000-4000-8000-0000000000c0'
          and participant_id = 'b3000000-0000-4000-8000-000000000005')
    )$$,
  'P0001',
  'not_booked',
  'no-show rows cannot be cancelled'
);

update public.sessions
  set cancelled_at = timestamptz '2026-05-02 00:00:00+00'
where id = 'b2000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.book_session(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000002'
    )$$,
  'P0001',
  'booking_closed',
  'cancelled sessions do not accept new bookings'
);

select lives_ok(
  $$delete from public.sessions where id = 'b2000000-0000-4000-8000-0000000000c0'$$,
  'session delete cascades bookings'
);

select is(
  (select count(*) from public.bookings
    where session_id = 'b2000000-0000-4000-8000-0000000000c0'),
  0::bigint,
  'bookings for a deleted session are gone'
);

select * from finish();
rollback;
