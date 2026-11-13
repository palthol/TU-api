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
- **A3 (landed)**: `session_content` (staff notes + HTTPS video link + visibility: staff/members/public; default staff) attached to `sessions`. See the A3 contract below.
- **A4**: member login via Terpsichora Supabase magic-link JWT (separate Supabase project from TU-api). Verify against Terpsichora JWKS/issuer configured by env.
- **Staff booking (landed)**: staff-operated `bookings` on existing `sessions` rows. See the staff booking contract below. Weekly class occurrences are still expanded in the API and are not auto-materialized.
- **A5–A10**: follow-on lanes per the scheduling plan (defined in their task briefs). Member self-booking waits on A4.

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

## A3 contract (landed)

- Migration `20261101101000_scheduling_v2_session_content.sql` (in-repo only; **not** applied to production by this work).
- One `session_content` row per `sessions` row (`on delete cascade`). Columns: `notes` (staff-authored, distinct from `sessions.notes`), `video_url` (absolute `https` URL or null), `visibility` (`staff` | `members` | `public`, default `staff`).
- RLS is enabled. Table privileges are `service_role` only, matching `classes`. An authenticated admin policy is present and does not grant `anon` or `authenticated`.
- `http`, other schemes, whitespace, and URLs with userinfo fail the check constraint. The API normalizes a leading `HTTPS://` to `https://` and returns `invalid_video_url` before insert.
- Admin (existing `requireAdmin` gate and scheduling RBAC): `GET /api/admin/scheduling-v2/session-content`, `GET/POST/PATCH/DELETE /api/admin/scheduling-v2/sessions/:sessionId/content`. v2 session stubs (`/sessions`, cancel) stay `501`.
- Missing session → `session_not_found`. Missing content on a real session → `content_not_found`. A second create → `already_exists`.
- `members` is stored and returned to staff. It is not served on any member route (A4). The public calendar reads `visibility = public` only.
- `GET /api/calendar/occurrences` adds `content` (`notes`, `video_url`, `visibility: "public"`) when exactly one non-cancelled session shares that occurrence's UTC `starts_at` and its `session_label` equals the class `name`. Staff content, members content, cancelled sessions, and ambiguous matches are omitted (no `content` key). Optional Bearer auth does not unlock `members`.
- Apply this migration before deploying the API revision that reads `session_content`. The public occurrence list queries that table.

## Class description and session link

- Migration `20261113175150_scheduling_v2_class_description_and_session_link.sql` (in-repo only; **not** applied to production by this work). This is not one of the reserved A4–A10 filenames.
- `public.classes` already exists from A1. This migration does not replace that weekly catalog. It adds optional `description` and keeps `duration_minutes` as the default duration (1–1440). `name`, `instructor`, `capacity`, `is_active`, `created_at`, and `updated_at` stay as they are.
- `sessions.class_id` is a nullable foreign key to `classes` with `ON DELETE SET NULL`. Existing sessions stay valid with `class_id` null. Deleting a class unlinks its sessions and does not delete them.
- RLS on `classes` stays enabled. Table privileges are `service_role` only, matching `session_content`. The authenticated `admin_all_classes` policy does not grant `anon` or `authenticated`.
- `preserve_session_cancelled_at` treats `class_id` as an other-column edit. Linking a cancelled session still applies and does not move `cancelled_at`.
- Admin CRUD stays on the existing gate: `GET/POST /api/admin/scheduling-v2/classes`, `GET/PATCH/DELETE /api/admin/scheduling-v2/classes/:classId`. `description` is optional (trimmed, 1–2000, blank stores null).
- The persisted session link is on the existing v1 session routes (`POST` / `PATCH /api/admin/scheduling/sessions`). `class_id` is optional. Omitting it leaves current create behavior, with `class_id: null` on the response. v2 `/sessions` stubs stay `501`.
- Public: `GET /api/calendar/classes` lists active classes only. It uses the same rate-limit env knobs as occurrences, with a separate counter.
- Apply this migration before deploying an API build that selects `sessions.class_id`.

## Staff booking contract (landed)

This slice books against **existing `sessions` rows**, not computed class occurrences. Staff create or generate a session (v1 `POST /api/admin/scheduling/sessions` or `generate_sessions`) and may set `class_id`. Materializing the 14-day occurrence list into `sessions` is a later generator; it is not required to store a booking once a session row exists.

- Migration `20261113190000_scheduling_v2_bookings.sql` (in-repo only; **not** applied to production by this work). Filename is after `20261113175150` and outside the reserved A4–A10 timestamps.
- `public.bookings` links `session_id` + `participant_id`. Statuses: `booked`, `waitlisted`, `cancelled`, `late_cancelled`, `attended`, `no_show`. One active row per participant per session (`booked` / `waitlisted` / `attended` / `no_show`). Cancelled rows stay as history; the participant may rebook.
- Seat cap is `sessions.capacity` when set, otherwise `classes.capacity`. Neither set → `capacity_not_configured`. Occupying statuses are `booked`, `attended`, and `no_show`. A full session waitlists new bookings in FIFO (`created_at`, `id`).
- `book_session`, `cancel_booking`, `check_in_booking`, and `mark_booking_no_show` are `service_role` execute-only. They lock the session row so concurrent books and cancel+promote do not overfill. This slice writes **no charges and no credit holds**. Statuses are the later hook: booked/promoted → hold, attended → consume, cancelled → release, late_cancelled / no_show → penalty or consume.
- Cancel more than 3 **elapsed** hours before `starts_at` is `cancelled`. At or inside 3 hours (including exactly 3h) is `late_cancelled`. Both free the spot. `starts_at` is timestamptz, so DST is already encoded; do not subtract gym-local wall-clock hours. Cancelling a booked row auto-promotes the oldest waitlisted row. Cancelling a waitlisted row does not.
- Check-in marks `attended`. No-show is allowed at or after `starts_at` and does not promote the waitlist.
- Admin (existing `requireAdmin` gate and scheduling RBAC: owner and `front_desk` write, `finance` read-only): `GET/POST /api/admin/scheduling-v2/sessions/:sessionId/bookings`, `POST /api/admin/scheduling-v2/bookings/:bookingId/cancel`, `.../check-in`, `.../no-show`. No public or member booking routes. v2 `/sessions` stubs stay `501`. Optional `sessions.capacity` is accepted on the existing v1 session create/patch.
- RLS on `bookings` matches `session_content`: enabled, `service_role` DML only, authenticated admin policy does not grant `anon` or `authenticated`.
- Apply this migration before deploying an API build that calls `book_session` / `cancel_booking` / `check_in_booking` / `mark_booking_no_show` or selects `sessions.capacity`.

Rollback (in-repo only; do not run against production from this work): drop the four RPCs and helpers, drop `public.bookings`, drop `sessions.capacity`, restore `preserve_session_cancelled_at` to the `20261113175150` body (no `capacity` compare).

## Stable error keys (reserved)

These keys are pre-registered in the API error mapper with explicit HTTP statuses so
front-ends can rely on stable behavior:

- `class_type_not_found`
- `class_not_found`
- `instructor_not_found`
- `session_not_found`
- `content_not_found`
- `session_full`
- `booking_closed`
- `no_credit`
- `late_cancel`
- `already_booked`
- `not_booked`
- `booking_not_found`
- `participant_not_found`
- `capacity_not_configured`
- `unauthorized_member`

## Reserved migration timestamps (future PRs only)

A1 consumed its reserved timestamp. Remaining timestamps stay reserved so parallel
PRs do not collide. All timestamps are **after** `20261003045729`.

- **A1**: `20261101100000_scheduling_v2_classes.sql` (landed; originally reserved as `class_types_instructors`)
- **A2**: `20261101100500_scheduling_v2_eastern_time_and_cancel_idempotency.sql` (landed)
- **A3**: `20261101101000_scheduling_v2_session_content.sql` (landed)
- **A4**: `20261101101500_scheduling_v2_member_auth_projection.sql`
- **A5**: `20261101102000_scheduling_v2_lane_a5.sql`
- **A6**: `20261101102500_scheduling_v2_lane_a6.sql`
- **A7**: `20261101103000_scheduling_v2_lane_a7.sql`
- **A8**: `20261101103500_scheduling_v2_lane_a8.sql`
- **A9**: `20261101104000_scheduling_v2_lane_a9.sql`
- **A10**: `20261101104500_scheduling_v2_lane_a10.sql`

Class description and the nullable session link shipped as `20261113175150_scheduling_v2_class_description_and_session_link.sql`. That filename is outside the reserved A4–A10 block so those lanes can still use their timestamps.
