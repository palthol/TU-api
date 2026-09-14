-- Optional unique idempotency key for POST /api/waivers/submit retries.
-- Forward-safe: existing waiver rows keep NULL keys (partial unique index ignores them).
-- Do not apply to production from this task (API-HARD-002 production writes: no).

alter table public.waivers
  add column if not exists idempotency_key text;

create unique index if not exists waivers_idempotency_key_unique
  on public.waivers (idempotency_key)
  where idempotency_key is not null;

comment on column public.waivers.idempotency_key is
  'Client-supplied or server-derived submit intent key. Unique when set; retries replay the original waiver.';
