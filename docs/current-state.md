# API current state

**Verified:** 2026-09-24 (production migration history, production row-count snapshot, billing scheduler decision, subscription-generator limitations); 2026-09-21 (billing uniqueness scope and per-class conversion anchor); 2026-09-16 (Stripe webhook → `record_payment`); 2026-09-14 (Discord cron runbook; staff RBAC; schedule templates); 2026-09-05 (deploy inventory)
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
| Schema | verified | Production `list_migrations` checked 2026-09-24 | Applied: `0001`–`0020`, `20260608191715`, `20260914150818`, `20260914185843`, `20260914202053`, `20260916174649`, `20260916225225`, `20260921185003`, `20260921221500`. No known migration from that repository set remains pending production application. |
| Public/admin routes | implemented | Routes mounted; API suite passes 18/18 | Most business routes lack integration tests |
| Reporting | implemented | All 19 referenced views exist | Most operational source tables are empty |
| Billing/receipts | schema verified; automation gated | Production migrations for atomic payment recording, processor references, and V1 monthly generation are applied. Production snapshot still has 0 subscriptions, charges, payments, and receipts. | Do not enable recurring billing yet: the current generator ends periods at the calendar-month boundary instead of preserving billing anchors such as the 26th/29th, and recurring family/custom discounts are not persisted as generation policy. Cloudflare Worker is the selected scheduler but is not yet implemented/deployed. |
| Subscriptions | verified (non-prod) | Local smoke (API-VAL-002): `POST /api/admin/billing/subscriptions` for TU-TEST participant + Basic Group Plan (`create_subscription`, monthly `create_initial_charge`). Billing pgTAP verifies the $100 Basic, $150 Core, and $200 Unlimited plans create exactly one correct initial charge, explicit disable remains uncharged for the current period and begins next-period automation, free monthly plans create no charge, and paid per-class conversions persist `automatic_billing_starts_at` for the next period. | Production still has 0 subscriptions. API omission defaults initial charging only for paid monthly plans |
| Scheduling | schema applied; production data empty | `20260914202053` (`generate_sessions`) is applied; local route/RPC tests cover template/session flows | Production still has 0 sessions and attendance rows. **Entitlement:** default `enforce_entitlement: true` blocks when `can_attend_group_session` is false; `enforce_entitlement: false` bypasses that check. |
| Notifications | schedule documented; live cron not enabled | Discord routes exist; Render cron runbook in [deployment.md](./deployment.md) | Digest once daily (`0 13 * * *` UTC). Dedicated `payment-reminders` cron **not** scheduled (same overdue / due-soon list as digest). Render MCP unauthorized; no live job created |
| On-demand waiver PDF | implemented, unwired | Renderer/route tests pass | Active admin UI uses stored signed PDF URLs |
| Non-prod validation env | documented | [validation-environment.md](./validation-environment.md) | Local Supabase + local API only; production `jhxzecxkccqlgyazhsnb` is out of bounds |

## Production snapshot

Read-only production inspection on 2026-09-24 returned: participants 32; waivers 36; staff_users 0; subscriptions, sessions, attendance, charges, payments, receipts, personal-finance entries, operating expenses, and marketing leads all 0. No production writes were performed during this verification.

No production writes were performed. Deployed Express host is **Render** at
`https://api.templeunderground.com` (also
`https://temple-underground-signup.onrender.com`). Read-only health checks on
2026-09-05: `GET /health` → `{ok:true}`; `GET /health/deep` → `{ok:true,db:true}`.
Live CORS responds with `Access-Control-Allow-Origin: *`. Env **names** only are listed
in [deployment.md](./deployment.md) and `services/api/.env.example`.

## Known gaps and risks

- `record-payment` uses service-role RPC `record_payment` (payment + allocations + optional receipt in one transaction; optional `idempotency_key`). Migration `20260916174649` is applied in production. The sequential fallback remains compatibility code for databases missing the RPC; public Stripe webhooks never use that fallback. Live Stripe endpoint registration was not re-verified during the 2026-09-24 database/documentation audit.
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
- Monthly-charge generation migrations are applied, but automation is intentionally gated. The current generator uses calendar-month period ends, so a member billed on September 26 would receive September 26–30 instead of September 26–October 25. It also has no persistent recurring family/custom discount policy. Fix those semantics before setting `automatic_billing_starts_at` or deploying the selected Cloudflare Worker scheduler.
- Discord notifications: operator Render cron runbook is in [deployment.md](./deployment.md) (API-AUTO-002). Live cron was **not** enabled (Render MCP unauthorized; avoid silent production Discord posts). Digest is the only recommended scheduled job; `payment-reminders` stays on-demand because it repeats digest’s overdue / due-soon list. Handlers have no last-run marker, so a manual Trigger Run plus the scheduled tick can still double-post.
- Schedule-template CRUD and recurring-session generation exist in-repo (API-SCHED-001); migration `20260914202053` is applied in production.
- Staff authorization is per-person hashed `x-admin-key` values with roles
  `owner` / `front_desk` / `finance` (API-AUTH-001 / API-ADR-005). The shared
  `ADMIN_API_KEY` remains an owner compatibility actor (`legacy_shared_key`)
  until operators rotate. Migration `20260914185843` is applied in production; there are currently no `staff_users` rows, so the shared compatibility key may still be operationally relevant.
- CORS defaults to `*` when `ALLOWED_ORIGIN` is absent; production currently reflects `*`.

## Verification baseline

- `npm --workspace services/api test`: 140/140 passing.
- Billing database lifecycle: 50/50 pgTAP assertions pass after a fresh native PostgreSQL migration replay + `supabase/seed.sql`. Local Supabase CLI could not start in the Cloud VM because no Docker daemon was available; PostgreSQL 16 + pgTAP was used as the isolated local fallback. No production connection or write occurred.
- `npm run guard:waiver-schema`: passing.
- Documentation refreshed against production `list_migrations`, production row counts, current billing RPC behavior, and scheduler decisions on 2026-09-24. Historical audit documents are explicitly labeled as historical.
- Deploy inventory (API-OPS-001): public host + health documented in [deployment.md](./deployment.md) (2026-09-05).
- Discord cron runbook (API-AUTO-002): auth header `x-cron-secret` / env `CRON_SECRET`; digest `POST /api/admin/notifications/discord/daily-digest` at `0 13 * * *` UTC; `payment-reminders` not scheduled. Failure keys: `401 unauthorized`, `500 discord_webhook_not_configured`, `502 discord_*`. Live Render cron not created.
- Validation environment (API-GATE-001): seed/cleanup procedure in [validation-environment.md](./validation-environment.md). Production project `jhxzecxkccqlgyazhsnb` and `https://api.templeunderground.com` are out of bounds for VAL writes.
- Waiver submit idempotency (API-HARD-002): Vitest covers first submit, duplicate replay, notification throw, unchanged validation errors, and a missing-column fallback so live submits still work before `20260914150818` is applied. Migration `20260914150818` (formerly `0022`) is applied in production.
- Staff RBAC (API-AUTH-001): Vitest covers missing/wrong key (`401 unauthorized`), shared-key owner compatibility, personal staff keys, finance/front_desk `403 forbidden`, cron `x-cron-secret` actor, and owner staff CRUD. Migration `20260914185843` (formerly `0023`) is applied in production.
- Schedule templates (API-SCHED-001): Vitest covers template create/update, generate-sessions, duplicate generate, and validation errors. Migration `20260914202053` (formerly `0024`) is applied in production.
- Atomic record-payment (API-HARD-001): Vitest covers RPC success, RPC failure with no leftover rows, idempotent retry, idempotency-key conflict, and missing-function sequential fallback. Migration `20260916174649` is applied in production.
- Stripe webhook (API-PAY-001): Vitest covers signature accept/reject, `payment_intent.succeeded` → `record_payment` (`method=card`, `issued_by=stripe_webhook`, `idempotency_key=stripe:pi_…`), duplicate event replay with one payment, unmatched metadata `400 unmatched_payment`, missing RPC `503` with no sequential inserts, ignored `charge.succeeded`, `refund.created` → `record_payment_refund`, and refund-before-payment `400 payment_not_found`. Migration `20260916225225` is applied in production. Env name `STRIPE_WEBHOOK_SECRET` only.
