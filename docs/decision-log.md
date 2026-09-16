# API decision log

Entries are append-only. Supersede an earlier decision by referencing its ID.

| ID | Date | Decision | Status |
| --- | --- | --- | --- |
| API-ADR-001 | 2026-09-03 | This repository is the only backend and canonical schema owner. | accepted |
| API-ADR-002 | 2026-09-03 | Production database writes require explicit task authorization. | accepted |
| API-ADR-003 | 2026-09-03 | Capability status uses verified, implemented, unwired, and missing. | accepted |
| API-ADR-004 | 2026-09-03 | Privileged multi-write operations should use transactional RPCs and idempotency where retryable. | accepted |
| API-ADR-005 | 2026-09-14 | Staff identity uses per-person hashed API keys and roles on the existing `x-admin-key` header; the shared env key remains an owner compatibility actor. | accepted |
| API-ADR-006 | 2026-09-16 | Card-processor webhooks use Stripe; public `POST /api/webhooks/stripe` verifies signatures and maps succeeded PaymentIntents into `record_payment`. | accepted |

## Open decisions

- Deployment and scheduling platform ownership.
- Email and SMS providers.
- Long-term role of personal-finance entries versus formal billing.

## API-ADR-005 — Staff authentication and RBAC

**Status:** accepted  
**Date:** 2026-09-14  
**Task:** API-AUTH-001

### Context

`/api/admin/*` (and the on-demand waiver PDF) is gated by a single shared
`ADMIN_API_KEY` compared to header `x-admin-key`. Dashboard and receipts paste
that header at runtime; they do not ship `VITE_ADMIN_API_KEY`. Discord cron
routes also accept `x-cron-secret` when `CRON_SECRET` is set. Viewer routes use
Cloudflare Access and are out of scope.

A shared key cannot name the person who performed a privileged write
(`created_by` / `recorded_by` today are optional client strings defaulting to
`admin_api`). Target roles are `owner`, `front_desk`, and `finance`.

Supabase Auth + `app_admin` already exists for **direct PostgREST / RLS**
access. The deployed operator apps talk to **this Express API**, not to
PostgREST with a user JWT. Binding API auth to Supabase Auth now would force a
second login stack on dashboard/receipts. This ADR keeps one HTTP contract so
those apps can switch from a shared paste-in key to a personal key without a
second API.

### Decision

1. **Same header.** Operators continue to send `x-admin-key`. A matching
   `ADMIN_API_KEY` is the **legacy shared-key compatibility mode**: it
   authenticates as actor `legacy_shared_key` with role `owner`. Personal staff
   keys use the same header so dashboard/receipts can paste a per-person key
   later with no new client protocol.
2. **Staff directory in Postgres** (`staff_users`, migration `20260914185843`). Columns:
   email, display name, role (`owner` | `front_desk` | `finance`), SHA-256
   `key_hash`, `key_prefix`, `active`. Plaintext keys are shown once at create
   or rotate (`tu_sk_` + 32 random bytes hex). Hashes are never logged or
   returned. RLS is enabled; `anon` / `authenticated` have no write policies.
   `key_hash` has no SELECT policy for `authenticated` (service-role API only).
   The Express service-role client remains responsible for HTTP authorization.
3. **No half-open gate.** Missing/wrong key → `401 { ok: false, error: "unauthorized" }`.
   Authenticated but role-denied → `403 { ok: false, error: "forbidden" }`. There
   is no optional-key, “dev open admin”, or route that skips the gate. Unset
   `ADMIN_API_KEY` does not match an empty header. If `20260914185843` is not applied,
   staff-key lookup fails closed (treat as unknown key); the shared env key
   still works.
4. **Role matrix (prefix, mutating methods).** GET/HEAD (except `GET /staff`)
   is allowed for every active role so today’s monolith dashboard can load.
   Mutations:
   - `owner`: all admin routes, including staff CRUD and participant merge
   - `finance`: `/billing/*` except as noted; not scheduling writes, not staff,
     not merge, not Discord notification triggers
   - `front_desk`: `/scheduling/*`, `/waivers*`, `POST /billing/record-payment`,
     `POST /billing/external-counterparty-accounts`; not refunds, write-offs,
     discounts, subscriptions, expenses, staff, or merge
   - Unknown mutations default to `owner` only
5. **Cron.** `requireAdminOrCron` still accepts `x-cron-secret` when
   `CRON_SECRET` is set, attaches actor `cron` / `cron_secret`, and does not
   require a staff row. Viewer Cloudflare Access is unchanged.
6. **Actor identity.** Every authenticated admin request sets `req.staff`
   (`id`, `email`, `displayName`, `role`, `authMethod`, `actorLabel`). Mutating
   requests append `staff_audit_events` (staff id when known, actor label, role,
   auth method, HTTP method, path). That table is the privileged-write identity
   story for this change. Domain columns (`created_by`, `recorded_by`) stay
   client-supplied until each route adopts `req.staff.actorLabel`; spoofable
   body fields are not treated as the authenticated actor.
7. **Staff management.** Owner-only Express routes
   `GET/POST /api/admin/staff`, `PATCH /api/admin/staff/:id`, plus
   `GET /api/admin/auth/me` for any authenticated staff (dashboard adoption
   hook). Operators may also insert hashed rows via service-role SQL. Do not
   put staff keys in `VITE_*`.

### Consequences

- Existing `x-admin-key` clients keep working as owner until they rotate to
  personal keys. The shared-key window is leftover risk: anyone with
  `ADMIN_API_KEY` is still a full owner.
- Production must not receive `20260914185843` from this task. Until it is applied,
  only the shared key authenticates.
- `API-PAY-001` stays blocked until this task and `API-HARD-001` are both done.
- Sibling UIs are not changed in this repository.

## API-ADR-006 — Stripe webhook → `record_payment`

**Status:** accepted  
**Date:** 2026-09-16  
**Task:** API-PAY-001

Closes the **payment** part of the former open decision “Payment, email, and
SMS providers.” Email and SMS providers remain open.

### Context

Staff already record succeeded money-in through
`POST /api/admin/billing/record-payment`, which calls service-role RPC
`record_payment` (API-ADR-004 / API-HARD-001). That path is authenticated with
`x-admin-key`. Card-processor events cannot use that header: Stripe (or any
processor) is an untrusted public caller.

`record_payment` is atomic and idempotent on `p_idempotency_key` (max 200
chars). Refunds already have `record_payment_refund`. Production has not
applied migration `20260916174649`; the admin handler still has a sequential
insert fallback. Provider webhooks must not use that fallback.

Historical sketch: `docs/archive/infrastructure-additions-checklist.md` §2.1
(`POST /api/webhooks/stripe`). That sketch is not a product lock; this ADR is.

### Decision

1. **Provider — Stripe.** Card-processor success maps to `payments.method = card`.
   PaymentIntent is the money-in object; Refund is the money-out object; Event id
   is the delivery id. Out of scope for this task and this ADR: email/SMS
   providers, member pay links, Checkout / Payment Link / customer portal,
   sibling-app changes, live Stripe Dashboard webhook registration, and
   `supabase db push` to production.

2. **Trust boundary.** `POST /api/webhooks/stripe` is a **public** route, not
   `/api/admin/*`. Authenticate only by verifying Stripe-Signature (HMAC-SHA256
   over `timestamp.payload`, 300s timestamp tolerance) against
   `STRIPE_WEBHOOK_SECRET`. Staff `x-admin-key` does not authenticate the
   provider and does not bypass signature verify. No
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_API_KEY`, or Stripe secret belongs in a
   browser or `VITE_*` bundle.

3. **Idempotency.**
   - Delivery: unique `(provider, event_id)` on `payment_processor_events`.
     A retry of the same `evt_…` replays the stored JSON envelope and does not
     call `record_payment` / `record_payment_refund` again.
   - Money-in intent: `p_idempotency_key = stripe:pi_<payment_intent_id>`
     (well under 200 chars). Duplicate `payment_intent.succeeded` deliveries,
     or a second event for the same PaymentIntent, replay `{ payment_id, receipt_id }`
     and insert no second payment, allocation, or receipt. Same key with a
     different account, amount, or method → `409` `idempotency_key_conflict`.
   - Money-out intent: `p_idempotency_key = stripe:re_<refund_id>` on
     `record_payment_refund`.
   - Object map: `payment_processor_refs` unique on
     `(provider, object_type, object_id)` so a PaymentIntent or Refund id
     resolves to our `payment_id` / `payment_refund_id`.

4. **Mapping to `record_payment`.** After signature verify, only
   `payment_intent.succeeded` books money-in. Fields:
   - `p_account_id` — PaymentIntent metadata `tu_account_id` (UUID). Required.
   - `p_amount_cents` — integer cents from `amount_received` (fallback `amount`).
     Currency must be `usd`. Metadata must not override the processor amount.
   - `p_method` — `card` (card-processor success).
   - `p_issued_by` — webhook actor label `stripe_webhook` (not a body field).
   - `p_allocations` — metadata `tu_allocations` JSON array of
     `{ charge_id, amount_cents }` if present; else a single row allocating the
     full amount to metadata `tu_charge_id`. Allocation sum must equal
     `p_amount_cents`. Unmatched (missing account/charge metadata) **fails
     closed** (`unmatched_payment`); the webhook does not guess charges.
   - `p_reference` — PaymentIntent id (`pi_…`).
   - `p_notes` — `stripe_event:<evt_id>`.
   - `p_issue_receipt` — `true`.
   - `p_idempotency_key` — `stripe:pi_<payment_intent_id>`.
   - `p_paid_at` — PaymentIntent `created` (unix seconds → timestamptz).
   - `p_source` — `provider` when the RPC accepts it (optional trailing argument
     defaulting to `manual` so existing admin record-payment calls stay unchanged).

   Allocations that exceed remaining `view_charge_net` headroom fail closed
   (`allocation_exceeds_net_due`). No unmatched / unapplied wallet.

5. **Events in scope.**
   - `payment_intent.succeeded` — `record_payment` as above.
   - `payment_intent.payment_failed` / `charge.failed` — ignore (`200` + stored
     ignored event). Do not insert a `payments` row with `status=failed`.
   - `charge.succeeded` — ignore. Money-in is booked only from the PaymentIntent
     so a paired charge event cannot double-allocate.
   - `refund.created` with `status=succeeded` — `record_payment_refund` for the
     refund amount, reason `stripe_refund`, `p_created_by=stripe_webhook`,
     payment located via `payment_processor_refs` on the PaymentIntent (or
     Charge) id. Out-of-order refund before the PI is booked → fail closed
     (`payment_not_found`) so Stripe retries.
   - `charge.refunded` — ignore if `refund.created` is the canonical refund
     event; do not invent a second refund path.
   - `charge.dispute.created` / `charge.dispute.closed` — ignore. Disputes are
     not auto-written to the ledger; operators use existing
     `POST /api/admin/billing/payment-refunds` after review.
   - Other event types — ignore (`200` `{ ok: true, ignored: true }`) after
     storing the event id so retries do not re-enter.

6. **Secrets.** `STRIPE_WEBHOOK_SECRET` lives in Render env and in
   `services/api/.env.example` as a **name only**. No Stripe secret key is
   required for inbound webhooks (payload is used after signature verify; the
   API does not call Stripe). Never commit values.

7. **Failure / residual risk.**
   - Missing/invalid/expired signature → `401` `invalid_signature` (no DB write).
   - Unset `STRIPE_WEBHOOK_SECRET` → `500` `stripe_webhook_not_configured`.
   - Missing `record_payment` function (`20260916174649` not applied) → `503`
     `record_payment_unavailable`. **Do not** use the admin sequential
     record-payment fallback.
   - Unmatched metadata, currency other than USD, allocation sum mismatch,
     amount ≤ 0 → `400` with a machine key; no payment row.
   - Replay / concurrent retries: event-id unique row plus `record_payment`
     idempotency key. Unique-violation on the event table replays the stored
     envelope.
   - Out-of-order refund: `400` `payment_not_found` (Stripe retries).
   - Amount vs `view_charge_net`: RPC rejects over-allocation; webhook returns
     that error and does not insert a partial payment.
   - Live webhook endpoint and production migrations stay unregistered /
     unapplied from this task.

### Consequences

- Card money-in from Stripe can land on the same atomic payment + allocation +
  receipt path as the front desk, without a staff key.
- Checkout / pay links are still missing; someone (operator or a later task)
  must set `tu_account_id` and `tu_charge_id` (or `tu_allocations`) on the
  PaymentIntent before it succeeds.
- Email/SMS receipt delivery is unchanged and still an open decision.
- `POST /api/admin/billing/record-payment` stays the staff path. This ADR does
  not remove its sequential fallback.
