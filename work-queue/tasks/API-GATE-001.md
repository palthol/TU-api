# API-GATE-001 — Non-production validation environment

- Status: **done**
- Lane: validation
- Depends on: API-DEV-001, API-TEST-001, API-TEST-002, API-OPS-001
- Production writes: **no**
- Branch from: `develop` as `agent/API-GATE-001-validation-env`

## Agent prompt

Define a safe non-production way to exercise finance and scheduling (local
Supabase, preview branch, or approved fixtures). Production test writes remain
prohibited. Document how to seed and clean up.

## Allowed paths

- `docs/` (new `docs/validation-environment.md` preferred)
- `scripts/tu-test-seed.mjs`, `scripts/tu-test-cleanup.mjs`, `scripts/lib/`
- Shared queue files

## Acceptance

- Written procedure: where data lives, who may write, cleanup
- Explicit: production project `jhxzecxkccqlgyazhsnb` is out of bounds for VAL tasks
- Seed/cleanup scripts documented or extended without targeting prod
