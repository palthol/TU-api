# API task claim

- Task ID: API-HARD-002
- Owner: Cursor Cloud Agent
- Claimed at: 2026-09-11T08:43:26Z
- Base branch: `develop`
- Base commit: `d6cb827dc9b93f63ada00b53de42b76305ff5224`
- Production write authorized: no
- Status: `done`

Note: the work-queue brief suggests branching as `agent/API-HARD-002-waiver-idempotency`, but this run uses the required Cursor Cloud branch naming scheme (`cursor/api-hard-002-waiver-idempotency-6e61`).

## Scope and allowed files

- `services/api/src/index.js` (submit handler only as needed)
- `services/api/src/services/accounts/`
- tests
- `docs/admin-api.md`, `docs/frontend-backend-payload.md`, `docs/current-state.md`
- `supabase/migrations/` only if a unique constraint or idempotency table is required (next number after `0021`; idempotent SQL)
- `work-queue/claims/API-HARD-002.md`
- `work-queue/queue.json` (API-HARD-002 row only)
- `work-queue/README.md` (API-HARD-002 row only)

## Verification evidence

Commands run:

| Command | Exit code | Notes |
| --- | --- | --- |
| `git fetch/checkout/pull origin develop` then `git rev-parse HEAD origin/develop` | 0 | Both `d6cb827dc9b93f63ada00b53de42b76305ff5224` |
| `diff -u work-queue/queue.json <(git show HEAD:work-queue/queue.json)` | 0 | On-disk queue matched `HEAD` before the claim |
| `npm --workspace services/api run test` | 0 | 11 files / 75 tests (includes new submit idempotency suite). Log: `/opt/cursor/artifacts/api_hard_002_vitest.log` |
| `npm run guard:waiver-schema` | 0 | Log: `/opt/cursor/artifacts/api_hard_002_waiver_guard.log` |

What landed:

- Optional body `idempotency_key` on `POST /api/waivers/submit`. Same key + same participant identity (email + DOB + phone) replays `{ ok, waiverId, participantId, accountId, accountMemberId, sha256 }`.
- If the client omits the key, the server derives `derived:v1:` + SHA-256 of identity + `content_version` + signature PNG hash (protects current TU-Signup double-click/retry without a frontend change).
- Unique partial index `waivers_idempotency_key_unique` in unapplied migration `0022`. Insert `23505` races replay the winner. If the live schema does not have the column yet (`PGRST204` / `42703`), lookup is skipped and insert retries without the key so production submits keep working until `0022` is applied.
- Notification failure still cannot fail a persisted submit (`Promise.resolve(notify(...)).catch` plus sync try/catch). Replays do not re-notify.
- Existing success envelope field names unchanged. Validation `400 { ok:false, errors }` unchanged.
- `createOrBindParticipantAccount` still reuses the first membership.

Did **not** do:

- No production writes.
- No `supabase db push` to project `jhxzecxkccqlgyazhsnb`.
- No POST to `https://api.templeunderground.com` or the Render host.
- Migration `0022` is in-repo only (forward-safe `add column if not exists` + partial unique index; existing NULL keys stay valid).
- No live local GATE duplicate-submit smoke: Docker was not available in this environment (`docker info` failed). Vitest covers first submit, duplicate replay, notify throw, and validation.
- Did not start API-VAL-002, API-HARD-001, or any other queue task.
- Did not rewrite other tasks' queue/README rows.

## Handoff or blocker

`done`. Residual risk: storage uploads and DB writes are still sequential. Unique `idempotency_key` prevents duplicate waiver rows; a crash after storage upload and before the waiver insert can leave orphan signature/PDF objects. Related rows (`emergency_contacts`, `waiver_medical_histories`, `audit_trails`, `event_ledger`) may be missing if the first attempt died after the waiver insert; a retry replays IDs and does not duplicate the waiver. Concurrent first-time participant inserts are still matched only in application code (no unique on email+DOB+phone). Apply `0022` to production in a later authorized schema push; until then production retries can still duplicate.
