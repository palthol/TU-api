-- Explicit charge discount line items (never hidden in net price).
-- Supports flat amount and percentage discounts while keeping net due >= 0.

create table if not exists public.charge_discounts (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges(id) on delete cascade,
  discount_type text not null,
  percent_basis_points integer,
  flat_amount_cents integer,
  applied_amount_cents integer not null,
  label text not null,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  constraint check_charge_discount_type check (discount_type in ('flat', 'percent')),
  constraint check_charge_discount_shape check (
    (discount_type = 'flat' and flat_amount_cents is not null and flat_amount_cents > 0 and percent_basis_points is null)
    or
    (discount_type = 'percent' and percent_basis_points is not null and percent_basis_points > 0 and percent_basis_points <= 10000 and flat_amount_cents is null)
  ),
  constraint check_charge_discount_applied_amount check (applied_amount_cents > 0)
);

create index if not exists idx_charge_discounts_charge_id on public.charge_discounts(charge_id);

create or replace function public.charge_discounts_set_applied_amount()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_gross integer;
begin
  select c.amount_cents into v_gross
  from public.charges c
  where c.id = new.charge_id;

  if v_gross is null then
    raise exception 'charge not found for discount';
  end if;

  if new.discount_type = 'flat' then
    new.applied_amount_cents := least(v_gross, new.flat_amount_cents);
  elsif new.discount_type = 'percent' then
    new.applied_amount_cents := greatest(1, floor((v_gross * new.percent_basis_points)::numeric / 10000.0)::integer);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_charge_discounts_set_applied_amount on public.charge_discounts;
create trigger trg_charge_discounts_set_applied_amount
  before insert or update on public.charge_discounts
  for each row execute function public.charge_discounts_set_applied_amount();

-- Update totals guard: affiliate credits + write-offs + explicit discounts must not exceed gross.
create or replace function public.enforce_charge_adjustment_totals()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cid uuid;
  v_gross integer;
  v_affiliate integer;
  v_writeoffs integer;
  v_discounts integer;
begin
  v_cid := coalesce(new.charge_id, old.charge_id);
  select c.amount_cents into v_gross
  from public.charges c
  where c.id = v_cid;

  if v_gross is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(aca.amount_cents), 0)::integer into v_affiliate
  from public.affiliate_credit_applications aca
  where aca.charge_id = v_cid;

  select coalesce(sum(ca.amount_cents), 0)::integer into v_writeoffs
  from public.charge_adjustments ca
  where ca.charge_id = v_cid
    and ca.adjustment_type = 'write_off';

  select coalesce(sum(cd.applied_amount_cents), 0)::integer into v_discounts
  from public.charge_discounts cd
  where cd.charge_id = v_cid;

  if v_affiliate + v_writeoffs + v_discounts > v_gross then
    raise exception 'Adjustments, affiliate credits, and discounts (%) exceed charge gross (%) for charge %',
      v_affiliate + v_writeoffs + v_discounts, v_gross, v_cid;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_affiliate_application_totals()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_charge_id uuid;
  v_gross integer;
  v_affiliate integer;
  v_writeoffs integer;
  v_discounts integer;
begin
  v_charge_id := coalesce(new.charge_id, old.charge_id);
  select c.amount_cents into v_gross from public.charges c where c.id = v_charge_id;
  if v_gross is null then
    return coalesce(new, old);
  end if;
  select coalesce(sum(aca.amount_cents), 0)::integer into v_affiliate
  from public.affiliate_credit_applications aca where aca.charge_id = v_charge_id;
  select coalesce(sum(ca.amount_cents), 0)::integer into v_writeoffs
  from public.charge_adjustments ca
  where ca.charge_id = v_charge_id and ca.adjustment_type = 'write_off';
  select coalesce(sum(cd.applied_amount_cents), 0)::integer into v_discounts
  from public.charge_discounts cd
  where cd.charge_id = v_charge_id;
  if v_affiliate + v_writeoffs + v_discounts > v_gross then
    raise exception 'Affiliate credits, write-offs, and discounts exceed charge gross for charge %', v_charge_id;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_charge_discount_totals()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cid uuid;
  v_gross integer;
  v_affiliate integer;
  v_writeoffs integer;
  v_discounts integer;
begin
  v_cid := coalesce(new.charge_id, old.charge_id);
  select c.amount_cents into v_gross
  from public.charges c
  where c.id = v_cid;
  if v_gross is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(aca.amount_cents), 0)::integer into v_affiliate
  from public.affiliate_credit_applications aca
  where aca.charge_id = v_cid;
  select coalesce(sum(ca.amount_cents), 0)::integer into v_writeoffs
  from public.charge_adjustments ca
  where ca.charge_id = v_cid and ca.adjustment_type = 'write_off';
  select coalesce(sum(cd.applied_amount_cents), 0)::integer into v_discounts
  from public.charge_discounts cd
  where cd.charge_id = v_cid;

  if v_affiliate + v_writeoffs + v_discounts > v_gross then
    raise exception 'Affiliate credits, write-offs, and discounts exceed charge gross for charge %', v_cid;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_charge_discounts_totals on public.charge_discounts;
create trigger trg_charge_discounts_totals
  after insert or update or delete on public.charge_discounts
  for each row execute function public.enforce_charge_discount_totals();

-- Keep the same view shape, but include discounts in net_due math.
create or replace view public.view_charge_net
  with (security_invoker = on) as
select
  c.id as charge_id,
  c.account_id,
  c.subscription_id,
  c.amount_cents as gross_cents,
  coalesce(aca.credit_applied_cents, 0)::integer as credit_applied_cents,
  coalesce(adj.write_off_cents, 0)::integer as write_off_cents,
  (c.amount_cents
    - coalesce(aca.credit_applied_cents, 0)
    - coalesce(adj.write_off_cents, 0)
    - coalesce(disc.discount_cents, 0))::integer as net_due_cents,
  c.status,
  c.due_at
from public.charges c
left join (
  select
    aca.charge_id,
    coalesce(sum(aca.amount_cents), 0)::integer as credit_applied_cents
  from public.affiliate_credit_applications aca
  group by aca.charge_id
) aca on aca.charge_id = c.id
left join (
  select
    ca.charge_id,
    coalesce(sum(ca.amount_cents), 0)::integer as write_off_cents
  from public.charge_adjustments ca
  where ca.adjustment_type = 'write_off'
  group by ca.charge_id
) adj on adj.charge_id = c.id
left join (
  select
    cd.charge_id,
    coalesce(sum(cd.applied_amount_cents), 0)::integer as discount_cents
  from public.charge_discounts cd
  group by cd.charge_id
) disc on disc.charge_id = c.id;

alter table public.charge_discounts enable row level security;

create policy "admin_all_charge_discounts" on public.charge_discounts
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.charge_discounts to service_role;

-- Auditability guard:
-- Once discount line-items exist for a charge, lock charge.amount_cents.
-- Corrections must happen via explicit finance events (void/reissue/adjustment),
-- not by silently mutating the original charge gross.
create or replace function public.prevent_discounted_charge_amount_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.amount_cents is distinct from new.amount_cents then
    if exists (
      select 1
      from public.charge_discounts cd
      where cd.charge_id = old.id
      limit 1
    ) then
      raise exception
        'cannot update charges.amount_cents for charge % after discounts exist; use explicit correction events',
        old.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_charges_lock_amount_when_discounted on public.charges;
create trigger trg_charges_lock_amount_when_discounted
  before update on public.charges
  for each row execute function public.prevent_discounted_charge_amount_mutation();

comment on table public.charge_discounts is
  'Explicit charge-level discounts (flat or percent) represented as auditable line items.';
