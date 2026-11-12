-- Scheduling v2 lane A2.
-- generate_sessions converts schedule_templates.start_time from America/New_York
-- wall-clock to UTC: the earlier instant when the civil time repeats (fall-back),
-- and no row when the civil time does not exist (spring-forward).
-- cancel_session is idempotent. A second cancel does not rewrite the row and does
-- not append another session.cancelled event.
-- Production has no generated sessions, so this file does not rewrite stored rows.
-- Version 20261101100500 is the reserved A2 timestamp. Do not apply remotely from
-- this change; operators apply it before deploying the API that calls cancel_session.

comment on column public.schedule_templates.start_time is
  'America/New_York wall-clock. generate_sessions converts it to UTC (earlier instant on fall-back; nonexistent spring-forward times are omitted).';

-- Earliest UTC instant whose America/New_York wall clock equals p_local.
-- NULL when that civil time does not exist. Hourly probes cover EST/EDT
-- (whole-hour US Eastern offsets). Matches services/api/src/lib/gymTime.js
-- disambiguation "earlier".
create or replace function public.ny_wall_clock_to_utc(p_local timestamp)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select min(probe)
  from (
    select (p_local at time zone 'UTC') + make_interval(hours => h) as probe
    from generate_series(-12, 14) as h
  ) candidates
  where (probe at time zone 'America/New_York') = p_local;
$$;

comment on function public.ny_wall_clock_to_utc(timestamp) is
  'Convert an America/New_York wall-clock timestamp to UTC. Fall-back repeats use the earlier instant. Spring-forward gaps return NULL.';

revoke all on function public.ny_wall_clock_to_utc(timestamp) from public;
revoke all on function public.ny_wall_clock_to_utc(timestamp) from anon;
revoke all on function public.ny_wall_clock_to_utc(timestamp) from authenticated;
grant execute on function public.ny_wall_clock_to_utc(timestamp) to service_role;

create or replace function public.generate_sessions(
  p_start_date date,
  p_end_date date,
  p_template_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
  v_result jsonb;
begin
  if p_start_date is null then
    raise exception 'invalid_start';
  end if;
  if p_end_date is null then
    raise exception 'invalid_end';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end_must_be_on_or_after_start';
  end if;
  if (p_end_date - p_start_date) > 366 then
    raise exception 'range_too_long';
  end if;

  if p_template_id is not null then
    select t.id, t.is_active
      into v_template
    from public.schedule_templates t
    where t.id = p_template_id;

    if v_template.id is null then
      raise exception 'template_not_found';
    end if;
    if not v_template.is_active then
      raise exception 'template_inactive';
    end if;
  end if;

  with dates as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as d
  ),
  active_templates as (
    select t.*
    from public.schedule_templates t
    where t.is_active
      and (p_template_id is null or t.id = p_template_id)
  ),
  resolved as (
    select
      t.id as schedule_template_id,
      t.name as session_label,
      t.notes,
      t.duration_minutes,
      public.ny_wall_clock_to_utc(d.d + t.start_time) as starts_at
    from dates d
    inner join active_templates t
      on extract(isodow from d.d)::integer = t.day_of_week
  ),
  candidates as (
    select
      r.schedule_template_id,
      r.session_label,
      r.notes,
      r.starts_at,
      r.starts_at + make_interval(mins => r.duration_minutes) as ends_at
    from resolved r
    where r.starts_at is not null
  ),
  inserted as (
    insert into public.sessions (
      starts_at,
      ends_at,
      schedule_template_id,
      session_label,
      notes
    )
    select
      c.starts_at,
      c.ends_at,
      c.schedule_template_id,
      c.session_label,
      c.notes
    from candidates c
    where not exists (
      select 1
      from public.sessions s
      where s.schedule_template_id = c.schedule_template_id
        and s.starts_at = c.starts_at
    )
    on conflict (schedule_template_id, starts_at)
      where schedule_template_id is not null
    do nothing
    returning
      id,
      starts_at,
      ends_at,
      session_label,
      schedule_template_id,
      notes,
      cancelled_at,
      created_at,
      updated_at
  )
  select jsonb_build_object(
    'created_count', (select count(*)::integer from inserted),
    'skipped_count',
      (select count(*)::integer from candidates)
      - (select count(*)::integer from inserted),
    'created', coalesce(
      (
        select jsonb_agg(to_jsonb(i) order by i.starts_at, i.id)
        from inserted i
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.generate_sessions(date, date, uuid) is
  'Expands active schedule_templates into sessions for an inclusive America/New_York calendar-date range. day_of_week is ISO (1=Mon..7=Sun). start_time is America/New_York wall-clock, stored as UTC (earlier instant on fall-back). Nonexistent spring-forward times are omitted and are not counted as skipped. Retries skip existing (template, starts_at) rows, including cancelled sessions.';

revoke all on function public.generate_sessions(date, date, uuid) from public;
revoke all on function public.generate_sessions(date, date, uuid) from anon;
revoke all on function public.generate_sessions(date, date, uuid) from authenticated;
grant execute on function public.generate_sessions(date, date, uuid) to service_role;

-- Keep the original cancelled_at once set. A pure re-cancel (no other column
-- changes) skips the update so updated_at and AFTER triggers do not run.
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
  then
    return null;
  end if;

  return new;
end;
$$;

comment on function public.preserve_session_cancelled_at() is
  'BEFORE UPDATE guard: an already-cancelled session keeps its original cancelled_at. A re-cancel with no other edits is a no-op.';

drop trigger if exists preserve_session_cancelled_at on public.sessions;
create trigger preserve_session_cancelled_at
  before update on public.sessions
  for each row execute function public.preserve_session_cancelled_at();

-- One ledger row per actual cancel transition. A skipped re-cancel does not fire
-- this AFTER trigger.
create or replace function public.capture_session_cancelled_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into public.event_ledger (
      event_name,
      event_category,
      entity_type,
      entity_id,
      actor_type,
      source_system,
      reason_code,
      payload_before,
      payload_after,
      payload_meta
    )
    values (
      'session.cancelled',
      'system',
      'session',
      new.id,
      'service',
      'cancel_session',
      'manual_cancellation',
      to_jsonb(old),
      to_jsonb(new),
      jsonb_build_object('table', 'sessions', 'captured_via', 'session_cancel')
    );
  end if;

  return new;
end;
$$;

comment on function public.capture_session_cancelled_event() is
  'Append one session.cancelled event_ledger row when cancelled_at transitions from null. Repeats do not insert.';

drop trigger if exists capture_session_cancelled_event on public.sessions;
create trigger capture_session_cancelled_event
  after update on public.sessions
  for each row execute function public.capture_session_cancelled_event();

create or replace function public.cancel_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_already boolean := false;
begin
  if p_session_id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
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
    v_already := true;
  else
    update public.sessions
      set cancelled_at = clock_timestamp()
      where id = p_session_id
      returning * into v_session;
  end if;

  return jsonb_build_object(
    'already_cancelled', v_already,
    'session', to_jsonb(v_session)
  );
end;
$$;

comment on function public.cancel_session(uuid) is
  'Soft-cancel a session. Already-cancelled sessions return success with the original row and do not append another session.cancelled event. Missing ids raise session_not_found.';

revoke all on function public.cancel_session(uuid) from public;
revoke all on function public.cancel_session(uuid) from anon;
revoke all on function public.cancel_session(uuid) from authenticated;
grant execute on function public.cancel_session(uuid) to service_role;
