-- Staff directory and privileged-write audit for API-AUTH-001 / API-ADR-005.
-- Idempotent. Version 20260914185843 sorts after live 20260608191715.
-- Former repo filename: 0023_staff_rbac.sql.
-- Until this migration is applied, only the shared ADMIN_API_KEY authenticates.

create table if not exists public.staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  role text not null,
  key_hash text not null,
  key_prefix text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_by_staff_id uuid references public.staff_users (id),
  constraint staff_users_role_check check (role in ('owner', 'front_desk', 'finance')),
  constraint staff_users_email_len check (char_length(email) between 3 and 320),
  constraint staff_users_display_name_len check (char_length(display_name) between 1 and 200),
  constraint staff_users_key_hash_len check (char_length(key_hash) = 64),
  constraint staff_users_key_prefix_len check (char_length(key_prefix) between 4 and 32)
);

create unique index if not exists staff_users_key_hash_unique
  on public.staff_users (key_hash);

create unique index if not exists staff_users_email_lower_unique
  on public.staff_users (lower(email));

drop trigger if exists update_staff_users_updated_at on public.staff_users;
create trigger update_staff_users_updated_at
  before update on public.staff_users
  for each row execute function public.update_updated_at_column();

comment on table public.staff_users is
  'Operator identities for Express /api/admin auth. key_hash is SHA-256 of the personal x-admin-key; never expose plaintext.';

comment on column public.staff_users.key_hash is
  'Hex SHA-256 of the staff API key. Service-role API only; no authenticated SELECT policy.';

alter table public.staff_users enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE policies for anon or authenticated.
-- key_hash must not be readable via PostgREST user JWTs. service_role bypasses RLS.

grant select, insert, update on public.staff_users to service_role;

create table if not exists public.staff_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  staff_user_id uuid references public.staff_users (id),
  actor_label text not null,
  role text not null,
  auth_method text not null,
  http_method text not null,
  request_path text not null,
  payload_meta jsonb not null default '{}'::jsonb,
  constraint staff_audit_auth_method_check check (
    auth_method in ('staff_key', 'legacy_shared_key', 'cron_secret')
  )
);

create index if not exists idx_staff_audit_events_occurred_at
  on public.staff_audit_events (occurred_at desc);

create index if not exists idx_staff_audit_events_staff_user_id
  on public.staff_audit_events (staff_user_id, occurred_at desc);

comment on table public.staff_audit_events is
  'Authenticated actor for mutating /api/admin requests. Domain created_by/recorded_by remain client-supplied until routes adopt req.staff.';

alter table public.staff_audit_events enable row level security;

drop policy if exists admin_select_staff_audit_events on public.staff_audit_events;
create policy "admin_select_staff_audit_events" on public.staff_audit_events
  for select to authenticated
  using ((select private.is_admin()));

-- Inserts come from the service-role API only (no authenticated INSERT policy).
grant select, insert on public.staff_audit_events to service_role;
