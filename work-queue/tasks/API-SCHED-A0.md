# Task: API-SCHED-A0 — scheduling plan A0 (scaffolding only)

Status: done
Lane: backend
Production writes: no

## Goal

Scaffold the scheduling-plan lane so that follow-up PRs (A1+) can land in parallel
without editing shared files (entrypoint mounts, shared helpers, or queue plumbing).

This task is **scaffolding only**: add mount points, stub routers (501), a timezone
helper library, and unit tests. **No migrations** in this PR.

## Allowed paths

- `services/api/src/index.js`
- `services/api/src/lib/gymTime.js`
- `services/api/src/lib/gymTime.test.js`
- `services/api/src/lib/exposeSupabaseError.js`
- `services/api/src/lib/exposeSupabaseError.test.js`
- `services/api/src/routes/scheduling/**`
- `services/api/src/routes/member/**`
- `services/api/src/routes/calendar/**`
- `services/api/src/routes/scheduling/**/*.test.js`
- `services/api/src/routes/member/**/*.test.js`
- `services/api/src/routes/calendar/**/*.test.js`
- `docs/scheduling/README.md`
- `work-queue/queue.json`
- `work-queue/README.md`
- `work-queue/claims/API-SCHED-A0.md`

## Requirements

- Mount new routers once from the API entrypoint.
- `gymTime`: create `America/New_York` wall-clock helpers including wall-clock-to-UTC
  conversion that handles DST (use `Intl` or a tiny dependency).
- `exposeSupabaseError`: pre-register machine keys with HTTP status mapping:
  `class_type_not_found`, `instructor_not_found`, `session_not_found`, `session_full`,
  `booking_closed`, `no_credit`, `late_cancel`, `already_booked`, `not_booked`,
  `unauthorized_member`.
- Stub routers under:
  - `routes/scheduling/*` mounted under `/api/admin/...` and guarded by the existing
    `x-admin-key` auth + role matrix.
  - `routes/member/*` and `routes/calendar/*` mounted and structured for future Bearer auth,
    but all current endpoints return `501 { ok:false, error:"not_implemented" }`.
- CORS: `ALLOWED_ORIGIN` accepts a comma-separated list of origins (backward compatible
  with a single value or `*`).
- Add unit tests:
  - `gymTime` DST edge cases: 2026-11-01 (fall back) and 2027-03-14 (spring forward).
  - CORS parsing.
  - Stub routes mounted + returning `501 not_implemented` (and admin auth gate stays intact).
- Keep CI green. No secrets in code or logs.

## Verify

From repo root:

- `npm test`
- `npm run guard:waiver-schema`

