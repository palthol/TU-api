-- Atomic record_payment: payment + allocations + optional money_in receipt.
-- Idempotent on payments.idempotency_key when set.
-- Version 20260916174649 sorts after 20260914202053.
-- Forward-safe: additive column + partial unique index; existing NULL keys stay valid.
-- Do not apply to production from this change (production writes: no).

alter table public.payments
  add column if not exists idempotency_key text;

create unique index if not exists payments_idempotency_key_unique
  on public.payments (idempotency_key)
  where idempotency_key is not null;

comment on column public.payments.idempotency_key is
  'Client-supplied record-payment intent key. Unique when set; retries replay payment_id + receipt_id.';

create or replace function public.record_payment(
  p_account_id uuid,
  p_amount_cents integer,
  p_method text,
  p_issued_by text,
  p_allocations jsonb,
  p_paid_at timestamptz default null,
  p_reference text default null,
  p_notes text default null,
  p_issue_receipt boolean default true,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_payment_id uuid;
  v_receipt_id uuid;
  v_existing record;
  v_sum integer := 0;
  v_alloc record;
  v_charge record;
  v_net integer;
  v_allocated integer;
  v_headroom integer;
  v_total_alloc integer;
  v_issue_receipt boolean;
begin
  if p_account_id is null or p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'account_and_positive_amount_required';
  end if;
  if p_method is null or p_method not in ('cash', 'card', 'cashapp', 'venmo', 'paypal', 'zelle', 'other') then
    raise exception 'invalid_payment_method';
  end if;
  if p_issued_by is null or length(trim(p_issued_by)) = 0 then
    raise exception 'issued_by_required';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'allocations_required';
  end if;

  v_key := nullif(trim(p_idempotency_key), '');
  v_issue_receipt := coalesce(p_issue_receipt, true);

  if v_key is not null then
    select p.id, p.account_id, p.amount_cents, p.method
      into v_existing
    from public.payments p
    where p.idempotency_key = v_key;

    if v_existing.id is not null then
      if v_existing.account_id is distinct from p_account_id
         or v_existing.amount_cents is distinct from p_amount_cents
         or v_existing.method is distinct from p_method then
        raise exception 'idempotency_key_conflict';
      end if;

      select r.id
        into v_receipt_id
      from public.receipts r
      where r.payment_id = v_existing.id
        and r.receipt_kind = 'money_in'
      order by r.voided_at nulls first, r.created_at asc
      limit 1;

      return jsonb_build_object(
        'payment_id', v_existing.id,
        'receipt_id', v_receipt_id
      );
    end if;
  end if;

  begin
    select coalesce(sum((elem->>'amount_cents')::integer), 0)::integer
      into v_sum
    from jsonb_array_elements(p_allocations) as elem;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_allocation_row';
  end;

  if v_sum <> p_amount_cents then
    raise exception 'allocation_sum_must_equal_payment_amount';
  end if;

  -- Lock charges in id order so concurrent record_payment calls cannot over-allocate.
  for v_alloc in
    select
      (elem->>'charge_id')::uuid as charge_id,
      (elem->>'amount_cents')::integer as amount_cents
    from jsonb_array_elements(p_allocations) as elem
    order by 1
  loop
    if v_alloc.charge_id is null or v_alloc.amount_cents is null or v_alloc.amount_cents <= 0 then
      raise exception 'invalid_allocation_row';
    end if;

    v_charge := null;
    select c.id, c.account_id, c.status, c.amount_cents
      into v_charge
    from public.charges c
    where c.id = v_alloc.charge_id
    for update;

    if v_charge.id is null then
      raise exception 'charge_not_found' using
        detail = jsonb_build_object('charge_id', v_alloc.charge_id)::text;
    end if;
    if v_charge.account_id is distinct from p_account_id then
      raise exception 'charge_account_mismatch' using
        detail = jsonb_build_object('charge_id', v_alloc.charge_id)::text;
    end if;
    if v_charge.status = 'void' then
      raise exception 'charge_is_void' using
        detail = jsonb_build_object('charge_id', v_alloc.charge_id)::text;
    end if;

    select coalesce(
      (select vcn.net_due_cents from public.view_charge_net vcn where vcn.charge_id = v_alloc.charge_id),
      v_charge.amount_cents,
      0
    ) into v_net;

    select coalesce(sum(pa.amount_cents), 0)::integer into v_allocated
    from public.payment_allocations pa
    where pa.charge_id = v_alloc.charge_id;

    v_headroom := greatest(0, v_net - v_allocated);
    if v_alloc.amount_cents > v_headroom then
      raise exception 'allocation_exceeds_net_due' using
        detail = jsonb_build_object(
          'charge_id', v_alloc.charge_id,
          'allocatable_cents', v_headroom
        )::text;
    end if;
  end loop;

  insert into public.payments (
    account_id,
    amount_cents,
    currency,
    paid_at,
    method,
    source,
    status,
    reference,
    notes,
    idempotency_key
  )
  values (
    p_account_id,
    p_amount_cents,
    'USD',
    coalesce(p_paid_at, now()),
    p_method,
    'manual',
    'succeeded',
    nullif(p_reference, ''),
    nullif(p_notes, ''),
    v_key
  )
  returning id into v_payment_id;

  for v_alloc in
    select
      (elem->>'charge_id')::uuid as charge_id,
      (elem->>'amount_cents')::integer as amount_cents
    from jsonb_array_elements(p_allocations) as elem
  loop
    insert into public.payment_allocations (payment_id, charge_id, amount_cents)
    values (v_payment_id, v_alloc.charge_id, v_alloc.amount_cents);
  end loop;

  for v_alloc in
    select distinct (elem->>'charge_id')::uuid as charge_id
    from jsonb_array_elements(p_allocations) as elem
  loop
    select coalesce(sum(pa.amount_cents), 0)::integer into v_total_alloc
    from public.payment_allocations pa
    where pa.charge_id = v_alloc.charge_id;

    select coalesce(
      (select vcn.net_due_cents from public.view_charge_net vcn where vcn.charge_id = v_alloc.charge_id),
      (select c.amount_cents from public.charges c where c.id = v_alloc.charge_id),
      0
    ) into v_net;
    if v_total_alloc >= v_net and v_net > 0 then
      update public.charges
      set status = 'paid', updated_at = now()
      where id = v_alloc.charge_id;
    end if;
  end loop;

  if v_issue_receipt then
    insert into public.receipts (
      receipt_kind,
      payment_id,
      account_id,
      amount_cents,
      currency,
      issued_by,
      source
    )
    values (
      'money_in',
      v_payment_id,
      p_account_id,
      p_amount_cents,
      'USD',
      trim(p_issued_by),
      'staff_triggered'
    )
    returning id into v_receipt_id;
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_id', v_receipt_id
  );
exception
  when unique_violation then
    if v_key is not null then
      v_existing := null;
      v_receipt_id := null;
      select p.id, p.account_id, p.amount_cents, p.method
        into v_existing
      from public.payments p
      where p.idempotency_key = v_key;

      if v_existing.id is not null then
        if v_existing.account_id is distinct from p_account_id
           or v_existing.amount_cents is distinct from p_amount_cents
           or v_existing.method is distinct from p_method then
          raise exception 'idempotency_key_conflict';
        end if;

        select r.id
          into v_receipt_id
        from public.receipts r
        where r.payment_id = v_existing.id
          and r.receipt_kind = 'money_in'
        order by r.voided_at nulls first, r.created_at asc
        limit 1;

        return jsonb_build_object(
          'payment_id', v_existing.id,
          'receipt_id', v_receipt_id
        );
      end if;
    end if;
    raise;
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_allocation_row';
end;
$$;

comment on function public.record_payment(uuid, integer, text, text, jsonb, timestamptz, text, text, boolean, text) is
  'Atomic succeeded payment + allocations + optional money_in receipt. Allocations are capped by view_charge_net remaining headroom. Optional idempotency_key replays payment_id and receipt_id.';

revoke all on function public.record_payment(uuid, integer, text, text, jsonb, timestamptz, text, text, boolean, text) from public;
revoke all on function public.record_payment(uuid, integer, text, text, jsonb, timestamptz, text, text, boolean, text) from anon;
revoke all on function public.record_payment(uuid, integer, text, text, jsonb, timestamptz, text, text, boolean, text) from authenticated;
grant execute on function public.record_payment(uuid, integer, text, text, jsonb, timestamptz, text, text, boolean, text) to service_role;
