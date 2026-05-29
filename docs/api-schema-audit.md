# API ↔ Supabase schema audit (live verification)

**Date:** 2026-05-29  
**Product map:** See [api-capability-audit.md](./api-capability-audit.md) for notifications, finance, and scheduling vs API coverage and phased roadmap.  
**Project:** Temple Underground — Supabase `jhxzecxkccqlgyazhsnb` (production, live traffic)
**Audited API:** `services/api` (this repo — the deployed admin/waiver API)
**Method:** Live introspection of the production database (tables, views, functions,
columns, check constraints) cross-checked against every route in
`services/api/src/routes/**` and the services/lib it calls.

> This is the authoritative API repo. The `admin/` repo's `services/api` scaffold was
> retired in favor of this service — do not re-introduce a second backend.

---

## TL;DR

The API code is **structurally aligned** with the database: every RPC it calls, every
view it reads, and every column it writes exists in the live schema with matching names,
types, and check-constraint vocabularies — **with one exception that breaks 6 endpoints**:

> **The live database is migrated through `0016`. The repo contains `0017`, `0018`, and
> `0019`, which are committed but NOT applied to production.** The API already depends on
> the objects those migrations create.

Apply `0017`–`0019` and the API and schema are fully in sync. No code changes are
required for alignment.

---

## 1. Migration drift (the headline finding)

`list_migrations` on the live project returns `0001`–`0016`. The repo's
`supabase/migrations/` folder contains three more that have never been pushed:

| Migration | Creates | API code that depends on it |
| --- | --- | --- |
| `0017_personal_finance_entries.sql` | table `personal_finance_entries` (+ checks, RLS, indexes) | `billing.js`: `POST/GET /billing/personal-finance-entries`, `POST .../:id/invoice-status` |
| `0018_fix_private_schema_grants_for_event_capture.sql` | `grant usage on schema private` + execute grants to `service_role` for event-capture functions | waiver submission path (`participants` INSERT → event-capture trigger → `private.*`) |
| `0019_charge_discounts.sql` | table `charge_discounts`, trigger `charge_discounts_set_applied_amount()`, discount-aware rewrite of `view_charge_net`, total-guard triggers, `charges.amount_cents` lock trigger | `billing.js`: `GET/POST /billing/charge-discounts` (and the discount line in the receipts "Formal billing" tab) |

### Impact while unapplied

- **`personal_finance_entries` does not exist** → the Cash log, Invoice, and Recent tabs
  of the receipts app fail (PostgREST `relation does not exist`). These are the 3 primary
  receipts workflows.
- **`charge_discounts` does not exist** → the "Apply discount line" action and the
  discount list in Formal billing fail.
- **`view_charge_net` is the pre-discount version** (`gross − affiliate credits −
  write-offs`). Until `0019`, discounts cannot reduce net due even if the table existed.
- **`0018` grants**: production waivers are currently submitting successfully and
  `event_ledger` is growing, so these grants appear to already be in place in prod
  (likely applied out-of-band). Treat `0018` as **verify-then-apply** — it is idempotent
  (`grant` statements), so re-applying is safe.

### Remediation

Apply in order, then regenerate any generated types (this API is plain JS, so there are
no TypeScript DB types to regenerate here):

```bash
# from repo root, with the project linked
npm run supabase:push        # supabase db push — applies 0017, 0018, 0019
```

Or apply individually via the Supabase MCP `apply_migration` tool (one migration per
call, in numeric order). All three are idempotent (`create table if not exists`,
`create or replace`, `grant`).

**Post-apply verification:**

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('personal_finance_entries','charge_discounts');
-- expect 2 rows

select column_name from information_schema.columns
where table_schema='public' and table_name='view_charge_net' and column_name='net_due_cents';
-- expect net_due_cents to now subtract discount_cents (see 0019 view body)
```

---

## 2. Endpoint-by-endpoint alignment

Legend: **OK** = exists & matches; **BLOCKED** = correct code, blocked only by the
unapplied migration above.

### Billing (`routes/admin/billing.js`)

| Endpoint | DB objects | Status |
| --- | --- | --- |
| `POST /billing/external-counterparty-accounts` | `accounts` (insert; `status='active'`) | OK — `accounts.status` check allows `active`/`inactive` |
| `GET /billing/charge-discounts` | `charge_discounts` | BLOCKED (0019) |
| `POST /billing/charge-discounts` | `charge_discounts` (+ `view_charge_net`) | BLOCKED (0019) — see §3 note on `applied_amount_cents` |
| `POST /billing/charge-adjustments` | `charge_adjustments` | OK — `adjustment_type='write_off'`, `amount_cents>0` match checks |
| `POST /billing/payment-refunds` | RPC `record_payment_refund(p_payment_id,p_amount_cents,p_reason,p_created_by,p_idempotency_key)` | OK — signature matches exactly |
| `POST /billing/subscription-upgrade` | RPC `upgrade_subscription_prorated(...)` | OK |
| `POST /billing/per-class/charge-from-attendance` | RPC `create_pay_per_class_charge(p_attendance_id,p_due_at,p_notes,p_created_by)` | OK |
| `POST /billing/per-class/upgrade-to-monthly` | RPC `upgrade_per_class_to_monthly(...)` | OK |
| `POST /billing/record-payment` | `charges`, `payments`, `payment_allocations`, `receipts`, `view_charge_net` | OK — see §3 atomicity caveat |
| `POST /billing/receipts/:id/void` | `receipts` (soft void) | OK |
| `POST /billing/receipts/issue-for-refund` | `payment_refunds`, `payments`, `receipts` | OK — satisfies `check_receipt_kind_refs` (money_out_refund needs payment_id + payment_refund_id) |
| `GET /billing/marketing-leads` | `marketing_leads` | OK |
| `GET/POST /billing/operating-expenses` | `operating_expenses` | OK — `category in (rent,utilities,other)` matches |
| `POST /billing/personal-finance-entries` | `personal_finance_entries` | BLOCKED (0017) |
| `GET /billing/personal-finance-entries` | `personal_finance_entries` | BLOCKED (0017) |
| `POST /billing/personal-finance-entries/:id/invoice-status` | `personal_finance_entries` | BLOCKED (0017) |

### Participants (`routes/admin/participants.js`)

| Endpoint | DB objects | Status |
| --- | --- | --- |
| `GET /participants/search` | `participants`, `account_members`, `accounts` | OK — preferred-account logic uses roles `payer`/`guardian` which match `check_account_member_role` |
| `POST /participants/merge` | RPC `merge_participants(p_canonical_participant_id,p_duplicate_participant_id)` | OK |

### Reporting (`routes/admin/reporting.js`, `lib/reportingViewQuery.js`)

| Endpoint | DB objects | Status |
| --- | --- | --- |
| `GET /reporting/views/:slug` | 19 whitelisted views | OK — all 19 slugs resolve to existing views |
| `GET /reporting/summary/primary-kpis` | `view_analytics_primary_kpis_monthly` | OK — selected columns exist |
| `GET /finance/monthly-summary` | `view_analytics_revenue_waterfall_monthly`, `operating_expenses` | OK — `net_cash_collected_cents`, `month_start` exist |

All 19 reporting-view slugs were confirmed present in the live DB:
`view_analytics_primary_kpis_monthly`, `view_member_payment_board`,
`view_member_payment_reminders`, `view_orphan_waivers`, `view_orphan_waiver_summary`,
`view_charge_net`, `view_waiver_documents`, `participant_entitlement_status`,
`view_ops_today_sessions`, `view_ops_upcoming_access_issues`,
`view_ops_waiver_compliance_gaps`, `view_ops_ar_aging`,
`view_ops_unallocated_or_partial_payment_risk`,
`view_analytics_revenue_waterfall_monthly`, `view_analytics_subscription_movement`,
`view_analytics_attendance_utilization_weekly`, `view_analytics_entitlement_burn`,
`view_analytics_affiliate_program_performance`, `view_analytics_data_hygiene`.

### Waivers / viewer / public

| Endpoint | DB objects | Status |
| --- | --- | --- |
| `POST /api/lead` | `marketing_leads` | OK |
| `POST /api/waivers/submit` | `participants`, `accounts`, `account_members`, `waivers`, `emergency_contacts`, `waiver_medical_histories`, `audit_trails`, storage buckets, event ledger | OK — all insert payload columns exist |
| `GET /api/admin/waivers` | `view_waiver_documents` | OK — selected columns exist |
| `GET /api/admin/waivers/:id` | `waivers`, `audit_trails` + signed storage URLs | OK |
| `GET /api/viewer/waiver-documents` | `view_waiver_documents` (Cloudflare Access) | OK |
| Discord notifications | `view_member_payment_reminders`, `marketing_leads` | OK — `reminder_bucket`, `name`, `actual_price`, etc. exist |

---

## 3. Notes & non-blocking observations

1. **`charge_discounts` `applied_amount_cents: 1` is intentional, not a bug.** `billing.js`
   inserts a placeholder `1`; migration `0019`'s `BEFORE INSERT` trigger
   `charge_discounts_set_applied_amount()` overwrites it server-side
   (flat = `least(gross, flat_amount_cents)`, percent = `floor(gross*bps/10000)`). The
   API then re-reads `view_charge_net.net_due_cents` for the response. **Do not "fix" the
   `1` to compute in JS** — that would double-handle the math and diverge from the DB
   source of truth.

2. **`record-payment` is not transactional.** It performs sequential inserts (payment →
   allocations → receipt) with per-step validation but no surrounding transaction. A
   failure after the payment insert can leave a payment with partial/no allocations or no
   receipt. Recommendation (future hardening, not an alignment issue): move the
   payment+allocations+receipt write into a single Postgres RPC (e.g. `record_payment(...)`)
   so it's atomic, mirroring `record_payment_refund`.

3. **Response envelope.** This API returns `200` with `{ ok: true, ... }` on success and
   `{ ok: false, error }` on failure. The receipts client (`adminFetch`) keys off
   `res.ok` (any 2xx) and reads `data.<field>` / `data.error`, so the envelope is
   consistent with the consumer. (The retired admin-repo spec described `201` for creates;
   the real API uses `200` — the design docs in the `admin/` repo reflect the real
   behavior.)

4. **Authorization model is correct.** `/api/admin/*` is gated by `x-admin-key`;
   `/api/viewer/*` uses Cloudflare Access JWT + email allowlist; the service uses the
   Supabase **service-role** client (bypasses RLS), so each route is responsible for its
   own authz. No admin route bypasses the key.

---

## 4. Data integrity snapshot (live, 2026-05-29)

Counts increased mid-audit (participants 5→7, waivers 8→10) confirming **live production
traffic**. Integrity checks were clean:

| Check | Result |
| --- | --- |
| participants | 7 |
| participants merged (`merged_into_participant_id` set) | 0 |
| participants with no `account_members` link | **0** (every participant is tethered to an account) |
| waivers | 10 |
| waivers with null `participant_id` | **0** |
| audit_trails | 10 |
| emergency_contacts / medical_histories | 8 / 10 |
| charges / payments / receipts | 0 / 0 / 0 (formal billing not yet exercised) |
| marketing_leads | 0 |
| event_ledger | 25 (append-only, growing) |

No orphaned, dangling, or merged-but-unresolved rows were found. The
`createOrBindParticipantAccount` tether in the waiver path is doing its job (0 unlinked
participants).

---

## 5. Action checklist

- [ ] **Apply migrations `0017`, `0018`, `0019`** to the live project (idempotent; see §1).
- [ ] Verify `personal_finance_entries` and `charge_discounts` exist and `view_charge_net`
      includes the discount term.
- [ ] Smoke-test the 6 previously-blocked endpoints against the live DB.
- [ ] (Optional hardening) Wrap `record-payment` writes in an atomic RPC.
- [ ] Update `docs/(working) schema-changes-and-admin-api-alignment.md` — it is pinned to
      migrations `0001–0012` and predates `0014–0019` (receipts, leads, expenses,
      personal finance, discounts).
