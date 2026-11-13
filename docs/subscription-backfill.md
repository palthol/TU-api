# Subscription enrollment backfill (operator runbook)

Safe, **enrollment-only** tooling so singh can assign monthly plans after reviewing a CSV. It does **not** create charges, billing obligations, or enable the billing cron.

Default is dry-run. Production writes happen only if singh runs `--apply` with a confirmation that matches `would_create`.

## Why a CLI, not an admin endpoint

Existing one-off operator tools live as Node scripts (`scripts/` at the repo root, now also `services/api/scripts/`). A `dry_run` HTTP flag on the deployed API would be easy to call by accident and would need extra auth surface. Singh can run these locally with `services/api/.env`. The apply path calls the same `enrollSubscription` helper as `POST /api/admin/billing/subscriptions` (RPC `create_subscription`) with `create_initial_charge: false`.

## Prerequisites

- Repo checkout of this branch / `develop` after merge
- `services/api/.env` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY` if the new name is unset)
- Do not commit the CSV, the result log, or `.env`

The scripts print the Supabase **hostname** and whether it is the production project. They never print keys, admin tokens, or webhooks.

## 1. Export the roster template (read-only)

```bash
npm --workspace services/api run roster:export -- --out ./tmp/subscription-roster.csv
```

Writes:

- `./tmp/subscription-roster.csv` — one row per **active** account/participant
- `./tmp/subscription-roster.csv.plans.csv` — active plans for reference (also printed to stdout)

Roster columns:

| Column | Filled by export? | Purpose |
| --- | --- | --- |
| `participant_id` | yes | Match key (do not change) |
| `account_id` | yes | Payer used on enroll |
| `display_name` | yes | Review aid |
| `email` | yes | Review aid |
| `current_plan` | yes | Existing current enrollment name, if any |
| `plan` | **blank** | Fill with active plan **name or id** |
| `start_date` | **blank** | `YYYY-MM-DD` (America/New_York calendar date) |
| `note` | **blank** | Optional; stored on the subscription |

## 2. Fill the CSV

For each monthly payer, set `plan` and `start_date`. Leave `plan` blank to skip that person. Do not enroll people who should stay off the books.

## 3. Dry-run (default; no writes)

```bash
npm --workspace services/api run roster:backfill -- --csv ./tmp/subscription-roster.csv
```

The report lists would-create, skipped, errors, totals, and implied monthly revenue (`monthly_revenue_cents`). Also writes `./tmp/subscription-roster.csv.backfill-result.json`.

Skipped (not errors):

- blank `plan`
- person already has an overlapping **active** subscription (idempotent; not duplicated)

Errors (block `--apply`):

- unknown person (id not on an active account)
- unknown or inactive plan
- bad `start_date`
- duplicate filled `participant_id`

## 4. Singh reviews

Confirm the target host, the would-create list, skips, and monthly revenue. Fix the CSV and dry-run again until errors are 0.

## 5. Apply only with singh’s OK

`N` must equal `would_create` from the last dry-run:

```bash
npm --workspace services/api run roster:backfill -- --csv ./tmp/subscription-roster.csv --apply --yes-i-reviewed=N
```

Without `--apply`, or with a mismatched count, or with row errors, nothing is written. A TTY `--apply` without `--yes-i-reviewed` prompts for that same count.

Rerun is safe: already-enrolled people are skipped. `created_by` is `subscription_backfill`. `initial_charge_id` stays null.

This repository change does **not** authorize anyone except singh to run `--apply` against production, and it does not enable charge generation.
