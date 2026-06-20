# Database overview: what to expect and further optimizations

Summary of what the current schema and migrations provide, and optional next steps.

---

## 1. What the current setup provides

### 1.1 Data model (in short)


| Area                      | Tables / objects                                                                                                                      | Purpose                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Waivers**               | `participants`, `waivers`, `emergency_contacts`, `waiver_medical_histories`, `audit_trails`                                           | Signup flow, one waiver per participant (with medical + emergency contact), audit per submission.                                                                        |
| **View**                  | `view_waiver_documents`                                                                                                               | One row per waiver with participant, medical, emergency contact, and latest audit — used for PDF generation and reporting.                                               |
| **Accounts & billing**    | `accounts`, `account_members`, `plan_definitions`, `plan_entitlements`, `subscriptions`, `charges`, `payments`, `payment_allocations` | One account (payer) can have many participants; plans define price and entitlements; subscriptions link account+participant to a plan; charges and payments are ledgers. |
| **Schedule & attendance** | `schedule_templates`, `sessions`, `attendance_records`, `private_usage`, `entitlement_credits`, `access_overrides`                    | Recurring schedule, concrete sessions, who attended; private minutes; bonus credits; time-limited overrides.                                                             |
| **Admin**                 | `app_admin`, `private.is_admin()`, RLS on all tables                                                                                  | Only users listed in `app_admin` (or the service role) can read/write.                                                                                                   |


### 1.2 What works out of the box

- **Waiver flow**  
Create participant and waiver (and related rows); query `view_waiver_documents` for PDF/reporting. RLS: admin-only.
- **Billing**  
  - Create accounts, plans, subscriptions; create charges and payments manually or via your app.  
  - **Monthly charge generation:** run `generate_monthly_charges()` (manually or via pg_cron). It only creates charges for plans with `billing_cadence = 'monthly'` and only one charge per subscription per coverage period. It does **not** run by itself; you must schedule or call it.
- **Entitlements**  
  - **View:** `participant_entitlement_status` — per participant, per entitlement: usage (sessions or minutes), credits, `has_availability`, `remaining`. Respects `reset_rule` (e.g. calendar week) and active `access_overrides`.  
  - **Helper:** `can_attend_group_session(participant_id, session_label)` — returns true if the participant has an active override or a group-session entitlement with availability (optional session label filter).
- **Security**  
  - RLS on every table; only admins (and service_role) get access.  
  - Views use `security_invoker = on`; functions use `search_path = public`.  
  - First admin: insert into `app_admin` via Dashboard SQL with the **service_role** key.

### 1.3 What the DB does *not* do by itself

- **Charge generation** — Only when you call `generate_monthly_charges()`. No automatic cron in the DB.  
- **Per-session / other cadences** — No built-in logic to create charges for `per_session`, `contract`, or `custom`; you’d add that in app code or new functions.  
- **Payment processing** — No Stripe/payment-provider integration; `payments` and `payment_allocations` are manual (or your app fills them).  
- **Public waiver submission** — Waiver tables are admin-only. If you want participants to submit waivers from the web app without being admins, you need additional RLS policies (or a backend that uses service_role to insert on their behalf).  
- **Auth** — Supabase Auth handles login; `app_admin` only decides who can access **data** in this project.

---

## 2. Indexes and performance (current + one extra)

Already in place (migrations 0001–0009):

- Core FKs and common filters: participants (email, full_name); waivers (participant_id, signed_at_utc); audit_trails (participant_id, waiver_id + created_at); emergency_contacts, waiver_medical_histories; accounts (status); subscriptions, charges, payments, payment_allocations, sessions, attendance_records, private_usage, access_overrides, entitlement_credits; plan_entitlements (plan_definition_id).
- Billing: partial index on `charges(subscription_id, coverage_start)` where `status != 'void'` for `generate_monthly_charges()`.
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