# API task claim

- Task ID: API-VAL-002
- Owner: Cursor Cloud Agent
- Claimed at: 2026-09-11
- Base branch: `develop`
- Base commit: `d6cb827dc9b93f63ada00b53de42b76305ff5224`
- Production write authorized: no
- Status: `done`

Note: the work-queue brief suggests branching as `agent/API-VAL-002-scheduling-smoke`, but this run uses the required Cursor Cloud branch naming scheme (`cursor/api-val-002-scheduling-smoke-51f1`), same conflict as API-VAL-001.

## Scope and allowed files

- `docs/current-state.md`
- `docs/api-schema-audit.md` checklist
- `work-queue/claims/API-VAL-002.md`
- `work-queue/queue.json` (API-VAL-002 row only)
- `work-queue/README.md` (API-VAL-002 row only)
- Test/script files only if a fixture bug must be fixed to complete the smoke

## Verification evidence

Executed (non-prod only; local Supabase + local API). `HEAD` matched `origin/develop` at `d6cb827` before branching.

- `npm install` (exit 0)
- Local Docker was missing; installed `docker.io`, started `dockerd` in tmux, and set legacy iptables forward policy to ACCEPT so containers can talk.
  - `/opt/cursor/artifacts/docker_apt_install.log` (EXIT:0)
  - `/opt/cursor/artifacts/dockerd_start.log`
- `npm run supabase:start` (EXIT:0): `/opt/cursor/artifacts/supabase_start.redacted.log` (local keys redacted). Live keys were local-only (`http://127.0.0.1:54321`).
- `npm run dev:api` with local `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_API_KEY=local-admin-key` (tmux session: `api-val-002-api`). `GET /health` → `{ok:true}`; `GET /health/deep` → `{ok:true,db:true}`.
- Preflight: `/opt/cursor/artifacts/preflight.log` — env does not contain `jhxzecxkccqlgyazhsnb` or `api.templeunderground.com`.
- Seed (runId `9063720c`, EXIT:0): `/opt/cursor/artifacts/tu_test_seed_billing_schedule.log`
  - P1 `ab6b54f8-6674-46ff-8847-1ecc8aeadada` (seed billing subscription + schedule attendance)
  - P2 `22f05b2f-7329-4959-a291-023a60256ab8`
- Scheduling + attendance + subscriptions smoke (EXIT:0): `/opt/cursor/artifacts/api_val_002_smoke.log`

Happy + failure (all against `http://127.0.0.1:3001` with local `x-admin-key`):

- Scheduling
  - Happy: `POST /api/admin/scheduling/sessions` → `200` session `319fbfc0-b2b6-4039-aee2-8a1ee4768082` (`starts_at`/`ends_at` ISO-8601, `session_label` `open_mat`)
  - Failure: missing `starts_at` → `400` `invalid_starts_at`
  - Happy: `GET /api/admin/scheduling/sessions` and `GET /api/admin/scheduling/sessions/:sessionId`
  - Happy: `PATCH` reschedule; `PATCH` `"cancel": true` sets `cancelled_at`
  - Failure: unknown session → `404` `session_not_found`
  - Failure: attendance on cancelled session → `400` `session_cancelled`
- Entitlement on attendance (**blocks** by default; does not only warn)
  - Happy: `POST .../attendance` with `enforce_entitlement: true` (default) `present` for P1 on `open_mat` → `200` upserted, `blocked: []`. `can_attend_group_session` allowed P1 for `open_mat`.
  - Block: same session, P2 (no subscription) `present` → `400` `all_records_blocked`, `blocked: [{ participant_id: P2, reason: "no_group_entitlement" }]`. GET session showed P2 was **not** upserted.
  - Contrast: same P2 payload with `enforce_entitlement: false` → `200` upserted P2, `blocked: []` (skip-check / warn path; RPC not applied).
  - Note: seed `--schedule` already inserted a `present` row for P1 this week. `participant_entitlement_status` counts all present rows (not by `session_label`), so Basic Group Plan's limited **weekday** slot was exhausted (`can_attend weekday=false`). Happy path used **open_mat** (unlimited). This is live RPC/view behavior, not a new policy.
- Subscriptions
  - Happy: `POST /api/admin/billing/subscriptions` P2 + **Basic Group Plan** (`monthly`, `price_cents` 10000) with `create_initial_charge: true` → `200` `subscription_id=3123e796-32c6-44c3-99a8-ee5290dda696`, `initial_charge_id=0e7df504-8cac-4a0b-8bcc-302cfb2c4451`
  - Failure: missing `participant_id` → `400` `participant_id_required`
  - Extra failure: `create_initial_charge: true` on Jennifer Hill Unlimited Plan (`billing_cadence=contract`) → `400` `create_initial_charge only applies to monthly plans (plan e352208b-226c-415d-be01-9185373abdf1 has cadence contract)`
- Discord cron auth
  - `DISCORD_WEBHOOK_URL` not set on the local API. Did **not** configure a production webhook.
  - `POST /api/admin/notifications/discord/payment-reminders` and `daily-digest` with `x-admin-key` → `500` `discord_webhook_not_configured`
  - Skipped `x-cron-secret` proof (`CRON_SECRET` unset; no non-prod webhook).

Cleanup:

- Dry-run: `/opt/cursor/artifacts/tu_test_cleanup_dryrun.log` (EXIT:0), target `http://127.0.0.1:54321`
- Execute: `/opt/cursor/artifacts/tu_test_cleanup_execute.log` (EXIT:0) — local DB only

Vitest (no product change): `npm --workspace services/api run test` 63/63, EXIT:0 — `/opt/cursor/artifacts/services_api_vitest.log`

Did not do:

- No production writes.
- No requests to `https://api.templeunderground.com`, `https://temple-underground-signup.onrender.com`, or Supabase project `jhxzecxkccqlgyazhsnb`.
- Did not implement API-HARD-002 or API-SCHED-001.
- Did not flip API-SCHED-001 to `ready`.
- Did not post to a Discord channel.

## Handoff or blocker

Done. Residual risk: scheduling still has no template CRUD / recurring session generation (API-SCHED-001). Attendance entitlement **blocks** by default via `can_attend_group_session`; operators can skip the check with `enforce_entitlement: false`. Discord routes exist but were not posted (no non-prod webhook). API-SCHED-001 remains `blocked` until an operator marks it ready.
