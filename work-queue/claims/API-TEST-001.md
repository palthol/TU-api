# API task claim

- Task ID: API-TEST-001
- Owner: cloud-agent
- Claimed at: 2026-09-07T18:55:00Z
- Base branch: `develop`
- Base commit: `3a02838d42f8c0a79ef0d9b661f481bda902ce05`
- Production write authorized: no
- Status: `done`

## Scope and allowed files

- `services/api/src/**/*.test.js` — added `services/api/src/routes/admin/billing.test.js`
- `services/api/src/**/*.test.ts` — not used
- `services/api/vitest.config.ts` — not modified (existing `src/**/*.test.js` include is enough)
- Shared queue files: `work-queue/claims/API-TEST-001.md`, `work-queue/queue.json` (this row only), `work-queue/README.md` (this row only)

Did not change production route handlers. No testability seams were required in `billing.js`.

## What changed

Added isolated Express + supertest integration tests for billing/receipt admin routes. Each case injects an in-memory Supabase stand-in (no network, no production database) and the real `requireAdmin` middleware.

Coverage:

- `x-admin-key` rejection (missing and wrong key) on `record-payment` and receipt void
- Bad input: missing account/amount, invalid method, missing `issued_by`, empty allocations, allocation sum mismatch, missing charge, account mismatch, allocation exceeds net due, missing void reason, missing `issued_by` on issue-for-refund
- Success: payment + allocation + charge marked `paid` + money-in receipt; `issue_receipt: false`; receipt void
- Known non-transactional `record-payment` gap (current behavior, not a fix):
  - first allocation insert fails → HTTP 400, payment row remains, no `payment_id` in the error body
  - later allocation insert fails → payment + first allocation remain
  - receipt insert fails → HTTP 400 includes `payment_id`; payment, allocations, and paid charge remain; no receipt

## Verification evidence

| Command | Exit code | Notes |
| --- | --- | --- |
| `npm ci` | 0 | Environment `node_modules` lacked `@rollup/rollup-linux-x64-gnu`; clean install from the repaired lockfile. No lockfile edits. |
| `npm --workspace services/api run test` | 0 | 8 files / 38 tests passed (was 7 files / 18 tests). |

Did **not**: write to production Supabase; change `billing.js` contracts; run `npm audit fix`; flip `API-GATE-001` (still needs `API-TEST-002`); start `API-HARD-001`.

## Handoff or blocker

`done`. Residual risk: tests assert the current non-atomic `record-payment` write path; `API-HARD-001` should replace that with an RPC and update this suite. `API-GATE-001` stays blocked until `API-TEST-002` is also done (DEV-001 and OPS-001 are already done).
