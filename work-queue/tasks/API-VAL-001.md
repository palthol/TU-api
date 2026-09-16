# API-VAL-001 — Smoke-test finance and receipts

- Status: **done**
- Lane: validation
- Depends on: API-GATE-001
- Production writes: **no** (non-prod only)
- Branch from: `develop` as `agent/API-VAL-001-finance-smoke`

## Agent prompt

Using the API-GATE-001 environment, smoke-test personal-finance, discounts,
record-payment, void, and refund paths. Record results in `docs/current-state.md`
and the claim. Do not touch production.

## Allowed paths

- `docs/current-state.md`
- `docs/api-schema-audit.md` checklist
- Claim + queue files
- Test/script files only if a fixture bug must be fixed to complete the smoke

## Acceptance

- Evidence for happy path + one failure path per exercised route
- Residual risk stated (especially non-atomic record-payment)
