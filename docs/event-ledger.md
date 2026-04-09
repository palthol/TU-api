# Event Ledger (Foundation)

This document defines how to interpret and query the event ledger introduced in `supabase/migrations/0010_event_ledger_foundation.sql`.

---

## 1) Purpose

The event ledger is an append-only history of business happenings captured from database writes.

It is intended to support:
- participant timeline reconstruction,
- finance timeline reconstruction,
- cause-vs-state interpretation,
- future automation and workflow orchestration.

It does not replace the source-of-truth tables (`participants`, `charges`, `subscriptions`, etc.).  
Those tables store state and facts; the ledger stores historical events.

---

## 2) Core Objects

- `public.event_ledger`
  - append-only event rows.
- `public.event_reason_codes`
  - controlled cause vocabulary (optional reason assignment).
- `public.event_capture_config`
  - per-table capture toggle/settings for phase-1 tracked tables.

---

## 3) Event Row Semantics

Each row in `event_ledger` represents one captured event:

- **Identity**
  - `id`, `occurred_at`, `event_name`, `event_category`
- **Primary target**
  - `entity_type`, `entity_id`
- **Operational references (nullable)**
  - `participant_id`, `account_id`, `subscription_id`, `charge_id`, `payment_id`
- **Context**
  - `actor_type`, `actor_id`, `source_system`, `reason_code`, `correlation_id`
- **Payload snapshots**
  - `payload_before` (for update/delete)
  - `payload_after` (for insert/update)
  - `payload_meta` (capture metadata)

### Append-only guarantee

`event_ledger` rejects all `UPDATE` and `DELETE` operations via DB triggers.

---

## 4) Trigger Capture (Phase 1)

Phase-1 trigger capture covers:

- `participants`
- `subscriptions`
- `charges`
- `payments`
- `payment_allocations`
- `waivers`
- `attendance_records`

### Event name taxonomy (phase 1)

Examples:

- Participants:
  - `participant.created`
  - `participant.updated`
  - `participant.deleted`
- Subscriptions:
  - `subscription.created`
  - `subscription.updated`
  - `subscription.deleted`
  - `subscription.status_changed`
- Charges:
  - `charge.created`
  - `charge.updated`
  - `charge.deleted`
  - `charge.status_changed`
- Payments:
  - `payment.created`
  - `payment.updated`
  - `payment.deleted`
  - `payment.status_changed`
- Payment allocations:
  - `payment_allocation.created`
  - `payment_allocation.updated`
  - `payment_allocation.deleted`
- Waivers:
  - `waiver.created`
  - `waiver.updated`
  - `waiver.deleted`
- Attendance:
  - `attendance_record.created`
  - `attendance_record.updated`
  - `attendance_record.deleted`

---

## 5) Reason Codes (Cause Layer)

`reason_code` is the controlled cause field (not freeform tags).

Seeded codes:
- `non_payment`
- `manual_cancellation`
- `upgrade_conversion`
- `data_correction`
- `manual_writeoff`
- `refund_adjustment`
- `merge_correction`

Reason codes are currently supplied via DB context setting (`app.reason_code`) when available. If missing/unknown, `reason_code` is null.

---

## 6) Query Patterns

### Participant timeline

```sql
select
  occurred_at,
  event_name,
  event_category,
  entity_type,
  entity_id,
  reason_code,
  payload_before,
  payload_after
from public.event_ledger
where participant_id = '<participant_uuid>'::uuid
order by occurred_at desc
limit 200;
```

### Finance timeline by account

```sql
select
  occurred_at,
  event_name,
  account_id,
  charge_id,
  payment_id,
  reason_code
from public.event_ledger
where account_id = '<account_uuid>'::uuid
  and event_category = 'billing'
order by occurred_at desc
limit 200;
```

### Charge-centric causality

```sql
select
  occurred_at,
  event_name,
  payload_before->>'status' as before_status,
  payload_after->>'status' as after_status,
  reason_code
from public.event_ledger
where charge_id = '<charge_uuid>'::uuid
order by occurred_at asc;
```

---

## 7) Operational Notes

- This is a foundation ledger, not a complete business-event ontology yet.
- Some business actions are represented by multiple low-level events (for example, a conversion may emit subscription + charge events).
- Use `correlation_id` and `reason_code` to improve causality stitching as API context propagation is expanded.
- For scenario testing, use:
  - `docs/(working)/event-ledger-validation-scenarios.sql`

---

## 8) Next Step Recommendations

1. Add API middleware to set DB session context (`app.source_system`, `app.reason_code`, `app.correlation_id`) per request.
2. Add timeline views:
   - `view_participant_event_timeline`
   - `view_finance_event_timeline`
3. Expand capture to correction-heavy tables:
   - `charge_adjustments`, `payment_refunds`, `class_charge_links`, `affiliate_*`.
