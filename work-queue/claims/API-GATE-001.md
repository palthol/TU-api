# API task claim

- Task ID: API-GATE-001
- Owner: cloud-agent
- Claimed at: 2026-09-07T19:35:00Z
- Base branch: `develop`
- Base commit: `8c9649f1bc1faee1688dbc8efc6df2d919f0d75d`
- Production write authorized: no
- Status: `done`

## Scope and allowed files

- `docs/validation-environment.md` (new)
- `docs/README.md` (link only)
- `docs/current-state.md` (link the validation doc only)
- `scripts/tu-test-seed.mjs`
- `scripts/tu-test-cleanup.mjs`
- `scripts/lib/` (guard + env loader; existing `tu-test-data.mjs` kept)
- Shared queue files: `work-queue/claims/API-GATE-001.md`, `work-queue/queue.json` (GATE row + successor ready flips required by the brief), `work-queue/README.md` (matching rows)

## What changed

Wrote the operator procedure for a safe non-production validation environment (local Supabase + local API). Reused existing `tu-test:seed` / `tu-test:cleanup` markers. Added a production-target guard that refuses project `jhxzecxkccqlgyazhsnb` and the Render API hosts from API-OPS-001 with no override.

## Verification evidence

| Command | Exit | Notes |
| --- | --- | --- |
| `node scripts/lib/tu-test-guard.selftest.mjs` | 0 | 7 offline checks (prod URL, prod API host, local allow, remote flag, env-file scan) |
| `node scripts/tu-test-seed.mjs --help` | 0 | Documents prod out-of-bounds |
| `node scripts/tu-test-cleanup.mjs --help` | 0 | Documents prod out-of-bounds; dry-run default |
| `TU_TEST_API_BASE=https://api.templeunderground.com node scripts/tu-test-seed.mjs --count=1` | 1 | Refused before any fetch |
| `TU_TEST_API_BASE=https://temple-underground-signup.onrender.com node scripts/tu-test-seed.mjs --count=1` | 1 | Refused Render hostname |
| `TU_TEST_ALLOW_REMOTE=1 SUPABASE_URL=https://jhxzecxkccqlgyazhsnb.supabase.co … --billing` | 1 | Production project refused even with remote flag |
| `SUPABASE_URL=https://jhxzecxkccqlgyazhsnb.supabase.co … tu-test-cleanup.mjs` | 1 | Cleanup refused production; no client calls |
| `SUPABASE_URL=https://abcdefghijklmnop.supabase.co … --execute` | 1 | Unmarked remote refused (would-be `--execute` never ran) |
| `TU_TEST_API_BASE=http://127.0.0.1:3001 … tu-test-seed.mjs` | 1 | Guard passed; `ECONNREFUSED 127.0.0.1:3001` only — no production host |

Operator-doc read of `docs/validation-environment.md`: headings present for where data lives, who may write, seed, cleanup, and production out-of-bounds (`jhxzecxkccqlgyazhsnb`, `api.templeunderground.com`). Successor usage for API-VAL-001, API-VAL-002, API-HARD-002 is spelled out.

Queue after this task: GATE `done`; VAL-001 / VAL-002 / HARD-002 `ready`. HARD-001, SCHED-001, AUTO-001, AUTO-002, AUTH-001 left `blocked`.

VM had no `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ADMIN_API_KEY` in the process environment.

### What this agent did **not** do

- No writes to production Supabase project `jhxzecxkccqlgyazhsnb`
- No POST/PATCH/DELETE (or seed/cleanup execute) against `https://api.templeunderground.com` or the Render hostname
- Did not run API-VAL-001, API-VAL-002, or API-HARD-002
- Did not change application routes, schema, auth, CORS, or Render production env
- Did not commit secrets, service-role keys, webhook URLs, or real PII
- Did not start a blocked successor
- Did not flip API-HARD-001, API-SCHED-001, API-AUTO-001, API-AUTO-002, or API-AUTH-001
- Did not start local Docker/Supabase in this environment (API was not listening on :3001)

## Handoff or blocker

`done`. Residual risk:

- A local API whose **process** env points at production (keys not stored in `services/api/.env` on disk) would still accept localhost writes; operators must confirm `supabase status` keys are what the API loaded.
- `record-payment` remains non-atomic (API-HARD-001). Waiver submit remains non-idempotent (API-HARD-002).
- `event_ledger` is append-only; cleanup does not remove it.
- No hosted Render preview environment exists in this repo yet (API-OPS-001).
- This session did not actually insert/delete rows in a running local Supabase; VAL agents must complete bring-up from the new doc.
