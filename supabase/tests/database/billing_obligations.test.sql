begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- Synthetic examples deliberately use amounts unrelated to real agreements.
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
 select ('a0000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into public.participants(id,full_name,date_of_birth,email)
 select pg_temp.uid(n), '[TU-TEST] Obligation participant ' || n, '1990-01-01', 'obligation-' || n || '@tu-test.invalid'
 from generate_series(1,4) n;
insert into public.accounts(id, primary_contact_name, primary_contact_email)
 select pg_temp.uid(n), '[TU-TEST] Payer ' || n, 'shared-family@tu-test.invalid' from generate_series(10,13) n;
insert into public.account_members(account_id,participant_id)
 values(pg_temp.uid(10),pg_temp.uid(1)),(pg_temp.uid(10),pg_temp.uid(2)),(pg_temp.uid(11),pg_temp.uid(3)),(pg_temp.uid(12),pg_temp.uid(4));
insert into public.participant_relationships(participant_a_id,participant_b_id,relationship_type)
 values(pg_temp.uid(1),pg_temp.uid(3),'sibling');
insert into public.subscriptions(id,account_id,participant_id,plan_definition_id,starts_at,automatic_billing_starts_at)
 select pg_temp.uid(50),pg_temp.uid(10),pg_temp.uid(1),id,'2031-01-01','2031-01-01'
 from public.plan_definitions where name='Core Group Plan';
select is((select count(*) from private.generate_monthly_charges_as_of('2031-01-31')),0::bigint,
 'legacy active monthly subscription with automation flag creates no recurring debt');
select public.create_billing_obligation(pg_temp.uid(20),pg_temp.uid(10),'Shared training',12345,'2031-01-31',array[pg_temp.uid(1),pg_temp.uid(2)]);
select public.create_billing_obligation(pg_temp.uid(21),pg_temp.uid(10),'Other service',6789,'2031-01-31');
select public.create_billing_obligation(pg_temp.uid(22),pg_temp.uid(11),'Separate family payer',23456,'2031-01-26',array[pg_temp.uid(3)]);
select public.create_billing_obligation(pg_temp.uid(23),pg_temp.uid(12),'Unactivated',4567,'2031-01-01');
select is((select count(*) from private.generate_monthly_charges_as_of('2031-01-31')),0::bigint,'draft obligations never charge');
select throws_ok($$select public.create_billing_obligation(pg_temp.uid(20),pg_temp.uid(10),'Retry',12345,'2031-01-31')$$,
 '23505',null,'same create intent ID cannot create a second obligation');
select throws_ok($$select public.create_billing_obligation(pg_temp.uid(90),pg_temp.uid(10),'Invalid link',100,'2031-01-31',array[pg_temp.uid(99)])$$,
 '23503',null,'invalid participant link fails atomic create');
select is((select count(*) from public.billing_obligations where id=pg_temp.uid(90)),0::bigint,'failed linked create leaves no obligation');
select throws_ok($$select public.transition_billing_obligation(pg_temp.uid(20),'activate','2031-02-27')$$,
 'P0001','billing_start_must_be_anchor_boundary','activation requires exact original-day boundary');
select public.transition_billing_obligation(pg_temp.uid(20),'activate','2031-01-31');
select public.transition_billing_obligation(pg_temp.uid(21),'activate','2031-01-31');
select public.transition_billing_obligation(pg_temp.uid(22),'activate','2031-01-26');
create temp table jan26 as select * from private.generate_monthly_charges_as_of('2031-01-26');
select is((select count(*) from jan26),1::bigint,'only the earlier anchor is due');
select is((select account_id from jan26),pg_temp.uid(11),'separate family payer billed explicitly despite shared email');
create temp table jan31 as select * from private.generate_monthly_charges_as_of('2031-01-31');
select is((select count(*) from jan31),2::bigint,'two obligations for one payer each create a charge');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(20)),1::bigint,'two covered participants produce one charge');
select is((select amount_cents from public.charges where billing_obligation_id=pg_temp.uid(20)),12345,'agreed amount differs from catalog price');
select is((select count(*) from jan31 where account_id=pg_temp.uid(10) and subscription_id is null),2::bigint,'obligation charges use payer and no participant subscription');
select is((select coverage_end from public.charges where billing_obligation_id=pg_temp.uid(20)),'2031-02-27'::date,'31st period ends before clamped February boundary');
select is((select due_at from public.charges where billing_obligation_id=pg_temp.uid(20)),'2031-01-31'::date,'due date is period start');
select is((select count(*) from private.generate_monthly_charges_as_of('2031-02-01')),0::bigint,'calendar month crossing does not restart anchored period');
select is((select count(*) from private.generate_monthly_charges_as_of('2031-01-31')),0::bigint,'repeated generation is idempotent');
select throws_ok($$insert into public.charges(account_id,billing_obligation_id,amount_cents,coverage_start,coverage_end,due_at,charge_kind)
 select account_id,billing_obligation_id,amount_cents,coverage_start,coverage_end,due_at,charge_kind from public.charges where billing_obligation_id=pg_temp.uid(20)$$,
 '23505',null,'database index rejects direct duplicate obligation period');
select throws_ok($$insert into public.charges(account_id,billing_obligation_id,amount_cents,coverage_start,coverage_end,due_at,charge_kind)
 values(pg_temp.uid(11),pg_temp.uid(20),12345,'2031-02-28','2031-03-30','2031-02-28','monthly_period')$$,
 '23503',null,'composite FK rejects charge billed to another payer');
update public.plan_definitions set price_cents=19001 where name='Core Group Plan';
update public.subscriptions set plan_definition_id=(select id from public.plan_definitions where name='Unlimited Group Plan') where id=pg_temp.uid(50);
select * from private.generate_monthly_charges_as_of('2031-02-28');
select is((select amount_cents from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-02-28'),12345,'plan and entitlement changes never alter agreed recurring amount');
select is((select coverage_end from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-02-28'),'2031-03-30'::date,'February clamp returns to original March 31st anchor');
select is((select count(*) from private.generate_monthly_charges_as_of('2031-03-01')),0::bigint,'retry after month boundary does not duplicate February period');
-- A late run creates the CURRENT period with the original due date, never all missed months.
select * from private.generate_monthly_charges_as_of('2031-06-02');
select is((select coverage_end from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-05-31'),'2031-06-29'::date,'late run retains anchored full coverage');
select is((select due_at from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-05-31'),'2031-05-31'::date,'late run retains original due date');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start between '2031-03-01' and '2031-05-30'),0::bigint,'missed full periods are not silently backfilled');
select is((select count(*) from public.charges where account_id in (pg_temp.uid(12),pg_temp.uid(13))),0::bigint,'unconfigured accounts and draft obligations remain unbilled');

-- Exercise every month-end day in common and leap years, and the following month.
select is(private.billing_anchor_in_month('2031-01-29','2031-02-01'),'2031-02-28'::date,'29 clamps in common February');
select is(private.billing_anchor_in_month('2031-01-30','2031-02-01'),'2031-02-28'::date,'30 clamps in common February');
select is(private.billing_anchor_in_month('2031-01-31','2031-02-01'),'2031-02-28'::date,'31 clamps in common February');
select is(private.billing_anchor_in_month('2031-01-29','2032-02-01'),'2032-02-29'::date,'29 in leap February');
select is(private.billing_anchor_in_month('2031-01-30','2032-02-01'),'2032-02-29'::date,'30 in leap February');
select is(private.billing_anchor_in_month('2031-01-31','2032-02-01'),'2032-02-29'::date,'31 in leap February');
select is(private.billing_anchor_in_month('2031-01-29','2032-03-01'),'2032-03-29'::date,'29 restored in March');
select is(private.billing_anchor_in_month('2031-01-30','2032-03-01'),'2032-03-30'::date,'30 restored in March');
select is(private.billing_anchor_in_month('2031-01-31','2032-03-01'),'2032-03-31'::date,'31 restored in March');
select * from private.generate_monthly_charges_as_of('2032-02-29');
select is((select coverage_end from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2032-02-29'),'2032-03-30'::date,'generator leap-year period reaches original March anchor');

-- Pause/resume skips paused periods and immutable charge terms survive lifecycle edits.
create temp table history as select * from public.charges where billing_obligation_id=pg_temp.uid(20);
select public.transition_billing_obligation(pg_temp.uid(20),'pause');
select * from private.generate_monthly_charges_as_of('2032-04-30');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(20)),(select count(*) from history),'paused obligation preserves history and creates no charge');
select public.transition_billing_obligation(pg_temp.uid(20),'activate','2032-05-31');
select * from private.generate_monthly_charges_as_of('2032-05-30');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(20)),(select count(*) from history),'resume does not bill before explicit boundary');
select * from private.generate_monthly_charges_as_of('2032-05-31');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(20)),(select count(*)+1 from history),'resumed obligation bills once at selected boundary');
select throws_ok($$update public.billing_obligations set amount_cents=888 where id=pg_temp.uid(20)$$,'P0001','replace_obligation_to_change_terms','amount edits require explicit replacement');
select throws_ok($$update public.billing_obligations set anchor_date='2031-01-30' where id=pg_temp.uid(20)$$,'P0001','replace_obligation_to_change_terms','anchor edits require explicit replacement');
select throws_ok($$update public.charges set amount_cents=888 where billing_obligation_id=pg_temp.uid(20)$$,'P0001','obligation_charge_terms_are_immutable','historical obligation charge amounts cannot mutate');
select throws_ok($$delete from public.charges where billing_obligation_id=pg_temp.uid(20)$$,'P0001','obligation_charge_history_is_retained','deletion cannot erase idempotency/history');

-- Replacement is a draft until explicitly activated; cutover is atomic.
select public.create_billing_obligation(pg_temp.uid(24),pg_temp.uid(10),'Replacement agreement',13791,'2032-06-30',array[pg_temp.uid(1),pg_temp.uid(2)],null,pg_temp.uid(20));
select throws_ok($$select public.transition_billing_obligation(pg_temp.uid(24),'activate','2032-05-30')$$,
 'P0001','replacement_must_start_at_previous_boundary','invalid replacement boundary rejected');
select is((select ends_before from public.billing_obligations where id=pg_temp.uid(20)),null::date,'failed replacement leaves previous obligation unchanged');
select public.transition_billing_obligation(pg_temp.uid(24),'activate','2032-06-30');
select * from private.generate_monthly_charges_as_of('2032-06-30');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start >= '2032-06-30'),0::bigint,'replaced obligation stops at exclusive cutover');
select is((select amount_cents from public.charges where billing_obligation_id=pg_temp.uid(24)),13791,'replacement uses new agreement amount');
select is((select count(*) from history h join public.charges c on c.id=h.id where to_jsonb(c)=to_jsonb(h)),(select count(*) from history),'replacement preserves all old charge fields');
select public.transition_billing_obligation(pg_temp.uid(24),'end');
select * from private.generate_monthly_charges_as_of('2032-07-30');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(24)),1::bigint,'ended obligation retains historical charge without further debt');
select throws_ok($$select public.transition_billing_obligation(pg_temp.uid(24),'activate','2032-08-30')$$,'P0001','ended_obligation_is_terminal','ended obligation cannot silently resume');
update public.charges set status='void' where billing_obligation_id=pg_temp.uid(21) and coverage_start='2032-06-30';
select * from private.generate_monthly_charges_as_of('2032-06-30');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(21) and coverage_start='2032-06-30'),1::bigint,'voided period is never regenerated');

-- Discounts, payments across two obligations of ONE payer, and allocation limits.
insert into public.charge_discounts(charge_id,discount_type,flat_amount_cents,label)
 select id,'flat',345,'[TU-TEST] courtesy' from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-01-31';
create temp table payment_result as select public.record_payment(pg_temp.uid(10),18789,'cash','pgtap',
 (select jsonb_agg(jsonb_build_object('charge_id',id,'amount_cents',case when billing_obligation_id=pg_temp.uid(20) then 12000 else 6789 end))
 from public.charges where billing_obligation_id in (pg_temp.uid(20),pg_temp.uid(21)) and coverage_start='2031-01-31'),
 null,null,null,false,'obligation-test-payment') result;
select is((select count(*) from public.payment_allocations where payment_id=(select (result->>'payment_id')::uuid from payment_result)),2::bigint,'one payment allocates to two obligations of same account');
select is((select count(*) from public.charges where account_id=pg_temp.uid(10) and coverage_start='2031-01-31' and status='paid'),2::bigint,'discount-adjusted and ordinary obligation charges both become paid');
select throws_ok($$select public.record_payment(pg_temp.uid(11),1,'cash','pgtap',
 (select jsonb_build_array(jsonb_build_object('charge_id',id,'amount_cents',1)) from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-02-28'),null,null,null,false)$$,
 'P0001','charge_account_mismatch','payment cannot cross payer accounts');
select throws_ok($$select public.record_payment(pg_temp.uid(10),1,'cash','pgtap',
 (select jsonb_build_array(jsonb_build_object('charge_id',id,'amount_cents',1)) from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-01-31'),null,null,null,false)$$,
 'P0001','allocation_exceeds_net_due','existing net-due allocation ceiling remains valid');
select throws_ok($$select public.record_payment(pg_temp.uid(10),1,'cash','pgtap',
 (select jsonb_build_array(jsonb_build_object('charge_id',id,'amount_cents',1)) from public.charges where billing_obligation_id=pg_temp.uid(21) and coverage_start='2032-06-30'),null,null,null,false)$$,
 'P0001','charge_is_void','voided obligation charge cannot receive payment');

-- Refunds may reopen charge status without modifying immutable charge terms.
select lives_ok($$select public.record_payment_refund((select (result->>'payment_id')::uuid from payment_result),500,'[TU-TEST] partial refund','pgtap','obligation-refund')$$,
 'existing refund RPC operates on obligation allocations');
select is((select sum(amount_cents)::integer from public.payment_allocations where payment_id=(select (result->>'payment_id')::uuid from payment_result)),18289,'refund shrinks allocated total without changing charge gross');
select is((select count(*) from public.charges where account_id=pg_temp.uid(10) and coverage_start='2031-01-31' and status='open'),1::bigint,'refund reopens the affected obligation charge');
insert into public.charge_adjustments(charge_id,amount_cents,reason)
 select id,200,'[TU-TEST] write-off' from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-02-28';
select is((select net_due_cents from public.view_charge_net where charge_id=(select id from public.charges where billing_obligation_id=pg_temp.uid(20) and coverage_start='2031-02-28')),12145,'existing write-offs reduce obligation net due');

select ok((select relrowsecurity from pg_class where oid='public.billing_obligations'::regclass),'obligations have RLS');
select ok((select relrowsecurity from pg_class where oid='public.billing_obligation_participants'::regclass),'participant links have RLS');
select ok(not has_table_privilege('anon','public.billing_obligations','SELECT'),'anonymous cannot read obligations');
select ok(not has_table_privilege('authenticated','public.billing_obligations','INSERT'),'authenticated cannot create obligations');
select ok(not has_function_privilege('authenticated','public.transition_billing_obligation(uuid,text,date)','EXECUTE'),'lifecycle RPC is not public');
select ok(not has_function_privilege('anon','private.generate_monthly_charges_as_of(date)','EXECUTE'),'dated generator is private');
select ok(has_function_privilege('service_role','public.transition_billing_obligation(uuid,text,date)','EXECUTE'),'service role can manage obligations');
select ok(exists(select 1 from public.event_ledger where entity_type='billing_obligations' and payload_before is not null),'lifecycle changes retain before/after audit evidence');
-- Inactive payers are excluded without changing obligations or existing debt.
update public.accounts set status='inactive' where id=pg_temp.uid(11);
select * from private.generate_monthly_charges_as_of('2032-09-26');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(22) and coverage_start='2032-09-26'),0::bigint,'inactive payer receives no new recurring charge');
select throws_ok($$select public.create_billing_obligation(pg_temp.uid(91),pg_temp.uid(11),'Inactive payer',100,'2032-10-26')$$,
 'P0001','active_payer_account_required','cannot configure new obligation on inactive payer');
select throws_ok($$select public.create_billing_obligation(pg_temp.uid(92),pg_temp.uid(10),'Zero amount',0,'2032-10-26')$$,
 '23514',null,'database rejects zero agreed amount');
select throws_ok($$select public.create_billing_obligation(pg_temp.uid(93),pg_temp.uid(10),'Negative amount',-1,'2032-10-26')$$,
 '23514',null,'database rejects negative agreed amount');
select throws_ok($$select * from private.generate_monthly_charges_as_of(null)$$,
 'P0001','finite_as_of_date_required','null as-of date fails closed');
select throws_ok($$select * from private.generate_monthly_charges_as_of('infinity')$$,
 'P0001','finite_as_of_date_required','infinite as-of date fails closed');
select throws_ok($$select public.transition_billing_obligation(pg_temp.uid(23),'activate','2031-01-02')$$,
 'P0001','billing_start_must_be_anchor_boundary','first billing date cannot silently shift the cycle');
-- Later activation on an old anchor skips all earlier periods.
select public.transition_billing_obligation(pg_temp.uid(23),'activate','2033-01-01');
select * from private.generate_monthly_charges_as_of('2032-12-31');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(23)),0::bigint,'future explicit billing start blocks all earlier periods');
select * from private.generate_monthly_charges_as_of('2033-01-01');
select is((select count(*) from public.charges where billing_obligation_id=pg_temp.uid(23)),1::bigint,'delayed activation creates only its first configured period');
select is((select coverage_end from public.charges where billing_obligation_id=pg_temp.uid(21) and coverage_start='2032-12-31'),'2033-01-30'::date,'December anchor crosses year without drift');
select public.transition_billing_obligation(pg_temp.uid(23),'pause');
select throws_ok($$select public.transition_billing_obligation(pg_temp.uid(23),'activate','2001-01-01')$$,
 'P0001','resume_requires_current_or_future_boundary','resume cannot retrospectively charge a paused historical period');
-- Two replacement drafts cannot both activate against one predecessor.
select public.create_billing_obligation(pg_temp.uid(25),pg_temp.uid(10),'Competing replacement',111,'2033-02-28','{}',null,pg_temp.uid(20));
select throws_ok($$select public.transition_billing_obligation(pg_temp.uid(25),'activate','2033-02-28')$$,
 'P0001','replacement_not_available','second replacement cannot reopen a previous obligation');
select public.create_billing_obligation(pg_temp.uid(26),pg_temp.uid(10),'Overlapping replacement',111,'2033-01-31','{}',null,pg_temp.uid(21));
select * from private.generate_monthly_charges_as_of('2033-01-31');
select throws_ok($$select public.transition_billing_obligation(pg_temp.uid(26),'activate','2033-01-31')$$,
 'P0001','replacement_overlaps_existing_charge','replacement cannot overlap a generated period');
select is((select status from public.billing_obligations where id=pg_temp.uid(26)),'draft','failed replacement leaves new draft unactivated');
-- Execute through the actual service role, not only the migration owner.
grant usage on schema extensions to service_role;
set local role service_role;
select lives_ok($$select public.create_billing_obligation('a0000000-0000-4000-8000-000000000094','a0000000-0000-4000-8000-000000000010','Service-role agreement',901,'2034-01-29')$$,
 'service role can create an obligation including audit writes');
select lives_ok($$select public.transition_billing_obligation('a0000000-0000-4000-8000-000000000094','activate','2034-01-29')$$,
 'service role can activate an obligation');
select lives_ok($$select * from private.generate_monthly_charges_as_of('2034-01-29')$$,
 'service role can generate anchored charges with triggers and grants');
reset role;
select * from finish();
rollback;
