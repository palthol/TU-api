# API-OPS-001 — Inventory API deployment

- Status: **done**
- Lane: deployment
- Depends on: API-DOC-001 (done)
- Production writes: **no** (read-only inspection of host/platform/env **names**)
- Branch from: `develop` as `agent/API-OPS-001-deploy-inventory`

## Agent prompt

Read `AGENTS.md`, `docs/current-state.md`, and this brief. Claim
`work-queue/claims/API-OPS-001.md`. Document the real API host, platform, health
check, CORS behavior, and non-secret environment variable names. Commit no
secrets. Do not change application code. Stop when the inventory is in the
allowed docs.

## Read first

- `docs/current-state.md` (deployed hostname was previously unknown)
- `docs/use-guide.md` env section
- `AGENTS.md` secrets
- `services/api/.env.example`
- `services/api/src/index.js` (PORT bind, CORS, health)

## Allowed paths

- `docs/current-state.md`
- `docs/use-guide.md`
- `AGENTS.md`
- `docs/README.md` (link only, if you add a deployment section)
- Shared queue files listed in `work-queue/README.md`

New file allowed if needed: `docs/deployment.md` (then link it from `docs/README.md`).

## Out of scope

- Changing CORS defaults in code
- Setting production env values
- Configuring Render/GitHub secrets
- Discord cron (API-AUTO-002)

## Acceptance

- Named platform (e.g. Render) and public hostname, or an explicit statement that
  it could not be verified and what was tried
- Health endpoints documented: `GET /health`, `GET /health/deep`
- CORS: `ALLOWED_ORIGIN` vs default `*`
- Non-secret env **names** only, matching `.env.example`
- No secret values, webhooks, or keys in the commit

## Verify

- Grep the diff for `eyJ`, `sk_`, `service_role`, webhook URLs with tokens
- Read the new/updated docs as an operator: could they find host + health + env names?

## Done protocol

Set this task `done`. Do not unblock API-GATE-001 until DEV-001, TEST-001, TEST-002,
and this task are all done.
