-- Personal operator log: cash received without requiring billing UUIDs, plus lightweight invoices.
-- Complements formal `payments` / `receipts` when you only need name + amount + context.

create table if not exists public.personal_finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_kind text not null,
  member_display_name text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
  method text,
  issued_by text not null,
  notes text,
  due_at date,
  invoice_status text,
  account_id uuid references public.accounts (id) on delete set null,
  charge_id uuid references public.charges (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint check_personal_finance_entry_kind check (entry_kind in ('cash_received', 'invoice')),
  constraint check_personal_finance_amount check (amount_cents > 0),
  constraint check_personal_finance_cash_shape check (
    entry_kind <> 'cash_received'
    or (
      due_at is null
      and invoice_status is null
    )
  ),
  constraint check_personal_finance_invoice_shape check (
    entry_kind <> 'invoice'
    or (
      due_at is not null
      and invoice_status in ('draft', 'sent', 'paid', 'void')
    )
  )
);

create index if not exists idx_personal_finance_entries_created_at on public.personal_finance_entries (created_at desc);
create index if not exists idx_personal_finance_entries_kind on public.personal_finance_entries (entry_kind);

comment on table public.personal_finance_entries is
  'Operator-owned cash log and draft invoices without requiring account/charge UUIDs. Formal billing still uses payments/receipts.';

alter table public.personal_finance_entries enable row level security;

create policy "admin_all_personal_finance_entries" on public.personal_finance_entries
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update, delete on public.personal_finance_entries to service_role;
