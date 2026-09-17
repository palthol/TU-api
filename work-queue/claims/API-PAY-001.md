# API task claim

- Task ID: API-PAY-001
- Owner: Cursor Cloud Agent
- Claimed at: 2026-09-16T22:48:00Z
- Base branch: `develop`
- Base commit: `8ca91a2db2eb2800f7918c9085c3262a58877c0e`
- Production write authorized: no
- Status: `done`

## Scope and allowed files

- `docs/decision-log.md`
- `docs/finance-subsystem-design.md`
- `docs/admin-api.md`
- `docs/current-state.md`
- `services/api/.env.example` (env **names** only)
- webhook route + tests + migrations under `services/api/src/` and `supabase/migrations/`
- Shared queue files: `work-queue/claims/API-PAY-001.md`, `work-queue/queue.json` (API-PAY-001 row only), `work-queue/README.md` (API-PAY-001 row only), `work-queue/tasks/API-PAY-001.md` (status line)

## Verification evidence

Commands run:

| Command | Exit code | Notes |
| --- | --- | --- |
| `git fetch/checkout/pull origin develop` then `git rev-parse HEAD origin/develop` | 0 | Both `8ca91a2db2eb2800f7918c9085c3262a58877c0e` |
| `/tmp/supabase migration new payment_processor_refs` | 0 | Official linux CLI v2.75.5. Created `supabase/migrations/20260916225225_payment_processor_refs.sql` |
| `npm ci` | 0 | Local env was missing `@rollup/rollup-linux-x64-gnu`; lockfile unchanged |
| `npm --workspace services/api run test` | 0 | 17 files / 131 tests. Log: `/opt/cursor/artifacts/api_pay_001_vitest.log` |
| `npm run guard:waiver-schema` | 0 | Log: `/opt/cursor/artifacts/api_pay_001_waiver_guard.log` |

What landed:

- API-ADR-006: Stripe is the card processor. Public `POST /api/webhooks/stripe` verifies `Stripe-Signature`. Staff `x-admin-key` does not authenticate the provider.
- Money-in: `payment_intent.succeeded` → service-role `record_payment` with `method=card`, `issued_by=stripe_webhook`, `idempotency_key=stripe:pi_<id>`, allocations from metadata `tu_account_id` + `tu_charge_id` or `tu_allocations`. Unmatched metadata fails closed.
- Duplicate Stripe event ids replay the stored envelope; no second payment/allocation/receipt.
- Money-out: `refund.created` → `record_payment_refund` (`stripe:re_<id>`). Disputes and `charge.succeeded` are ignored so they cannot double-allocate.
- Missing `record_payment` → `503 record_payment_unavailable` (no sequential fallback).
- Additive tables `payment_processor_events` and `payment_processor_refs`. Env name `STRIPE_WEBHOOK_SECRET` only.

Did **not** do:

- No production writes.
- No `supabase db push` to project `jhxzecxkccqlgyazhsnb`.
- No POST to `https://api.templeunderground.com` or the Render host.
- No live Stripe webhook registration.
- No Checkout / pay links / sibling UI changes.
- No email or SMS provider work.
- Did not flip any other queue task to `ready` (no successor).

## Handoff or blocker

`done`. Residual risk: production still needs `20260916174649` and `20260916225225` applied, plus a Stripe endpoint URL and `STRIPE_WEBHOOK_SECRET` on Render, before live card events can book. PaymentIntents must carry `tu_account_id` and `tu_charge_id` (or `tu_allocations`); there is no member pay-link UI yet. Email/SMS providers remain an open decision.
