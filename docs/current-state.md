# API current state

**Verified:** 2026-10-01 (local obligation implementation; 191 API tests and 165 isolated PostgreSQL/pgTAP assertions; no production access); 2026-09-29 (Cloudflare Worker source added; production deployment remains gated); 2026-09-24 (production migration history, production row-count snapshot, billing scheduler decision, subscription-generator limitations); 2026-09-21 (billing uniqueness scope and per-class conversion anchor); 2026-09-16 (Stripe webhook → `record_payment`); 2026-09-14 (Discord cron runbook; staff RBAC; schedule templates); 2026-09-05 (deploy inventory)
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
| Reporting | obligation-aware backend implemented locally | Two additive payer views and Discord consumer tests; legacy contracts retained | Sibling frontend adoption, HTTP integration and operator review pending |
| Billing/receipts | explicit payer obligations implemented locally; deployment gated | `20260930063526` replaces recurring subscription-price generation with one charge per active obligation/anchored period; 84 obligation + 44 integration/reporting assertions plus 37 retained legacy checks pass | Migration not applied to production. No obligation backfill/activation. Worker remains undeployed and its checked-in cron list is empty. Non-prod Supabase/PostgREST/concurrency, sibling frontend adoption, and operator workflow review remain gates. |
| Subscriptions | legacy one-off behavior retained; recurring terms separated | Enrollment/conversion/proration/per-class regressions pass; `automatic_billing_starts_at` stays in responses but is ignored by the new generator | No automatic obligation inference. Explicit `/billing/obligations/:id/entitlements` enrolls/changes covered monthly access without debt; paid upgrade APIs still mean an explicit one-off charge. Production counts below are the historical snapshot, not a fresh query. |
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
- Route-level billing, subscription, scheduling, and obligation suites pass using in-process fixtures; they do not prove production integration.
- Production's historical generator remains unchanged by this work. Locally, `20260930063526_account_billing_obligations.sql` implements explicit payer amounts, multiple obligations per account, stable anchored periods, and obligation-period uniqueness including voids. No legacy subscription is automatically charged by the new generator. See [design and lifecycle rules](recurring-billing-obligations.md).
- Worker deployment remains disabled (`triggers.crons = []`). Before approval, complete non-production Supabase/PostgREST/concurrent-run validation and operator agreement review. The in-memory PostgreSQL fallback ran real migrations and pgTAP, but does not validate multiple database connections or the Supabase HTTP layer.
- Additive payer reports now expose one row per charge with canonical outstanding debt and nested participant coverage; both Discord handlers consume payer reminders. Legacy member reports retain their old contracts. Sibling frontend adoption and operator review remain gates. Today-only covered entitlement changes create no charges; legacy paid upgrades are unchanged. Replacement cutovers require a shared boundary and cannot precede the predecessor billing start; unmatched anchor changes and missed periods/proration require explicit operator handling.
- Discord notifications: operator Render cron runbook is in [deployment.md](./deployment.md) (API-AUTO-002). Live cron was **not** enabled (Render MCP unauthorized; avoid silent production Discord posts). Digest is the only recommended scheduled job; `payment-reminders` stays on-demand because it repeats digest’s overdue / due-soon list. Handlers have no last-run marker, so a manual Trigger Run plus the scheduled tick can still double-post.
- Schedule-template CRUD and recurring-session generation exist in-repo (API-SCHED-001); migration `20260914202053` is applied in production.
- Staff authorization is per-person hashed `x-admin-key` values with roles
  `owner` / `front_desk` / `finance` (API-AUTH-001 / API-ADR-005). The shared
  `ADMIN_API_KEY` remains an owner compatibility actor (`legacy_shared_key`)
  until operators rotate. Migration `20260914185843` is applied in production; there are currently no `staff_users` rows, so the shared compatibility key may still be operationally relevant.
- CORS defaults to `*` when `ALLOWED_ORIGIN` is absent; production currently reflects `*`.

## Verification baseline

- `npm --workspace services/api test`: **191/191 passing**, 20 files (2026-10-01).
- `npm run supabase:start` and `npm run test:billing-db`: local stack startup blocked by unavailable Docker/Podman; the CLI suite then reports connection refused at `127.0.0.1:54322`. No production connection was attempted.
- `TU_PGLITE_ROOT=/tmp/tu-billing-runtime/node_modules/@electric-sql/pglite TU_PGTAP_BUNDLE=/tmp/tu-billing-pg/pgtap.tar.gz node scripts/test-billing-pglite.mjs`: **165/165 pgTAP assertions passing** (37 legacy, 84 obligation, 44 reporting/integration). All repository migrations and catalog seed replay in a fresh in-memory PostgreSQL instance; the follow-up migration also reapplies successfully, and synthetic pre-existing subscriptions, charges, payments, and allocations survive both obligation migrations unchanged. RLS, private RPC grants, and service-role operations are exercised. See [reproduction instructions](validation-environment.md#isolated-postgresql-fallback-without-docker).
- `npm run guard:waiver-schema`: passing. `git diff --check`: passing.
- No production access, migration, seed, obligation activation, Worker deployment, queue modification, push, or merge occurred. Production evidence in the snapshot above remains dated 2026-09-24.
- Deploy inventory (API-OPS-001): public host + health documented in [deployment.md](./deployment.md) (2026-09-05).
- Discord cron runbook (API-AUTO-002): auth header `x-cron-secret` / env `CRON_SECRET`; digest `POST /api/admin/notifications/discord/daily-digest` at `0 13 * * *` UTC; `payment-reminders` not scheduled. Failure keys: `401 unauthorized`, `500 discord_webhook_not_configured`, `502 discord_*`. Live Render cron not created.
- Validation environment (API-GATE-001): seed/cleanup procedure in [validation-environment.md](./validation-environment.md). Production project `jhxzecxkccqlgyazhsnb` and `https://api.templeunderground.com` are out of bounds for VAL writes.
- Waiver submit idempotency (API-HARD-002): Vitest covers first submit, duplicate replay, notification throw, unchanged validation errors, and a missing-column fallback so live submits still work before `20260914150818` is applied. Migration `20260914150818` (formerly `0022`) is applied in production.
- Staff RBAC (API-AUTH-001): Vitest covers missing/wrong key (`401 unauthorized`), shared-key owner compatibility, personal staff keys, finance/front_desk `403 forbidden`, cron `x-cron-secret` actor, and owner staff CRUD. Migration `20260914185843` (formerly `0023`) is applied in production.
- Schedule templates (API-SCHED-001): Vitest covers template create/update, generate-sessions, duplicate generate, and validation errors. Migration `20260914202053` (formerly `0024`) is applied in production.
- Atomic record-payment (API-HARD-001): Vitest covers RPC success, RPC failure with no leftover rows, idempotent retry, idempotency-key conflict, and missing-function sequential fallback. Migration `20260916174649` is applied in production.
- Stripe webhook (API-PAY-001): Vitest covers signature accept/reject, `payment_intent.succeeded` → `record_payment` (`method=card`, `issued_by=stripe_webhook`, `idempotency_key=stripe:pi_…`), duplicate event replay with one payment, unmatched metadata `400 unmatched_payment`, missing RPC `503` with no sequential inserts, ignored `charge.succeeded`, `refund.created` → `record_payment_refund`, and refund-before-payment `400 payment_not_found`. Migration `20260916225225` is applied in production. Env name `STRIPE_WEBHOOK_SECRET` only.


## Follow-up review evidence (2026-10-01)

Starting commit `da021cfd63b87a868947d03cb2f3e15d70488666`, same branch. New
migration `20261001080133_obligation_reporting_entitlements.sql` rejects chained
replacement cutovers before the predecessor's start, adds invoker payer reports,
and exposes a service-only no-charge entitlement RPC. API adds one owner/finance
route, two report slugs, and switches Discord handlers to issued-charge debt.
No production access, real notification sends, queue edits, push, merge, or deploy.
Worker `triggers.crons` remains empty. No rollout action is authorized by these repository changes.

Populated replay compares the complete original subscription, charge (excluding
the added null obligation column), payment and allocation JSON before/after both
obligation migrations and follow-up reapplication. It also verifies that the
migrations create no obligations and legacy automation creates no debt.
Single-session SQL tests and mocked API tests do not establish multiple-connection
serialization, PostgREST schema discovery/authentication, or Supabase integration.
Full commands and blockers are in `validation-environment.md`.
