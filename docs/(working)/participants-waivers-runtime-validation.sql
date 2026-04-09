-- Participants/Waivers Runtime Validation
-- Purpose: verify participant + waiver schema behavior against linked DB.
-- Notes:
-- - Read-only checks only (no writes).
-- - "0 rows" on anomaly queries indicates pass.

-- ============================================================================
-- 0) Existence checks (tables + key views)
-- ============================================================================
select
  'table_exists' as check_type,
  t.table_name as object_name
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_name in (
    'participants',
    'waivers',
    'audit_trails',
    'emergency_contacts',
    'waiver_medical_histories',
    'accounts',
    'account_members',
    'subscriptions',
    'attendance_records'
  )
order by t.table_name;

select
  'view_exists' as check_type,
  v.table_name as object_name
from information_schema.views v
where v.table_schema = 'public'
  and v.table_name in (
    'view_waiver_documents',
    'view_ops_waiver_compliance_gaps'
  )
order by v.table_name;

-- ============================================================================
-- 1) Required foreign keys exist
-- ============================================================================
select
  c.conname as fk_name,
  conrelid::regclass::text as source_table,
  confrelid::regclass::text as target_table
from pg_constraint c
where c.contype = 'f'
  and (
    (conrelid::regclass::text = 'waivers' and confrelid::regclass::text = 'participants')
    or (conrelid::regclass::text = 'emergency_contacts' and confrelid::regclass::text = 'waivers')
    or (conrelid::regclass::text = 'emergency_contacts' and confrelid::regclass::text = 'participants')
    or (conrelid::regclass::text = 'waiver_medical_histories' and confrelid::regclass::text = 'waivers')
    or (conrelid::regclass::text = 'account_members' and confrelid::regclass::text = 'participants')
    or (conrelid::regclass::text = 'subscriptions' and confrelid::regclass::text = 'participants')
    or (conrelid::regclass::text = 'attendance_records' and confrelid::regclass::text = 'participants')
  )
order by source_table, target_table, fk_name;

-- ============================================================================
-- 2) Data integrity anomaly checks (expect zero rows)
-- ============================================================================
-- 2a) Orphan waivers
select w.id as waiver_id
from public.waivers w
left join public.participants p on p.id = w.participant_id
where w.participant_id is not null
  and p.id is null
limit 50;

-- 2b) Orphan emergency contacts by waiver
select ec.id as emergency_contact_id
from public.emergency_contacts ec
left join public.waivers w on w.id = ec.waiver_id
where w.id is null
limit 50;

-- 2c) Orphan emergency contacts by participant
select ec.id as emergency_contact_id
from public.emergency_contacts ec
left join public.participants p on p.id = ec.participant_id
where p.id is null
limit 50;

-- 2d) Orphan waiver medical histories
select mh.id as waiver_medical_history_id
from public.waiver_medical_histories mh
left join public.waivers w on w.id = mh.waiver_id
where w.id is null
limit 50;

-- 2e) Merged participants should not remain active on child ops tables
-- (account_members, subscriptions, attendance_records)
select
  p.id as merged_participant_id,
  p.merged_into_participant_id,
  count(am.id)::integer as account_member_refs,
  count(s.id)::integer as subscription_refs,
  count(ar.id)::integer as attendance_refs
from public.participants p
left join public.account_members am on am.participant_id = p.id
left join public.subscriptions s on s.participant_id = p.id
left join public.attendance_records ar on ar.participant_id = p.id
where p.merged_into_participant_id is not null
group by p.id, p.merged_into_participant_id
having count(am.id) > 0 or count(s.id) > 0 or count(ar.id) > 0
order by p.id
limit 50;

-- ============================================================================
-- 3) RLS / policy checks
-- ============================================================================
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'participants',
    'waivers',
    'audit_trails',
    'emergency_contacts',
    'waiver_medical_histories',
    'accounts',
    'account_members',
    'attendance_records'
  )
order by c.relname;

select
  pol.schemaname,
  pol.tablename,
  pol.policyname
from pg_policies pol
where pol.schemaname = 'public'
  and pol.tablename in (
    'participants',
    'waivers',
    'audit_trails',
    'emergency_contacts',
    'waiver_medical_histories',
    'accounts',
    'account_members',
    'attendance_records'
  )
order by pol.tablename, pol.policyname;

-- ============================================================================
-- 4) Reporting shape sanity
-- ============================================================================
select * from public.view_waiver_documents limit 20;
select * from public.view_ops_waiver_compliance_gaps limit 20;

-- Any compliance row should have has_compliance_gap = true and one missing flag.
select *
from public.view_ops_waiver_compliance_gaps v
where v.has_compliance_gap is distinct from true
  or not (v.missing_waiver or v.missing_emergency_contact or v.missing_medical_history)
limit 50;

