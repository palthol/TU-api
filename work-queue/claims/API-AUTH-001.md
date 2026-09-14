# API task claim

- Task ID: `API-AUTH-001`
- Owner: cursor-cloud agent / singh (`ilikericeat@gmail.com`)
- Claimed at: `2026-09-14T15:32:43Z`
- Base branch: `develop`
- Base commit: `bce14612492a24f755c57d7f3ff3e9016e1381f5`
- Production write authorized: no
- Status: `done`
- Working branch: `cursor/api-auth-001-rbac-769a`

## Branch naming

Queue preferred `agent/API-AUTH-001-rbac`. This Cloud run requires
`cursor/<slug>-<run-suffix>` (`-769a`), so the working branch is
`cursor/api-auth-001-rbac-769a`.

## Scope and allowed files

- `docs/decision-log.md`, `docs/admin-api.md`, `docs/current-state.md`
- `services/api/src/lib/requireAdmin.js` and related middleware
  (`requireAdminOrCron.js`, `staffAuth.js`, `staffRoutes.js`, and the
  `index.js` wiring needed to mount them)
- `supabase/migrations/0023_staff_rbac.sql` (not applied to production)
- tests under `services/api/src/lib/`
- Shared queue files (this claim, `work-queue/queue.json`, `work-queue/README.md`)

## Design choice

Accepted `API-ADR-005`: keep the existing `x-admin-key` header. Shared
`ADMIN_API_KEY` authenticates as owner actor `legacy_shared_key`. Personal
staff keys (hashed in `staff_users`) use the same header so dashboard/receipts
can adopt them without a second API. Roles `owner` / `front_desk` / `finance`
are enforced in middleware by path prefix. Privileged-write identity is
`req.staff` plus `staff_audit_events`. Domain `created_by` / `recorded_by`
stay client-supplied until routes adopt `req.staff.actorLabel`.

`index.js` previously referenced `requireAdmin` without importing it; this
change wires `createRequireAdminFromSupabase` so the gate is actually mounted.

## Verification evidence

```text
npm --workspace services/api run test
# exit 0 — Test Files 14 passed (14); Tests 100 passed (100)

npm run guard:waiver-schema
# exit 0 — Waiver schema guard passed.
```

Did **not**:

- Apply `0023` (or any migration) to production project `jhxzecxkccqlgyazhsnb`
- Write to production Postgres or `https://api.templeunderground.com`
- Flip `API-PAY-001` to `ready` (`API-HARD-001` is still `ready`, not `done`)
- Start `API-HARD-001`, `API-SCHED-001`, `API-AUTO-001`, `API-AUTO-002`, or `API-PAY-001`
- Expose keys via `VITE_*` or log `ADMIN_API_KEY` / staff plaintext keys
- Change scheduling endpoint contracts or Discord cadence docs

## Handoff or blocker

`done`. Leftover risk: anyone with the shared `ADMIN_API_KEY` is still a full
owner until operators issue personal keys and rotate that env value. Until
`0023` is applied in a later authorized schema task, only the shared key
authenticates. Body `created_by` / `recorded_by` can still be spoofed; the
authoritative actor for this change is `staff_audit_events` + `req.staff`.
`app_admin` / Supabase Auth remains the PostgREST RLS admin list and is not
the Express staff directory.
