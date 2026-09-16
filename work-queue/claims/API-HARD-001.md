# API task claim

- Task ID: API-HARD-001
- Owner: Cursor Cloud Agent
- Claimed at: 2026-09-16T17:41:00Z
- Base branch: `develop`
- Base commit: `4bec056038619bc1322ff961aa5c02b569933e40`
- Production write authorized: no
- Status: `done`

## Scope and allowed files

- `supabase/migrations/` — `20260916174649_record_payment_rpc.sql` (created with official `supabase migration new record_payment_rpc`; version sorts after `20260914202053`; did not reuse `0021`–`0024`)
- `services/api/src/routes/admin/billing.js`
- matching tests: `services/api/src/routes/admin/billing.test.js`
- `docs/admin-api.md`, `docs/current-state.md`
- Shared queue files: `work-queue/claims/API-HARD-001.md`, `work-queue/queue.json` (API-HARD-001 row only), `work-queue/README.md` (API-HARD-001 row only)

## Verification evidence

Commands run:

| Command | Exit code | Notes |
| --- | --- | --- |
| `git fetch/checkout/pull origin develop` then `git rev-parse HEAD origin/develop` | 0 | Both `4bec056038619bc1322ff961aa5c02b569933e40` |
| `diff` of on-disk `work-queue/queue.json` vs `git show HEAD:work-queue/queue.json` | 0 | Matched before the claim |
| `/tmp/supabase migration new record_payment_rpc` | 0 | Official linux CLI v2.75.5 (workspace npm package has no linux-x64 binary). Created `supabase/migrations/20260916174649_record_payment_rpc.sql` |
| `npm --workspace services/api run test` | 0 | 14 files / 110 tests. Log: `/opt/cursor/artifacts/api_hard_001_vitest.log` |
| `npm run guard:waiver-schema` | 0 | Log: `/opt/cursor/artifacts/api_hard_001_waiver_guard.log` |

What landed:

- Service-role RPC `public.record_payment(...)` writes payment + allocations + optional `money_in` receipt in one function (Postgres rolls the whole call back on error). Charges are locked `FOR UPDATE` in id order. Allocations are capped by `view_charge_net` remaining headroom. Money is integer cents.
- Optional `idempotency_key` on `payments` (partial unique index). Same key + same account/amount/method replays `{ payment_id, receipt_id }`. Same key with a different account, amount, or method returns `409 idempotency_key_conflict`. Concurrent unique-index races replay the committed row.
- `POST /api/admin/billing/record-payment` calls the RPC. If the function is missing (`PGRST202` / `42883`), the handler falls back to the previous sequential inserts so live record-payment still works before `20260916174649` is applied.
- Vitest: RPC success, RPC failure with no leftover payment/allocations/receipt, idempotent retry, key conflict, missing-RPC sequential fallback, existing validation/auth cases.

Did **not** do:

- No production writes.
- No `supabase db push` to project `jhxzecxkccqlgyazhsnb`.
- No POST to `https://api.templeunderground.com` or the Render host.
- Migration `20260916174649` is in-repo only (forward-safe `add column if not exists` + partial unique index; existing NULL keys stay valid).
- Did not start API-PAY-001 or API-AUTO-001. Did not flip API-PAY-001 to `ready`.
- Did not rewrite other tasks' queue/README rows.

## Handoff or blocker

`done`. Residual risk: until `20260916174649` is applied, production still uses sequential inserts (partial failure can leave a payment without allocations/receipt; retries are not idempotent). Apply that migration in a later authorized schema push. API-PAY-001 stays `blocked` (dependencies are now both `done`; a later agent can flip it to `ready` if desired).
