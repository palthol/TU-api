# API-PAY-001 — Payment-provider integration

- Status: **done**
- Lane: integrations
- Depends on: API-HARD-001 (done), API-AUTH-001 (done)
- Production writes: no
- Branch from: `develop` as `agent/API-PAY-001-payments`

## Agent prompt

Design webhook → atomic payment/allocation/receipt mapping, then implement only
after the design is in `docs/decision-log.md`. Do not implement a provider until
that ADR answers provider choice, idempotency, signature verify, and mapping to
`record_payment`. No service-role key in browsers.

## Read first

- `docs/admin-api.md` — `POST /api/admin/billing/record-payment`
- `supabase/migrations/20260916174649_record_payment_rpc.sql`
- `services/api/src/routes/admin/billing.js` (record-payment handler)
- `docs/decision-log.md` (API-ADR-004, API-ADR-005)
- `docs/reviewer-guide.md` (P0 finance duplication; P1 non-transactional multi-write)
- `docs/finance-subsystem-design.md`
- `docs/archive/infrastructure-additions-checklist.md` §2.1 (historical Stripe sketch, not a lock)

## Phase A — design (commit first)

Append an ADR to `docs/decision-log.md`. Close the **payment** part of the open
“Payment, email, and SMS providers” decision only. The ADR must answer:

1. **Provider** — pick one. Record why, and what is out of scope (email/SMS,
   member pay links, Checkout UI, sibling-app changes).
2. **Trust boundary** — webhook is a **public** route, not `/api/admin/*`.
   Verify provider signatures. Staff `x-admin-key` does not authenticate the
   provider. No `SUPABASE_SERVICE_ROLE_KEY` or `ADMIN_API_KEY` in browsers or
   `VITE_*`.
3. **Idempotency** — stable key for `record_payment`’s `p_idempotency_key`
   (max 200 chars). Duplicate webhook / retry must replay `{ payment_id, receipt_id }`
   and insert no second payment, allocation, or receipt. Same key with a
   different account, amount, or method → `409` `idempotency_key_conflict`.
   Store provider event ids so already-processed events can be ignored.
4. **Mapping to `record_payment`** — how the payload becomes `p_account_id`,
   `p_amount_cents` (integer cents), `p_method` (`cash|card|cashapp|venmo|paypal|zelle|other`;
   card-processor success → `card`), `p_issued_by` (webhook actor label, not a
   spoofable body field), `p_allocations` (which `charge_id`s; unmatched payments
   fail closed), `p_reference` / `p_notes` / `p_issue_receipt`, `p_idempotency_key`.
5. **Events in scope** — succeeded payment vs failed / refunded / disputed.
   Refunds already have `record_payment_refund`; do not invent a second refund
   path unless the ADR says webhook refunds call that RPC.
6. **Secrets** — signing secret and provider keys live in platform env (Render)
   and `services/api/.env.example` **names only**. Never commit values.
7. **Failure / residual risk** — unsigned requests, replay, out-of-order events,
   amount mismatch vs `view_charge_net`, missing production migration
   `20260916174649`. Webhook handler must fail closed; do not use the sequential
   record-payment fallback for provider webhooks.

Also update `docs/finance-subsystem-design.md` and `docs/admin-api.md` for the
intended contract.

## Phase B — implement (only after Phase A is on the branch)

Expected shape (refine in the ADR, do not ignore it):

- Public `POST` webhook (archived sketch: `POST /api/webhooks/stripe` if Stripe
  is chosen).
- Signature verify before any DB write.
- Optional processor-ref table for provider object ids; forward-safe, idempotent
  SQL. Use `supabase migration new`; version must sort after `20260916174649`.
  Do not reuse `0021`–`0024`.
- Service-role call to `record_payment` only (no sequential payment/allocation/receipt
  inserts).
- Money remains integer cents; allocations must not exceed remaining
  `view_charge_net` headroom; envelope stays `{ ok: true, ... }` /
  `{ ok: false, error: "<machine_key>" }`.

## Allowed paths

- `docs/decision-log.md`, `docs/finance-subsystem-design.md`, `docs/admin-api.md`,
  `docs/current-state.md`
- `services/api/.env.example` (env **names** only)
- webhook route + tests + migrations under `services/api/src/` and
  `supabase/migrations/`
- Shared queue files

## Out of scope

- Production `supabase db push` or live webhook registration
- Sibling UIs (`admin`, `TU-Signup`, marketing)
- Member-facing pay links / Checkout / customer portal
- Email or SMS receipt delivery
- Changing existing `POST /api/admin/billing/record-payment` except docs that
  point at the webhook
- Flipping any other queue task to `ready`

## Acceptance

- Design answers: provider, idempotency key, mapping to `record_payment` RPC
- Duplicate webhook does not double-allocate
- Secrets stay in platform env, not git
- API suite + new webhook tests pass
- `docs/current-state.md` records what is implemented vs unverified in production
