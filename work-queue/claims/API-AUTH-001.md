# API task claim

- Task ID: `API-AUTH-001`
- Owner: cursor-cloud agent / singh (`ilikericeat@gmail.com`)
- Claimed at: `2026-09-14T15:32:43Z`
- Base branch: `develop`
- Base commit: `bce14612492a24f755c57d7f3ff3e9016e1381f5`
- Production write authorized: no
- Status: `in_progress`
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

## Verification evidence

Commands run, exit codes, and what you did **not** do (especially production writes).

## Handoff or blocker

In progress. ADR `API-ADR-005` written first; implementation follows in this PR.
