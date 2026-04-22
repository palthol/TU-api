-- Business operating expenses (rent, utilities, etc.) — separate from member charges.

create table if not exists public.operating_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
  expense_date date not null,
  vendor_name text,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  constraint check_operating_expense_category check (
    category in ('rent', 'utilities', 'other')
  ),
  constraint check_operating_expense_amount check (amount_cents > 0)
);

create index if not exists idx_operating_expenses_date on public.operating_expenses(expense_date desc);

create trigger update_operating_expenses_updated_at
  before update on public.operating_expenses
  for each row execute function public.update_updated_at_column();

alter table public.operating_expenses enable row level security;

create policy "admin_all_operating_expenses" on public.operating_expenses
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

comment on table public.operating_expenses is
  'Shop-level cash out (rent, utilities). Not member billing.';

grant select, insert, update, delete on public.operating_expenses to service_role;
