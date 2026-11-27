-- Scheduling v2 follow-on: class description and optional session link.
-- public.classes already exists (20261101100000) as the weekly catalog:
-- name, instructor, capacity, duration_minutes (the default duration),
-- is_active, and timestamps, plus the weekday schedule columns.
-- This migration adds optional description and a nullable sessions.class_id.
-- It does not replace the weekly catalog and does not rewrite existing sessions.
-- Idempotent. Do not apply to a live Supabase project from this change.
-- Apply it before deploying an API build that selects sessions.class_id.

alter table public.classes
  add column if not exists description text;

alter table public.classes drop constraint if exists classes_description_check;
alter table public.classes
  add constraint classes_description_check check (
    description is null
    or (
      char_length(description) between 1 and 2000
      and description = btrim(description)
    )
  );

comment on table public.classes is
  'Scheduling v2 weekly class catalog. start_time is America/New_York wall-clock. duration_minutes is the default duration. description is optional public copy. Sessions may set sessions.class_id. No booking rows yet.';

comment on column public.classes.description is
  'Optional public description. Null when unset. Trimmed, 1–2000 characters.';

comment on column public.classes.duration_minutes is
  'Default duration in minutes for this class. Sessions store their own starts_at and ends_at.';

comment on column public.classes.is_active is
  'Inactive classes stay in the catalog and are omitted from public reads.';

alter table public.sessions
  add column if not exists class_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sessions'::regclass
      and conname = 'sessions_class_id_fkey'
  ) then
    alter table public.sessions
      add constraint sessions_class_id_fkey
      foreign key (class_id) references public.classes (id) on delete set null;
  end if;
end $$;

create index if not exists idx_sessions_class_id
  on public.sessions (class_id)
  where class_id is not null;

comment on column public.sessions.class_id is
  'Optional link to public.classes. Null keeps a session that has no catalog row. ON DELETE SET NULL leaves the session in place.';

-- An already-cancelled session keeps cancelled_at. class_id is an other-column
-- edit, so linking or unlinking a cancelled session still applies.
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
  then
    return null;
  end if;

  return new;
end;
$$;

comment on function public.preserve_session_cancelled_at() is
  'BEFORE UPDATE guard: an already-cancelled session keeps its original cancelled_at. A re-cancel with no other edits is a no-op. class_id counts as an other edit.';

-- Same access model as session_content: RLS on, no anon/authenticated
-- table privileges, authenticated admin policy, service_role DML.
alter table public.classes enable row level security;

revoke all on public.classes from public, anon, authenticated;

drop policy if exists admin_all_classes on public.classes;
create policy "admin_all_classes" on public.classes
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.classes to service_role;
