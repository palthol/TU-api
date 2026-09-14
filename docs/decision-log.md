# API decision log

Entries are append-only. Supersede an earlier decision by referencing its ID.

| ID | Date | Decision | Status |
| --- | --- | --- | --- |
| API-ADR-001 | 2026-09-03 | This repository is the only backend and canonical schema owner. | accepted |
| API-ADR-002 | 2026-09-03 | Production database writes require explicit task authorization. | accepted |
| API-ADR-003 | 2026-09-03 | Capability status uses verified, implemented, unwired, and missing. | accepted |
| API-ADR-004 | 2026-09-03 | Privileged multi-write operations should use transactional RPCs and idempotency where retryable. | accepted |
| API-ADR-005 | 2026-09-14 | Staff identity uses per-person hashed API keys and roles on the existing `x-admin-key` header; the shared env key remains an owner compatibility actor. | accepted |

## Open decisions

- Deployment and scheduling platform ownership.
- Payment, email, and SMS providers.
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
2. **Staff directory in Postgres** (`staff_users`, migration `0023`). Columns:
   email, display name, role (`owner` | `front_desk` | `finance`), SHA-256
   `key_hash`, `key_prefix`, `active`. Plaintext keys are shown once at create
   or rotate (`tu_sk_` + 32 random bytes hex). Hashes are never logged or
   returned. RLS is enabled; `anon` / `authenticated` have no write policies.
   `key_hash` has no SELECT policy for `authenticated` (service-role API only).
   The Express service-role client remains responsible for HTTP authorization.
3. **No half-open gate.** Missing/wrong key → `401 { ok: false, error: "unauthorized" }`.
   Authenticated but role-denied → `403 { ok: false, error: "forbidden" }`. There
   is no optional-key, “dev open admin”, or route that skips the gate. Unset
   `ADMIN_API_KEY` does not match an empty header. If `0023` is not applied,
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
- Production must not receive `0023` from this task. Until it is applied,
  only the shared key authenticates.
- `API-PAY-001` stays blocked until this task and `API-HARD-001` are both done.
- Sibling UIs are not changed in this repository.
