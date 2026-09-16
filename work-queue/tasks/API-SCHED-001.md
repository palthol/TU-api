# API-SCHED-001 — Schedule templates and session generation

- Status: **done**
- Lane: backend
- Depends on: API-TEST-002, API-VAL-002
- Production writes: no
- Branch from: `develop` as `agent/API-SCHED-001-templates`

## Agent prompt

Add template CRUD and a date-range generate-sessions API wrapping
`schedule_templates` → `sessions`. Soft-cancel remains the only session delete.
Document in `admin-api.md`. Tests required.

## Allowed paths

- `services/api/src/routes/admin/scheduling.js`
- tests
- `docs/admin-api.md`
- `supabase/migrations/` if an RPC is required
- Shared queue files

## Acceptance

- Create/update templates; generate sessions for a range without duplicates
- Existing session/attendance routes unchanged
- No production writes during development
