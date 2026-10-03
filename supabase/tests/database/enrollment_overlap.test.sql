begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('d0000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into participants(id,full_name,date_of_birth,email)
 select pg_temp.uid(n),'[TU-TEST] Enrollment overlap '||n,'1990-01-01','overlap-'||n||'@tu-test.invalid' from generate_series(1,3) n;
insert into accounts(id,primary_contact_name) values(pg_temp.uid(10),'[TU-TEST] Enrollment payer'),(pg_temp.uid(11),'[TU-TEST] Other payer');
insert into account_members(account_id,participant_id)
 select pg_temp.uid(10),pg_temp.uid(n) from generate_series(1,3) n;
insert into account_members(account_id,participant_id) values(pg_temp.uid(11),pg_temp.uid(1));
select create_billing_obligation(pg_temp.uid(20),pg_temp.uid(10),'[TU-TEST] Covered',12340,'2000-01-01',array[pg_temp.uid(1)]);
select transition_billing_obligation(pg_temp.uid(20),'activate','2000-01-01');
select enroll_obligation_entitlement(pg_temp.uid(30),pg_temp.uid(20),pg_temp.uid(1),(select id from plan_definitions where name='Core Group Plan'));
select throws_ok($$select create_subscription(pg_temp.uid(1),(select id from plan_definitions where name='Core Group Plan'),current_date,null,pg_temp.uid(10),true)$$,
 'P0001','overlapping_active_subscription','legacy cannot enroll over covered access');
select throws_ok($$select create_subscription(pg_temp.uid(1),(select id from plan_definitions where name='Core Group Plan'),current_date,null,pg_temp.uid(11),true)$$,
 'P0001','overlapping_active_subscription','different payer cannot bypass participant overlap');
select is((select count(*) from subscriptions where participant_id=pg_temp.uid(1)),1::bigint,'failed overlap leaves exactly one subscription');
select is((select count(*) from charges where account_id in(pg_temp.uid(10),pg_temp.uid(11))),0::bigint,'rejected legacy calls leave no initial charge');
select lives_ok($$select create_subscription(pg_temp.uid(1),(select id from plan_definitions where name='Core Group Plan'),'1999-01-01','1999-01-31',pg_temp.uid(10),false)$$,'disjoint historical access remains supported');
select create_subscription(pg_temp.uid(2),(select id from plan_definitions where name='Core Group Plan'),'2040-01-01','2040-01-31',pg_temp.uid(10),false);
select throws_ok($$select create_subscription(pg_temp.uid(2),(select id from plan_definitions where name='Core Group Plan'),'2040-01-31','2040-02-20',pg_temp.uid(10),false)$$,
 'P0001','overlapping_active_subscription','same-day endpoint is inclusive overlap');
select lives_ok($$select create_subscription(pg_temp.uid(2),(select id from plan_definitions where name='Core Group Plan'),'2040-02-01','2040-02-20',pg_temp.uid(10),false)$$,'next-day successor is disjoint');
select throws_ok($$select create_subscription(pg_temp.uid(2),(select id from plan_definitions where name='Core Group Plan'),current_date,null,pg_temp.uid(10),false)$$,
 'P0001','overlapping_active_subscription','open-ended current access intersects future access');
select create_subscription(pg_temp.uid(3),(select id from plan_definitions where name='Core Group Plan'),current_date,null,pg_temp.uid(10),false);
update subscriptions set status='cancelled' where participant_id=pg_temp.uid(3);
select lives_ok($$select create_subscription(pg_temp.uid(3),(select id from plan_definitions where name='Core Group Plan'),current_date,null,pg_temp.uid(10),false)$$,'cancelled access does not block new enrollment');
select ok(not has_function_privilege('anon','create_subscription(uuid,uuid,date,date,uuid,boolean,text,text)','execute'),'anon cannot enroll via legacy RPC');
select ok(not has_function_privilege('authenticated','create_subscription(uuid,uuid,date,date,uuid,boolean,text,text)','execute'),'authenticated cannot enroll via legacy RPC');
select ok(has_function_privilege('service_role','create_subscription(uuid,uuid,date,date,uuid,boolean,text,text)','execute'),'legacy RPC remains service-only');
select * from finish();
rollback;
