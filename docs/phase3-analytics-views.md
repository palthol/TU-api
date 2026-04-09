# Phase 3 Analytics Views (DB-Ready)

This document describes analytics views introduced by:

- `supabase/migrations/0012_phase3_analytics_views.sql`

These views are DB-ready analytics foundations. API slug exposure, filters/pagination, and dashboard wiring are intentionally deferred.

---

## 1) `view_analytics_revenue_waterfall_monthly`

### Purpose
Monthly finance waterfall to compare gross billings vs concessions vs refunds and cash outcomes.

### Sources
- `charges`
- `affiliate_credit_applications`
- `charge_adjustments`
- `payments`
- `payment_refunds`

### Key outputs
- `gross_charged_cents`
- `affiliate_credits_applied_cents`
- `write_off_cents`
- `net_billed_cents`
- `collected_cents`
- `refunded_cents`
- `net_cash_collected_cents`

### Caveats
- Uses charge period/month anchoring for billing components and payment/refund timestamp month for cash components.
- Useful for trend analysis, not full accrual accounting.

---

## 2) `view_analytics_subscription_movement`

### Purpose
Monthly movement by plan to track growth/churn-style signals.

### Sources
- `subscriptions`
- `plan_definitions`

### Key outputs
- `new_count`
- `cancelled_count`
- `paused_count`
- `expired_count`
- grouped by `month_start`, `plan_definition_id`

### Caveats
- Movement is inferred from state/timestamps (`starts_at`, `cancelled_at`, `updated_at`, `ends_at`).
- A dedicated event-timeline model can improve precision for lifecycle causality.

---

## 3) `view_analytics_attendance_utilization_weekly`

### Purpose
Weekly utilization/engagement snapshot combining attendance and private usage.

### Sources
- `sessions`
- `attendance_records`
- `private_usage`

### Key outputs
- `session_count`
- `tracked_attendance_count`
- `present_count`, `no_show_count`, `cancelled_count`
- `unique_participants`
- `private_minutes_used`
- `no_show_rate_percent`

### Caveats
- No explicit class capacity model yet, so this is attendance-tracking utilization (not seat-capacity utilization).

---

## 4) `view_analytics_entitlement_burn`

### Purpose
Current burn and risk visibility for entitlements by participant/plan.

### Sources
- `participant_entitlement_status`
- `subscriptions`
- `plan_definitions`
- `participants`

### Key outputs
- entitlement context (`scope`, `unit`, `limit_type`, `entitlement_limit`, `reset_rule`)
- usage and remaining (`sessions_used`, `minutes_used`, `remaining`)
- `usage_percent_of_limit`
- `overburn_risk`

### Caveats
- This is a current-state analytical view, not a historical weekly entitlement timeline.
- For strict longitudinal burn history, add a snapshot/materialization pipeline in a future phase.

---

## 5) `view_analytics_affiliate_program_performance`

### Purpose
Evaluate referral program outcomes and outstanding liability by referrer.

### Sources
- `affiliate_referrals`
- `affiliate_credits`
- `affiliate_credit_applications`
- `charges`
- `subscriptions`
- `participants`

### Key outputs
- `total_referral_count`
- `active_referral_count`
- `credits_earned_cents`
- `credits_applied_cents`
- `outstanding_credit_liability_cents`
- `last_credit_earned_at`

### Caveats
- Applied-credit attribution follows current charge/subscription linkage pattern.

---

## 6) `view_analytics_data_hygiene`

### Purpose
Participant-level hygiene queue to reduce ops friction and data quality drift.

### Sources
- `participants`
- `account_members`
- `view_orphan_waivers`

### Key outputs
- merge flags (`is_merged`, `merged_into_participant_id`)
- duplicate signals (`potential_duplicate_group_size` based on same email + DOB)
- orphan/no-link indicators
- missing contact indicators
- `hygiene_issue_score`

### Caveats
- Duplicate detection is heuristic and should be treated as a triage signal, not automatic merge criteria.

---

## Validation artifact

Use:
- `docs/(working)/phase3-analytics-views-validation.sql`

for smoke checks, equation sanity checks, bounds validation, and risk-shape checks.
