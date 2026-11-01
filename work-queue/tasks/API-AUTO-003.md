# API-AUTO-003 — V1 monthly charge generation

- Status: **done**
- Lane: automation
- Depends on: API-AUTO-001, API-VAL-001
- Production writes: no (migrations later applied; this row is a historical index)
- Evidence: PRs [#41](https://github.com/palthol/TU-api/pull/41), [#42](https://github.com/palthol/TU-api/pull/42); released to `main` as **v1.1.0** via [#43](https://github.com/palthol/TU-api/pull/43) (2026-09-22). Tag `v1.1.0` = `e947bcc`.

## What landed

Completed V1 automatic subscription charge generation and scoped monthly-charge uniqueness / per-class conversion anchors. API-AUTO-001 only added the cron HTTP endpoint; this work added the generator migrations and billing automation tests released in v1.1.0.
