# Scheduling v2 plan (lanes A0+)

This repository owns the **backend** for scheduling. Front-ends live in sibling repos.

## Route namespaces (new)

- Admin (staff): `/api/admin/scheduling-v2/*` (same `requireAdmin` gate as other admin routes: `x-admin-key` **or** cookie session + CSRF origin; existing RBAC role matrix)
- Member (authenticated later): `/api/member/*` (Bearer auth, Terpsichora JWT verification in A4)
- Calendar (public + authenticated later): `/api/calendar/*` (Bearer auth optional later)

## Lanes

- **A0 (scaffolding only)**: mount new routers once, add `gymTime` NY-time helpers, expand stable error key status map, accept comma-separated CORS origins, add stub routers + tests. No migrations. Shipped in PR #55.
- **A1 (first slice, this PR)**: combined `classes` table (name, instructor, ISO weekday, weekly recurrence, America/New_York start time, duration, capacity, active flag) with admin CRUD and a public 14-day occurrence listing. No booking. Separate `class_types` / `instructors` tables remain future work; those stub routes stay `501`.
- **A2 (landed)**: Eastern-time correctness in `generate_sessions` (America/New_York wall-clock → UTC with DST) and idempotent session cancel. No repair SOP: production has no generated sessions. See the A2 contract below.
- **A3**: `session_content` (notes + HTTPS video link + visibility: staff/members/public; default staff).
- **A4**: member login via Terpsichora Supabase magic-link JWT (separate Supabase project from TU-api). Verify against Terpsichora JWKS/issuer configured by env.
- **A5–A10**: follow-on lanes per the scheduling plan (defined in their task briefs).

## A1 contract (landed)

- Migration `20261101100000_scheduling_v2_classes.sql` (in-repo only; **not** applied to production by this work).
- Admin: `GET/POST /api/admin/scheduling-v2/classes`, `GET/PATCH/DELETE /api/admin/scheduling-v2/classes/:classId`.
- Public: `GET /api/calendar/occurrences` — active weekly classes expanded for the next 14 gym-local calendar days. Already-ended occurrences and spring-forward nonexistent wall times are omitted. Capacity is returned; there is no booked count and no booking endpoint.
- `start_time` is **America/New_York wall-clock**. Conversion to UTC uses `gymTime` (earlier instant on fall-back).
- `day_of_week` is ISO-8601 (`1` = Monday … `7` = Sunday). `recurrence` is `weekly` only.

Full HTTP shapes: [admin-api.md](../admin-api.md) § Scheduling v2.

## A2 contract (landed)

- Migration `20261101100500_scheduling_v2_eastern_time_and_cancel_idempotency.sql` (in-repo only; **not** applied to production by this work).
- `schedule_templates.start_time` is **America/New_York wall-clock** on the requested calendar date. `generate_sessions` stores `starts_at` / `ends_at` as UTC. Conversion matches `services/api/src/lib/gymTime.js`:
  - A repeated civil time (fall-back) uses the **earlier** instant. `2026-11-01 01:30` → `2026-11-01T05:30:00Z`.
  - A nonexistent civil time (spring-forward) is omitted. `2027-03-14 02:30` creates no session and is not included in `skipped_count`.
  - `ends_at` is `starts_at` plus `duration_minutes` of elapsed time.
- The date arguments stay inclusive calendar dates (`YYYY-MM-DD`). Weekday matching is still ISO-8601 (`1` = Monday … `7` = Sunday). Retries still skip an existing `(schedule_template_id, starts_at)` row, including a cancelled one.
- `cancel_session(uuid)` (`service_role` only) soft-cancels a session and appends one `event_ledger` row: `session.cancelled`, category `system`, reason `manual_cancellation`.
- Cancelling an already-cancelled session returns success. It does not change `cancelled_at` or `updated_at`, and it does not append another event. A direct `UPDATE` that only moves `cancelled_at` is the same no-op. Other column edits still apply and keep the original `cancelled_at`.
- Unknown ids raise `session_not_found`. Clearing `cancelled_at` still uncancels; a later cancel is a new cancellation and appends one new event.
- HTTP shape is unchanged. `PATCH /api/admin/scheduling/sessions/:sessionId` with `{ "cancel": true }` calls `cancel_session` on the first cancel and returns the existing row on a repeat. Response remains `{ "ok": true, "session": { ... } }`.
- No stored-session repair. Apply this migration before deploying the API revision that calls `cancel_session`.

## Stable error keys (reserved)

These keys are pre-registered in the API error mapper with explicit HTTP statuses so
front-ends can rely on stable behavior:

- `class_type_not_found`
- `class_not_found`
- `instructor_not_found`
- `session_not_found`
- `session_full`
- `booking_closed`
- `no_credit`
- `late_cancel`
- `already_booked`
- `not_booked`
- `unauthorized_member`

## Reserved migration timestamps (future PRs only)

A1 consumed its reserved timestamp. Remaining timestamps stay reserved so parallel
PRs do not collide. All timestamps are **after** `20261003045729`.

- **A1**: `20261101100000_scheduling_v2_classes.sql` (landed; originally reserved as `class_types_instructors`)
- **A2**: `20261101100500_scheduling_v2_eastern_time_and_cancel_idempotency.sql` (landed)
- **A3**: `20261101101000_scheduling_v2_session_content.sql`
- **A4**: `20261101101500_scheduling_v2_member_auth_projection.sql`
- **A5**: `20261101102000_scheduling_v2_lane_a5.sql`
- **A6**: `20261101102500_scheduling_v2_lane_a6.sql`
- **A7**: `20261101103000_scheduling_v2_lane_a7.sql`
- **A8**: `20261101103500_scheduling_v2_lane_a8.sql`
- **A9**: `20261101104000_scheduling_v2_lane_a9.sql`
- **A10**: `20261101104500_scheduling_v2_lane_a10.sql`
