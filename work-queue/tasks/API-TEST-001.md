# API-TEST-001 — Billing/receipt route tests

- Status: **done**
- Lane: tests
- Depends on: API-DEV-001
- Production writes: no
- Branch from: `develop` as `agent/API-TEST-001-billing-tests`

## Agent prompt

Add integration tests for billing/receipt admin routes: auth, validation, success,
and partial failure. Use isolated fixtures. Do not hit production.

## Read first

- `docs/admin-api.md` billing/receipt sections
- `services/api/src/routes/admin/billing.js`
- Existing tests under `services/api/src/` for style

## Allowed paths

- `services/api/src/**/*.test.js`
- `services/api/src/**/*.test.ts`
- `services/api/vitest.config.ts` (only if required)
- Shared queue files

Prefer not to change production route behavior except for testability seams that
do not alter contracts.

## Acceptance

- Covers `x-admin-key` rejection, bad input, at least one success path, and the
  known non-transactional `record-payment` failure mode (assert current behavior
  or document the gap)
- Tests do not require the live production database
- Full API suite still passes
