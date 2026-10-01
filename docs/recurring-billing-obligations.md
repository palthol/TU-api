# Explicit payer billing obligations

Implemented locally on `cursor/custom-household-billing`; **not deployed**.
Migration: `20260930063526_account_billing_obligations.sql`. Production was not
contacted. No obligations or charges are seeded or backfilled by this migration.

## Existing flow and model choice

Before this migration, `subscriptions` required an account, participant, and plan.
The generator selected active, paid monthly subscriptions with a non-null
`automatic_billing_starts_at`; took the catalog `price_cents`; and chose a start
from the last charge end, automation baseline, subscription start, and run date.
Coverage ended at calendar-month end (or the subscription end). Due date equaled
coverage start. An advisory transaction lock and a unique non-void
`(subscription_id, coverage_start)` index for `monthly_period` prevented repeated
subscription charges. Multiple participants meant multiple subscription charges.

`account_members` and `participant_relationships` describe people, not payment
agreements. `record_payment` allocates against the existing `charges` ledger,
requires matching payer account, and enforces the discount-adjusted net balance.

Adding amount and anchor columns to subscriptions would retain the wrong
one-participant/one-plan cardinality. Making those columns nullable and changing
subscription cardinality would disrupt enrollment and entitlement consumers.
Therefore `billing_obligations` represents the explicit payer agreement, while
subscriptions remain enrollment/access records. This adds one source of recurring
terms, **not another ledger or a parallel generator**: the existing RPC now reads
only obligations and creates ordinary `charges`, handled by existing payments,
allocations, receipts, discounts, credits, write-offs, and refunds.

## Records and invariants

- Every obligation has a client-supplied UUID, required `account_id`, descriptive
  `label`, positive integer `amount_cents`, USD currency, immutable `anchor_date`,
  lifecycle status, optional notes and `replaces_obligation_id`.
- There is no uniqueness constraint on payer account. Two obligations for one
  account each bill independently, even with identical dates and amounts.
- `billing_obligation_participants` is an optional explicit many-to-many link.
  Participants need not be inferred from account membership. The operator may
  describe a service in the label without attaching any participant. Generation
  never joins links, subscriptions, plan prices, emails, or family relationships.
- Separate accounts in a family own separate obligations. A payment can cover
  multiple obligations of one account; existing allocation checks reject mixing
  payer accounts. A replacement may explicitly move responsibility to another
  payer, after review; changing a payer in place is forbidden.
- `charges.billing_obligation_id` and `account_id` have a composite foreign key.
  Obligation charges are `monthly_period`, with `subscription_id = NULL`.
- Unique `(billing_obligation_id, coverage_start)` includes **all statuses**.
  Voiding a charge waives that period; a retry does not undo the waiver. Correct
  financial mistakes with existing adjustments/voids/manual charges, not by
  deleting a generated charge or changing its immutable terms.
- The old subscription monthly-period uniqueness index remains intact. Manual,
  per-class, and prorated charges retain their existing uniqueness rules.
- New tables have RLS and no anon/authenticated grants. Configuration RPCs are
  service-role-only, security invoker. Lifecycle changes have before/after records
  in `event_ledger`. Charge audit capture continues through the existing trigger.

## Dates, retries, and gaps

`anchor_date` fixes the original day of month and earliest possible cycle. The
operator separately selects `billing_starts_on` at an anchor boundary when
activating. Merely inserting a draft, enrolling a participant, or applying this
migration cannot start recurring billing.

A month's boundary is the original anchor day, clamped to that month's last day.
The next boundary is independently computed from the original day, never from a
previous clamped date. Thus a January 31 anchor bills January 31–February 27 and
February 28–March 30 in a common year; in a leap year February starts on the 29th.
Anchors 29 and 30 similarly recover their own original days in March. December
rolls into the next year without special handling.

Coverage is stored as inclusive `coverage_start` and `coverage_end`; due date is
coverage start. The public no-argument RPC uses the **America/New_York business
date**, independent of the database session timezone. The private
`generate_monthly_charges_as_of(date)` is the deterministic database test path;
there is no public HTTP as-of-date input.

Only the period containing the run date can be generated, and its start must be
at or after the explicitly selected billing start. A delayed run inside that
period retains its original coverage and due date, including when the run is in
the following calendar month. Entire missed periods are skipped, not backfilled.
For example, a delayed March 2 run for a 26th anchor creates February 26–March 25
if missing; it does not create January's debt. Historical recovery requires an
operator review and manual charges. There is no automatic proration, late fee,
payment collection, or independent due-date offset.

The shared advisory transaction lock serializes generation and lifecycle RPCs;
obligation rows are locked during generation. The unique database index also
protects direct/concurrent inserts. Retries return only newly created charges.

## Changes and lifecycle

1. Create a **draft** using an explicit payer and a caller-generated UUID. Reuse
   that UUID on retries: an existing ID returns 409, preventing accidental new
   agreements. GET the payer's obligations to reconcile an uncertain response.
2. Activate with a reviewed `billing_starts_on`. Repeating the same activation
   is a no-op. An inactive account cannot activate and cannot generate charges.
3. Pause stops generation immediately, retaining already issued charges. Resume
   is `activate` with a current/future anchor boundary; it cannot move the stored
   billing start backwards. Dates missed during the pause are not recovered.
4. End stops generation immediately and is terminal. Already issued full-period
   charges remain unchanged. Ending does not automatically refund or prorate.
5. Economic terms (payer, amount, currency, anchor, replacement ancestry) are
   immutable. Create a replacement draft, then activate it. Activation atomically
   sets the predecessor's exclusive `ends_before` and the new billing start.
   Both cycles must have a boundary on that date, and no existing predecessor
   charge (even void) may extend into the replacement. A second replacement
   cannot supersede the same predecessor. The predecessor remains stored and can
   generate only before cutover; replacement drafts do not interrupt it.

Changing to an anchor that has no shared cutover boundary requires an explicit
end and a separately reviewed new obligation, including any gap or manual
adjustment. This first version does not infer proration or bridge that gap.
Labels/notes may be corrected by privileged SQL; economic edits always use the
replacement workflow. Participant links are fixed by the create request in this
API version; replacement provides a new coverage description.

Plan or entitlement changes do not update the agreed obligation amount.
**Existing enrollment and upgrade APIs still create their documented one-off
catalog/proration charges.** Use `create_initial_charge: false` when adding
subscriptions whose fees are already covered by an obligation. Entitlement-only
plan changes must not be routed through `subscription-upgrade`, which explicitly
means a charged prorated upgrade. There is no new entitlement-edit HTTP route in
this change.

## Legacy handling and contracts

No legacy subscription becomes an obligation implicitly, even if its
`automatic_billing_starts_at` is populated. That field is retained and returned by
legacy APIs for compatibility but is ignored by recurring generation. Existing
charges are not altered or associated with new obligations. Operators must choose
a first billing boundary that avoids previously billed coverage.

The generator's seven result fields and HTTP envelope remain unchanged.
`subscription_id` is null for obligation charges; read `charges.billing_obligation_id`
for their source. The new staff routes are documented in `admin-api.md`.

## Deployment gate / remaining validation

The Worker remains undeployed with `triggers.crons = []`. Before separately
approving deployment:

- Review this migration and reconcile the actual migration history in the future
  authorized environment (the prior production snapshot is not a fresh check).
- Run the documented Docker Supabase database suite and local API/PostgREST
  integration smoke, including simultaneous generator/lifecycle calls. The WASM
  PostgreSQL fallback validates SQL/pgTAP but is single-session and does not prove
  network auth, production grants, or multi-connection behavior.
- Review actual payer agreements, prior charges, first billing boundaries, USD
  amounts, paused states, missed-period handling, and the absence of proration.
  Configure/activate agreements only under separate operator authorization.
- Update the operator billing workflow and reminders. Existing participant-based
  `view_member_payment_board` / `view_member_payment_reminders` join charges by
  subscription and **do not display obligation charges**. Existing charge-level
  net-due and account receivable views include them. Do not reinterpret a family
  charge as debt for each participant; an obligation/account reporting contract
  needs its own UI review before enabling automated billing/reminders.
- Review enrollment/upgrade defaults with the frontend so covered participants
  do not receive unintended separate one-off fees.
- Only after those gates and explicit deployment approval, configure the intended
  daily trigger and shared cron secret. No production migration, backfill,
  activation, Worker deployment, push, or merge is part of this change.
