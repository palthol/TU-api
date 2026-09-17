# API-HARD-001 — Atomic record-payment

- Status: **done**
- Lane: backend
- Depends on: API-TEST-001, API-VAL-001
- Production writes: no (migration must be forward-safe; apply to prod only with
  explicit later authorization)
- Branch from: `develop` as `agent/API-HARD-001-record-payment-rpc`

## Agent prompt

Replace multi-step `POST /api/admin/billing/record-payment` with a service-role
RPC that writes payment + allocations + receipt atomically and is idempotent on
retry. Update `docs/admin-api.md`. Add tests.

## Read first

- `docs/admin-api.md` record-payment
- `docs/reviewer-guide.md` P0/P1 finance rules
- `services/api/src/routes/admin/billing.js`

## Allowed paths

- `supabase/migrations/` (use `supabase migration new <name>` so the version sorts after `20260914202053`; do not reuse `0021`–`0024`)
- `services/api/src/routes/admin/billing.js`
- matching tests
- `docs/admin-api.md`, `docs/current-state.md`
- Shared queue files

## Acceptance

- Partial failure cannot leave a payment without allocations/receipt
- Retry with the same idempotency key does not double-allocate
- Money remains integer cents; allocations respect `view_charge_net`
- API suite + new tests pass
