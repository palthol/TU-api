-- Marketing / trial leads from public contact form (stored for dashboard review).

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  goals text not null,
  preferred_time text not null,
  notes text,
  source text not null default 'marketing_contact',
  created_at timestamptz not null default now()
);

create index if not exists idx_marketing_leads_created_at on public.marketing_leads(created_at desc);

comment on table public.marketing_leads is
  'Inbound leads from marketing site and similar sources.';

alter table public.marketing_leads enable row level security;

create policy "admin_all_marketing_leads" on public.marketing_leads
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Service role inserts from API (public lead endpoint uses service role).
grant select, insert on public.marketing_leads to service_role;
