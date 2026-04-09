-- Event Ledger Validation Scenarios (Phase 1)
-- Run after migration 0010 has been applied.
-- These checks are designed for day-to-day operational workflows.

-- ============================================================================
-- 0) Baseline sanity
-- ============================================================================

-- Expect >= 1 row after any write in phase-1 tracked tables.
select count(*) as event_count from public.event_ledger;

-- Ensure append-only guard is installed.
select tgname, tgrelid::regclass as table_name
from pg_trigger
where tgname in ('trg_event_ledger_no_update', 'trg_event_ledger_no_delete')
order by tgname;

-- Ensure capture triggers are attached.
select
  c.relname as table_name,
  t.tgname as trigger_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where t.tgname like 'trg_event_capture_%'
order by c.relname, t.tgname;

-- ============================================================================
-- 1) Participant created -> event exists
-- ============================================================================

-- Replace <participant_uuid> with a recently created participant id.
select
  e.id,
  e.occurred_at,
  e.event_name,
  e.participant_id,
  e.payload_after
from public.event_ledger e
where e.event_name = 'participant.created'
  and e.participant_id = '<participant_uuid>'::uuid
order by e.occurred_at desc
limit 5;

-- ============================================================================
-- 2) Pay-per-class charge from attendance -> links participant/subscription/charge
-- ============================================================================

-- Replace <charge_uuid> from create_pay_per_class_charge result.
select
  e.id,
  e.event_name,
  e.charge_id,
  e.subscription_id,
  e.participant_id,
  e.account_id,
  e.payload_after
from public.event_ledger e
where e.charge_id = '<charge_uuid>'::uuid
order by e.occurred_at desc;

-- Expect at least one charge.created event for that charge_id.
select count(*) as charge_created_events
from public.event_ledger e
where e.charge_id = '<charge_uuid>'::uuid
  and e.event_name = 'charge.created';

-- ============================================================================
-- 3) Per-class -> monthly upgrade scenario
-- ============================================================================

-- Replace values from upgrade_per_class_to_monthly response.
select
  e.occurred_at,
  e.event_name,
  e.subscription_id,
  e.participant_id,
  e.payload_before->>'status' as before_status,
  e.payload_after->>'status' as after_status
from public.event_ledger e
where e.subscription_id in (
  '<old_subscription_uuid>'::uuid,
  '<new_subscription_uuid>'::uuid
)
order by e.occurred_at asc;

-- If create_initial_charge=true, ensure an event exists for the initial charge.
select
  e.occurred_at,
  e.event_name,
  e.charge_id,
  e.account_id
from public.event_ledger e
where e.charge_id = '<initial_charge_uuid>'::uuid
order by e.occurred_at desc;

-- ============================================================================
-- 4) Refund/write-off correction flows
-- ============================================================================

-- Replace <payment_uuid> with refunded payment id.
select
  e.occurred_at,
  e.event_name,
  e.payment_id,
  e.account_id,
  e.payload_before->>'status' as before_status,
  e.payload_after->>'status' as after_status
from public.event_ledger e
where e.payment_id = '<payment_uuid>'::uuid
order by e.occurred_at desc;

-- Replace <charge_uuid> with a charge that was written off/updated.
select
  e.occurred_at,
  e.event_name,
  e.charge_id,
  e.payload_before->>'status' as before_status,
  e.payload_after->>'status' as after_status
from public.event_ledger e
where e.charge_id = '<charge_uuid>'::uuid
order by e.occurred_at desc;

-- ============================================================================
-- 5) Participant merge correction flow
-- ============================================================================

-- Replace with canonical and duplicate participant ids.
select
  e.occurred_at,
  e.event_name,
  e.participant_id,
  e.payload_before->>'merged_into_participant_id' as before_merged_into,
  e.payload_after->>'merged_into_participant_id' as after_merged_into
from public.event_ledger e
where e.participant_id in (
  '<canonical_participant_uuid>'::uuid,
  '<duplicate_participant_uuid>'::uuid
)
order by e.occurred_at desc;

-- ============================================================================
-- 6) Operational timeline queries
-- ============================================================================

-- Participant timeline (single feed).
select
  e.occurred_at,
  e.event_name,
  e.event_category,
  e.entity_type,
  e.entity_id,
  e.reason_code
from public.event_ledger e
where e.participant_id = '<participant_uuid>'::uuid
order by e.occurred_at desc
limit 200;

-- Finance timeline for an account.
select
  e.occurred_at,
  e.event_name,
  e.event_category,
  e.account_id,
  e.charge_id,
  e.payment_id,
  e.reason_code
from public.event_ledger e
where e.account_id = '<account_uuid>'::uuid
  and e.event_category = 'billing'
order by e.occurred_at desc
limit 200;

-- ============================================================================
-- 7) Negative checks / operational hardening
-- ============================================================================

-- Unknown event names should be rare and indicate taxonomy drift.
select e.event_name, count(*) as count_rows
from public.event_ledger e
group by e.event_name
order by count_rows desc, e.event_name asc;

-- Rows missing both before and after snapshots can indicate bad trigger plumbing.
select count(*) as rows_without_snapshots
from public.event_ledger e
where e.payload_before is null
  and e.payload_after is null;
