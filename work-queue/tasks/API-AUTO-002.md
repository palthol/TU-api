# API-AUTO-002 — Deploy Discord schedules

- Status: **done**
- Lane: automation
- Depends on: API-OPS-001, API-VAL-001
- Production writes: no
- Branch from: `develop` as `agent/API-AUTO-002-discord-cron`

## Agent prompt

Schedule `POST /api/admin/notifications/discord/daily-digest` and
`payment-reminders` on the real platform (likely Render cron) using
`CRON_SECRET`. Document cadence, env names, and duplicate-spam risk. Do not
commit webhook URLs.

## Allowed paths

- `docs/deployment.md` or `docs/current-state.md` / `docs/use-guide.md`
- Render/blueprint files **only if** this repo should own them (prefer documenting
  dashboard steps if cron lives outside git)
- Shared queue files

Application notification handlers should not change unless required for
idempotency/run tracking.

## Acceptance

- Written schedule + auth header contract
- Failure observability described
- No secrets in git
