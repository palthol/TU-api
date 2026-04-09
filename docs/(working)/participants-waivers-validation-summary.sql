-- Participants/Waivers Validation Summary (single-result report)
with
required_tables as (
  select unnest(array[
    'participants',
    'waivers',
    'audit_trails',
    'emergency_contacts',
    'waiver_medical_histories',
    'accounts',
    'account_members',
    'subscriptions',
    'attendance_records'
  ]) as table_name
),
required_views as (
  select unnest(array[
    'view_waiver_documents',
    'view_ops_waiver_compliance_gaps'
  ]) as view_name
),
table_counts as (
  select count(*)::int as found
  from information_schema.tables t
  join required_tables r on r.table_name = t.table_name
  where t.table_schema = 'public'
),
view_counts as (
  select count(*)::int as found
  from information_schema.views v
  join required_views r on r.view_name = v.table_name
  where v.table_schema = 'public'
),
fk_counts as (
  select count(*)::int as found
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
),
rls_counts as (
  select count(*)::int as enabled_count
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
    and c.relrowsecurity = true
),
policy_counts as (
  select count(*)::int as found
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'admin_all_participants',
      'admin_all_waivers',
      'admin_all_audit_trails',
      'admin_all_emergency_contacts',
      'admin_all_waiver_medical_histories',
      'admin_all_accounts',
      'admin_all_account_members',
      'admin_all_attendance_records'
    )
),
anomaly_counts as (
  select
    (select count(*) from public.waivers w left join public.participants p on p.id = w.participant_id where w.participant_id is not null and p.id is null)::int as orphan_waivers,
    (select count(*) from public.emergency_contacts ec left join public.waivers w on w.id = ec.waiver_id where w.id is null)::int as orphan_contacts_by_waiver,
    (select count(*) from public.emergency_contacts ec left join public.participants p on p.id = ec.participant_id where p.id is null)::int as orphan_contacts_by_participant,
    (select count(*) from public.waiver_medical_histories mh left join public.waivers w on w.id = mh.waiver_id where w.id is null)::int as orphan_medical_histories,
    (select count(*) from public.view_ops_waiver_compliance_gaps v where v.has_compliance_gap is distinct from true or not (v.missing_waiver or v.missing_emergency_contact or v.missing_medical_history))::int as invalid_compliance_rows
)
select
  (select found from table_counts) as found_tables,
  (select count(*) from required_tables)::int as expected_tables,
  (select found from view_counts) as found_views,
  (select count(*) from required_views)::int as expected_views,
  (select found from fk_counts) as found_target_fks,
  (select enabled_count from rls_counts) as rls_enabled_tables,
  (select found from policy_counts) as found_admin_policies,
  a.orphan_waivers,
  a.orphan_contacts_by_waiver,
  a.orphan_contacts_by_participant,
  a.orphan_medical_histories,
  a.invalid_compliance_rows
from anomaly_counts a;

