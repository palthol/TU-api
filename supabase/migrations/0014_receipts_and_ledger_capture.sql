-- Receipts: money-in / money-out (refund) with void semantics; event ledger capture.

create sequence if not exists public.receipt_number_seq;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint not null default nextval('public.receipt_number_seq'),
  receipt_kind text not null,
  payment_id uuid references public.payments(id) on delete restrict,
  payment_refund_id uuid references public.payment_refunds(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  amount_cents integer not null,
  currency text not null default 'USD',
  issued_at timestamptz not null default now(),
  issued_by text not null,
  voided_at timestamptz,
  void_reason text,
  supersedes_receipt_id uuid references public.receipts(id) on delete set null,
  notes text,
  source text not null default 'staff_triggered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_receipt_kind check (
    receipt_kind in ('money_in', 'money_out_refund', 'money_out_correction')
  ),
  constraint check_receipt_source check (source in ('staff_triggered', 'member_link')),
  constraint check_amount_positive check (amount_cents > 0),
  constraint check_receipt_kind_refs check (
    (receipt_kind = 'money_in' and payment_id is not null and payment_refund_id is null)
    or
    (receipt_kind = 'money_out_refund' and payment_id is not null and payment_refund_id is not null)
    or
    (receipt_kind = 'money_out_correction' and payment_id is not null)
  )
);

create unique index if not exists idx_receipts_one_active_money_in
  on public.receipts (payment_id)
  where receipt_kind = 'money_in' and voided_at is null;

create unique index if not exists idx_receipts_one_receipt_per_refund
  on public.receipts (payment_refund_id)
  where receipt_kind = 'money_out_refund' and voided_at is null;

create index if not exists idx_receipts_account on public.receipts(account_id);
create index if not exists idx_receipts_payment on public.receipts(payment_id);
create index if not exists idx_receipts_issued_at on public.receipts(issued_at desc);

comment on table public.receipts is
  'Receipt artifacts: money_in tied to payment; money_out_refund tied to payment_refunds; voiding is soft (voided_at).';

create or replace function public.receipts_immutable_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.id is distinct from new.id
     or old.receipt_number is distinct from new.receipt_number
     or old.receipt_kind is distinct from new.receipt_kind
     or old.payment_id is distinct from new.payment_id
     or old.payment_refund_id is distinct from new.payment_refund_id
     or old.account_id is distinct from new.account_id
     or old.amount_cents is distinct from new.amount_cents
     or old.currency is distinct from new.currency
     or old.issued_at is distinct from new.issued_at
     or old.issued_by is distinct from new.issued_by
     or old.supersedes_receipt_id is distinct from new.supersedes_receipt_id
     or old.source is distinct from new.source
     or old.created_at is distinct from new.created_at
  then
    raise exception 'receipts are immutable except void fields and notes';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_receipts_immutable on public.receipts;
create trigger trg_receipts_immutable
  before update on public.receipts
  for each row execute function public.receipts_immutable_update();

alter table public.receipts enable row level security;

create policy "admin_all_receipts" on public.receipts
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

insert into public.event_capture_config (table_name, enabled, include_before, include_after, notes)
values ('receipts', true, true, true, 'Receipt issuance and void events.')
on conflict (table_name) do update
set
  enabled = excluded.enabled,
  include_before = excluded.include_before,
  include_after = excluded.include_after,
  notes = excluded.notes,
  updated_at = now();

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

  elsif tg_table_name = 'receipts' then
    v_event_category := 'billing';
    v_entity_id := coalesce(new.id, old.id);
    v_payment_id := coalesce(new.payment_id, old.payment_id);
    v_account_id := coalesce(new.account_id, old.account_id);
    if tg_op = 'UPDATE' and coalesce(old.voided_at, 'epoch'::timestamptz) is distinct from coalesce(new.voided_at, 'epoch'::timestamptz)
       and new.voided_at is not null then
      v_event_name := 'receipt.voided';
    else
      v_event_name := case tg_op
        when 'INSERT' then 'receipt.created'
        when 'UPDATE' then 'receipt.updated'
        else 'receipt.deleted'
      end;
    end if;

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

drop trigger if exists trg_event_capture_receipts on public.receipts;
create trigger trg_event_capture_receipts
  after insert or update or delete on public.receipts
  for each row execute function public.capture_event_ledger_phase1();

grant select, insert, update, delete on public.receipts to service_role;
grant usage, select on sequence public.receipt_number_seq to service_role;
