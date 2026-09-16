# API task claim

- Task ID: `API-AUTO-001`
- Owner: Cursor Cloud Agent (singh / ilikericeat@gmail.com)
- Claimed at: `2026-09-16T17:43:47Z`
- Base branch: `develop`
- Base commit: `4bec056038619bc1322ff961aa5c02b569933e40`
- Production write authorized: no
- Status: `done`

## Scope and allowed files

- `services/api/src/routes/admin/billing.js`
- `services/api/src/index.js` (mount/cron middleware only)
- tests (`services/api/src/routes/admin/generate-monthly-charges.test.js`, `services/api/src/lib/staffAuth.test.js`)
- `docs/admin-api.md`
- `docs/use-guide.md`
- `work-queue/claims/API-AUTO-001.md`
- `work-queue/queue.json` (this row only)
- `work-queue/README.md` (this row only)

## Verification evidence

Refresh (exit 0): `HEAD` = `origin/develop` =
`4bec056038619bc1322ff961aa5c02b569933e40`. On-disk `work-queue/queue.json`
matched `git show HEAD:work-queue/queue.json`. Claim file did not exist.

### Commands

1. `git fetch origin develop && git checkout develop && git pull origin develop` — exit 0; `HEAD` = `origin/develop` = `4bec056038619bc1322ff961aa5c02b569933e40`
2. `diff` of on-disk `work-queue/queue.json` vs `git show HEAD:work-queue/queue.json` — match
3. `npm --workspace services/api run test` — first run failed on missing `@rollup/rollup-linux-x64-gnu` (environment, not this change)
4. `npm install --no-save @rollup/rollup-linux-x64-gnu` — exit 0; working tree stayed clean
5. `npm --workspace services/api run test` — exit 0; **116/116** passing (15 files). Was 109/109 on develop; +7 generate-monthly-charges tests.

### What shipped

- `POST /api/admin/billing/generate-monthly-charges` mounted on the existing `adminCronRouter` (`requireAdminOrCron`), same as Discord notification routes.
- Calls `supabase.rpc('generate_monthly_charges')`, logs `generate_monthly_charges.created`, returns `{ ok: true, created: N }`.
- Duplicate same-period charges: RPC already skips when a non-void charge exists for `subscription_id` + `coverage_start` (migration 0002). Tests prove (a) the SQL still has that `EXISTS` guard, (b) a second mocked RPC returning `[]` yields `created: 0`, (c) the HTTP handler never inserts into `charges`.

### What I did **not** do

- No production database writes
- No Render cron job created / no prod scheduler enabled
- No schema/migration change
- Did not start a successor task
- Did not edit `docs/current-state.md` or `docs/deployment.md` (not in allowed_paths)

## Handoff or blocker

`done`. Leftover risk: `idx_charges_subscription_coverage` is a **non-unique** partial index, so two overlapping HTTP calls could theoretically race past the function's `EXISTS` check. A unique constraint would be a later schema task. Operators must not point Discord digest cron at this URL; enabling monthly-charge cron is a later ops step.
