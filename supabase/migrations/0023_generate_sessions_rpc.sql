-- Recurring session generation from schedule_templates.
-- Unique (template, starts_at) so retries of the same date range do not duplicate rows.
-- Do not apply to production from this task (API-SCHED-001 production writes: no).

-- One concrete occurrence per template timestamp (including cancelled sessions).
create unique index if not exists sessions_schedule_template_starts_at_unique
  on public.sessions (schedule_template_id, starts_at)
  where schedule_template_id is not null;

comment on index public.sessions_schedule_template_starts_at_unique is
  'Idempotent generate_sessions: one row per template occurrence. Soft-cancelled sessions still occupy the slot.';

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
  candidates as (
    select
      t.id as schedule_template_id,
      t.name as session_label,
      t.notes,
      ((d.d + t.start_time) at time zone 'UTC') as starts_at,
      ((d.d + t.start_time) at time zone 'UTC')
        + make_interval(mins => t.duration_minutes) as ends_at
    from dates d
    inner join active_templates t
      on extract(isodow from d.d)::integer = t.day_of_week
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
  'Expands active schedule_templates into sessions for an inclusive UTC date range. day_of_week is ISO (1=Mon..7=Sun). start_time is UTC wall-clock. Retries skip existing (template, starts_at) rows.';

revoke all on function public.generate_sessions(date, date, uuid) from public;
revoke all on function public.generate_sessions(date, date, uuid) from anon;
revoke all on function public.generate_sessions(date, date, uuid) from authenticated;
grant execute on function public.generate_sessions(date, date, uuid) to service_role;
