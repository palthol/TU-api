-- Scheduling v2 staff booking and attendance.
-- Bookings attach to existing public.sessions rows (optional class_id from
-- 20261113175150). This does not materialize weekly class occurrences; staff
-- create or generate session rows first, then book against them.
-- Capacity is sessions.capacity, falling back to classes.capacity.
-- Waitlist is FIFO. Cancel of a booked spot auto-promotes under a session row
-- lock. Credits/charges are out of scope: statuses are the later hook
-- (booked/promoted → hold, attended → consume, cancelled → release,
-- late_cancelled / no_show → penalty or consume).
-- Idempotent. Do not apply to a live Supabase project from this change.
-- Version 20261113190000 is after 20261113175150 and outside the reserved
-- A4–A10 timestamps.

alter table public.sessions
  add column if not exists capacity integer;

alter table public.sessions drop constraint if exists sessions_capacity_check;
alter table public.sessions
  add constraint sessions_capacity_check check (
    capacity is null or capacity between 1 and 500
  );

comment on column public.sessions.capacity is
  'Optional per-session seat cap. Booking uses this when set, otherwise classes.capacity. Null with no class is capacity_not_configured.';

-- Capacity is an other-column edit on an already-cancelled session.
create or replace function public.preserve_session_cancelled_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.cancelled_at is null or new.cancelled_at is null then
    return new;
  end if;

  new.cancelled_at := old.cancelled_at;

  if new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at
     and new.schedule_template_id is not distinct from old.schedule_template_id
     and new.session_label is not distinct from old.session_label
     and new.notes is not distinct from old.notes
     and new.class_id is not distinct from old.class_id
     and new.capacity is not distinct from old.capacity
  then
    return null;
  end if;

  return new;
end;
$$;

comment on function public.preserve_session_cancelled_at() is
  'BEFORE UPDATE guard: an already-cancelled session keeps its original cancelled_at. A re-cancel with no other edits is a no-op. class_id and capacity count as other edits.';

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  checked_in_at timestamptz,
  no_show_at timestamptz,
  promoted_at timestamptz,
  created_by text,
  cancelled_by text,
  checked_in_by text,
  no_show_by text,
  constraint bookings_status_check check (
    status in ('booked', 'waitlisted', 'cancelled', 'late_cancelled', 'attended', 'no_show')
  ),
  constraint bookings_created_by_len check (
    created_by is null or char_length(created_by) between 1 and 200
  ),
  constraint bookings_cancelled_by_len check (
    cancelled_by is null or char_length(cancelled_by) between 1 and 200
  ),
  constraint bookings_checked_in_by_len check (
    checked_in_by is null or char_length(checked_in_by) between 1 and 200
  ),
  constraint bookings_no_show_by_len check (
    no_show_by is null or char_length(no_show_by) between 1 and 200
  ),
  constraint bookings_cancelled_status_check check (
    (status in ('cancelled', 'late_cancelled') and cancelled_at is not null)
    or (status not in ('cancelled', 'late_cancelled') and cancelled_at is null)
  ),
  constraint bookings_attended_check check (
    (status = 'attended' and checked_in_at is not null)
    or (status <> 'attended')
  ),
  constraint bookings_no_show_status_check check (
    (status = 'no_show' and no_show_at is not null)
    or (status <> 'no_show')
  )
);

create index if not exists idx_bookings_session_created
  on public.bookings (session_id, created_at, id);

create index if not exists idx_bookings_participant_id
  on public.bookings (participant_id);

create index if not exists idx_bookings_session_waitlist
  on public.bookings (session_id, created_at, id)
  where status = 'waitlisted';

create unique index if not exists bookings_one_active_per_participant_session
  on public.bookings (session_id, participant_id)
  where status in ('booked', 'waitlisted', 'attended', 'no_show');

comment on table public.bookings is
  'Staff-operated session roster. One active booking per participant per session. Waitlist is FIFO. Statuses are the later credit hook; this slice writes no charges.';

comment on column public.bookings.status is
  'booked and waitlisted are the live roster. cancelled frees a spot (>3h before start). late_cancelled frees a spot at or inside 3h. attended is check-in. no_show is an admin mark after the session starts. booked/promoted later hold credit; attended later consumes; cancelled later releases; late_cancelled and no_show later penalty or consume.';

comment on column public.bookings.promoted_at is
  'Set when a waitlisted booking is auto-promoted into booked. Later credit slice may hold on this transition.';

drop trigger if exists update_bookings_updated_at on public.bookings;
create trigger update_bookings_updated_at
  before update on public.bookings
  for each row execute function public.update_updated_at_column();

alter table public.bookings enable row level security;

revoke all on public.bookings from public, anon, authenticated;

drop policy if exists admin_all_bookings on public.bookings;
create policy "admin_all_bookings" on public.bookings
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.bookings to service_role;

comment on table public.classes is
  'Scheduling v2 weekly class catalog. start_time is America/New_York wall-clock. duration_minutes is the default duration. description is optional public copy. Sessions may set sessions.class_id. Staff booking uses sessions rows; class.capacity is the fallback seat cap.';

-- Occupying a numbered seat: live booked, checked-in, or no-show after start.
-- Waitlist and both cancel statuses do not occupy.
create or replace function public.booking_occupies_spot(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status in ('booked', 'attended', 'no_show');
$$;

comment on function public.booking_occupies_spot(text) is
  'True when the booking holds a numbered seat (booked, attended, or no_show).';

revoke all on function public.booking_occupies_spot(text) from public;
revoke all on function public.booking_occupies_spot(text) from anon;
revoke all on function public.booking_occupies_spot(text) from authenticated;
grant execute on function public.booking_occupies_spot(text) to service_role;

create or replace function public.session_booking_capacity(p_session public.sessions)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_session.capacity,
    (select c.capacity from public.classes c where c.id = p_session.class_id)
  );
$$;

comment on function public.session_booking_capacity(public.sessions) is
  'Seat cap for a session: sessions.capacity if set, else classes.capacity.';

revoke all on function public.session_booking_capacity(public.sessions) from public;
revoke all on function public.session_booking_capacity(public.sessions) from anon;
revoke all on function public.session_booking_capacity(public.sessions) from authenticated;
grant execute on function public.session_booking_capacity(public.sessions) to service_role;

create or replace function public.book_session(
  p_session_id uuid,
  p_participant_id uuid,
  p_actor text default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_session public.sessions;
  v_capacity integer;
  v_occupied integer;
  v_status text;
  v_booking public.bookings;
begin
  if p_session_id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if p_participant_id is null then
    raise exception 'participant_not_found' using errcode = 'P0001';
  end if;

  select *
    into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  if v_session.cancelled_at is not null then
    raise exception 'booking_closed' using errcode = 'P0001';
  end if;

  perform 1
  from public.participants
  where id = p_participant_id
  for update;

  if not found then
    raise exception 'participant_not_found' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.bookings
    where session_id = p_session_id
      and participant_id = p_participant_id
      and status in ('booked', 'waitlisted', 'attended', 'no_show')
  ) then
    raise exception 'already_booked' using errcode = 'P0001';
  end if;

  v_capacity := public.session_booking_capacity(v_session);
  if v_capacity is null then
    raise exception 'capacity_not_configured' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into v_occupied
  from public.bookings
  where session_id = p_session_id
    and public.booking_occupies_spot(status);

  if v_occupied < v_capacity then
    v_status := 'booked';
  else
    v_status := 'waitlisted';
  end if;

  insert into public.bookings (
    session_id,
    participant_id,
    status,
    created_at,
    updated_at,
    created_by
  ) values (
    p_session_id,
    p_participant_id,
    v_status,
    v_now,
    v_now,
    nullif(btrim(p_actor), '')
  )
  returning * into v_booking;

  return to_jsonb(v_booking);
exception
  when unique_violation then
    raise exception 'already_booked' using errcode = 'P0001';
end;
$$;

comment on function public.book_session(uuid, uuid, text, timestamptz) is
  'Insert a booked or waitlisted row under a session lock. Duplicate active bookings raise already_booked. Does not charge or hold credit.';

revoke all on function public.book_session(uuid, uuid, text, timestamptz) from public;
revoke all on function public.book_session(uuid, uuid, text, timestamptz) from anon;
revoke all on function public.book_session(uuid, uuid, text, timestamptz) from authenticated;
grant execute on function public.book_session(uuid, uuid, text, timestamptz) to service_role;

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_actor text default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_session_id uuid;
  v_session public.sessions;
  v_booking public.bookings;
  v_status text;
  v_was_occupying boolean;
  v_capacity integer;
  v_occupied integer;
  v_promoted public.bookings;
  v_actor text := nullif(btrim(p_actor), '');
begin
  if p_booking_id is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  select session_id
    into v_session_id
  from public.bookings
  where id = p_booking_id;

  if v_session_id is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  select *
    into v_session
  from public.sessions
  where id = v_session_id
  for update;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  select *
    into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  if v_booking.status in ('cancelled', 'late_cancelled') then
    return jsonb_build_object(
      'booking', to_jsonb(v_booking),
      'promoted', null
    );
  end if;

  if v_booking.status in ('attended', 'no_show') then
    raise exception 'not_booked' using errcode = 'P0001';
  end if;

  -- Exactly 3 elapsed hours before starts_at is late. starts_at is timestamptz
  -- (UTC), so DST is already encoded; do not subtract gym-local wall-clock hours.
  if v_now >= v_session.starts_at - interval '3 hours' then
    v_status := 'late_cancelled';
  else
    v_status := 'cancelled';
  end if;

  v_was_occupying := public.booking_occupies_spot(v_booking.status);

  update public.bookings
    set status = v_status,
        cancelled_at = v_now,
        cancelled_by = v_actor
  where id = p_booking_id
  returning * into v_booking;

  v_promoted := null;
  -- Only a booked cancel frees a numbered seat. Waitlist cancels do not promote.
  if v_was_occupying then
    v_capacity := public.session_booking_capacity(v_session);
    if v_capacity is not null then
      loop
        select count(*)::integer
          into v_occupied
        from public.bookings
        where session_id = v_session.id
          and public.booking_occupies_spot(status);

        exit when v_occupied >= v_capacity;

        select *
          into v_promoted
        from public.bookings
        where session_id = v_session.id
          and status = 'waitlisted'
        order by created_at asc, id asc
        limit 1
        for update;

        exit when not found;

        update public.bookings
          set status = 'booked',
              promoted_at = v_now
        where id = v_promoted.id
        returning * into v_promoted;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'promoted', to_jsonb(v_promoted)
  );
end;
$$;

comment on function public.cancel_booking(uuid, text, timestamptz) is
  'Cancel a booked or waitlisted row. At or inside 3 elapsed hours before starts_at is late_cancelled. Both free the spot. Auto-promotes the oldest waitlisted row under the session lock. Repeat cancel is a no-op.';

revoke all on function public.cancel_booking(uuid, text, timestamptz) from public;
revoke all on function public.cancel_booking(uuid, text, timestamptz) from anon;
revoke all on function public.cancel_booking(uuid, text, timestamptz) from authenticated;
grant execute on function public.cancel_booking(uuid, text, timestamptz) to service_role;

create or replace function public.check_in_booking(
  p_booking_id uuid,
  p_actor text default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_session_id uuid;
  v_booking public.bookings;
  v_actor text := nullif(btrim(p_actor), '');
begin
  if p_booking_id is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  select session_id
    into v_session_id
  from public.bookings
  where id = p_booking_id;

  if v_session_id is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  perform 1
  from public.sessions
  where id = v_session_id
  for update;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  select *
    into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  if v_booking.status = 'attended' then
    return to_jsonb(v_booking);
  end if;

  if v_booking.status is distinct from 'booked' then
    raise exception 'not_booked' using errcode = 'P0001';
  end if;

  update public.bookings
    set status = 'attended',
        checked_in_at = v_now,
        checked_in_by = v_actor
  where id = p_booking_id
  returning * into v_booking;

  return to_jsonb(v_booking);
end;
$$;

comment on function public.check_in_booking(uuid, text, timestamptz) is
  'Mark a booked row attended. Waitlist and cancelled rows raise not_booked. Repeat check-in is a no-op. Later credit slice may consume here.';

revoke all on function public.check_in_booking(uuid, text, timestamptz) from public;
revoke all on function public.check_in_booking(uuid, text, timestamptz) from anon;
revoke all on function public.check_in_booking(uuid, text, timestamptz) from authenticated;
grant execute on function public.check_in_booking(uuid, text, timestamptz) to service_role;

create or replace function public.mark_booking_no_show(
  p_booking_id uuid,
  p_actor text default null,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_session_id uuid;
  v_session public.sessions;
  v_booking public.bookings;
  v_actor text := nullif(btrim(p_actor), '');
begin
  if p_booking_id is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  select session_id
    into v_session_id
  from public.bookings
  where id = p_booking_id;

  if v_session_id is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  select *
    into v_session
  from public.sessions
  where id = v_session_id
  for update;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  select *
    into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  if v_booking.status = 'no_show' then
    return to_jsonb(v_booking);
  end if;

  if v_booking.status is distinct from 'booked' then
    raise exception 'not_booked' using errcode = 'P0001';
  end if;

  if v_now < v_session.starts_at then
    raise exception 'booking_closed' using errcode = 'P0001';
  end if;

  update public.bookings
    set status = 'no_show',
        no_show_at = v_now,
        no_show_by = v_actor
  where id = p_booking_id
  returning * into v_booking;

  return to_jsonb(v_booking);
end;
$$;

comment on function public.mark_booking_no_show(uuid, text, timestamptz) is
  'Mark a booked row no_show after the session start. Does not auto-promote the waitlist. Repeat no-show is a no-op.';

revoke all on function public.mark_booking_no_show(uuid, text, timestamptz) from public;
revoke all on function public.mark_booking_no_show(uuid, text, timestamptz) from anon;
revoke all on function public.mark_booking_no_show(uuid, text, timestamptz) from authenticated;
grant execute on function public.mark_booking_no_show(uuid, text, timestamptz) to service_role;
