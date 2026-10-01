-- Disposable database only, after catalog seed and before obligation migrations.
insert into participants(id,full_name,date_of_birth,email)
 values('c0000000-0000-4000-8000-000000000001','[TU-TEST] Migration preservation','1990-01-01','migration-preservation@tu-test.invalid');
insert into accounts(id,primary_contact_name,primary_contact_email)
 values('c0000000-0000-4000-8000-000000000010','[TU-TEST] Migration payer','migration-payer@tu-test.invalid');
insert into account_members(account_id,participant_id)
 values('c0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000001');
insert into subscriptions(id,account_id,participant_id,plan_definition_id,starts_at,automatic_billing_starts_at)
 select 'c0000000-0000-4000-8000-000000000020','c0000000-0000-4000-8000-000000000010',
 'c0000000-0000-4000-8000-000000000001',id,'2020-01-01','2020-02-01'
 from plan_definitions where name='Core Group Plan';
insert into charges(id,account_id,subscription_id,amount_cents,coverage_start,coverage_end,due_at,charge_kind)
 values('c0000000-0000-4000-8000-000000000030','c0000000-0000-4000-8000-000000000010',
 'c0000000-0000-4000-8000-000000000020',12300,'2020-01-01','2020-01-31','2020-01-01','monthly_period');
select record_payment('c0000000-0000-4000-8000-000000000010',2300,'cash','pgtap',
 '[{"charge_id":"c0000000-0000-4000-8000-000000000030","amount_cents":2300}]'::jsonb,
 null,null,null,false,'migration-preservation');
create temp table migration_history_snapshot as
 select 'subscriptions' as source,to_jsonb(s) as row from subscriptions s where id='c0000000-0000-4000-8000-000000000020'
 union all select 'charges',to_jsonb(c) from charges c where id='c0000000-0000-4000-8000-000000000030'
 union all select 'payments',to_jsonb(p) from payments p where idempotency_key='migration-preservation'
 union all select 'allocations',to_jsonb(a) from payment_allocations a where charge_id='c0000000-0000-4000-8000-000000000030';
