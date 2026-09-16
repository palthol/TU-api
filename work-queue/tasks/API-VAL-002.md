# API-VAL-002 — Smoke-test subscriptions, scheduling, entitlements

- Status: **done**
- Lane: validation
- Depends on: API-GATE-001
- Production writes: **no**
- Branch from: `develop` as `agent/API-VAL-002-scheduling-smoke`

## Agent prompt

Using the API-GATE-001 environment, smoke-test session CRUD, attendance, cron
auth on Discord routes (if webhook configured in non-prod), and subscription
enrollment. Record results. No production writes.

## Allowed paths

- `docs/current-state.md`
- `docs/api-schema-audit.md` checklist
- Claim + queue files

## Acceptance

- Evidence for scheduling + subscription happy path and one failure each
- Entitlement check on attendance documented (block vs warn)
