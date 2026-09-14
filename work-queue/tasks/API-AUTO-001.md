# API-AUTO-001 — Monthly-charge cron endpoint

- Status: **ready**
- Lane: automation
- Depends on: API-OPS-001, API-VAL-001
- Production writes: no (endpoint only; enabling prod cron is a later ops step)
- Branch from: `develop` as `agent/API-AUTO-001-monthly-charges`

## Agent prompt

Add `POST /api/admin/billing/generate-monthly-charges` that calls
`generate_monthly_charges()` behind admin or `x-cron-secret`. Log count created.
Prevent duplicate charges for the same period (function already intends this;
prove it). Document the contract.

## Allowed paths

- `services/api/src/routes/admin/billing.js`
- `services/api/src/index.js` (mount/cron middleware only if needed)
- tests
- `docs/admin-api.md`, `docs/use-guide.md`
- Shared queue files

## Acceptance

- Cron auth matches notification routes
- Response includes created count
- Tests for unauthorized + success (mocked RPC)
