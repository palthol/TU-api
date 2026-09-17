# API-TEST-002 — Subscription and scheduling route tests

- Status: **done**
- Lane: tests
- Depends on: API-DEV-001
- Production writes: no
- Branch from: `develop` as `agent/API-TEST-002-scheduling-tests`

## Agent prompt

Add integration tests for subscription create and scheduling session/attendance
routes: auth, validation, success, and failure. Isolated fixtures only.

## Read first

- `docs/admin-api.md` scheduling + `POST /billing/subscriptions`
- `services/api/src/routes/admin/scheduling.js`
- `services/api/src/lib/adminRequestValidation.js`

## Allowed paths

- `services/api/src/**/*.test.js`
- `services/api/src/**/*.test.ts`
- `services/api/vitest.config.ts` (only if required)
- Shared queue files

Do not overlap billing test files owned by API-TEST-001 if that claim is active:
prefer `scheduling*.test.js` and `subscriptions*.test.js`.

## Acceptance

- Auth, invalid UUID/dates, create/list/cancel session, attendance upsert
- Subscription create validation errors
- No production database
- Full API suite still passes
