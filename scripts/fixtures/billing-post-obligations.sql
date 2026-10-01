-- In the same disposable session after obligation migrations and reapplication.
do $$ begin
  if (select count(*) from migration_history_snapshot) <> 4 then
    raise exception 'migration preservation fixture incomplete';
  end if;
  if exists (
    select source,row from migration_history_snapshot
    except
    (select 'subscriptions',to_jsonb(s) from subscriptions s
     union all select 'charges',to_jsonb(c)-'billing_obligation_id' from charges c
     union all select 'payments',to_jsonb(p) from payments p
     union all select 'allocations',to_jsonb(a) from payment_allocations a)
  ) then raise exception 'historical billing data changed during migration'; end if;
  if exists(select 1 from billing_obligations) then raise exception 'migration unexpectedly enrolled a payer'; end if;
  if exists(select 1 from private.generate_monthly_charges_as_of('2021-01-01')) then
    raise exception 'unconfigured historical subscription unexpectedly charged';
  end if;
end $$;
-- Remove only this fixture so other suites run in their normal empty-ledger state.
delete from payment_allocations where charge_id='c0000000-0000-4000-8000-000000000030';
delete from payments where idempotency_key='migration-preservation';
delete from charges where id='c0000000-0000-4000-8000-000000000030';
delete from subscriptions where id='c0000000-0000-4000-8000-000000000020';
delete from account_members where account_id='c0000000-0000-4000-8000-000000000010';
delete from accounts where id='c0000000-0000-4000-8000-000000000010';
delete from participants where id='c0000000-0000-4000-8000-000000000001';
