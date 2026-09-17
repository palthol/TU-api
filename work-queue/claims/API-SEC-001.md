# API task claim

- Task ID: `API-SEC-001`
- Owner: cloud-agent
- Claimed at: `2026-09-07T18:56:06Z`
- Base branch: `develop`
- Base commit: `3a02838d42f8c0a79ef0d9b661f481bda902ce05`
- Production write authorized: no
- Status: `done`

## Scope and allowed files

- `package-lock.json`
- `package.json` (unchanged)
- `services/api/package.json` (unchanged)
- `work-queue/claims/API-SEC-001.md`
- `work-queue/queue.json` (this task's row only)
- `work-queue/README.md` (this task's row only)

## Verification evidence

All local; no production DB writes; no secrets committed.

### Baseline

- `npm ci` (exit 0): clean install after API-DEV-001 lockfile repair.
- Initial `npm audit`: **7** findings (4 moderate, 3 high) —
  `body-parser`, `fflate`, `form-data`, `nanoid`, `postcss`, `qs` (+ `express` via `qs`).

### Safe upgrades applied (`npm audit fix`, no `--force`)

Lockfile-only transitive bumps (root / `services/api` `package.json` unchanged):

| Package | Before → After | Finding | Disposition |
| --- | --- | --- | --- |
| `fflate` | 0.8.2 → 0.8.3 | GHSA-px8p-9vwx-vf98 (moderate) | **upgrade** |
| `form-data` | 4.0.5 → 4.0.6 | GHSA-hmw2-7cc7-3qxx (high) | **upgrade** |
| `nanoid` | 3.3.12 → 3.3.18 | GHSA-28wg-ghj8-5hjv / GHSA-2v37-7h3g-55p8 (high) | **upgrade** |
| `postcss` | 8.5.15 → 8.5.28 | GHSA-fxqj-rqcc-2cmp / GHSA-r28c-9q8g-f849 (high) | **upgrade** |
| `body-parser` | 1.20.5 → 1.20.6 | GHSA-v422-hmwv-36x6 (moderate) + qs dep | **upgrade** (own DoS advisory cleared from report; still listed under qs tree) |
| `qs` | 6.15.2 → 6.15.3 | GHSA-x5fp-wj9c-mxmx / GHSA-4mjr-xmp4-gh2g | partial only; still in vulnerable range |

Also incidental patch bumps in the same fix: `side-channel`, `side-channel-list`, `hasown`, etc.

### Remaining findings — ignore-with-reason

After fix, `npm audit` reports **3 moderate**, all the `qs` advisory tree:

- `qs@6.15.3` (installed)
- `body-parser@1.20.6` (depends on vulnerable `qs`)
- `express@4.22.2` (depends on vulnerable `body-parser` / `qs`)

**Reason to ignore (for this task):** `express@4.22.2` and `body-parser@1.20.6` both pin `qs` to `~6.15.1`, so `qs@6.16.0` (fixed) is outside the allowed semver range. Closing these requires an Express major line upgrade (Express 5 / `body-parser` 2.x). `npm audit fix --force` was **not** applied; no major upgrades.

### Acceptance commands

- `npm --workspace services/api test` (exit 0): **18/18** passed.
- `npm run guard:waiver-schema` (exit 0): passed.
- Re-ran `npm ci` after lockfile change (exit 0); audit still 3 moderate as above.

Did **not**: change API routes; touch migrations; write to production; run `npm audit fix --force`; upgrade Express; start blocked successors.

## Handoff or blocker

`done`. Residual risk: moderate `qs` advisories remain until an Express 5 (or equivalent) upgrade is intentionally planned.
