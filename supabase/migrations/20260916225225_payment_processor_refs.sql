-- Stripe processor event + object ids for API-PAY-001 / API-ADR-006.
-- Idempotent. Version 20260916225225 sorts after 20260916174649.
-- Do not apply to production from this change (production writes: no).

create table if not exists public.payment_processor_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  object_id text,
  status text not null,
  http_status integer not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_processor_events_provider_check check (provider in ('stripe')),
  constraint payment_processor_events_status_check check (status in ('processed', 'ignored')),
  constraint payment_processor_events_event_id_len check (char_length(event_id) between 1 and 200),
  constraint payment_processor_events_http_status_check check (http_status between 200 and 499)
);

create unique index if not exists payment_processor_events_provider_event_id_unique
  on public.payment_processor_events (provider, event_id);

create index if not exists idx_payment_processor_events_created_at
  on public.payment_processor_events (created_at desc);

comment on table public.payment_processor_events is
  'Provider webhook deliveries. Unique event_id replays the stored HTTP envelope; service-role API only.';

alter table public.payment_processor_events enable row level security;

grant select, insert on public.payment_processor_events to service_role;

create table if not exists public.payment_processor_refs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  object_type text not null,
  object_id text not null,
  payment_id uuid references public.payments (id) on delete restrict,
  payment_refund_id uuid references public.payment_refunds (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payment_processor_refs_provider_check check (provider in ('stripe')),
  constraint payment_processor_refs_object_type_check check (
    object_type in ('payment_intent', 'charge', 'refund')
  ),
  constraint payment_processor_refs_object_id_len check (char_length(object_id) between 1 and 200)
);

create unique index if not exists payment_processor_refs_provider_object_unique
  on public.payment_processor_refs (provider, object_type, object_id);

create index if not exists idx_payment_processor_refs_payment_id
  on public.payment_processor_refs (payment_id)
  where payment_id is not null;

comment on table public.payment_processor_refs is
  'Maps Stripe PaymentIntent / Charge / Refund ids to payments and payment_refunds.';

alter table public.payment_processor_refs enable row level security;

grant select, insert on public.payment_processor_refs to service_role;
