# API-OPS-002 — September 2026 subscription backfill SQL

- Status: **needs_verification**
- Lane: deployment
- Depends on: API-AUTO-003
- Production writes: no (script is a production seed; execution is **not** authorized by this row and is **not** known to have run)
- Branch: `chore/subscription-backfill-2026-09` (no pull request as of 2026-10-24)
- Commit: `8ff62a6` “chore: add September subscription backfill seed” (2026-09-24). File: `scripts/production/backfill-subscriptions-2026-09.sql`. **Not** merged to `develop`.

## Why verification is required

The SQL is labeled a production backfill (Aaron Finazzo + Finsley/Davenport household), leaves `automatic_billing_starts_at` NULL, and is not local seed data. There is no PR, merge, or apply record. The 2026-09-24 production snapshot in `docs/current-state.md` still shows 0 subscriptions; that snapshot is the same calendar day as the commit and does not prove the script was or was not executed later. Supabase MCP was unauthenticated during the 2026-10-24 docs refresh, so live row counts were not re-checked.
