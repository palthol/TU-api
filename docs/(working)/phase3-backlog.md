# Project Status and Next Work

This document is the current handoff note after Event Ledger Phase 1, Phase 2 high-impact DB views, and Phase 3 analytics DB scaffold.

## Estimated progress snapshot

- **Database:** ~70% complete for data + finance facts
- **API:** ~60% complete
- **Dashboard:** ~40% complete toward full command-center/workflow layer
- **Event causality / audit objective:** ~20-30% complete

## What was completed recently

### Event Ledger Phase 1

- Added a dedicated append-only event schema that captures business happenings from DB writes.
- This **does not replace** source-of-truth state tables (`participants`, `charges`, `subscriptions`, etc.).
- Core objects now exist:
  - `event_ledger`
  - `event_reason_codes`
  - `event_capture_config`
- Each event row captures:
  - identity (`id`, `occurred_at`, `event_name`, `event_category`)
  - primary target (`entity_type`, `entity_id`)
  - operational refs (nullable participant/account/subscription/charge/payment IDs)
  - context (`actor_type`, `actor_id`, `source_system`, `reason_code`, `correlation_id`)
  - payload snapshots (`payload_before`, `payload_after`, `payload_meta`)
- Append-only guarantee is enforced: `event_ledger` rejects `UPDATE` and `DELETE` via triggers.
- Current model is intentionally foundational. Some business actions currently appear as multiple low-level events.

### Phase 2 high-impact DB-only views

Added five high-impact operational/finance views to support day-to-day admin decisions:

1. `view_ops_today_sessions`
   - Day-of front desk logistics board (attendance counts and filled % from tracked attendance).
2. `view_ops_upcoming_access_issues`
   - Upcoming attendance risk queue (potential entitlement/override access blockers).
3. `view_ops_waiver_compliance_gaps`
   - Active participant compliance gaps (missing waiver, emergency contact, medical history).
4. `view_ops_ar_aging`
   - Collections prioritization with account + total rollup in AR aging buckets.
5. `view_ops_unallocated_or_partial_payment_risk`
   - Billing integrity cleanup queue (unallocated payments, partial allocations, overallocations).

These views are operational helpers for validation, risk detection, logistics, and cleanup.

---

## Next work focus

Priority sequence for upcoming phases:

1. Integrate Phase 2 + Phase 3 views into API (slugs + filters + pagination)
2. Integrate those API surfaces into dashboard analysis modules
3. Expand event-ledger context and timeline views
4. Final validation hardening and CI-level scenario coverage

---

# Phase 3 Backlog (Deferred from Phase 2)

This backlog captures deferred items after Phase 2 DB-only high-impact views.

---

## A) Deferred analytics views

Status: **Completed in DB scaffold** (migration `0012_phase3_analytics_views.sql`).

Next actions for analytics are integration-focused:

1. Expose analytics slugs in API reporting whitelist.
2. Add date-range and pagination support where applicable.
3. Add dashboard analysis modules and drill-downs for each analytics view.

---

## B) API integration backlog

Status update:
- Reporting slug mappings for Phase 2 + Phase 3 views are scaffolded.
- Generic reporting query controls (`limit`, `offset`, `sort`, `order`, `start`, `end`) are scaffolded.

Next API tasks:

1. Add stronger per-view filter support beyond generic controls where needed:
   - `services/api/src/routes/admin/reporting.js`
2. Add timeline/reporting endpoints for event-ledger use cases:
   - participant timeline
   - account finance timeline

---

## C) Dashboard integration backlog

Status update:
- Analysis panel now includes Phase 2 + Phase 3 view slugs.
- Generic query controls for reporting are scaffolded in DataExplorer.

Next dashboard tasks:

1. Add focused drill-down actions:
   - participant profile from access/compliance rows
   - account AR detail from aging rows
2. Add risk triage UX:
   - status/owner notes (if workflow table is introduced)

---

## D) Event-ledger follow-up

1. Add API middleware to set DB context:
   - `app.source_system`
   - `app.reason_code`
   - `app.correlation_id`
2. Add timeline-ready views:
   - `view_participant_event_timeline`
   - `view_finance_event_timeline`
3. Expand trigger capture to correction-centric tables:
   - `charge_adjustments`
   - `payment_refunds`
   - `class_charge_links`

---

## E) Validation hardening

1. Build fixture-driven SQL test packs for:
   - AR boundary dates
   - partial/over allocations
   - entitlement/override race scenarios
2. Add CI checks to execute critical validation SQL scripts on preview DB.
