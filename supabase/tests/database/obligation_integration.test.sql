begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('b0000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.today() returns date language sql stable as $$
 select (now() at time zone 'America/New_York')::date
$$;
insert into participants(id,full_name,date_of_birth,email)
 select pg_temp.uid(n),'[TU-TEST] Reporting '||n,'1990-01-01','report-'||n||'@tu-test.invalid' from generate_series(1,4) n;
insert into accounts(id,primary_contact_name,primary_contact_email)
 values(pg_temp.uid(10),'[TU-TEST] Payer','report-payer@tu-test.invalid');
insert into account_members(account_id,participant_id)
 select pg_temp.uid(10),pg_temp.uid(n) from generate_series(1,4) n;
select create_billing_obligation(pg_temp.uid(20),pg_temp.uid(10),'Shared access',12340,'2020-01-01',array[pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3)]);
select transition_billing_obligation(pg_temp.uid(20),'activate','2020-01-01');
select create_billing_obligation(pg_temp.uid(21),pg_temp.uid(10),'Coaching',6780,'2020-01-01');
select transition_billing_obligation(pg_temp.uid(21),'activate','2020-01-01');
select * from private.generate_monthly_charges_as_of(pg_temp.today());
select is((select count(*) from view_payer_charge_board where account_id=pg_temp.uid(10)),2::bigint,'two obligations and three participants produce exactly two report rows');
select is((select jsonb_array_length(covered_participants) from view_payer_charge_board where billing_obligation_id=pg_temp.uid(20)),3,'participant coverage is nested without multiplying debt');
select is((select sum(outstanding_cents)::bigint from view_payer_charge_board where account_id=pg_temp.uid(10)),19120::bigint,'report total equals actual ledger debt');
insert into charge_discounts(charge_id,discount_type,flat_amount_cents,label)
 select id,'flat',340,'[TU-TEST] discount' from charges where billing_obligation_id=pg_temp.uid(20);
select record_payment(pg_temp.uid(10),2000,'cash','pgtap',
 (select jsonb_build_array(jsonb_build_object('charge_id',id,'amount_cents',2000)) from charges where billing_obligation_id=pg_temp.uid(20)),null,null,null,false,'integration-payment');
select is((select net_due_cents from view_payer_charge_board where billing_obligation_id=pg_temp.uid(20)),12000,'report uses canonical discounted balance');
select is((select allocated_cents from view_payer_charge_board where billing_obligation_id=pg_temp.uid(20)),2000::bigint,'report exposes allocation total');
select is((select outstanding_cents from view_payer_charge_board where billing_obligation_id=pg_temp.uid(20)),10000::bigint,'reminder balance subtracts allocations from net due');
select is((select count(*) from view_payer_payment_reminders where account_id=pg_temp.uid(10)),2::bigint,'one reminder per unpaid charge');
select transition_billing_obligation(pg_temp.uid(21),'end');
select is((select count(*) from view_payer_payment_reminders where billing_obligation_id=pg_temp.uid(21)),1::bigint,'ended agreement retains unpaid debt in reminders');
update charges set status='void' where billing_obligation_id=pg_temp.uid(21);
select is((select outstanding_cents from view_payer_charge_board where billing_obligation_id=pg_temp.uid(21)),0::bigint,'void has zero collectible balance');
select is((select count(*) from view_payer_payment_reminders where billing_obligation_id=pg_temp.uid(21)),0::bigint,'void excluded from reminders');
select record_payment_refund((select id from payments where idempotency_key='integration-payment'),500,'[TU-TEST] refund','pgtap','integration-refund');
select is((select outstanding_cents from view_payer_charge_board where billing_obligation_id=pg_temp.uid(20)),10500::bigint,'refund increases reported outstanding through remaining allocations');
insert into charge_adjustments(charge_id,amount_cents,reason)
 select id,500,'[TU-TEST] write-off' from charges where billing_obligation_id=pg_temp.uid(20);
select is((select outstanding_cents from view_payer_charge_board where billing_obligation_id=pg_temp.uid(20)),10000::bigint,'write-off reduces outstanding');
insert into charges(id,account_id,amount_cents,coverage_start,coverage_end,due_at)
 values(pg_temp.uid(40),pg_temp.uid(10),100,pg_temp.today(),pg_temp.today(),pg_temp.today()+3),
       (pg_temp.uid(41),pg_temp.uid(10),100,pg_temp.today(),pg_temp.today(),pg_temp.today()+4),
       (pg_temp.uid(42),pg_temp.uid(10),100,pg_temp.today()-2,pg_temp.today()-1,pg_temp.today()-1);
select is((select reminder_bucket from view_payer_payment_reminders where charge_id=pg_temp.uid(40)),'due_soon','three-day boundary includes legacy/manual debt once');
select is((select count(*) from view_payer_payment_reminders where charge_id=pg_temp.uid(41)),0::bigint,'four-day future debt excluded');
select is((select days_late from view_payer_payment_reminders where charge_id=pg_temp.uid(42)),1,'overdue uses New York business date');
select record_payment(pg_temp.uid(10),100,'cash','pgtap',jsonb_build_array(jsonb_build_object('charge_id',pg_temp.uid(40),'amount_cents',100)),null,null,null,false);
select is((select count(*) from view_payer_payment_reminders where charge_id=pg_temp.uid(40)),0::bigint,'fully paid debt excluded');
-- Capture all financial state, then enroll/change access without adding any debt.
create temp table before_debt as select id,to_jsonb(c) as row from charges c;
create temp table before_terms as select id,to_jsonb(b) as row from billing_obligations b;
select lives_ok($$select enroll_obligation_entitlement(pg_temp.uid(50),pg_temp.uid(20),pg_temp.uid(1),(select id from plan_definitions where name='Core Group Plan'))$$,'covered enrollment succeeds');
select is((select automatic_billing_starts_at from subscriptions where id=pg_temp.uid(50)),null::date,'new covered enrollment has no legacy automation baseline');
select throws_ok($$select enroll_obligation_entitlement(pg_temp.uid(50),pg_temp.uid(20),pg_temp.uid(1),(select id from plan_definitions where name='Core Group Plan'))$$,'23505','subscription_id_already_exists','repeated enrollment UUID cannot add enrollment');
select throws_ok($$select enroll_obligation_entitlement(pg_temp.uid(51),pg_temp.uid(20),pg_temp.uid(1),(select id from plan_definitions where name='Core Group Plan'))$$,'P0001','overlapping_active_subscription','different UUID cannot double enroll through covered path');
select throws_ok($$select enroll_obligation_entitlement(pg_temp.uid(51),pg_temp.uid(20),pg_temp.uid(1),(select id from plan_definitions where name='Unlimited Group Plan'),pg_temp.uid(50))$$,'P0001','invalid_entitlement_predecessor','same-day predecessor cannot get invalid end date');
insert into subscriptions(id,account_id,participant_id,plan_definition_id,starts_at)
 select pg_temp.uid(52),pg_temp.uid(10),pg_temp.uid(2),id,pg_temp.today()-10 from plan_definitions where name='Core Group Plan';
select lives_ok($$select enroll_obligation_entitlement(pg_temp.uid(53),pg_temp.uid(20),pg_temp.uid(2),(select id from plan_definitions where name='Unlimited Group Plan'),pg_temp.uid(52))$$,'entitlement-only plan replacement succeeds');
select is((select ends_at from subscriptions where id=pg_temp.uid(52)),pg_temp.today()-1,'prior enrollment retains historical dates up to yesterday');
select is((select starts_at from subscriptions where id=pg_temp.uid(53)),pg_temp.today(),'new access begins on New York business date');
select is((select plan_definition_id from subscriptions where id=pg_temp.uid(53)),(select id from plan_definitions where name='Unlimited Group Plan'),'new access uses selected plan');
select throws_ok($$select enroll_obligation_entitlement(pg_temp.uid(54),pg_temp.uid(20),pg_temp.uid(4),(select id from plan_definitions where name='Core Group Plan'))$$,'P0001','participant_not_covered_by_obligation','unlinked participant cannot claim agreement coverage');
select throws_ok($$select enroll_obligation_entitlement(pg_temp.uid(54),pg_temp.uid(21),pg_temp.uid(3),(select id from plan_definitions where name='Core Group Plan'))$$,'P0001','active_obligation_required','ended obligation cannot grant access');
-- An invalid plan cannot partially end prior access.
select throws_ok($$select enroll_obligation_entitlement(pg_temp.uid(54),pg_temp.uid(20),pg_temp.uid(2),pg_temp.uid(999),pg_temp.uid(53))$$,'P0001','active_monthly_plan_required','invalid target plan fails atomically');
select is((select ends_at from subscriptions where id=pg_temp.uid(53)),null::date,'failed replacement preserves prior access');
select is((select count(*) from charges),(select count(*) from before_debt),'access operations create no extra charges');
select is((select count(*) from before_debt h join charges c using(id) where h.row=to_jsonb(c)),(select count(*) from before_debt),'access operations preserve every historical charge');
select is((select count(*) from before_terms h join billing_obligations b using(id) where h.row=to_jsonb(b)),(select count(*) from before_terms),'access operations do not mutate agreed terms or lifecycle');
-- Regression: A -> B starts in June, C cannot replace B starting in April.
select create_billing_obligation(pg_temp.uid(60),pg_temp.uid(10),'Ancestor',400,'2040-01-01');
select transition_billing_obligation(pg_temp.uid(60),'activate','2040-01-01');
select create_billing_obligation(pg_temp.uid(61),pg_temp.uid(10),'Future replacement',500,'2040-01-01','{}',null,pg_temp.uid(60));
select transition_billing_obligation(pg_temp.uid(61),'activate','2040-06-01');
select create_billing_obligation(pg_temp.uid(62),pg_temp.uid(10),'Invalid early descendant',600,'2040-01-01','{}',null,pg_temp.uid(61));
select throws_ok($$select transition_billing_obligation(pg_temp.uid(62),'activate','2040-04-01')$$,'P0001','replacement_precedes_previous_billing_start','replacement chain cannot overlap ancestor before predecessor starts');
select is((select ends_before from billing_obligations where id=pg_temp.uid(61)),null::date,'rejected chain cutover does not alter predecessor');
select is((select status from billing_obligations where id=pg_temp.uid(62)),'draft','rejected chain cutover leaves descendant draft');
select is((select count(*) from private.generate_monthly_charges_as_of('2040-04-01') where amount_cents in (400,500,600)),1::bigint,'only ancestor bills before valid chain cutover');
select lives_ok($$select transition_billing_obligation(pg_temp.uid(61),'activate','2040-06-01')$$,'repeated activation remains a no-op');
select ok(not has_table_privilege('anon','view_payer_charge_board','SELECT'),'anon cannot read payer report');
select ok(not has_table_privilege('authenticated','view_payer_payment_reminders','SELECT'),'client auth cannot read payer reminders directly');
select ok(not has_function_privilege('authenticated','enroll_obligation_entitlement(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'entitlement RPC service-only');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='view_payer_charge_board'::regclass),'payer report uses invoker security');
grant usage on schema extensions to service_role;
set local role service_role;
select lives_ok($$select * from view_payer_charge_board$$,'service role can query canonical payer report');
select lives_ok($$select * from view_payer_payment_reminders$$,'service role can query payer reminders');
select lives_ok($$select enroll_obligation_entitlement('b0000000-0000-4000-8000-000000000055','b0000000-0000-4000-8000-000000000020','b0000000-0000-4000-8000-000000000003',(select id from plan_definitions where name='Core Group Plan'))$$,'service role can enroll with triggers and grants');
reset role;
select * from finish();
rollback;
