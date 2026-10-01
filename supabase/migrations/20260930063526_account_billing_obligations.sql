-- Explicit payer obligations; no data backfill and no scheduler activation.
-- Subscriptions remain participant entitlements; all debt uses the existing ledger.
create table if not exists public.billing_obligations (
  id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete restrict,
  label text not null check (length(btrim(label)) between 1 and 200),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  anchor_date date not null check (isfinite(anchor_date)),
  billing_starts_on date,
  ends_before date,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  replaces_obligation_id uuid references public.billing_obligations(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, account_id),
  check (replaces_obligation_id is distinct from id),
  check (billing_starts_on is null or (isfinite(billing_starts_on) and billing_starts_on >= anchor_date)),
  check (status <> 'active' or billing_starts_on is not null),
  check (ends_before is null or (isfinite(ends_before) and ends_before > anchor_date))
);
create index if not exists idx_billing_obligations_account on public.billing_obligations(account_id);
create index if not exists idx_billing_obligations_replaces on public.billing_obligations(replaces_obligation_id);

-- Informational links only: no joins to this table in charge generation.
create table if not exists public.billing_obligation_participants (
  obligation_id uuid not null references public.billing_obligations(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  primary key (obligation_id, participant_id)
);
create index if not exists idx_billing_obligation_participants_participant
  on public.billing_obligation_participants(participant_id);

alter table public.billing_obligations enable row level security;
alter table public.billing_obligation_participants enable row level security;
revoke all on public.billing_obligations, public.billing_obligation_participants from public, anon, authenticated;
grant select, insert, update on public.billing_obligations to service_role;
grant select, insert on public.billing_obligation_participants to service_role;

alter table public.charges add column if not exists billing_obligation_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.charges'::regclass and conname = 'charges_obligation_payer_fk') then
    alter table public.charges add constraint charges_obligation_payer_fk
      foreign key (billing_obligation_id, account_id) references public.billing_obligations(id, account_id) on delete restrict;
    alter table public.charges add constraint charges_obligation_kind_check
      check (billing_obligation_id is null or (subscription_id is null and charge_kind = 'monthly_period'));
  end if;
end $$;
-- Includes void rows: a void waives this period; automation must not rebill it.
create unique index if not exists uq_charges_obligation_period
  on public.charges(billing_obligation_id, coverage_start) where billing_obligation_id is not null;
-- Preserve the pre-existing subscription/monthly-only index unchanged.

create or replace function private.billing_anchor_in_month(p_anchor date, p_month date)
returns date language sql immutable strict set search_path = pg_catalog as $$
  select date_trunc('month', p_month)::date +
    (least(extract(day from p_anchor)::integer,
      extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer) - 1);
$$;

create or replace function private.guard_billing_obligation()
returns trigger language plpgsql set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then raise exception 'billing_obligation_history_is_retained'; end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.account_id, new.amount_cents, new.currency, new.anchor_date, new.replaces_obligation_id)
       is distinct from (old.id, old.account_id, old.amount_cents, old.currency, old.anchor_date, old.replaces_obligation_id) then
      raise exception 'replace_obligation_to_change_terms';
    end if;
    if old.status = 'ended' and new.status <> 'ended' then raise exception 'ended_obligation_is_terminal'; end if;
    if old.status <> 'draft' and new.status = 'draft' then raise exception 'cannot_return_obligation_to_draft'; end if;
    if old.billing_starts_on is not null and
      (new.billing_starts_on is null or new.billing_starts_on < old.billing_starts_on) then
      raise exception 'billing_start_cannot_move_backwards';
    end if;
    if old.ends_before is not null and (new.ends_before is null or new.ends_before > old.ends_before) then
      raise exception 'obligation_end_cannot_be_extended';
    end if;
  end if;
  if new.billing_starts_on is not null and new.billing_starts_on <>
    private.billing_anchor_in_month(new.anchor_date, new.billing_starts_on) then
    raise exception 'billing_start_must_be_anchor_boundary';
  end if;
  if new.ends_before is not null and new.ends_before <>
    private.billing_anchor_in_month(new.anchor_date, new.ends_before) then
    raise exception 'obligation_end_must_be_anchor_boundary';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_billing_obligation on public.billing_obligations;
create trigger guard_billing_obligation before insert or update or delete on public.billing_obligations
  for each row execute function private.guard_billing_obligation();

-- Immutable charge identity/terms preserve both history and retry protection.
-- Status, notes, discounts, write-offs, refunds, and allocations keep existing behavior.
create or replace function private.guard_obligation_charge()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.billing_obligation_id is not null then
    if tg_op = 'DELETE' then raise exception 'obligation_charge_history_is_retained'; end if;
    if (new.billing_obligation_id, new.account_id, new.subscription_id, new.amount_cents,
        new.currency, new.coverage_start, new.coverage_end, new.due_at, new.charge_kind)
       is distinct from
       (old.billing_obligation_id, old.account_id, old.subscription_id, old.amount_cents,
        old.currency, old.coverage_start, old.coverage_end, old.due_at, old.charge_kind) then
      raise exception 'obligation_charge_terms_are_immutable';
    end if;
  elsif tg_op = 'UPDATE' and new.billing_obligation_id is not null then
    raise exception 'cannot_reassign_legacy_charge_to_obligation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists guard_obligation_charge on public.charges;
create trigger guard_obligation_charge before update or delete on public.charges
  for each row execute function private.guard_obligation_charge();

create or replace function private.audit_billing_obligation()
returns trigger language plpgsql set search_path = public, private as $$
begin
  perform private.append_event('billing_obligation.' || lower(tg_op), 'billing',
    'billing_obligations', new.id, null, new.account_id, null, null, null,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new), '{}'::jsonb);
  return new;
end $$;
drop trigger if exists audit_billing_obligation on public.billing_obligations;
create trigger audit_billing_obligation after insert or update on public.billing_obligations
  for each row execute function private.audit_billing_obligation();

-- Client-supplied ID makes create retries conflict instead of duplicating debt.
-- All obligations start as drafts, including replacements.
create or replace function public.create_billing_obligation(
  p_id uuid, p_account_id uuid, p_label text, p_amount_cents integer, p_anchor_date date,
  p_participant_ids uuid[] default '{}', p_notes text default null, p_replaces_obligation_id uuid default null
) returns jsonb language plpgsql set search_path = public, private as $$
declare v_row public.billing_obligations;
begin
  if not exists (select 1 from public.accounts where id = p_account_id and status = 'active') then
    raise exception 'active_payer_account_required';
  end if;
  insert into public.billing_obligations(id, account_id, label, amount_cents, anchor_date, notes, replaces_obligation_id)
    values(p_id, p_account_id, p_label, p_amount_cents, p_anchor_date, p_notes, p_replaces_obligation_id)
    returning * into v_row;
  insert into public.billing_obligation_participants(obligation_id, participant_id)
    select p_id, unnest(coalesce(p_participant_ids, '{}'::uuid[]));
  return to_jsonb(v_row);
end $$;

create or replace function public.transition_billing_obligation(
  p_id uuid, p_action text, p_billing_starts_on date default null
) returns jsonb language plpgsql set search_path = public, private as $$
declare v_row public.billing_obligations; v_old public.billing_obligations;
begin
  -- Same lock as generation: replacements/resumes cannot race a billing run.
  perform pg_advisory_xact_lock(hashtextextended('public.generate_monthly_charges', 0));
  select * into v_row from public.billing_obligations where id = p_id for update;
  if not found then raise exception 'billing_obligation_not_found'; end if;
  if p_action is null or p_action not in ('activate', 'pause', 'end') then raise exception 'invalid_obligation_action'; end if;
  if v_row.status = 'ended' and p_action <> 'end' then raise exception 'ended_obligation_is_terminal'; end if;
  if p_action = 'activate' then
    if p_billing_starts_on is null then raise exception 'billing_start_required'; end if;
    if v_row.status = 'active' then
      if p_billing_starts_on = v_row.billing_starts_on then return to_jsonb(v_row); end if;
      raise exception 'pause_before_changing_billing_start';
    end if;
    if v_row.status = 'paused' and p_billing_starts_on < (now() at time zone 'America/New_York')::date then
      raise exception 'resume_requires_current_or_future_boundary';
    end if;
    if v_row.ends_before is not null and p_billing_starts_on >= v_row.ends_before then
      raise exception 'billing_start_is_after_obligation_end';
    end if;
    if not exists (select 1 from public.accounts where id = v_row.account_id and status = 'active') then
      raise exception 'active_payer_account_required';
    end if;
    if v_row.replaces_obligation_id is not null and v_row.status = 'draft' then
      select * into v_old from public.billing_obligations where id = v_row.replaces_obligation_id for update;
      if v_old.status = 'draft' or v_old.ends_before is not null then raise exception 'replacement_not_available'; end if;
      if p_billing_starts_on <= v_old.anchor_date or
        p_billing_starts_on <> private.billing_anchor_in_month(v_old.anchor_date, p_billing_starts_on) then
        raise exception 'replacement_must_start_at_previous_boundary';
      end if;
      if exists(select 1 from public.charges where billing_obligation_id = v_old.id and coverage_end >= p_billing_starts_on) then
        raise exception 'replacement_overlaps_existing_charge';
      end if;
      update public.billing_obligations set ends_before = p_billing_starts_on where id = v_old.id;
    end if;
    update public.billing_obligations set status = 'active', billing_starts_on = p_billing_starts_on
      where id = p_id returning * into v_row;
  elsif p_action = 'pause' then
    if v_row.status not in ('active', 'paused') then raise exception 'only_active_obligation_can_pause'; end if;
    update public.billing_obligations set status = 'paused' where id = p_id returning * into v_row;
  else
    update public.billing_obligations set status = 'ended' where id = p_id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;

-- Keep the seven-column RPC result contract. Obligation charges have a null
-- subscription_id; their obligation ID is available on the canonical charges row.
create or replace function private.generate_monthly_charges_as_of(p_as_of date)
returns table(charge_id uuid, account_id uuid, subscription_id uuid, amount_cents integer,
  coverage_start date, coverage_end date, due_at date)
language plpgsql set search_path = public, private as $$
#variable_conflict use_column
declare o record; v_start date; v_end date; v_month date;
begin
  if p_as_of is null or not isfinite(p_as_of) then raise exception 'finite_as_of_date_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('public.generate_monthly_charges', 0));
  for o in select b.* from public.billing_obligations b join public.accounts a on a.id = b.account_id
    where b.status = 'active' and a.status = 'active' and b.billing_starts_on <= p_as_of
      and (b.ends_before is null or p_as_of < b.ends_before)
    order by b.id for update of b
  loop
    v_month := date_trunc('month', p_as_of)::date;
    v_start := private.billing_anchor_in_month(o.anchor_date, v_month);
    if v_start > p_as_of then
      v_month := (v_month - interval '1 month')::date;
      v_start := private.billing_anchor_in_month(o.anchor_date, v_month);
    end if;
    if v_start < o.billing_starts_on then continue; end if;
    v_end := private.billing_anchor_in_month(o.anchor_date, (v_month + interval '1 month')::date) - 1;
    return query
      insert into public.charges as c(account_id, billing_obligation_id, amount_cents, currency,
        coverage_start, coverage_end, due_at, status, charge_kind, notes)
      values(o.account_id, o.id, o.amount_cents, o.currency, v_start, v_end, v_start,
        'open', 'monthly_period', format('Recurring obligation: %s', o.label))
      on conflict (billing_obligation_id, coverage_start) where billing_obligation_id is not null do nothing
      returning c.id, c.account_id, c.subscription_id, c.amount_cents, c.coverage_start, c.coverage_end, c.due_at;
  end loop;
end $$;
create or replace function public.generate_monthly_charges()
returns table(charge_id uuid, account_id uuid, subscription_id uuid, amount_cents integer,
  coverage_start date, coverage_end date, due_at date)
language sql volatile set search_path = public, private as $$
  select * from private.generate_monthly_charges_as_of((now() at time zone 'America/New_York')::date);
$$;
comment on function public.generate_monthly_charges() is
  'One charge per explicitly active payer obligation/current anchored period. No legacy subscription fallback or missed-period backfill.';
comment on column public.subscriptions.automatic_billing_starts_at is
  'Legacy compatibility field returned by enrollment/conversion RPCs. Ignored by recurring generation; activate an explicit billing_obligation instead.';

revoke all on function private.billing_anchor_in_month(date,date), private.guard_billing_obligation(),
  private.guard_obligation_charge(), private.audit_billing_obligation(),
  private.generate_monthly_charges_as_of(date), public.generate_monthly_charges(),
  public.create_billing_obligation(uuid,uuid,text,integer,date,uuid[],text,uuid),
  public.transition_billing_obligation(uuid,text,date) from public, anon, authenticated;
grant execute on function private.billing_anchor_in_month(date,date), private.guard_billing_obligation(),
  private.guard_obligation_charge(), private.audit_billing_obligation(),
  private.generate_monthly_charges_as_of(date), public.generate_monthly_charges(),
  public.create_billing_obligation(uuid,uuid,text,integer,date,uuid[],text,uuid),
  public.transition_billing_obligation(uuid,text,date) to service_role;
