# API deployment inventory

**Verified:** 2026-09-05 (read-only)  
**Task:** API-OPS-001  
**No production writes. No env values set or recorded.**

## Platform and public host

| Item | Value | How verified |
| --- | --- | --- |
| Platform | **Render** (web service) | `x-render-origin-server: Render` on responses; DNS CNAME to `*.onrender.com` |
| Public hostname | **`https://api.templeunderground.com`** | DNS + live `GET /health` / `GET /health/deep` |
| Render hostname | **`https://temple-underground-signup.onrender.com`** | Same health responses; CNAME target of the public host |
| Edge | Cloudflare in front of Render | Response `server: cloudflare` |

DNS: `api.templeunderground.com` → CNAME `temple-underground-signup.onrender.com`.

### What could not be verified

- Render Dashboard service ID, plan, region, and auto-deploy branch: Render MCP
  `list_workspaces` returned **unauthorized**; `list_services` requires a confirmed
  workspace and was not available.
- Exact Render dashboard **service display name** beyond the public
  `temple-underground-signup` hostname slug.
- Which Git branch Render deploys from (no `render.yaml` in this repo).

Historical GitHub Deployments on `palthol/TU-api` from **vercel[bot]** point at
front-end projects (`temple-underground-signup-waiver-v2`, `tu_main_website`), not
this Express service. Do not treat those Vercel URLs as the API host.

## Health checks

| Method / path | Success body | Failure notes |
| --- | --- | --- |
| `GET /health` | `{ "ok": true }` | Liveness only; no DB |
| `GET /health/deep` | `{ "ok": true, "db": true }` | Hits Supabase `participants` head select; `500` with `db: false` if Supabase missing/unreachable |

Live check (2026-09-05): both paths returned HTTP 200 on
`https://api.templeunderground.com` and
`https://temple-underground-signup.onrender.com`.

Root `GET /` is not a health route (Express `Cannot GET /`).

## Runtime bind

- Process listens on `process.env.PORT` (Render injects `PORT`) or **`3001`** locally.
- Start command in this repo: `npm run start` → workspace `node src/index.js` in
  `services/api`.

## CORS

Code (`services/api/src/index.js`):

- If `ALLOWED_ORIGIN` is unset or empty → treated as missing → **default `*`**
  (`cors()` with no origin restriction).
- If `ALLOWED_ORIGIN` is set to a concrete origin → `cors({ origin: thatValue })`.

Live observation (2026-09-05): responses include
`access-control-allow-origin: *` (including preflight `OPTIONS` on `/api/lead`).
That matches either unset `ALLOWED_ORIGIN` or an explicit `*`. **Do not change
production CORS from this task.**

## Environment variable names (no values)

Names must match `services/api/.env.example`. Commit **names only**.

| Name | Role |
| --- | --- |
| `PORT` | Listen port (Render sets this) |
| `ALLOWED_ORIGIN` | CORS origin; omit or `*` for allow-all |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server only) |
| `ADMIN_API_KEY` | `x-admin-key` for `/api/admin/*` and admin PDF |
| `CRON_SECRET` | Shared secret for trusted scheduled callers (`x-cron-secret`). Required on the API and the Cloudflare billing Worker once billing automation is enabled |
| `DISCORD_WEBHOOK_URL` | Optional Discord webhook (read by the **API** service, not the cron job) |
| `SLACK_WEBHOOK_URL` | Optional Slack webhook |
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain (viewer) |
| `CF_ACCESS_AUD` | Cloudflare Access audience (viewer) |
| `WAIVER_VIEWER_DEV_BYPASS` | Dev-only viewer auth bypass |
| `WAIVER_VIEWER_ALLOWED_EMAILS` | Viewer email allowlist |
| `SIGNATURES_BUCKET` | Storage bucket (default `signatures`) |
| `WAIVERS_BUCKET` | Storage bucket (default `signed-waivers`) |
| `PDF_ORG_NAME` | PDF letterhead org name |
| `PDF_ORG_TAGLINE` | PDF letterhead tagline |
| `PDF_ORG_ADDRESS` | PDF letterhead address |
| `API_EXPOSE_DB_ERRORS` | Expose DB errors (non-production debugging only) |

Never commit secret values, webhook URLs with tokens, JWTs, or key material.

## Ownership map (operators)

| Concern | Owner / location |
| --- | --- |
| Express API source | This repo (`services/api`) |
| Schema / migrations | This repo (`supabase/migrations/`) |
| Production DB | Supabase project `jhxzecxkccqlgyazhsnb` |
| API runtime host | Render service behind `api.templeunderground.com` |
| Discord digest cron | Render **Cron Job** (Dashboard; not in this repo). Runbook below. |
| Monthly-charge scheduler | Cloudflare Worker (`workers/billing-cron/`) with a daily Cron Trigger |
| Waiver UI | Sibling `TU-Signup` (`VITE_API_BASE_URL` → production API) |
| Admin / receipts / waiver-viewer UIs | Sibling `admin` repo |
| Marketing site | Sibling marketing repos |

Front-end apps should point at `https://api.templeunderground.com` (no trailing slash)
for production API calls.

## Daily monthly-charge scheduler

Monthly charge generation is run by the in-repository Cloudflare Worker at
[`workers/billing-cron/`](../workers/billing-cron/). The Worker runs daily; PostgreSQL decides
which subscription period is due. The Worker does not access Supabase directly:
it POSTs to the protected API route, which invokes the service-role-only
`generate_monthly_charges()` function.

### Live database status

Read-only Supabase inspection on 2026-09-22 confirmed that migrations
`20260921185003_complete_v1_subscription_charge_generation` and
`20260921221500_scope_monthly_charge_uniqueness` are applied. The database
has `subscriptions.automatic_billing_starts_at`,
`charges.charge_kind`, `generate_monthly_charges()`, and
`uq_charges_monthly_period_coverage_nonvoid`.

Pre-existing subscriptions still require individual review before automation is
enabled. `automatic_billing_starts_at = NULL` disables recurring generation.
Do not bulk-fill it from historical `starts_at` values. Establish the
appropriate billing baseline for each active paid monthly subscription when it
is backfilled.

### Cloudflare Worker

| Field | Value |
| --- | --- |
| Worker | `tu-billing-cron` |
| Cron expression (UTC) | `0 12 * * *` |
| Meaning | Daily at 12:00 UTC; the database function decides what is due |
| HTTP | `POST https://api.templeunderground.com/api/admin/billing/generate-monthly-charges` |
| Authentication | `x-cron-secret` from `CRON_SECRET` |
| Source | `workers/billing-cron/` in this repository |

Set `CRON_SECRET` as a Cloudflare Worker secret and set the exact same value
on the Render API web service. Do not use `ADMIN_API_KEY` in the Worker.
Deploy and verification steps are in
[`workers/billing-cron/README.md`](../workers/billing-cron/README.md).

Successful API logs contain `billing.generate_due_charges.succeeded` with
`ran_at`, `created`, and `charge_ids`. A zero-charge run is successful.
Worker failures are visible in Cloudflare Worker logs. To disable automatic
generation, deploy a configuration with `"crons": []` or disable/delete the
Worker; Cron Trigger changes can take up to 15 minutes to propagate.

## Discord notification cron (API-AUTO-002)

Handlers already exist. There is **no** in-repo scheduler (`render.yaml` is
intentionally absent). Schedule lives in the **Render Dashboard** as a Cron Job
that HTTP POSTs the public API. Do not put webhook URLs or secret **values** in
git, PRs, or this file — **names only**.

Verified 2026-09-14: Render MCP `list_workspaces` returned **unauthorized** (same
as API-OPS-001). No dashboard service ID was retrieved. No live cron job was
created from this task (a live job would post to production Discord). Follow the
runbook below in the Dashboard, then **Suspend** the cron service to disable it.

### Auth contract

Notification routes are mounted behind `requireAdminOrCron`
(`services/api/src/lib/requireAdminOrCron.js`):

| Header | Env on API web service | When it works |
| --- | --- | --- |
| `x-cron-secret` | `CRON_SECRET` | Header value equals `CRON_SECRET` **and** `CRON_SECRET` is set. Sets staff actor `cron` and skips the RBAC role matrix (API-AUTH-001) |
| `x-admin-key` | `ADMIN_API_KEY` or an `owner` staff key | Operator/manual. Do **not** put `ADMIN_API_KEY` on the cron job |

If `CRON_SECRET` is unset on the API, `x-cron-secret` is ignored and only
`x-admin-key` works. Cron jobs must not fall back to the admin key.

Unauthenticated or wrong-secret POSTs return `401 { "ok": false, "error": "unauthorized" }`
and do **not** call Discord.

### Endpoints

| Job | Method | URL | Schedule this job? |
| --- | --- | --- | --- |
| Daily digest | `POST` | `https://api.templeunderground.com/api/admin/notifications/discord/daily-digest` | **Yes** — once daily |
| Payment reminders | `POST` | `https://api.templeunderground.com/api/admin/notifications/discord/payment-reminders` | **No** — on-demand only |

Same paths on the Render hostname `https://temple-underground-signup.onrender.com`
are equivalent (public host CNAMEs there). Prefer the public hostname.

Success envelopes (HTTP 200 after Discord accepts the webhook):

- Digest: `{ "ok": true, "posted": true, "summary": { "date", "reminderTotal", "overdueCount", "dueSoonCount", "marketingLeads24h" } }`
- Reminders: `{ "ok": true, "posted": true, "rowCount": N }`

### Cadence and duplicate-spam analysis

Both handlers read `view_member_payment_reminders` and format the **same**
overdue / due-soon member list (`buildReminderLines` in
`services/api/src/routes/admin/notifications.js`). Daily digest **also** includes
that full list, plus marketing-lead counts for the last 24 hours.

**Chosen schedule:** one digest per day; **do not** create a dedicated
`payment-reminders` cron.

| Field | Value |
| --- | --- |
| Cron expression (UTC) | `0 13 * * *` |
| Meaning | Daily at **13:00 UTC** (08:00 EST / 09:00 EDT) |
| HTTP | `POST` digest URL with `x-cron-secret` |
| `payment-reminders` cron | **Not scheduled** |

**Why not both:** posting both at the same minute (or even hours apart on the
same day) double-posts the overdue / due-soon list to the same Discord channel.
Digest already covers V1 “due soon / overdue” plus the morning roll-up. Keep
`POST .../payment-reminders` for a manual operator poke (admin key or cron
secret) when you want an extra ping without waiting for tomorrow’s digest.

If a second scheduled ping is added later, pick a **different UTC hour** (for
example weekdays `0 20 * * 1-5`) and accept duplicate list content, or change
the digest handler to omit the member list (application change; out of scope
here). The monthly-charge job is separate and is documented above.

Handlers have **no** last-run / idempotency key. Render starts at most one
overlapping run per cron service, but a Dashboard “Trigger Run” plus the
scheduled tick, or a curl retry after Discord already accepted the webhook, can
still double-post. Treat that as leftover risk; do not add a tracking table
without a migration task.

### Env names (no values)

Set on the **API web service** (the handler process):

| Name | Required for cron to post |
| --- | --- |
| `CRON_SECRET` | Yes — otherwise the cron header is ignored |
| `DISCORD_WEBHOOK_URL` | Yes — otherwise `500 discord_webhook_not_configured` |
| `ADMIN_API_KEY` | No — not used by the cron path |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Yes — digest reads leads + reminder view |

Set on the **Render Cron Job** (curl process only):

| Name | Role |
| --- | --- |
| `CRON_SECRET` | Same value as the API service; interpolated into `x-cron-secret` |

Do not copy `DISCORD_WEBHOOK_URL` onto the cron job. The cron job never talks to
Discord; the API does.

### Dashboard steps (create)

Render MCP cannot create this job from the agent (unauthorized). An operator
does it in the Dashboard. Suggested service name:
`tu-api-discord-daily-digest`.

1. Confirm `CRON_SECRET` and `DISCORD_WEBHOOK_URL` are set on the **existing**
   API web service (`temple-underground-signup` / `api.templeunderground.com`).
   Dashboard → that service → Environment. Generate `CRON_SECRET` if missing.
   Do not paste values into tickets or git.
2. Open [Render Dashboard → New → Cron Job](https://dashboard.render.com/).
3. **Do not** attach this git repo with auto-deploy. A repo-backed cron would
   rebuild on every API push and is unnecessary for an HTTP POST. Prefer a
   **Docker image** cron, for example image `curlimages/curl`, so the job
   is independent of `palthol/TU-api` deploys.
4. **Schedule:** `0 13 * * *` (UTC). Render evaluates cron in UTC only.
5. **Start / docker command** — interpolate `CRON_SECRET` from the cron job’s
   environment. Do not paste the secret into the command field as a literal.

   ```bash
   curl -fsS -X POST \
     'https://api.templeunderground.com/api/admin/notifications/discord/daily-digest' \
     -H "x-cron-secret: ${CRON_SECRET}" \
     -H 'Content-Type: application/json'
   ```

   `-fsS` fails the cron run if the API returns 4xx/5xx so Render marks the run
   failed.
6. **Environment:** add `CRON_SECRET` only (same value as the API service).
   Region: match the API if known; otherwise leave the Dashboard default.
7. Skip creating a second cron for `payment-reminders`.
8. Optional dry-run: Dashboard → the new cron → **Trigger Run**, then confirm
   one digest message in the staff Discord channel. Do not trigger digest and
   reminders in the same minute.

### How to disable

- Dashboard → the cron service → **Suspend** (or delete the service).
- Emergency mute without deleting cron: clear or rotate `DISCORD_WEBHOOK_URL`
  on the API (jobs then `500 discord_webhook_not_configured`) or rotate
  `CRON_SECRET` on the API only (jobs then `401 unauthorized`).

### Failure observability

| Signal | Where | Meaning |
| --- | --- | --- |
| Cron run **failed** (non-zero curl) | Render Dashboard → Cron Job → Logs / Events | API returned 4xx/5xx or network error |
| `401` `unauthorized` | API web service logs | Missing/wrong `x-cron-secret`, or `CRON_SECRET` unset on API |
| `500` `discord_webhook_not_configured` | API logs + JSON body | `DISCORD_WEBHOOK_URL` missing on the **API** service |
| `500` `supabase_not_configured` | API logs | API has no Supabase client |
| `400` with a PostgREST/DB `error` string | API JSON body | Reminder view or `marketing_leads` query failed |
| `502` `discord_http_<status>: …` (or any `error` starting `discord_`) | API logs (`discord.webhook.failed`) + JSON | Discord rejected/timed the webhook after retries |
| `500` `server_error` | API logs | Unexpected throw |
| HTTP 200 `posted: true` but no Discord message | Discord channel + API logs | Wrong webhook, filtered channel, or Discord-side drop after 2xx |

Render cron: at most one active run; max duration 12 hours (these POSTs should
finish in seconds). Billing is per cron service (Render’s $1/month minimum
applies). New git deploys of the **API** do not restart an in-flight cron run.

Manual operator POST (trusted machine, env already loaded — do not log the
header value):

```bash
curl -fsS -X POST \
  'https://api.templeunderground.com/api/admin/notifications/discord/daily-digest' \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -H 'Content-Type: application/json'
```

