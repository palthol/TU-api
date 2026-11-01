# Scheduling v2 plan (lanes A0+)

This repository owns the **backend** for scheduling. Front-ends live in sibling repos.

## Route namespaces (new)

- Admin (staff): `/api/admin/scheduling-v2/*` (guarded by `x-admin-key` and existing RBAC role matrix)
- Member (authenticated later): `/api/member/*` (Bearer auth, Terpsichora JWT verification in A4)
- Calendar (public + authenticated later): `/api/calendar/*` (Bearer auth optional later)

## Lanes

- **A0 (scaffolding only)**: mount new routers once, add `gymTime` NY-time helpers, expand stable error key status map, accept comma-separated CORS origins, add stub routers + tests. No migrations.
- **A1**: class types + instructors (admin CRUD; calendar read surfaces).
- **A2**: Eastern-time correctness in `generate_sessions` (wall-clock → UTC with DST) and idempotent session cancel. No repair SOP needed: production has no generated sessions yet.
- **A3**: `session_content` (notes + HTTPS video link + visibility: staff/members/public; default staff).
- **A4**: member login via Terpsichora Supabase magic-link JWT (separate Supabase project from TU-api). Verify against Terpsichora JWKS/issuer configured by env.
- **A5–A10**: follow-on lanes per the scheduling plan (defined in their task briefs).

## Stable error keys (reserved)

These keys are pre-registered in the API error mapper with explicit HTTP statuses so
front-ends can rely on stable behavior:

- `class_type_not_found`
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

No migrations are included in A0, but timestamps are reserved so parallel PRs do not
collide. All timestamps are **after** `20261003045729`.

- **A1**: `20261101100000_scheduling_v2_class_types_instructors.sql`
- **A2**: `20261101100500_scheduling_v2_eastern_time_and_cancel_idempotency.sql`
- **A3**: `20261101101000_scheduling_v2_session_content.sql`
- **A4**: `20261101101500_scheduling_v2_member_auth_projection.sql`
- **A5**: `20261101102000_scheduling_v2_lane_a5.sql`
- **A6**: `20261101102500_scheduling_v2_lane_a6.sql`
- **A7**: `20261101103000_scheduling_v2_lane_a7.sql`
- **A8**: `20261101103500_scheduling_v2_lane_a8.sql`
- **A9**: `20261101104000_scheduling_v2_lane_a9.sql`
- **A10**: `20261101104500_scheduling_v2_lane_a10.sql`

