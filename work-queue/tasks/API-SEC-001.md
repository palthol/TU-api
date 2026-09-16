# API-SEC-001 — Triage dependency findings

- Status: **done**
- Lane: security
- Depends on: API-DEV-001
- Production writes: no
- Branch from: `develop` as `agent/API-SEC-001-dep-triage`

## Agent prompt

After `npm ci` works, run `npm audit` and triage the findings (3 moderate as of
2026-09-03). Apply only safe upgrades. Do not churn unrelated versions.

## Allowed paths

- `package-lock.json`, root and `services/api` `package.json`
- Shared queue files

## Acceptance

- Each finding: ignore-with-reason, or upgrade with test evidence
- `npm --workspace services/api test` and `npm run guard:waiver-schema` pass
- No major upgrades unless required to close a real issue
