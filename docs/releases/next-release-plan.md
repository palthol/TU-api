# Next release: reliable membership billing

- **Status:** Draft for product decisions; implementation has not started.
- **Prepared:** September 30, 2026
- **Repository baseline:** `153abe93977139769ae384e34012c1a7aa0d8d4a` on `develop`
- **Local feature branch:** `cursor/custom-household-billing`
- **Release number:** To be assigned; the repository already has a `v1.1.0` tag.

## 1. Release outcome

The operator can enroll an existing person or household, enter its agreed monthly amount and billing cycle, preview the first bill, generate it once, record money received, and see an accurate remaining balance and next bill. A daily job can repeat charge generation once the pilot is verified.

Charge generation records an amount owed. Payment collection and recording remain separate operations. This release proposes automatic charge generation plus staff recording of payments received through existing channels. Member payment links, saved-card collection, and automated dunning are later work.

Recommended scope includes a small operator workflow in the existing admin application. Its exact effort requires an audit of that sibling repository; its code has not been inspected for this plan.

This plan proposes a billing milestone. Full V1 readiness also requires verifying previously agreed lead capture, referral visibility, and the staff Discord digest. Track those commitments explicitly before declaring the platform's full V1 complete.

## 2. Evidence and current limits

| Finding | Evidence | Release consequence |
| --- | --- | --- |
| Develop includes PRs 44 and 45. | Commit `153abe9` merges the billing Worker PR; earlier `612acee` merges the production-state refresh. | Start from the verified develop baseline. |
| API tests and waiver schema guard passed in this workspace. | 140 tests across 18 files; `npm run guard:waiver-schema`. | Preserve this baseline and add database/integration proof for new billing behavior. |
| Clean dependency installation is not yet proved here. | Tests ran after `npm install --ignore-scripts --no-package-lock`; docs still report an `npm ci` issue. | Verify a clean locked install in CI and resolve actual failures before release. |
| Current CI runs waiver checks and an optional smoke. | `.github/workflows/waiver-guards.yml`. It does not run the full API or billing database suites. | Add meaningful API and database checks; absent smoke credentials must be reported as untested, not proof of health. |
| Subscriptions link a participant to a plan; charges can reference an account without a subscription. | Foundation schema; latest monthly-generation migration. | Preserve participant access plans while introducing household billing ownership. |
| Generator uses the catalog price per subscription and calendar-month ends. | `20260921221500_scope_monthly_charge_uniqueness.sql`. | Persist actual billing terms and replace period calculation before activation. |
| A null `automatic_billing_starts_at` excludes a subscription. | Latest generation function. | Define explicit opt-in activation and its first billable period. |
| Payment, refund, receipt, staff-role, and scheduling code already exists. | API contracts, tests, ADRs and migrations. | Integrate and verify it; avoid rebuilding these domains. |
| Some affiliate logic requires a subscription-linked charge. | Referral earning and credit-application functions in migration `0002`. | A household charge with null `subscription_id` needs explicit compatibility work. |
| Billing Worker source exists; deployment is gated. | `workers/billing-cron/README.md`. | Keep scheduling activation after billing correctness and pilot verification. |
| The work queue is complete and has no ready successor. | `work-queue/README.md` and `queue.json`. | Add scoped release briefs with dependencies as the first implementation step. |

Production counts in `current-state.md` are dated snapshots. This planning pass did not refresh live production data. Passing mocked API tests is not evidence that the full production billing workflow has run successfully.

## 3. Confirmed direction and draft defaults

### Confirmed from the current discussion

- Support a keyed monthly amount for an individual or household, without requiring a per-child allocation formula.
- Preserve the Core plan's access entitlements when an operator agrees to a different price.
- Model dependents as their own participants under the appropriate payer account.
- Pilot with the two confirmed paying accounts. The inactive member and the unresolved household are excluded from this pass.
- A person's enrollment date does not establish their paid-through date, billing anchor, due date, or payment history.
- Continue with the existing Express API, Supabase system of record, and Cloudflare billing scheduler design.

### Defaults proposed pending answers

| Decision | Proposed default | Consequence if changed |
| --- | --- | --- |
| Delivery surface | Billing API plus a basic operator screen in `admin`. | Backend-only can omit UI delivery; broader operations expands the release. |
| Late payment | Keep the agreed coverage cycle; staff can explicitly move a due date or change future terms. | Restarting coverage on payment requires a different recurrence policy and more tests. |
| Overdue access | Alert staff for review; debt alone does not automatically suspend training. | Automatic blocks require an agreed grace policy and entitlement integration. Existing waiver, membership, and plan-limit rules still apply. |
| Price/member changes | Operator confirms the new total and effective future period. | Automatic repricing or mid-period proration adds policy and credit/refund work. |
| Receipt delivery | Use existing operator receipt/view/copy functionality. | Automated email/SMS needs provider selection and delivery work. |

These are planning defaults, not recorded stakeholder approvals.

## 4. Required billing design

### 4.1 A persisted billing agreement owned by the payer account

Propose an account-owned billing agreement, linked to its covered subscriptions. Final table and field names belong in the first design ADR.

The contract must represent:

- Agreed recurring amount in integer cents and currency, with an explicit pricing mode.
- Covered subscriptions and their effective membership dates; prevent the same subscription from being billed by two active recurring arrangements for an overlapping period.
- Recurrence day or explicit end-of-month policy, independent of enrollment date.
- First approved billable period and activation status.
- Due-date policy and any explicit one-period due-date override, separate from coverage dates.
- Effective dates, operator identity, and reasons for price or cycle changes.

A solo account can use the same mechanism as a household. Existing catalog-based subscriptions must continue to work or have an explicit migration path. Switching a covered subscription into household billing must suppress its old individual generator path atomically.

The plan catalog continues to define training access. A negotiated rate is persisted as billing data; notes alone cannot drive recurring charges. Preserve a transparent discount when its basis is known, such as $150 less $35. For a directly agreed household amount, show that amount and its recorded reason without fabricating a per-person split. Supersede conflicting language in the finance design document explicitly.

### 4.2 One authoritative period calculation

Use the same period calculation for previews, activation, initial charges, daily generation, and next-bill displays.

- A cycle beginning September 29 covers September 29–October 28, inclusive.
- Retain the intended anchor day across short months. A day-31 policy may clamp to February's last day and return to the 31st in March; it must not drift permanently to the 28th.
- Model explicit end-of-month separately where needed; do not assume every day-29 account means end-of-month.
- Use a defined business date/timezone, proposed `America/New_York`, with deterministic test dates. Preserve existing cash-reporting date contracts unless explicitly migrated.
- Moving a payment's expected date does not silently move coverage dates.
- Pausing, cancelling, or changing a rate must not rewrite an issued charge or receipt. Default rate changes take effect at the next unissued period; corrections use existing correction/refund mechanisms.

### 4.3 Deliberate first bill and dependable reruns

The operator supplies the approved first period and reviews amount, members, coverage dates, and due date. Activation can either create that due charge immediately or schedule a future period. It must not depend on waiting for the next cron tick.

- Never infer historical debt or succeeded payments from a training start date.
- Define the earliest billable period at cutover. A delayed run can generate an explicitly approved due period without rebasing its start to the run date.
- Adopt bounded catch-up for periods after activation; excessive gaps surface for review rather than silently skipping bills or producing unbounded arrears. Specify the bound in the ADR and test it.
- Guarantee one non-void recurring charge per billing agreement and period with a database constraint and transactional generation, including concurrent calls and manual/API/cron retries.
- Provide a non-mutating preview and explain skipped accounts: disabled, future period, paused, missing terms, already billed, or requires review.
- Manual charges, per-class charges, prorations, void replacements, and recurring charges must have explicit coexistence rules.

### 4.4 Billing compatibility

Integrate with `record_payment`, allocations, `view_charge_net`, refunds, immutable receipts, reporting, and audit events. Do not add a second payment ledger.

Household totals must appear once in balances and revenue reports while both participants remain discoverable. A child can share paid coverage without receiving a duplicate bill or losing their own plan entitlements.

Audit subscription-dependent joins and referral functions. Decide how household referral credit is earned/applied before enabling that behavior; never multiply a household payment by its member count or silently omit it. Preserve existing referral visibility, which older V1 product decisions require.

## 5. Implementation sequence and proposed task briefs

IDs below are proposals and are not yet inserted into the work queue. Each implementation brief must define allowed paths, dependencies, acceptance tests, evidence, and rollout limits. Code/test tasks use non-production targets; a separate release/import brief records any later production authorization.

| Order / proposed task | Work and owner | Dependencies | Completion evidence |
| --- | --- | --- | --- |
| 1. `API-REL-001` — reconcile scope and docs | TU-api: record pricing/cycle decisions; correct stale capability statements; create release task briefs and queue entries. | Product defaults resolved where behavior depends on them. | Clear source-of-truth docs; ready task with matching brief/queue/claim conventions. |
| 2. `API-REL-002` — reproducible validation | TU-api: clean locked install, API tests in CI, real local/isolated Postgres billing tests, reliable non-prod smoke environment. | REL-001. | Clean-run logs and migration replay; distinguish mocks from DB and end-to-end evidence. |
| 3. `API-BILL-001` — billing agreement schema | TU-api: ADR, forward migration, effective terms, member linkage, audited activation state, access controls. | REL-001. | Constraint/permission tests; existing subscriptions remain compatible and disabled records stay disabled. |
| 4. `API-BILL-002` — cycles and generation | TU-api: shared period calculator, custom amounts, initial charge, previews, idempotency, bounded catch-up. | BILL-001, REL-002. | Date-boundary, amount, retry, concurrency, and exclusion tests against PostgreSQL. |
| 5. `API-BILL-003` — operator API and financial compatibility | TU-api: validated configure/preview/activate/generate/pause flows; account-aware reports, payments, receipts and referral handling. | BILL-002. | Stable documented API; owner/finance checks; transactional failures; reconciled household balances. |
| 6. `ADMIN-BILL-001` — operator workflow | Sibling admin repo: audit existing apps, then extend the appropriate billing screen and dashboard readouts. | BILL-003 API contract. | Operator can search a household, edit terms, preview a charge, record a payment, and see next due/balance without copying UUIDs. |
| 7. `API-DATA-001` — pilot import | TU-api: adapt the separate seed draft to the final agreement model; preview exact participant/account links and baseline dates. | BILL-003. | Repeatable non-prod import with no duplicate subscriptions, charges, or member links. |
| 8. `API-REL-003` — release candidate | TU-api + admin: integrated acceptance matrix, deploy sequence, forward recovery plan and documentation. | ADMIN-BILL-001, DATA-001, all billing tests. | Release checklist passes on isolated infrastructure; remaining limitations are explicit. |
| 9. `API-OPS-002` — pilot and schedule | Operator/release owner: scoped migration/import rollout, preview approved first bills, run controlled generation, then enable Worker. | REL-003 and confirmed pilot billing baselines. | Exactly expected first charges, rerun produces zero duplicates, balances reconcile, scheduler/run logs visible. |

ADMIN-BILL-001 can progress against an agreed API contract while API integration is completed. Database migration changes should have one owner and merge in dependency order.

## 6. Operator workflow

1. Search an existing payer/account and inspect its participants.
2. Set the agreed rate, participants covered, billing cycle, first billable period, and due date.
3. Preview the first charge and subsequent cycle. Show custom pricing explicitly.
4. Activate with a clear choice to generate the due bill now or start on a future date.
5. Record a received payment through the existing atomic payment path, including method, received date, allocations, and optional receipt.
6. Review remaining balances, overdue/due-soon accounts, next bills, and generation failures.

The formal billing ledger is the authoritative source for member dues. Existing quick-log/invoice drafts must be clearly distinguished so one payment is not counted twice. Do not implement an automatic quick-log import without mapping and deduplication rules.

Verify how cash, Venmo, PayPal, Zelle, Cash App, and Intuit GoPayment map to the existing payment-method fields and references. Manual recording of these channels does not imply a live integration with each provider.

## 7. Pilot and import boundaries

The separate local `codex/backfill-known-monthly-subscriptions` branch is a draft input, not the final production import. It contains subscription notes for custom rates and was not run. Rework it after the new billing model exists instead of assuming its notes enable recurring pricing.

Pilot data requirements already known from the operator:

| Pilot case | Training plan | Agreed monthly amount | Enrollment dates |
| --- | --- | --- | --- |
| Solo member | Core, catalog $150 | $115 | July 10, 2026 |
| Parent and child | Core access for each | $249.75 for the household | August 11, 2026 for both |

Before live activation, confirm each account's paid-through date, exact first charge period, due date, and whether that period has already been paid. Enrollment dates do not answer those questions. Previously discussed end-of-month payment arrangements are context to verify at cutover, not permission to invent a payment record.

For the dependent, inspect both existing accounts and all financial/member links before consolidation. The draft seed moves the membership; the final import must stop on conflicting subscriptions or financial history, and avoid orphaning history. Preserve canonical participant records. Use synthetic people in automated test fixtures.

## 8. Release acceptance matrix

| Scenario | Required result |
| --- | --- |
| Solo Core member with a negotiated price | One $115 recurring charge; Core entitlements retained. |
| Two Core members on one household price | One $249.75 recurring charge; both memberships visible; no extra $150 charges. |
| Both pilot accounts due together | Two charges totaling $364.75 before separately approved credits; no duplicate balance in participant reports. |
| September 29 anchor | Coverage ends October 28; next cycle starts October 29. |
| Days 29/30/31, February, leap years, year rollover | Intended anchor is retained; no gaps/overlaps or permanent date drift. |
| Due period activated now | Correct first charge is available immediately through the operator action. |
| Future, disabled, paused, or cancelled agreement | No inappropriate charge. |
| Worker late or retried; two invocations overlap | Approved periods retain their boundaries; no duplicates or unapproved historical debt. |
| Rate/member change | Future billing follows effective terms; issued financial records remain unchanged. |
| Manual/per-class charge or void replacement | No mistaken suppression of a due household period and no accidental duplicate billing. |
| Full/partial payment, refund, write-off or discount | Net due, allocations, receipt history, reports, and audit events agree. |
| Existing referral credits | No doubled credit, missing household balance, or silent exclusion; agreed household policy is tested. |
| Unauthorized role or cross-account membership | Rejected before any partial write. |
| Repeated pilot import | No new duplicate identity, membership, subscription, or charge. |
| Waiver regression | Existing schema guard and waiver behavior continue to pass. |

Also verify zero/custom-rate validation, inactive plan behavior, business-date boundaries, and amount/currency consistency. Keep money in integer cents throughout.

## 9. Rollout and recovery

1. Complete isolated migration replay, API/database tests, and the actual operator workflow smoke. A native PostgreSQL fallback proves SQL behavior but does not replace API/Storage/auth end-to-end verification.
2. Prepare an additive migration and compatible API/UI release sequence. Read current production migration state immediately before rollout.
3. Publish a scoped release/import brief with exact permitted changes and a preview of the two pilot accounts. Preserve the separate non-production test safeguards.
4. Apply approved schema/API changes while scheduling remains disabled. Import the verified pilot records and preview first charges.
5. Generate only the approved pilot bills. Verify amounts, periods, members, balances and rerun behavior before enabling the daily Worker.
6. Verify first scheduled invocation and an isolated next-cycle simulation. Monitor generation outcomes and last successful run; alert on failures rather than relying on an unnoticed log entry.
7. Keep an application-level generation switch or equivalent immediate control. Disabling a cron can take time; document the fastest containment path. Preserve issued ledger history and use void/correction operations for financial recovery rather than deleting records or blindly dropping schema.

Successful rollout means the operator can see what is owed, record what was received, and trust the next charge. A scheduler returning HTTP 200 by itself is insufficient.

## 10. Scope after this release

- Member pay links and online payment collection: Stripe webhook code exists, but checkout links and their account/charge mapping need a separate delivery slice.
- Broader scheduling/attendance UI, CRM/lead management, and marketing campaigns.
- Automated email/SMS receipts or reminders, richer dunning, and payment-triggered cycle policies.
- Automatic family-price formulas, automatic mid-cycle proration, and more complex household/referral rules.
- Finance expansion such as owner contributions and richer expense analysis.
- Wider staff onboarding or replacement of the current API-key operator workflow.

Existing behavior in these domains remains a regression concern. New work should not postpone the two-account billing pilot unless it is required for correctness.

## 11. Decisions still needed

The direction questions presented during planning concern: operator UI versus backend-only scope, fixed versus payment-reset cycles, and overdue-access behavior. No selection was returned, so this draft uses the defaults in section 3.

Additional decisions:

1. Is there a target launch date or external deadline? This determines whether operator UI and optional notification improvements ship together or follow the API pilot.
2. Must referral credits be awarded/applied automatically on household bills at launch, or is visibility plus an explicit staff action acceptable initially? Existing V1 docs call referral visibility required.
3. At pilot cutover, what are the two accounts' actual paid-through dates, first bill periods, due dates, and payment status? These gate activation, not foundational implementation.

Do not block schema design, reproducible testing, or generic cycle tests on unanswered real-account payment history.

## 12. Source map and documentation repairs

This plan is grounded in the files below at the stated baseline and the current user decisions. Sibling-app capabilities remain to be audited.

- [Current state](../current-state.md): use dated evidence; reconcile its stale no-route-tests statement with the existing test suites and clean-install claim with fresh evidence.
- [Target state](../target-state.md): transactional writes, observable jobs, supported validation, and repository ownership.
- [Application ownership](../application-ownership-and-data-flow.md): API/schema here; operator UI in the sibling admin repo.
- [API contracts](../admin-api.md): subscriptions, generator, payment allocations, receipts, discounts and role boundaries.
- [Finance design](../finance-subsystem-design.md): account ownership, formal ledger, discount transparency, referrals and reporting.
- [V1/V2 map](../v1-v2-application-map.md): operator-first V1, later self-service payments, referrals and Discord. Reconcile outdated pending-receipts language and distinguish subscription cutover from historical payment/receipt backfill.
- [Decision log](../decision-log.md): supersede decisions explicitly and distinguish historical migration/deployment notes from current status.
- [Validation environment](../validation-environment.md): retain non-production safeguards; remove obsolete claims that now-implemented atomic/idempotent paths are still missing.
- [Work queue](../../work-queue/README.md): create new briefs; completion of the old queue is not completion of the billing product.
- [Worker runbook](../../workers/billing-cron/README.md): activation gate, protected API boundary, operational verification and disable procedure.
- [Latest billing migration](../../supabase/migrations/20260921221500_scope_monthly_charge_uniqueness.sql): current pricing, period calculation and uniqueness behavior to replace compatibly.
