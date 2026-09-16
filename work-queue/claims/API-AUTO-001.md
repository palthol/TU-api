# API task claim

- Task ID: `API-AUTO-001`
- Owner: Cursor Cloud Agent (singh / ilikericeat@gmail.com)
- Claimed at: `2026-09-16T17:43:47Z`
- Base branch: `develop`
- Base commit: `4bec056038619bc1322ff961aa5c02b569933e40`
- Production write authorized: no
- Status: `in_progress`

## Scope and allowed files

- `services/api/src/routes/admin/billing.js`
- `services/api/src/index.js` (mount/cron middleware only if needed)
- tests
- `docs/admin-api.md`
- `docs/use-guide.md`
- `work-queue/claims/API-AUTO-001.md`
- `work-queue/queue.json` (this row only)
- `work-queue/README.md` (this row only)

## Verification evidence

Commands run, exit codes, and what you did **not** do (especially production writes).

Refresh (exit 0): `HEAD` = `origin/develop` =
`4bec056038619bc1322ff961aa5c02b569933e40`. On-disk `work-queue/queue.json`
matched `git show HEAD:work-queue/queue.json`. Claim file did not exist.

## Handoff or blocker

`in_progress`
