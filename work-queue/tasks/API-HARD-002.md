# API-HARD-002 — Waiver submit idempotency

- Status: **done**
- Lane: backend
- Depends on: API-GATE-001
- Production writes: no
- Branch from: `develop` as `agent/API-HARD-002-waiver-idempotency`

## Agent prompt

Make `POST /api/waivers/submit` retry-safe across storage + DB (participant,
account bind, waiver, audit). Do not break the live waiver contract. Tests
required.

## Allowed paths

- `services/api/src/index.js` (submit handler only as needed)
- `services/api/src/services/accounts/`
- tests
- `docs/admin-api.md`, `docs/frontend-backend-payload.md`, `docs/current-state.md`
- migrations if a unique constraint/idempotency table is required
- Shared queue files

## Acceptance

- Duplicate submit does not create duplicate waivers/accounts for the same intent
- Existing success envelope fields remain
- Notification failure still must not fail a persisted submit
