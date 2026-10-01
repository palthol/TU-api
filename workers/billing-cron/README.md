# Cloudflare monthly-charge scheduler

> **Deployment gate remains closed.** Obligation billing is implemented locally
> by migration `20260930063526`, but is not deployed or enabled. The checked-in
> `wrangler.jsonc` has `"crons": []`. Do not configure a trigger, deploy this
> Worker, apply production migrations, or activate production obligations as part
> of this change.

The intended schedule, after separate approval, is daily at **12:00 UTC**
(`0 12 * * *`). The Worker calls the protected endpoint:

`POST /api/admin/billing/generate-monthly-charges`

It holds only `CRON_SECRET`, never a Supabase service-role key or
`ADMIN_API_KEY`, and has no public HTTP billing endpoint. The API authenticates
`x-cron-secret` and calls `generate_monthly_charges()` with no date override.

## Implemented billing semantics

The RPC uses the America/New_York business date and creates one charge per due
**billing obligation and anchored period**, even when one payer owns multiple
obligations. Amounts are agreed integer cents; participant plan prices and
household membership do not multiply them. Month-end anchors clamp and recover
the original day next month. Due dates and coverage boundaries survive delayed
runs and retries. Fully missed periods are not automatically backfilled.

Uniqueness is obligation + coverage start, including voided rows. Paused, ended,
draft, future-start, inactive-payer, and unconfigured legacy records do not bill.
Legacy `subscriptions.automatic_billing_starts_at` is ignored by the new generator.
There is no automatic obligation or charge backfill. The existing HTTP response
shape is retained; obligation charges have `subscription_id: null`.

See [design](../../docs/recurring-billing-obligations.md) and
[contracts](../../docs/admin-api.md).

## Required gates before a future deployment

1. Review and merge the implementation through a separately authorized workflow.
2. Verify the migration against an approved non-production Supabase stack and run
   the API/PostgREST integration smoke plus concurrent generation/lifecycle tests.
   Current local evidence is 171 API tests and 121 pgTAP assertions in isolated
   WASM PostgreSQL; Docker was unavailable. This is not a live deployment proof.
3. Resolve the obligation/account operator reporting workflow: existing member
   billing boards and reminders join by subscription and do not include these
   charges. Review enrollment/upgrade defaults to prevent separate unintended
   catalog-price one-off charges for already-covered participants.
4. Review each payer agreement, existing charge coverage, amount, first billing
   boundary, participant/service description, and pause/cutover behavior. Accept
   current-period-only recovery and manual handling of missed periods/proration.
5. Under separate approval, reconcile production migration history, apply the
   reviewed migration, and configure/activate only reviewed obligations. A schema
   migration itself never enrolls existing accounts in recurring billing.
6. Only after those checks and deployment approval, set matching `CRON_SECRET`
   values on the API and Worker, verify `API_BASE_URL`, change `crons` to the
   approved schedule, and deploy. No such action occurred in this work.

## Future operational verification

Use non-production bindings while validating. After an approved production
rollout, observe API `billing.generate_due_charges.succeeded` and Worker
`billing_generation_succeeded` events. `created: 0` is a successful no-op.
A `401` means the shared secret needs checking. Review generated obligation IDs
via canonical charge rows rather than interpreting null subscription IDs as a
failure.

To stop a future deployed scheduler, disable its Cloudflare trigger or deploy a
configuration with `"crons": []`. Pausing obligations stops their generation but
does not void historical charges. This repository currently keeps the trigger
list empty and does not deploy the Worker.
