# Phase 2 High-Impact Views (DB-Only)

This document describes the five Phase 2 operational/finance views added in:

- `supabase/migrations/0011_phase2_high_impact_ops_finance_views.sql`

---

## 1) `view_ops_today_sessions`

### Why
Day-of logistics board for front desk operations.

### Inputs
- `sessions`
- `attendance_records`

### Outputs (key)
- `session_id`, `starts_at`, `ends_at`, `session_label`
- `tracked_attendee_count`
- `present_count`, `no_show_count`, `cancelled_count`
- `filled_percent`

### Interpretation caveat
- `filled_percent` is computed as `present_count / tracked_attendee_count`.
- It is a **tracked-attendance utilization proxy**, not true capacity utilization (no explicit session capacity field exists yet).

---

## 2) `view_ops_upcoming_access_issues`

### Why
Queue of upcoming attendance rows that may be blocked by entitlement constraints.

### Inputs
- `attendance_records`
- `sessions`
- `participant_entitlement_status`
- `access_overrides`
- `participants`

### Outputs (key)
- `participant_id`, `participant_name`
- `session_id`, `next_session_starts_at`, `session_label`
- `entitlement_remaining`, `has_availability`, `override_active`
- `potential_access_issue`, `issue_reason`

### Interpretation caveat
- This is a **risk detector**, not final truth. Entitlement and override context can change before session start.
- It currently looks at the next 14 days of scheduled attendance rows.

---

## 3) `view_ops_waiver_compliance_gaps`

### Why
Operational compliance queue for active participants missing legal/medical records.

### Inputs
- `subscriptions` (active participants)
- `participants`
- `waivers`
- `emergency_contacts`
- `waiver_medical_histories`

### Outputs (key)
- `account_id`, `participant_id`, `participant_name`, `participant_email`
- `waiver_count`, `latest_waiver_at`
- `emergency_contact_count`, `medical_history_count`
- `missing_waiver`, `missing_emergency_contact`, `missing_medical_history`
- `has_compliance_gap`

### Interpretation caveat
- Medical coverage is inferred from waiver-linked records; multiple waivers can affect counts.

---

## 4) `view_ops_ar_aging`

### Why
Collections prioritization by account and total rollup.

### Inputs
- `charges`
- `view_charge_net`
- `payment_allocations`

### Outputs (key)
- `scope` (`account` or `total`)
- `account_id`
- `open_item_count`
- `total_outstanding_cents`
- `bucket_0_30_cents`, `bucket_31_60_cents`, `bucket_61_90_cents`, `bucket_90_plus_cents`

### Interpretation caveat
- Bucket logic uses `days_past_due = max(current_date - due_at, 0)`.
- Bucket `0-30` includes not-yet-overdue items (current bucket), which is common for AR board workflows.

---

## 5) `view_ops_unallocated_or_partial_payment_risk`

### Why
Billing integrity cleanup queue.

### Inputs
- `payments`
- `payment_allocations`
- `charges`
- `subscriptions`
- `view_charge_net`

### Outputs (key)
- `risk_type`:
  - `payment_unallocated`
  - `charge_partially_allocated`
  - `charge_overallocated`
- `account_id`, `participant_id`, `payment_id`, `charge_id`, `subscription_id`
- `amount_cents`, `allocated_cents`, `expected_cents`, `gap_cents`
- `due_at`, `days_past_due`
- `risk_context` (jsonb)

### Interpretation caveat
- `charge_overallocated` should be rare and is usually an operational/data integrity exception.

---

## Security and access behavior

All Phase 2 views are:
- `security_invoker = on`
- revoked from `public`
- granted `select` to `authenticated`

This matches current admin/reporting RLS access patterns.

---

## Validation artifact

Use:
- `docs/(working)/phase2-high-impact-views-validation.sql`

It includes:
- existence checks,
- smoke queries,
- bucket/risk sanity checks,
- edge-case checks for utilization and access-issue windows.
