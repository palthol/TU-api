# API-OPS-003 — Subscription enrollment backfill CLI

- Status: **done**
- Lane: deployment
- Depends on: API-AUTO-003
- Production writes: **no** (tooling only; this row does not authorize `--apply` against production)
- Branch: `noble-6/subscription-backfill-roster-d071`

## Goal

Operator CSV roster export (read-only) and enrollment-only backfill CLI. Default dry-run. `--apply` requires a matching `--yes-i-reviewed=<would_create>` confirmation. Same `create_subscription` path as `POST /api/admin/billing/subscriptions` with `create_initial_charge: false`. No charges, obligations, or billing cron.

## Allowed paths

- `services/api/scripts/`
- `services/api/src/lib/subscriptionCurrent.js`
- `services/api/src/services/billing/`
- `services/api/src/routes/admin/billing.js`
- `services/api/src/routes/admin/billing-plans.js`
- `services/api/package.json`
- `package.json`
- `docs/subscription-backfill.md`
- `docs/README.md`
- `docs/use-guide.md`
- `docs/admin-api.md`
- `docs/current-state.md`
- `work-queue/claims/API-OPS-003.md`
- `work-queue/queue.json`
- `work-queue/README.md`
- `work-queue/tasks/API-OPS-003.md`

## Out of scope

- Migrations
- Enabling `generate_monthly_charges` or the Cloudflare billing Worker
- Creating billing obligations or charges
- Merging to `main` / deploying
