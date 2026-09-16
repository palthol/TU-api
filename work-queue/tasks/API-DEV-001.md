# API-DEV-001 — Repair lockfile so `npm ci` succeeds

- Status: **done**
- Lane: tooling
- Depends on: API-DOC-001 (done)
- Production writes: **no**
- Branch from: `develop` as `agent/API-DEV-001-lockfile`

## Agent prompt

Read `AGENTS.md`, `docs/current-state.md`, and this brief. Claim
`work-queue/claims/API-DEV-001.md`. Repair the npm lockfile so a clean `npm ci`
succeeds on this repo. Do not upgrade unrelated packages. Do not write to
production. Stop when verify commands pass.

## Read first

- `docs/current-state.md` (lockfile / `npm ci` gap)
- Root `package.json`, `services/api/package.json`

## Allowed paths

- `package-lock.json`
- `package.json` (only if the lockfile cannot be repaired without it)
- `services/api/package.json` (same rule)
- Shared queue files listed in `work-queue/README.md`

## Out of scope

- Dependency CVE upgrades (API-SEC-001)
- New tests, schema, or deploy docs
- `npm audit fix` that changes versions beyond what `npm ci` needs

## Acceptance

- `npm ci` exits 0 from the repo root
- `npm --workspace services/api test` exits 0
- `npm run guard:waiver-schema` exits 0
- Diff is lockfile-focused; no unrelated upgrades

## Verify

```bash
npm ci
npm --workspace services/api test
npm run guard:waiver-schema
```

## Done protocol

Set this task `done` in `queue.json` and the README table. If API-DEV-001 is done,
set `API-SEC-001`, `API-TEST-001`, and `API-TEST-002` to `ready` (their only
dependency). Note residual risk in the claim.
