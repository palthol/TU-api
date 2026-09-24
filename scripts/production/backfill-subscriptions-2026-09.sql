-- Production subscription backfill: Aaron Finazzo + Finsley/Davenport household
-- Created 2026-09-23.
--
-- IMPORTANT:
--   * This is NOT local-development seed data and must NOT be added to supabase/seed.sql.
--   * Review before executing against production.
--   * This script intentionally leaves automatic_billing_starts_at NULL.
--     The current monthly generator creates calendar-month coverage, so a 26th/29th
--     billing anchor would be lost after the first generated charge.
--   * The current database also does not persist or auto-apply the household
--     100% / 70% / 50% family pricing policy. Charge-level discounts exist, but
--     they are not automatically attached to recurring generated charges.
--
-- Known pricing:
--   Aaron Finazzo:
--     Core Group Plan = $150.00/month
--     Intended recurring billing anchor = 26th
--
--   William Finsley + Natalie Davenport:
--     2 x Core Group Plan gross = $300.00/month
--     Standard family pricing:
--       member 1 = 100% x $150.00 = $150.00
--       member 2 =  70% x $150.00 = $105.00
--       standard household total = $255.00
--     Actual grandfathered/negotiated household total = $249.75
--     Difference from standard family price = additional $5.25 discount
--     Total discount from gross = $50.25
--       standard second-member discount = $45.00
--       additional household discount    =  $5.25
--
-- Current paid-through information:
--   William/Natalie are covered through 2026-09-28.
--   Intended next billing date = 2026-09-29.
--
-- Historical baseline:
--   Aaron membership began 2026-06-03.
--   Finsley/Davenport current known paid coverage window is treated as beginning
--   2026-08-29 and ending 2026-09-28. If an earlier membership start date is
--   later documented, starts_at can be corrected without creating historical debt.

begin;

-- ---------------------------------------------------------------------------
-- Constants / preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_core_plan_id uuid;
  v_core_price integer;
  v_count integer;
begin
  select id, price_cents
    into v_core_plan_id, v_core_price
  from public.plan_definitions
  where name = 'Core Group Plan'
    and is_active = true;

  if v_core_plan_id is null then
    raise exception 'Core Group Plan is missing or inactive';
  end if;

  if v_core_price <> 15000 then
    raise exception 'Core Group Plan expected 15000 cents, found %', v_core_price;
  end if;

  -- Verify canonical participants by both UUID and expected name.
  if not exists (
    select 1 from public.participants
    where id = 'b258d6cf-b495-46b3-bb96-0a2369262305'::uuid
      and full_name = 'Aaron Finazzo'
      and merged_into_participant_id is null
  ) then
    raise exception 'Aaron Finazzo participant record does not match expected production identity';
  end if;

  if not exists (
    select 1 from public.participants
    where id = '6cef1b3e-8097-4ff0-8435-6e5fd5c5a327'::uuid
      and full_name = 'William Finsley'
      and merged_into_participant_id is null
  ) then
    raise exception 'William Finsley participant record does not match expected production identity';
  end if;

  if not exists (
    select 1 from public.participants
    where id = '3763a1cc-e336-4d27-b0db-724d4f7954f2'::uuid
      and full_name = 'Natalie Davenport'
      and merged_into_participant_id is null
  ) then
    raise exception 'Natalie Davenport participant record does not match expected production identity';
  end if;

  -- Verify the intended billing accounts still exist and are active.
  if not exists (
    select 1 from public.accounts
    where id = '3c688d54-0fa3-494e-9f71-aa45c9faf4dd'::uuid
      and status = 'active'
  ) then
    raise exception 'Aaron billing account missing or inactive';
  end if;

  if not exists (
    select 1 from public.accounts
    where id = 'e5ab165e-4cd5-4431-863d-706c29c180a9'::uuid
      and status = 'active'
  ) then
    raise exception 'William Finsley billing account missing or inactive';
  end if;

  -- Natalie's legacy individual account must still be financially empty before
  -- we detach her from it and mark it inactive.
  select
      (select count(*) from public.subscriptions where account_id = '5fa8791e-2feb-4176-95d4-8140652d5ce2'::uuid)
    + (select count(*) from public.charges where account_id = '5fa8791e-2feb-4176-95d4-8140652d5ce2'::uuid)
    + (select count(*) from public.payments where account_id = '5fa8791e-2feb-4176-95d4-8140652d5ce2'::uuid)
    + (select count(*) from public.receipts where account_id = '5fa8791e-2feb-4176-95d4-8140652d5ce2'::uuid)
    + (select count(*) from public.personal_finance_entries where account_id = '5fa8791e-2feb-4176-95d4-8140652d5ce2'::uuid)
  into v_count;

  if v_count <> 0 then
    raise exception 'Natalie legacy account now has financial history; manual reconciliation required';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Household normalization
-- ---------------------------------------------------------------------------

-- Add Natalie to William's account. William's account remains the payer/billing
-- anchor because its primary contact is William and both share his contact data.
insert into public.account_members (
  account_id,
  participant_id,
  role
)
select
  'e5ab165e-4cd5-4431-863d-706c29c180a9'::uuid,
  '3763a1cc-e336-4d27-b0db-724d4f7954f2'::uuid,
  'member'
where not exists (
  select 1
  from public.account_members
  where account_id = 'e5ab165e-4cd5-4431-863d-706c29c180a9'::uuid
    and participant_id = '3763a1cc-e336-4d27-b0db-724d4f7954f2'::uuid
);

-- Remove the now-redundant participant binding from Natalie's empty individual
-- account so future "find default account" logic cannot accidentally select it.
delete from public.account_members
where account_id = '5fa8791e-2feb-4176-95d4-8140652d5ce2'::uuid
  and participant_id = '3763a1cc-e336-4d27-b0db-724d4f7954f2'::uuid;

update public.accounts
set
  status = 'inactive',
  notes = concat_ws(
    ' | ',
    nullif(btrim(coalesce(notes, '')), ''),
    'Superseded during 2026-09 subscription backfill; Natalie Davenport bills under William Finsley household account e5ab165e-4cd5-4431-863d-706c29c180a9.'
  ),
  updated_at = now()
where id = '5fa8791e-2feb-4176-95d4-8140652d5ce2'::uuid;

-- ---------------------------------------------------------------------------
-- Subscription backfill
-- ---------------------------------------------------------------------------

-- Aaron Finazzo
insert into public.subscriptions (
  account_id,
  participant_id,
  plan_definition_id,
  status,
  starts_at,
  ends_at,
  automatic_billing_starts_at,
  notes
)
select
  '3c688d54-0fa3-494e-9f71-aa45c9faf4dd'::uuid,
  'b258d6cf-b495-46b3-bb96-0a2369262305'::uuid,
  pd.id,
  'active',
  '2026-06-03'::date,
  null,
  null,
  'Production backfill 2026-09-23. Core Group Plan $150.00/month. Intended recurring billing anchor: 26th. Automatic billing intentionally disabled until anchored monthly coverage is supported.'
from public.plan_definitions pd
where pd.name = 'Core Group Plan'
  and pd.is_active = true
  and not exists (
    select 1
    from public.subscriptions s
    where s.participant_id = 'b258d6cf-b495-46b3-bb96-0a2369262305'::uuid
      and s.status = 'active'
  );

-- William Finsley
insert into public.subscriptions (
  account_id,
  participant_id,
  plan_definition_id,
  status,
  starts_at,
  ends_at,
  automatic_billing_starts_at,
  notes
)
select
  'e5ab165e-4cd5-4431-863d-706c29c180a9'::uuid,
  '6cef1b3e-8097-4ff0-8435-6e5fd5c5a327'::uuid,
  pd.id,
  'active',
  '2026-08-29'::date,
  null,
  null,
  'Production backfill 2026-09-23. Finsley/Davenport household. Core Group Plan. Household paid through 2026-09-28; intended next billing date 2026-09-29. Household target $249.75/month. Automatic billing disabled pending anchored-cycle + recurring family-discount support.'
from public.plan_definitions pd
where pd.name = 'Core Group Plan'
  and pd.is_active = true
  and not exists (
    select 1
    from public.subscriptions s
    where s.participant_id = '6cef1b3e-8097-4ff0-8435-6e5fd5c5a327'::uuid
      and s.status = 'active'
  );

-- Natalie Davenport
insert into public.subscriptions (
  account_id,
  participant_id,
  plan_definition_id,
  status,
  starts_at,
  ends_at,
  automatic_billing_starts_at,
  notes
)
select
  'e5ab165e-4cd5-4431-863d-706c29c180a9'::uuid,
  '3763a1cc-e336-4d27-b0db-724d4f7954f2'::uuid,
  pd.id,
  'active',
  '2026-08-29'::date,
  null,
  null,
  'Production backfill 2026-09-23. Finsley/Davenport household. Core Group Plan. Second household member standard price = 70% of $150 = $105; household also receives an additional $5.25 negotiated discount, producing $249.75 total. Automatic billing disabled pending recurring discount support.'
from public.plan_definitions pd
where pd.name = 'Core Group Plan'
  and pd.is_active = true
  and not exists (
    select 1
    from public.subscriptions s
    where s.participant_id = '3763a1cc-e336-4d27-b0db-724d4f7954f2'::uuid
      and s.status = 'active'
  );

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification / pricing review
-- ---------------------------------------------------------------------------

select
  p.full_name,
  a.primary_contact_name as billing_account,
  pd.name as plan_name,
  pd.price_cents as catalog_price_cents,
  s.starts_at,
  s.automatic_billing_starts_at,
  s.status,
  s.notes
from public.subscriptions s
join public.participants p on p.id = s.participant_id
join public.accounts a on a.id = s.account_id
join public.plan_definitions pd on pd.id = s.plan_definition_id
where s.participant_id in (
  'b258d6cf-b495-46b3-bb96-0a2369262305'::uuid,
  '6cef1b3e-8097-4ff0-8435-6e5fd5c5a327'::uuid,
  '3763a1cc-e336-4d27-b0db-724d4f7954f2'::uuid
)
order by a.primary_contact_name, p.full_name;

-- Expected household math. This is informational only; there is currently no
-- recurring household-pricing policy table that enforces these values.
select *
from (
  values
    (
      'Aaron Finazzo',
      15000, -- gross
      0,     -- standard family discount
      0,     -- additional negotiated discount
      15000  -- expected net
    ),
    (
      'Finsley/Davenport household',
      30000, -- 2 x Core @ $150
      4500,  -- 30% off second member ($150 -> $105)
      525,   -- additional negotiated adjustment
      24975  -- expected household net
    )
) as pricing(
  household,
  gross_cents,
  standard_family_discount_cents,
  additional_discount_cents,
  expected_net_cents
);
