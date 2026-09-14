# API task claim

- Task ID: `API-AUTO-002`
- Owner: Cursor Cloud Agent (singh / ilikericeat@gmail.com)
- Claimed at: `2026-09-14T15:32:47Z`
- Base branch: `develop`
- Base commit: `bce14612492a24f755c57d7f3ff3e9016e1381f5`
- Production write authorized: no
- Status: `done`

## Branch naming conflict

Work-queue preferred: `agent/API-AUTO-002-discord-cron`.  
This Cloud run requires `cursor/<slug>-<run-suffix>`. Using
`cursor/api-auto-002-discord-cron-459a`.

## Scope and allowed files

- `docs/deployment.md`
- `docs/current-state.md` (notifications / cron schedule only)
- `docs/use-guide.md` (Discord cron operator section)
- `work-queue/claims/API-AUTO-002.md`
- `work-queue/queue.json` (this task's row only)
- `work-queue/README.md` (this task's row only)

No `render.yaml` added: cron lives in the Render Dashboard, not this git repo.

## Verification evidence

Refresh (exit 0): `HEAD` = `origin/develop` =
`bce14612492a24f755c57d7f3ff3e9016e1381f5`. On-disk `work-queue/queue.json`
matched `git show HEAD:work-queue/queue.json`. Claim file did not exist.

### Render / MCP

- Render MCP `list_workspaces` → **unauthorized** (same as API-OPS-001).
- `list_services` / `create_cron_job` not used (no confirmed workspace).
- Render CLI not installed. **No live cron job was created.**

### Production HTTP (no Discord post, no DB writes)

Logged in `/opt/cursor/artifacts/api_auto_002_verify.log` (2026-09-14T15:36Z):

1. `GET https://api.templeunderground.com/health` → HTTP 200 `{"ok":true}`
2. `GET .../health/deep` → HTTP 500 `{"ok":false,"db":false,"error":"db_unreachable"}`
   (pre-existing; not changed by this task; API-OPS-001 saw 200 on 2026-09-05)
3. `POST .../api/admin/notifications/discord/daily-digest` with no auth →
   HTTP 401 `{"ok":false,"error":"unauthorized"}`
4. Same digest POST with header `x-cron-secret: not-a-real-secret` → 401
   `unauthorized` (dummy value does not match, or `CRON_SECRET` unset on API)
5. `POST .../payment-reminders` no auth and dummy `x-cron-secret` → 401
   `unauthorized`

Dummy secrets were throwaway strings, not production values. Authenticated
POSTs were **not** sent (would post to production Discord if env is set).

### Tests

`npm --workspace services/api run test` → **76/76** passing (11 files).
Log: `/opt/cursor/artifacts/api_auto_002_vitest.log`. First attempt failed on
missing optional `@rollup/rollup-linux-x64-gnu` (known lockfile platform-package
gap). Unpacked that optional binary into local `node_modules` only; **not
committed**.

Secret scan of the `origin/develop` diff: no webhook URLs, no `CRON_SECRET=` /
`ADMIN_API_KEY=` literals.

### Cadence recorded in docs

- Schedule **only** digest: `POST` `/api/admin/notifications/discord/daily-digest`
  at `0 13 * * *` UTC, header `x-cron-secret`, env `CRON_SECRET`.
- **Do not** schedule `payment-reminders`: it uses the same
  `buildReminderLines` overdue / due-soon list as digest (duplicate-spam).
- Env **names** only: `CRON_SECRET`, `DISCORD_WEBHOOK_URL` (API), plus existing
  Supabase names. Cron job needs `CRON_SECRET` only.
- Failure keys: `401 unauthorized`, `500 discord_webhook_not_configured`,
  `500 supabase_not_configured`, `502` errors starting `discord_`
  (`discord_http_<status>`), Render cron failure logs.

### What this run did **not** do

- Production Supabase writes, seeds, or migrations (`jhxzecxkccqlgyazhsnb`)
- Create, enable, or suspend a live Render cron (MCP unauthorized)
- Commit webhook URLs or secret values
- Edit `services/api/src/routes/admin/notifications.js` or
  `requireAdminOrCron.js` (no last-run table; would need a migration)
- Edit `services/api/src/routes/admin/billing.js` (API-AUTO-001)
- Add `render.yaml`
- Enable API-AUTO-001 monthly-charge cron (endpoint does not exist)
- Flip successors (`API-AUTO-001`, `API-AUTH-001`, `API-PAY-001`, etc.) to
  `ready`
- Rewrite RBAC or scheduling-template status in `docs/current-state.md`

## Handoff or blocker

`done` with leftover risk:

1. **Live cron not enabled.** An operator must create
   `tu-api-discord-daily-digest` in the Render Dashboard using
   `docs/deployment.md`. Suspend that service to disable it.
2. **`CRON_SECRET` may be unset on production.** Dummy `x-cron-secret` still
   returned 401, which is correct either if the env is unset (header ignored)
   or if the dummy did not match. Set `CRON_SECRET` on the API **before**
   enabling cron, or the job cannot authenticate.
3. **No handler idempotency.** Manual Trigger Run + scheduled tick can
   double-post. No last-run marker was added (would be a schema task).
4. **`GET /health/deep` returned `db_unreachable` during this run.** Out of
   scope; not a Discord-cron change. Operators should re-check separately.
5. Render Dashboard service ID still unknown without MCP workspace access.
