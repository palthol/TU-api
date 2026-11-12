-- Scheduling v2 first slice: recurring weekly classes (catalog + gym-local schedule).
-- Idempotent. Version 20261101100000 is the reserved A1 timestamp.
-- start_time is America/New_York wall-clock (not UTC). Occurrences are expanded
-- in the API; this table does not persist session rows or bookings.
-- Do not apply to production unless a later task authorizes schema writes.

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  instructor text not null,
  day_of_week integer not null,
  recurrence text not null default 'weekly',
  start_time time not null,
  duration_minutes integer not null,
  capacity integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classes_name_len check (char_length(btrim(name)) between 1 and 200),
  constraint classes_instructor_len check (char_length(btrim(instructor)) between 1 and 200),
  constraint classes_day_of_week_check check (day_of_week between 1 and 7),
  constraint classes_recurrence_check check (recurrence = 'weekly'),
  constraint classes_duration_minutes_check check (duration_minutes between 1 and 1440),
  constraint classes_capacity_check check (capacity between 1 and 500)
);

create index if not exists idx_classes_active_day_time
  on public.classes (day_of_week, start_time)
  where is_active;

comment on table public.classes is
  'Scheduling v2 weekly class catalog. start_time is America/New_York wall-clock. No booking rows yet.';

comment on column public.classes.day_of_week is
  'ISO-8601 weekday: 1 = Monday … 7 = Sunday.';

comment on column public.classes.recurrence is
  'Currently weekly only. Reserved for later cadences.';

comment on column public.classes.start_time is
  'Gym-local wall-clock in America/New_York. Convert to UTC in the API with gymTime.';

drop trigger if exists update_classes_updated_at on public.classes;
create trigger update_classes_updated_at
  before update on public.classes
  for each row execute function public.update_updated_at_column();

alter table public.classes enable row level security;

revoke all on public.classes from public, anon, authenticated;

drop policy if exists admin_all_classes on public.classes;
create policy "admin_all_classes" on public.classes
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.classes to service_role;
