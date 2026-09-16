# API current state

**Verified:** 2026-09-16 (Stripe webhook → `record_payment`; atomic record-payment RPC); 2026-09-14 (migration history filenames; Discord cron runbook; staff RBAC; schedule templates); 2026-09-05 (deploy inventory); production snapshot 2026-09-03  
**Repository:** `palthol/TU-api`  
**Production database:** Supabase `jhxzecxkccqlgyazhsnb`  
**Deployed API:** Render — `https://api.templeunderground.com` (see [deployment.md](./deployment.md))

This is the API repository's status source of truth. Use `admin-api.md` for request and
response contracts and `api-schema-audit.md` for detailed schema evidence.

## Status

| Domain | Status | Evidence | Qualification |
| --- | --- | --- | --- |
| Deployment / health | verified | Live `/health` and `/health/deep` on public host | Render dashboard service ID not readable via MCP |
| Waiver submission | verified | 32 participants and 36 waivers in production | Only workflow proven by production usage |
| Schema | verified | Project healthy; applied history is `0001`–`0020` + `20260608191715` | Repo filename now matches live version `20260608191715`. Pending in-repo: `20260914150818`, `20260914185843`, `20260914202053` (formerly `0022`–`0024`), `20260916174649` (`record_payment`), `20260916225225` (`payment_processor_*`); not applied. Production `schema_migrations` was not rewritten from this change. |
| Public/admin routes | implemented | Routes mounted; API suite passes 18/18 | Most business routes lack integration tests |
| Reporting | implemented | All 19 referenced views exist | Most operational source tables are empty |
| Billing/receipts | verified (non-prod) | Local smoke (API-VAL-001): personal finance entries, charge discounts, record-payment, receipt void, refund. API-HARD-001: Vitest covers atomic `record_payment` RPC, idempotent retry, and missing-RPC fallback. API-PAY-001: Vitest covers Stripe signature verify, `payment_intent.succeeded` → `record_payment`, duplicate event replay, unmatched metadata, missing-RPC `503`, ignored `charge.succeeded`, and `refund.created` → `record_payment_refund` | Production still has 0 charges, payments, receipts. Migrations `20260916174649` and `20260916225225` are in-repo and **not** applied. Live Stripe webhook is **not** registered. Admin record-payment still falls back to sequential inserts until the RPC exists; Stripe webhooks do **not** use that fallback |
| Subscriptions | verified (non-prod) | Local smoke (API-VAL-002): `POST /api/admin/billing/subscriptions` for TU-TEST participant + Basic Group Plan (`create_subscription`, monthly `create_initial_charge`); `400` `participant_id_required`; `400` `create_initial_charge only applies to monthly plans (... cadence contract)` | Production still has 0 subscriptions |
| Scheduling | verified (non-prod) | Local smoke (API-VAL-002): session create/list/get/reschedule/cancel; attendance upsert; cancelled-session `session_cancelled`; unknown session `session_not_found`; missing `starts_at` → `invalid_starts_at`. Template CRUD + generate-sessions (API-SCHED-001) covered by Vitest | Production still has 0 sessions and attendance rows. Migration `20260914202053` (`generate_sessions`, formerly `0024`) is in-repo and unapplied. **Entitlement:** default `enforce_entitlement: true` **blocks** — `can_attend_group_session` false → `blocked` / `400` `all_records_blocked` and no upsert; `enforce_entitlement: false` upserts without calling the RPC |
| Notifications | schedule documented; live cron not enabled | Discord routes exist; Render cron runbook in [deployment.md](./deployment.md) | Digest once daily (`0 13 * * *` UTC). Dedicated `payment-reminders` cron **not** scheduled (same overdue / due-soon list as digest). Render MCP unauthorized; no live job created |
| On-demand waiver PDF | implemented, unwired | Renderer/route tests pass | Active admin UI uses stored signed PDF URLs |
| Non-prod validation env | documented | [validation-environment.md](./validation-environment.md) | Local Supabase + local API only; production `jhxzecxkccqlgyazhsnb` is out of bounds |

## Production snapshot

Read-only inspection returned: participants 32; waivers 36; subscriptions, sessions,
attendance, charges, payments, receipts, personal-finance entries, operating expenses, and
marketing leads all 0. RLS is enabled on all public tables.

No production writes were performed. Deployed Express host is **Render** at
`https://api.templeunderground.com` (also
`https://temple-underground-signup.onrender.com`). Read-only health checks on
2026-09-05: `GET /health` → `{ok:true}`; `GET /health/deep` → `{ok:true,db:true}`.
Live CORS responds with `Access-Control-Allow-Origin: *`. Env **names** only are listed
in [deployment.md](./deployment.md) and `services/api/.env.example`.

## Known gaps and risks

- `record-payment` uses service-role RPC `record_payment` (payment + allocations + receipt in one transaction; optional `idempotency_key`). Migration `20260916174649` is in-repo and **not** applied to production; until then the **admin** handler falls back to sequential inserts (partial failure can still leave a payment without allocations/receipt, and retries are not idempotent). Public `POST /api/webhooks/stripe` (API-PAY-001 / API-ADR-006) never uses that fallback: missing RPC → `503` `record_payment_unavailable`. Live Stripe endpoint registration was **not** performed. PaymentIntents without `tu_account_id` + `tu_charge_id` (or `tu_allocations`) fail closed (`unmatched_payment`). Checkout / member pay links remain out of scope.
- Waiver submit is retry-safe for the same intent via optional client
  `idempotency_key` or a derived key (identity + `content_version` + signature
  hash). Duplicate POSTs replay the original success envelope and do not create
  extra waivers or accounts (API-HARD-002). Storage + DB remain non-atomic:
  orphan signature/PDF objects and missing related rows are still possible if
  the first attempt dies mid-flow.
- `npm ci` fails because the lockfile omits platform packages required by the declared
  Supabase CLI version.
- Dependency audit reported 3 moderate findings on 2026-09-03.
- No route-level suites cover the main billing, subscription, scheduling, or reporting
  workflows.
- Monthly-charge generation has no configured scheduler here (API-AUTO-001).
- Discord notifications: operator Render cron runbook is in [deployment.md](./deployment.md) (API-AUTO-002). Live cron was **not** enabled (Render MCP unauthorized; avoid silent production Discord posts). Digest is the only recommended scheduled job; `payment-reminders` stays on-demand because it repeats digest’s overdue / due-soon list. Handlers have no last-run marker, so a manual Trigger Run plus the scheduled tick can still double-post.
- Schedule-template CRUD and recurring-session generation exist in-repo (API-SCHED-001); apply migration `20260914202053` before using `POST /api/admin/scheduling/generate-sessions` against a live database.
- Staff authorization is per-person hashed `x-admin-key` values with roles
  `owner` / `front_desk` / `finance` (API-AUTH-001 / API-ADR-005). The shared
  `ADMIN_API_KEY` remains an owner compatibility actor (`legacy_shared_key`)
  until operators rotate. Migration `20260914185843` is in-repo and **not** applied to
  production.
- CORS defaults to `*` when `ALLOWED_ORIGIN` is absent; production currently reflects `*`.

## Verification baseline

- `npm --workspace services/api test`: 131/131 passing (API-PAY-001 Stripe webhook).
- `npm run guard:waiver-schema`: passing.
- Documentation reconciled against the mounted route list, migrations `0001`–`0020` plus `20260608191715`, and test files (2026-09-03). History filenames aligned 2026-09-14.
- Deploy inventory (API-OPS-001): public host + health documented in [deployment.md](./deployment.md) (2026-09-05).
- Discord cron runbook (API-AUTO-002): auth header `x-cron-secret` / env `CRON_SECRET`; digest `POST /api/admin/notifications/discord/daily-digest` at `0 13 * * *` UTC; `payment-reminders` not scheduled. Failure keys: `401 unauthorized`, `500 discord_webhook_not_configured`, `502 discord_*`. Live Render cron not created.
- Validation environment (API-GATE-001): seed/cleanup procedure in [validation-environment.md](./validation-environment.md). Production project `jhxzecxkccqlgyazhsnb` and `https://api.templeunderground.com` are out of bounds for VAL writes.
- Waiver submit idempotency (API-HARD-002): Vitest covers first submit, duplicate replay, notification throw, unchanged validation errors, and a missing-column fallback so live submits still work before `20260914150818` is applied. Migration `20260914150818` (formerly `0022`) is in-repo and unapplied to production.
- Staff RBAC (API-AUTH-001): Vitest covers missing/wrong key (`401 unauthorized`), shared-key owner compatibility, personal staff keys, finance/front_desk `403 forbidden`, cron `x-cron-secret` actor, and owner staff CRUD. Migration `20260914185843` (formerly `0023`) is in-repo and unapplied to production.
- Schedule templates (API-SCHED-001): Vitest covers template create/update, generate-sessions, duplicate generate, and validation errors. Migration `20260914202053` (formerly `0024`) is in-repo and unapplied to production.
- Atomic record-payment (API-HARD-001): Vitest covers RPC success, RPC failure with no leftover rows, idempotent retry, idempotency-key conflict, and missing-function sequential fallback. Migration `20260916174649` is in-repo and unapplied to production.
- Stripe webhook (API-PAY-001): Vitest covers signature accept/reject, `payment_intent.succeeded` → `record_payment` (`method=card`, `issued_by=stripe_webhook`, `idempotency_key=stripe:pi_…`), duplicate event replay with one payment, unmatched metadata `400 unmatched_payment`, missing RPC `503` with no sequential inserts, ignored `charge.succeeded`, `refund.created` → `record_payment_refund`, and refund-before-payment `400 payment_not_found`. Migration `20260916225225` is in-repo and unapplied. Env name `STRIPE_WEBHOOK_SECRET` only.
