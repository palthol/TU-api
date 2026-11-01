# API-AUTO-004 — Cloudflare billing Worker

- Status: **done**
- Lane: automation
- Depends on: API-AUTO-003
- Production writes: no
- Evidence: Worker source PR [#44](https://github.com/palthol/TU-api/pull/44) (merged to `develop` 2026-09-29); production-state docs [#45](https://github.com/palthol/TU-api/pull/45) (merged to `develop` 2026-09-29). Promoted to `main` with the Oct 14 release [#47](https://github.com/palthol/TU-api/pull/47). **Not** in tag `v1.1.0` (that tag is #43 only).

## What landed

In-repo Cloudflare Worker at `workers/billing-cron/` (`tu-billing-cron`) scheduled `0 12 * * *` UTC to `POST /api/admin/billing/generate-monthly-charges` with `x-cron-secret`. Source and runbook exist; docs still record deployment/configuration as gated on billing-anchor and recurring-discount fixes. This index does not re-verify live Worker deployment.
