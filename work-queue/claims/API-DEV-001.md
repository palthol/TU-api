# API task claim

- Task ID: API-DEV-001
- Owner: cloud-agent
- Claimed at: 2026-09-05T03:09:53Z
- Base branch: `develop`
- Base commit: `644cf28d614ea37f211a09d342c04d929a16b3a9`
- Production write authorized: no
- Status: `done`

## Scope and allowed files

- `package-lock.json`
- `package.json` (only if required — not modified)
- `services/api/package.json` (only if required — not modified)
- Shared queue files: `work-queue/claims/API-DEV-001.md`, `work-queue/queue.json`, `work-queue/README.md`

## What changed

The lockfile was generated on Windows and listed optional platform packages for
`supabase`, `rollup`, `lightningcss`, and `esbuild` without locking their package
entries (except a few `win32` artifacts). On Linux, `npm ci` skipped those
optionals, so the Supabase CLI binary was missing and Vitest/Rollup failed.

Repaired `package-lock.json` only: added the missing optional platform package
entries at the already-resolved versions (`supabase`/`@supabase/cli-*` 2.105.0,
`rollup` 4.61.1, `lightningcss` 1.30.1, `esbuild` 0.27.2). No `package.json`
changes. Did not run `npm audit fix`. No production database writes.

## Verification evidence

| Command | Exit code |
| --- | --- |
| `npm ci` | 0 |
| `npm --workspace services/api test` | 0 (7 files / 18 tests passed) |
| `npm run guard:waiver-schema` | 0 |

Post-`npm ci` checks: `@supabase/cli-linux-x64` installed; `npx supabase --version` → `2.105.0`; `@rollup/rollup-linux-x64-gnu` and `@esbuild/linux-x64` present.

## Handoff or blocker

`done`. Residual risk: lockfile now includes multi-platform optional natives (larger
diff); CVE triage remains for API-SEC-001. Successors API-SEC-001, API-TEST-001,
and API-TEST-002 set to `ready`.
