-- Event ledger foundation (append-only, trigger-driven capture).
-- Phase 1 tables:
--   participants, subscriptions, charges, payments,
--   payment_allocations, waivers, attendance_records

-- -----------------------------------------------------------------------------
-- reason codes
-- -----------------------------------------------------------------------------
create table if not exists public.event_reason_codes (
  code text primary key,
  description text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.event_reason_codes (code, description)
values
  ('non_payment', 'State change caused by non-payment.'),
  ('manual_cancellation', 'Manual cancellation by staff/admin.'),
  ('upgrade_conversion', 'Plan conversion or upgrade path.'),
  ('data_correction', 'Data correction or cleanup action.'),
  ('manual_writeoff', 'Manual finance write-off decision.'),
  ('refund_adjustment', 'Refund-driven correction.'),
  ('merge_correction', 'Participant merge or deduplication.')
on conflict (code) do update
set
  description = excluded.description,
  is_active = true;

alter table public.event_reason_codes enable row level security;

create policy "admin_all_event_reason_codes" on public.event_reason_codes
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

comment on table public.event_reason_codes is
  'Controlled reason-code catalog for interpreting event causes.';

-- -----------------------------------------------------------------------------
-- capture config
-- -----------------------------------------------------------------------------
create table if not exists public.event_capture_config (
  table_name text primary key,
  enabled boolean not null default true,
  include_before boolean not null default true,
  include_after boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.event_capture_config (
  table_name,
  enabled,
  include_before,
  include_after,
  notes
)
values
  ('participants', true, true, true, 'Participant lifecycle events.'),
  ('subscriptions', true, true, true, 'Enrollment and status transitions.'),
  ('charges', true, true, true, 'Billing line item events.'),
  ('payments', true, true, true, 'Payment lifecycle events.'),
  ('payment_allocations', true, true, true, 'Allocation mapping events.'),
  ('waivers', true, true, true, 'Waiver signature/legal record events.'),
  ('attendance_records', true, true, true, 'Attendance logging events.')
on conflict (table_name) do update
set
  enabled = excluded.enabled,
  include_before = excluded.include_before,
  include_after = excluded.include_after,
  notes = excluded.notes,
  updated_at = now();

alter table public.event_capture_config enable row level security;

create policy "admin_all_event_capture_config" on public.event_capture_config
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

comment on table public.event_capture_config is
  'Per-table toggle/settings for trigger-based event capture.';

-- -----------------------------------------------------------------------------
-- event ledger
-- -----------------------------------------------------------------------------
create table if not exists public.event_ledger (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_name text not null,
  event_category text not null,
  entity_type text not null,
  entity_id uuid,
  participant_id uuid,
  account_id uuid,
  subscription_id uuid,
  charge_id uuid,
  payment_id uuid,
  actor_type text not null default 'system',
  actor_id text,
  source_system text not null default 'db_trigger',
  reason_code text,
  correlation_id text,
  payload_before jsonb,
  payload_after jsonb,
  payload_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint check_event_category check (
    event_category in ('participant', 'subscription', 'billing', 'attendance', 'waiver', 'system')
  ),
  constraint check_actor_type check (
    actor_type in ('system', 'user', 'service')
  )
);

alter table public.event_ledger enable row level security;

create policy "admin_all_event_ledger" on public.event_ledger
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create index if not exists idx_event_ledger_occurred_at on public.event_ledger(occurred_at desc);
create index if not exists idx_event_ledger_event_name on public.event_ledger(event_name);
create index if not exists idx_event_ledger_entity on public.event_ledger(entity_type, entity_id, occurred_at desc);
create index if not exists idx_event_ledger_participant on public.event_ledger(participant_id, occurred_at desc);
create index if not exists idx_event_ledger_account on public.event_ledger(account_id, occurred_at desc);
create index if not exists idx_event_ledger_subscription on public.event_ledger(subscription_id, occurred_at desc);
create index if not exists idx_event_ledger_charge on public.event_ledger(charge_id, occurred_at desc);
create index if not exists idx_event_ledger_payment on public.event_ledger(payment_id, occurred_at desc);
create index if not exists idx_event_ledger_reason_code on public.event_ledger(reason_code) where reason_code is not null;

comment on table public.event_ledger is
  'Append-only event ledger for operational causality and historical reconstruction.';

-- -----------------------------------------------------------------------------
-- helpers
-- -----------------------------------------------------------------------------
create or replace function public.prevent_event_ledger_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'event_ledger is append-only; updates and deletes are not allowed';
end;
$$;

drop trigger if exists trg_event_ledger_no_update on public.event_ledger;
create trigger trg_event_ledger_no_update
  before update on public.event_ledger
  for each row execute function public.prevent_event_ledger_mutation();

drop trigger if exists trg_event_ledger_no_delete on public.event_ledger;
create trigger trg_event_ledger_no_delete
  before delete on public.event_ledger
  for each row execute function public.prevent_event_ledger_mutation();

create or replace function public.update_event_capture_config_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_event_capture_config_updated_at on public.event_capture_config;
create trigger trg_event_capture_config_updated_at
  before update on public.event_capture_config
  for each row execute function public.update_event_capture_config_updated_at();

create or replace function private.event_capture_enabled(p_table_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select c.enabled from public.event_capture_config c where c.table_name = p_table_name),
    true
  );
$$;

grant execute on function private.event_capture_enabled(text) to anon;
grant execute on function private.event_capture_enabled(text) to authenticated;

create or replace function private.append_event(
  p_event_name text,
  p_event_category text,
  p_entity_type text,
  p_entity_id uuid,
  p_participant_id uuid,
  p_account_id uuid,
  p_subscription_id uuid,
  p_charge_id uuid,
  p_payment_id uuid,
  p_payload_before jsonb default null,
  p_payload_after jsonb default null,
  p_payload_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text;
  v_claims_json jsonb;
  v_actor_type text := 'system';
  v_actor_id text := null;
  v_source_system text := 'db_trigger';
  v_reason_code text := null;
  v_correlation_id text := null;
begin
  v_claims := current_setting('request.jwt.claims', true);
  if v_claims is not null and btrim(v_claims) <> '' then
    begin
      v_claims_json := v_claims::jsonb;
      if coalesce(v_claims_json->>'role', '') = 'service_role' then
        v_actor_type := 'service';
      else
        v_actor_type := 'user';
      end if;
      v_actor_id := v_claims_json->>'sub';
    exception when others then
      v_actor_type := 'system';
      v_actor_id := null;
    end;
  end if;

  v_source_system := coalesce(nullif(current_setting('app.source_system', true), ''), 'db_trigger');
  v_reason_code := nullif(current_setting('app.reason_code', true), '');
  v_correlation_id := nullif(current_setting('app.correlation_id', true), '');

  if v_reason_code is not null and not exists (
    select 1 from public.event_reason_codes rc where rc.code = v_reason_code and rc.is_active
  ) then
    v_reason_code := null;
  end if;

  insert into public.event_ledger (
    event_name,
    event_category,
    entity_type,
    entity_id,
    participant_id,
    account_id,
    subscription_id,
    charge_id,
    payment_id,
    actor_type,
    actor_id,
    source_system,
    reason_code,
    correlation_id,
    payload_before,
    payload_after,
    payload_meta
  )
  values (
    p_event_name,
    p_event_category,
    p_entity_type,
    p_entity_id,
    p_participant_id,
    p_account_id,
    p_subscription_id,
    p_charge_id,
    p_payment_id,
    v_actor_type,
    v_actor_id,
    v_source_system,
    v_reason_code,
    v_correlation_id,
    p_payload_before,
    p_payload_after,
    coalesce(p_payload_meta, '{}'::jsonb)
      || jsonb_build_object('table', p_entity_type, 'captured_via', 'db_trigger')
  );
end;
$$;

grant execute on function private.append_event(text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb) to anon;
grant execute on function private.append_event(text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- trigger capture (phase 1)
-- -----------------------------------------------------------------------------
create or replace function public.capture_event_ledger_phase1()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_before jsonb := null;
  v_after jsonb := null;
  v_event_name text;
  v_event_category text;
  v_entity_type text := tg_table_name;
  v_entity_id uuid := null;
  v_participant_id uuid := null;
  v_account_id uuid := null;
  v_subscription_id uuid := null;
  v_charge_id uuid := null;
  v_payment_id uuid := null;
begin
  if not (select private.event_capture_enabled(tg_table_name)) then
    return coalesce(new, old);
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new);
  end if;

  if tg_table_name = 'participants' then
    v_event_category := 'participant';
    v_entity_id := coalesce(new.id, old.id);
    v_participant_id := v_entity_id;
    v_event_name := case tg_op
      when 'INSERT' then 'participant.created'
      when 'UPDATE' then 'participant.updated'
      else 'participant.deleted'
    end;

  elsif tg_table_name = 'subscriptions' then
    v_event_category := 'subscription';
    v_entity_id := coalesce(new.id, old.id);
    v_subscription_id := v_entity_id;
    v_participant_id := coalesce(new.participant_id, old.participant_id);
    v_account_id := coalesce(new.account_id, old.account_id);
    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_event_name := 'subscription.status_changed';
    else
      v_event_name := case tg_op
        when 'INSERT' then 'subscription.created'
        when 'UPDATE' then 'subscription.updated'
        else 'subscription.deleted'
      end;
    end if;

  elsif tg_table_name = 'charges' then
    v_event_category := 'billing';
    v_entity_id := coalesce(new.id, old.id);
    v_charge_id := v_entity_id;
    v_subscription_id := coalesce(new.subscription_id, old.subscription_id);
    v_account_id := coalesce(new.account_id, old.account_id);
    if v_subscription_id is not null then
      select s.participant_id into v_participant_id
      from public.subscriptions s
      where s.id = v_subscription_id
      limit 1;
    end if;
    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_event_name := 'charge.status_changed';
    else
      v_event_name := case tg_op
        when 'INSERT' then 'charge.created'
        when 'UPDATE' then 'charge.updated'
        else 'charge.deleted'
      end;
    end if;

  elsif tg_table_name = 'payments' then
    v_event_category := 'billing';
    v_entity_id := coalesce(new.id, old.id);
    v_payment_id := v_entity_id;
    v_account_id := coalesce(new.account_id, old.account_id);
    if tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_event_name := 'payment.status_changed';
    else
      v_event_name := case tg_op
        when 'INSERT' then 'payment.created'
        when 'UPDATE' then 'payment.updated'
        else 'payment.deleted'
      end;
    end if;

  elsif tg_table_name = 'payment_allocations' then
    v_event_category := 'billing';
    v_entity_id := coalesce(new.id, old.id);
    v_payment_id := coalesce(new.payment_id, old.payment_id);
    v_charge_id := coalesce(new.charge_id, old.charge_id);

    if v_charge_id is not null then
      select
        c.account_id,
        c.subscription_id
      into
        v_account_id,
        v_subscription_id
      from public.charges c
      where c.id = v_charge_id
      limit 1;
    end if;

    if v_subscription_id is not null then
      select s.participant_id into v_participant_id
      from public.subscriptions s
      where s.id = v_subscription_id
      limit 1;
    end if;

    v_event_name := case tg_op
      when 'INSERT' then 'payment_allocation.created'
      when 'UPDATE' then 'payment_allocation.updated'
      else 'payment_allocation.deleted'
    end;

  elsif tg_table_name = 'waivers' then
    v_event_category := 'waiver';
    v_entity_id := coalesce(new.id, old.id);
    v_participant_id := coalesce(new.participant_id, old.participant_id);
    v_event_name := case tg_op
      when 'INSERT' then 'waiver.created'
      when 'UPDATE' then 'waiver.updated'
      else 'waiver.deleted'
    end;

  elsif tg_table_name = 'attendance_records' then
    v_event_category := 'attendance';
    v_entity_id := coalesce(new.id, old.id);
    v_participant_id := coalesce(new.participant_id, old.participant_id);
    v_event_name := case tg_op
      when 'INSERT' then 'attendance_record.created'
      when 'UPDATE' then 'attendance_record.updated'
      else 'attendance_record.deleted'
    end;

  else
    return coalesce(new, old);
  end if;

  perform private.append_event(
    v_event_name,
    v_event_category,
    v_entity_type,
    v_entity_id,
    v_participant_id,
    v_account_id,
    v_subscription_id,
    v_charge_id,
    v_payment_id,
    v_before,
    v_after,
    '{}'::jsonb
  );

  return coalesce(new, old);
end;
$$;

-- participants
drop trigger if exists trg_event_capture_participants on public.participants;
create trigger trg_event_capture_participants
  after insert or update or delete on public.participants
  for each row execute function public.capture_event_ledger_phase1();

-- subscriptions
drop trigger if exists trg_event_capture_subscriptions on public.subscriptions;
create trigger trg_event_capture_subscriptions
  after insert or update or delete on public.subscriptions
  for each row execute function public.capture_event_ledger_phase1();

-- charges
drop trigger if exists trg_event_capture_charges on public.charges;
create trigger trg_event_capture_charges
  after insert or update or delete on public.charges
  for each row execute function public.capture_event_ledger_phase1();

-- payments
drop trigger if exists trg_event_capture_payments on public.payments;
create trigger trg_event_capture_payments
  after insert or update or delete on public.payments
  for each row execute function public.capture_event_ledger_phase1();

-- payment_allocations
drop trigger if exists trg_event_capture_payment_allocations on public.payment_allocations;
create trigger trg_event_capture_payment_allocations
  after insert or update or delete on public.payment_allocations
  for each row execute function public.capture_event_ledger_phase1();

-- waivers
drop trigger if exists trg_event_capture_waivers on public.waivers;
create trigger trg_event_capture_waivers
  after insert or update or delete on public.waivers
  for each row execute function public.capture_event_ledger_phase1();

-- attendance_records
drop trigger if exists trg_event_capture_attendance_records on public.attendance_records;
create trigger trg_event_capture_attendance_records
  after insert or update or delete on public.attendance_records
  for each row execute function public.capture_event_ledger_phase1();

comment on function public.capture_event_ledger_phase1() is
  'Trigger handler for phase-1 event capture into append-only event_ledger.';
