# API-AUTH-001 — Staff RBAC

- Status: **done**
- Lane: security
- Depends on: API-OPS-001
- Production writes: no
- Branch from: `develop` as `agent/API-AUTH-001-rbac`

## Agent prompt

Design then implement staff identity beyond a single `x-admin-key` (roles such as
owner, front_desk, finance). Start with a design section in `docs/decision-log.md`
if the approach is not already accepted. Do not ship a half-auth bypass.

## Allowed paths

- `docs/decision-log.md`, `docs/admin-api.md`, `docs/current-state.md`
- `services/api/src/lib/requireAdmin.js` and related middleware
- migrations if a role table is chosen
- tests
- Shared queue files

## Acceptance

- ADR accepted before large code change
- Privileged writes have an actor identity story
- Existing admin-key clients keep a migration path
- Reviewer-guide P0 auth checks pass
