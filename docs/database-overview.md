# Database overview: what to expect and further optimizations

Summary of repository schema and optional next steps. Obligation billing is implemented locally, pending production migration and deployment approval; see [recurring-billing-obligations.md](recurring-billing-obligations.md).

Corrective migration `20261003045729_serialize_subscription_enrollment.sql`
preserves legacy enrollment and initial-charge contracts but adds a participant
row lock shared with covered enrollment and an inclusive-date overlap check.
No historical data is changed. Local real-Supabase evidence is recorded in
[the 2026-10-03 validation report](obligation-validation-attempt-2026-10-03.md).

---

## 1. What the current setup provides

### 1.1 Data model (in short)


| Area                      | Tables / objects                                                                                                                      | Purpose                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Waivers**               | `participants`, `waivers`, `emergency_contacts`, `waiver_medical_histories`, `audit_trails`                                           | Signup flow; a participant may have multiple waiver rows (medical + emergency contact per submission), plus an audit row per submission. |
| **View**                  | `view_waiver_documents`                                                                                                               | One row per waiver with participant, medical, emergency contact, and latest audit — used for PDF generation and reporting.                                               |
| **Accounts & billing**    | `accounts`, `account_members`, `plan_definitions`, `plan_entitlements`, `subscriptions`, `billing_obligations`, `billing_obligation_participants`, `charges`, `payments`, `payment_allocations` | One account (payer) can have many participants; plans define price and entitlements; subscriptions link account+participant to a plan for access; explicit obligations own recurring amounts/cycles; charges and payments are ledgers. |
| **Schedule & attendance** | `schedule_templates`, `sessions`, `attendance_records`, `private_usage`, `entitlement_credits`, `access_overrides`                    | Recurring schedule, concrete sessions, who attended; private minutes; bonus credits; time-limited overrides.                                                             |
| **Admin**                 | `app_admin`, `private.is_admin()`, RLS on all tables                                                                                  | Only users listed in `app_admin` (or the service role) can read/write.                                                                                                   |


### 1.2 What works out of the box

- **Waiver flow**
Create participant and waiver (and related rows); query `view_waiver_documents` for PDF/reporting. RLS: admin-only.
- **Billing**
  - Create accounts, plans, subscriptions; create charges and payments manually or via your app.
  - **Monthly charge generation (repository):** `generate_monthly_charges()` now reads only explicitly active `billing_obligations` on active payer accounts. Each agreed amount is integer cents; participant links and catalog prices do not affect it. One charge per obligation + anchored period, including voids for retry suppression. Month-end clamps recover the original day next month. Due date is coverage start; late runs retain dates; fully missed periods are not backfilled. Legacy subscriptions are ignored even when their old automation field is set. The dated private helper supports isolated tests. No obligation data is seeded by the migration.
  - **Deployment gate:** `20260930063526` is local only. Worker cron list is empty and the Worker remains undeployed. See [design and remaining gates](recurring-billing-obligations.md).

- **Entitlements**
  - **View:** `participant_entitlement_status` — per participant, per entitlement: usage (sessions or minutes), credits, `has_availability`, `remaining`. Respects `reset_rule` (e.g. calendar week) and active `access_overrides`.
  - **Helper:** `can_attend_group_session(participant_id, session_label)` — returns true if the participant has an active override or a group-session entitlement with availability (optional session label filter).
- **Security**
  - RLS on every table; only admins (and service_role) get access.
  - Views use `security_invoker = on`; functions use `search_path = public`.
  - First admin: insert into `app_admin` via Dashboard SQL with the **service_role** key.

### 1.3 What the DB does *not* do by itself

- **Charge generation** — Only when you call `generate_monthly_charges()`. No Supabase Cron/`pg_cron` job is configured in the DB. A Cloudflare Worker is the selected external scheduler; source is in `workers/billing-cron/` but is not deployed/configured. Keep automatic billing disabled until the obligation migration, non-production integration validation, operator reporting review, and explicit deployment approval are complete.
- **Other recurring cadences** — Obligations are monthly/USD only. The existing per-class attendance RPC remains separate.
- **Payment collection** — Obligation generation records debt; it does not debit a card. Existing Stripe webhooks and manual payment recording use the same ledger.
- **Public waiver submission** — Waiver tables stay admin-only at the RLS layer. Participants submit through `POST /api/waivers/submit`, which uses the API’s **service role**. Do not add anonymous RLS write policies unless that is an explicit product change.
- **Auth** — Supabase Auth handles login; `app_admin` only decides who can access **data** in this project.

---

## 2. Indexes and performance (current + one extra)

Already in place in production (verified 2026-09-24: `0001`–`0020` plus all timestamped migrations through `20260921221500`):

- Core FKs and common filters: participants (email, full_name); waivers (participant_id, signed_at_utc); audit_trails (participant_id, waiver_id + created_at); emergency_contacts, waiver_medical_histories; accounts (status); subscriptions, charges, payments, payment_allocations, sessions, attendance_records, private_usage, access_overrides, entitlement_credits; plan_entitlements (plan_definition_id).
- Billing: non-unique partial index on `charges(subscription_id, coverage_start)` where `status != 'void'`, plus unique index `uq_charges_monthly_period_coverage_nonvoid` for non-void `charge_kind = monthly_period` rows (`20260921221500`).
- Views: indexes support `view_waiver_documents` (latest audit per waiver) and `participant_entitlement_status` (entitlements, usage, credits, overrides).

So you can expect:

- **Small/medium data:** Queries and the two main views should stay fast.
- **Large data (e.g. 100k+ waivers, millions of attendance rows):** Still fine for normal admin usage; if the entitlement view is hit very often, consider a materialized view (see below).

---

## 3. Optional further optimizations

Only consider these if you see real slowness or plan for much higher load.


| Option                                                     | When to consider                                                                                 | Effort                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Materialized view for `participant_entitlement_status`** | Dashboard or API hits this view a lot and near–real-time isn’t required.                         | Create mat view, refresh on a schedule (e.g. every 5–15 min) or after relevant writes.                          |
| **Scheduled refresh job**                                  | You want “good enough” freshness for entitlement display without recalculating on every request. | Use pg_cron (or external cron) to run `REFRESH MATERIALIZED VIEW CONCURRENTLY participant_entitlement_status;`. |
| **Expression index on sessions**                           | You often filter “sessions this week” by `date_trunc('week', starts_at)`.                        | `create index ... on sessions (date_trunc('week', starts_at));`                                                 |
| **Partial index on active plans**                          | Dashboard almost always filters `plan_definitions` by `is_active = true`.                        | `create index ... on plan_definitions (...) where is_active = true;`                                            |
| **ANALYZE after bulk loads**                               | You import large batches of data (participants, waivers, attendance).                            | Run `ANALYZE participants;` (etc.) or rely on autovacuum/analyze.                                               |


No need to add these unless you have a concrete performance or scaling requirement.

---

## 4. Summary

- **Functionality:** Waiver capture, waiver document view, accounts/plans/subscriptions, charges and payments (manual or via your app), monthly charge generation when you call it, entitlement view and “can attend” helper, admin-only RLS, secure views and functions.
- **Expectations:** DB is ready for admin-driven use and for the dashboard/API to rely on the views and functions above. Charge generation and payment recording are under your control (cron + app).
- **Optimizations:** Indexing is in good shape; add a materialized view and/or scheduled refresh only if the entitlement view becomes a bottleneck.

## Obligation schema (pending production application)

`billing_obligations` has a required payer FK, immutable economic terms, draft/active/paused/ended states, explicit billing start, exclusive replacement cutoff, and audited lifecycle transitions. `billing_obligation_participants` is informational. Both tables enable RLS and grant access only to the service role. `charges.billing_obligation_id` uses a composite FK with `account_id`; the new unique index includes all statuses. The existing subscription monthly-only index is retained.

Existing member payment boards/reminders remain subscription-based and exclude obligation charges. Account receivable and charge net-due views still work. An operator reporting/UI decision is a deployment gate; do not assign the entire household charge to every participant.


Follow-up migration `20261001080133_obligation_reporting_entitlements.sql` adds
`view_payer_charge_board` and `view_payer_payment_reminders` (invoker, service-role
only), and atomic `enroll_obligation_entitlement` (service-role only). Reports
include all ledger charges without participant fan-out and use `view_charge_net`
minus allocations. The entitlement RPC creates no debt and never updates
obligation terms. Chained replacement cutovers must be at or after the predecessor's
billing start. No new table, backfill, or ledger is introduced by this follow-up.
