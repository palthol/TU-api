# API current state

**Verified:** 2026-09-17 (live production route smoke, read-only); 2026-10-24 (work-queue refresh against git history, PRs #41–#47, tag `v1.1.0`, branches `cursor/custom-household-billing` and `chore/subscription-backfill-2026-09`; Discord waiver summaries released to `main`; Discord digest **live cron needs verification**); 2026-09-29 (Cloudflare Worker source added; production deployment remains gated); 2026-09-24 (production migration history, production row-count snapshot, billing scheduler decision, subscription-generator limitations); 2026-09-21 (billing uniqueness scope and per-class conversion anchor); 2026-09-16 (Stripe webhook → `record_payment`); 2026-09-14 (Discord cron runbook; staff RBAC; schedule templates); 2026-09-05 (deploy inventory)
**Repository:** `palthol/TU-api`  
**Production database:** Supabase `jhxzecxkccqlgyazhsnb`  
**Deployed API:** Render — `https://api.templeunderground.com` (see [deployment.md](./deployment.md))

This is the API repository's status source of truth. Use `admin-api.md` for request and
response contracts and `api-schema-audit.md` for detailed schema evidence.

## Status

| Domain | Status | Evidence | Qualification |
| --- | --- | --- | --- |
| Deployment / health | verified | Live `/health` `{ok:true}` and `/health/deep` `{ok:true,db:true}` on both public hosts (2026-09-17) | Render dashboard service ID not readable via MCP |
| Public/admin route gates | verified (live) | 85 cases × 2 hosts: public validation 400s; all `/api/admin/*` and PDF 401 without/wrong key | Authenticated admin success bodies not fetched (no production admin key in the smoke environment) |
| Waiver submission | verified | 32 participants and 36 waivers in production | Only workflow proven by production usage |
| Schema | verified | Production `list_migrations` checked 2026-09-24 | Applied: `0001`–`0020`, `20260608191715`, `20260914150818`, `20260914185843`, `20260914202053`, `20260916174649`, `20260916225225`, `20260921185003`, `20260921221500`. No known migration from that repository set remains pending production application. |
| Public/admin routes | implemented | Routes mounted; API suite passes 18/18 | Most business routes lack integration tests |
| Reporting | implemented | All 19 referenced views exist | Most operational source tables are empty |
| Billing/receipts | schema verified; automation gated | Production migrations for atomic payment recording, processor references, and V1 monthly generation are applied. Production snapshot still has 0 subscriptions, charges, payments, and receipts. | Do not enable recurring billing yet: the current generator ends periods at the calendar-month boundary instead of preserving billing anchors such as the 26th/29th, and recurring family/custom discounts are not persisted as generation policy. Cloudflare Worker is the selected scheduler; source is now in `workers/billing-cron/` but is not deployed/configured. |
| Subscriptions | verified (non-prod) | Local smoke (API-VAL-002): `POST /api/admin/billing/subscriptions` for TU-TEST participant + Basic Group Plan (`create_subscription`, monthly `create_initial_charge`). Billing pgTAP verifies the $100 Basic, $150 Core, and $200 Unlimited plans create exactly one correct initial charge, explicit disable remains uncharged for the current period and begins next-period automation, free monthly plans create no charge, and paid per-class conversions persist `automatic_billing_starts_at` for the next period. | Production still has 0 subscriptions. API omission defaults initial charging only for paid monthly plans |
| Scheduling | schema applied; production data empty | `20260914202053` (`generate_sessions`) is applied; local route/RPC tests cover template/session flows | Production still has 0 sessions and attendance rows. **Entitlement:** default `enforce_entitlement: true` blocks when `can_attend_group_session` is false; `enforce_entitlement: false` bypasses that check. |
| Notifications | needs verification | Discord routes exist; Render cron runbook in [deployment.md](./deployment.md); no in-repo scheduler (`render.yaml` absent). 2026-10-24: Render MCP tool discovery failed; Render CLI not installed; cannot list Dashboard cron jobs. Last documented check 2026-09-14: MCP unauthorized and no live job created from API-AUTO-002. | Digest remains documented as once daily (`0 13 * * *` UTC). Dedicated `payment-reminders` cron **not** scheduled in the runbook (same overdue / due-soon list as digest). Do not treat “live cron not enabled” as re-confirmed. |
| On-demand waiver PDF | implemented, unwired | Renderer/route tests pass | Active admin UI uses stored signed PDF URLs |
| Non-prod validation env | documented | [validation-environment.md](./validation-environment.md) | Local Supabase + local API only; production `jhxzecxkccqlgyazhsnb` is out of bounds |

## Production snapshot

Read-only production inspection on 2026-09-24 returned: participants 32; waivers 36; staff_users 0; subscriptions, sessions, attendance, charges, payments, receipts, personal-finance entries, operating expenses, and marketing leads all 0. No production writes were performed during this verification.

No production writes were performed. Deployed Express host is **Render** at
`https://api.templeunderground.com` (also
`https://temple-underground-signup.onrender.com`). Both hosts returned identical
status and error keys on the 2026-09-17 read-only smoke (85 cases each).

Live checks (2026-09-17): `GET /health` → `{ok:true}`; `GET /health/deep` →
`{ok:true,db:true}`; CORS `Access-Control-Allow-Origin: *` (including `OPTIONS`
on `/api/lead` and `/api/admin/waivers`); invalid `POST /api/lead` and
`POST /api/waivers/submit` → `400` with documented machine keys (no insert);
unauthenticated and wrong-key admin/cron/PDF → `401 unauthorized`;
`POST /api/webhooks/stripe` → `500 stripe_webhook_not_configured`;
`GET /api/viewer/waiver-documents` → `503 viewer_access_not_configured`.
Env **names** only are listed in [deployment.md](./deployment.md) and
`services/api/.env.example`.

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
- Monthly-charge generation migrations are applied, but automation is intentionally gated. The current generator uses calendar-month period ends, so a member billed on September 26 would receive September 26–30 instead of September 26–October 25. It also has no persistent recurring family/custom discount policy. Fix those semantics before setting `automatic_billing_starts_at` or deploying the selected Cloudflare Worker scheduler. Worker source and its deployment runbook are in `workers/billing-cron/`.
- Discord notifications: operator Render cron runbook is in [deployment.md](./deployment.md) (API-AUTO-002). **Live cron enablement needs verification** (2026-10-24): no `render.yaml`, Render MCP unavailable, last written check 2026-09-14 said no live job was created. Digest is the only recommended scheduled job; `payment-reminders` stays on-demand because it repeats digest’s overdue / due-soon list. Handlers have no last-run marker, so a manual Trigger Run plus the scheduled tick can still double-post.
- Schedule-template CRUD and recurring-session generation exist in-repo (API-SCHED-001); migration `20260914202053` is applied in production.
- Staff authorization is per-person hashed `x-admin-key` values with roles
  `owner` / `front_desk` / `finance` (API-AUTH-001 / API-ADR-005). The shared
  `ADMIN_API_KEY` remains an owner compatibility actor (`legacy_shared_key`)
  until operators rotate. Migration `20260914185843` is applied in production; there are currently no `staff_users` rows, so the shared compatibility key may still be operationally relevant.
- CORS defaults to `*` when `ALLOWED_ORIGIN` is absent; production currently reflects `*`.
- Live `POST /api/webhooks/stripe` returns `500 stripe_webhook_not_configured` — `STRIPE_WEBHOOK_SECRET` is unset on the Render service (route is mounted; Stripe Dashboard endpoint still not registered).
- Live `GET /api/viewer/waiver-documents` returns `503 viewer_access_not_configured` — `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are unset on the Render service.

## Verification baseline

- `npm --workspace services/api test`: 140/140 passing.
- Billing database lifecycle: 50/50 pgTAP assertions pass after a fresh native PostgreSQL migration replay + `supabase/seed.sql`. Local Supabase CLI could not start in the Cloud VM because no Docker daemon was available; PostgreSQL 16 + pgTAP was used as the isolated local fallback. No production connection or write occurred.
- `npm run guard:waiver-schema`: passing.
- Documentation refreshed against production `list_migrations`, production row counts, current billing RPC behavior, and scheduler decisions on 2026-09-24. Historical audit documents are explicitly labeled as historical. Cloudflare Worker source and deployment runbook were added in PR #44; deployment remains gated on billing-anchor and recurring discount fixes.
- Deploy inventory (API-OPS-001): public host + health documented in [deployment.md](./deployment.md) (2026-09-05). Live route smoke 2026-09-17: 85 cases on each host; no production writes; authenticated admin GETs skipped (no production admin key in the smoke environment).
- Discord cron runbook (API-AUTO-002): auth header `x-cron-secret` / env `CRON_SECRET`; digest `POST /api/admin/notifications/discord/daily-digest` at `0 13 * * *` UTC; `payment-reminders` not scheduled. Failure keys: `401 unauthorized`, `500 discord_webhook_not_configured`, `502 discord_*`. 2026-09-14 finding: live Render cron not created. 2026-10-24: cannot re-confirm Dashboard state (Render MCP unavailable).
- Validation environment (API-GATE-001): seed/cleanup procedure in [validation-environment.md](./validation-environment.md). Production project `jhxzecxkccqlgyazhsnb` and `https://api.templeunderground.com` are out of bounds for VAL writes.
- Waiver submit idempotency (API-HARD-002): Vitest covers first submit, duplicate replay, notification throw, unchanged validation errors, and a missing-column fallback so live submits still work before `20260914150818` is applied. Migration `20260914150818` (formerly `0022`) is applied in production.
- Staff RBAC (API-AUTH-001): Vitest covers missing/wrong key (`401 unauthorized`), shared-key owner compatibility, personal staff keys, finance/front_desk `403 forbidden`, cron `x-cron-secret` actor, and owner staff CRUD. Migration `20260914185843` (formerly `0023`) is applied in production.
- Schedule templates (API-SCHED-001): Vitest covers template create/update, generate-sessions, duplicate generate, and validation errors. Migration `20260914202053` (formerly `0024`) is applied in production.
- Atomic record-payment (API-HARD-001): Vitest covers RPC success, RPC failure with no leftover rows, idempotent retry, idempotency-key conflict, and missing-function sequential fallback. Migration `20260916174649` is applied in production.
- Stripe webhook (API-PAY-001): Vitest covers signature accept/reject, `payment_intent.succeeded` → `record_payment` (`method=card`, `issued_by=stripe_webhook`, `idempotency_key=stripe:pi_…`), duplicate event replay with one payment, unmatched metadata `400 unmatched_payment`, missing RPC `503` with no sequential inserts, ignored `charge.succeeded`, `refund.created` → `record_payment_refund`, and refund-before-payment `400 payment_not_found`. Migration `20260916225225` is applied in production. Env name `STRIPE_WEBHOOK_SECRET` only.

## Discord waiver contact feature (released 2026-10-14)

Released to `main` on 2026-10-14 via [PR #47](https://github.com/palthol/TU-api/pull/47); merged to `develop` the same day via [PR #46](https://github.com/palthol/TU-api/pull/46). Two Discord messages per newly persisted waiver: operator summary and separate vCard attachments. Medical wording is withheld because Discord channel permissions/consent are not established. Existing Slack layout, persistence and other notification workflows remain unchanged. Device import, real Discord attachment UI, and durable delivery remain unverified. Delivery receipts are process-local, not an outbox. See [discord-waiver-notifications.md](./discord-waiver-notifications.md) for actual guardian/medical mappings and limitations. PR #47 left “Production deploy after merge (Render)” unchecked; this refresh records the git release, not a verified Render deploy. No production data was read or written during this 2026-10-24 docs check.
