# Non-production validation environment

**Task:** API-GATE-001  
**Audience:** operators and agents running API-VAL-001, API-VAL-002, or API-HARD-002  
**Production writes:** never

This is the procedure for exercising finance, receipts, subscriptions, scheduling,
entitlements, and waiver submit **outside production**. Isolated Vitest fixtures from
API-TEST-001 / API-TEST-002 stay valid for route tests; they do not replace this
environment for live smokes.

## Out of bounds (read this first)

| Target | Status |
| --- | --- |
| Supabase project **`jhxzecxkccqlgyazhsnb`** | **Forbidden** for every VAL task and for these scripts. No override. |
| API `https://api.templeunderground.com` | **Forbidden** for seed, cleanup, and mutating smokes. |
| API `https://temple-underground-signup.onrender.com` | Same host (Render). **Forbidden** for writes. |

Later VAL / HARD work must not point `SUPABASE_URL`, `TU_TEST_API_BASE`, or
`services/api/.env` at those targets. Read-only production inspection is a
different activity and is not this procedure.

## Where data lives

| Store | Location | Role |
| --- | --- | --- |
| **Default validation database** | Local Supabase from this repo (`npm run supabase:start`) | Postgres + Storage + Studio. API URL `http://127.0.0.1:54321`. DB port `54322`. Studio `http://127.0.0.1:54323`. |
| **Default validation API** | Local Express (`npm run dev:api`) | Listens on `http://127.0.0.1:3001`. Must use the **local** `SUPABASE_URL` / service-role key, not production. |
| **Catalog seed** | `supabase/seed.sql` | Applied on `supabase db reset`. Includes `plan_definitions` such as **Basic Group Plan** (required by `--billing`). |
| **Disposable TU-TEST rows** | Same local (or approved non-prod) database | Created by `tu-test:seed` and by VAL smokes. Identified by `@tu-test.invalid` emails, `[TU-TEST]` display names, and `tu-test-run:` notes. |
| **Vitest fixtures** | In-process mocks in `services/api/src/routes/admin/*.test.js` | No network, no database. Use for regression; not a live finance/scheduling proof. |
| **Production** | Project `jhxzecxkccqlgyazhsnb` behind `https://api.templeunderground.com` | Out of bounds. |

Local storage buckets `signatures` and `signed-waivers` are optional. Waiver submit
logs storage errors and still inserts DB rows if buckets are missing.

## Who may write

| Actor | May write | Must not write |
| --- | --- | --- |
| Operator / VAL / HARD agent | Local Supabase and local API, using TU-TEST markers or documented smoke payloads | Production project `jhxzecxkccqlgyazhsnb`; production API mutating routes |
| `npm run tu-test:seed` | Local (or approved remote non-prod) API + DB | Production hosts; unmarked remote hosts without `TU_TEST_ALLOW_REMOTE=1` |
| `npm run tu-test:cleanup` | Same non-prod DB, and only rows matching TU-TEST markers | Production; unmarked remote without `TU_TEST_ALLOW_REMOTE=1`; `--execute` without a dry-run review |
| Vitest (`npm --workspace services/api run test`) | Nothing outside the process | Any live Supabase project |
| Production Render service | Live traffic only | Test data, seed, cleanup |

Staff auth on the local API is the shared `x-admin-key` (`ADMIN_API_KEY` in the
**local** API env). Do not reuse production key material in docs or commits.

## Supported targets (pick one)

1. **Local Supabase + local API (required default for VAL/HARD smokes).**  
   Bring-up below.
2. **Approved isolated hosted Supabase project (optional).**  
   A **different** project ref from `jhxzecxkccqlgyazhsnb`, with a non-production API
   pointed at it. Set `TU_TEST_ALLOW_REMOTE=1`. Production remains blocked even with
   that flag.
3. **Render preview branch.**  
   This repo has no `render.yaml` and API-OPS-001 could not read the Render dashboard.
   There is **no supported preview API today**. If one is added later, it must use a
   non-production Supabase project, never `jhxzecxkccqlgyazhsnb`.
4. **Approved fixtures.**  
   The in-memory Supabase stand-ins in API-TEST-001 (billing/receipts) and
   API-TEST-002 (subscriptions/scheduling). Sufficient for route tests; **not**
   sufficient for API-VAL-001 / API-VAL-002 live smokes.

## Bring-up (local)

Docker is required for `supabase start`.

```bash
# 1. Local database (migrations + supabase/seed.sql)
npm run supabase:start
# Keys: npx supabase status -o env
#   API URL -> SUPABASE_URL (http://127.0.0.1:54321)
#   service_role key -> SUPABASE_SERVICE_ROLE_KEY

# 2. Point the API at local, not production
#    Put these in services/api/.env (gitignored). The file must NOT contain
#    jhxzecxkccqlgyazhsnb or api.templeunderground.com.
#      SUPABASE_URL=http://127.0.0.1:54321
#      SUPABASE_SERVICE_ROLE_KEY=<local service_role from supabase status>
#      ADMIN_API_KEY=<any local-only test string>
#      PORT=3001

# 3. Same keys for seed/cleanup (repo-root .env.validation preferred; gitignored)
#      SUPABASE_URL=http://127.0.0.1:54321
#      SUPABASE_SERVICE_ROLE_KEY=<same local service_role>
#      TU_TEST_API_BASE=http://127.0.0.1:3001
#      ADMIN_API_KEY=<same local-only string, for VAL curl>

# 4. API process
npm run dev:api
```

Reset the local database (drops data, reapplies migrations, runs `seed.sql`):

```bash
npx supabase db reset
```

Optional storage: in local Studio (`http://127.0.0.1:54323`) create private buckets
`signatures` and `signed-waivers` if you need stored signature/PDF objects.

### Preflight (required before any seed or VAL write)

- `SUPABASE_URL` contains `127.0.0.1` or `localhost`, **or** is an approved non-prod
  project **and** `TU_TEST_ALLOW_REMOTE=1`.
- `SUPABASE_URL` does **not** contain `jhxzecxkccqlgyazhsnb`.
- `TU_TEST_API_BASE` is `http://127.0.0.1:3001` (or another local URL), not
  `api.templeunderground.com`.
- `services/api/.env` matches that non-prod target. Seed/cleanup **refuse to run**
  if that file mentions the production project or Render API host.

## Seed

Markers: emails `@tu-test.invalid`, names `[TU-TEST] …`, notes `tu-test-run:<id>`.
See `scripts/lib/tu-test-data.mjs`.

```bash
# Waivers + participants + accounts (public POST /api/waivers/submit)
npm run tu-test:seed -- --count=2

# Plus subscription + open charge + personal_finance invoice (API-VAL-001 starting point)
npm run tu-test:seed -- --count=2 --billing

# Plus session + attendance (API-VAL-002 starting point)
npm run tu-test:seed -- --count=2 --billing --schedule
```

`--billing` needs `plan_definitions` row **Basic Group Plan** (`supabase/seed.sql`
or an equivalent non-prod insert). `--schedule` writes `sessions.session_label`
and `notes` with `tu-test-run:` so cleanup can find them.

Help: `npm run tu-test:seed -- --help`

## Cleanup

Default is **dry-run**. Deletion requires `--execute`.

```bash
npm run tu-test:cleanup
npm run tu-test:cleanup -- --execute
```

Cleanup deletes only TU-TEST-scoped rows (test emails, `[TU-TEST]` /
`tu-test-run:` markers, and accounts/charges/payments/receipts linked to those
participants). It does **not** wipe `plan_definitions` or the whole database.

`event_ledger` is append-only: leftover UUID mentions after cleanup are expected.
Local storage objects may remain; `npx supabase db reset` is the full local wipe.

Help: `npm run tu-test:cleanup -- --help`

## How successor tasks use this

Do **not** start these tasks from this GATE work. When they run, they use this
environment only.

| Task | Use |
| --- | --- |
| **API-VAL-001** | Local API + local DB. Seed with `--billing`. Smoke personal-finance, discounts, `POST /api/admin/billing/record-payment`, receipt void, refund. Header `x-admin-key` from the **local** `ADMIN_API_KEY`. Cleanup after. |
| **API-VAL-002** | Same env. Seed with `--billing --schedule`. Smoke session CRUD, attendance (entitlement block vs warn), `POST /api/admin/billing/subscriptions`, Discord cron header only if a **non-prod** webhook is configured. Cleanup after. |
| **API-HARD-002** | Same env. Duplicate `POST /api/waivers/submit` against the local API. Do not submit to production. |

Vitest remains the fast loop; VAL smokes are the live non-prod proof.

## Script safety

`scripts/tu-test-seed.mjs` and `scripts/tu-test-cleanup.mjs` call
`scripts/lib/tu-test-guard.mjs` before any write:

- Production project ref and production API hosts → always refuse.
- Non-local URL without `TU_TEST_ALLOW_REMOTE=1` → refuse.
- `services/api/.env` containing production identifiers → refuse (a local API
  using production keys would write to production).

Env files loaded, in order, without overriding already-set variables:

1. Repo-root `.env.validation` (preferred)
2. Repo-root `.env`

`services/api/.env` is **not** auto-loaded by the scripts.

## Residual risk

- A local API started with production keys in its own process env (not in
  `services/api/.env` on disk) would still write to production if someone posted
  to `localhost`. Confirm `npx supabase status` keys are what the API process
  actually loaded.
- `record-payment` is still non-transactional (API-HARD-001). VAL-001 should
  expect partial writes on failure paths.
- Waiver submit is not end-to-end idempotent (API-HARD-002). Duplicate submits
  can create extra rows until that task lands.
- Cleanup cannot remove `event_ledger` history.
- There is no hosted preview environment in this repo yet.

## Billing database tests

With local Supabase running, execute **all three** suites:

```bash
npm run test:billing-db
```

This resolves to `supabase test db supabase/tests/database --local` and never uses
a linked production DB. Tests are transactionally rolled back. The legacy suite
retains enrollment, initial charge, per-class, conversion, and proration coverage;
the obligation suite uses synthetic agreements (not actual member details).

### Isolated PostgreSQL fallback without Docker

When Docker/Podman is unavailable, the following local-only fallback replays the
unaltered migrations, catalog seed, and pgTAP suites using PGlite (PostgreSQL in
WASM). It is additional SQL validation, **not** a replacement for the predeployment
Supabase/PostgREST and multi-connection concurrency gate. No URL, credential, or
production connection is accepted by the runner. It uses a fresh in-memory DB
with minimal `auth.users`/`auth.uid()` scaffolding and Supabase-style roles/grants.

Validated dependency versions: `@electric-sql/pglite@0.5.8`, pgTAP `1.3.2` from
Ubuntu package `postgresql-16-pgtap_1.3.2-2_all.deb` (pgTAP is SQL-only). No runtime
dependency or lockfile change to the API is necessary. On Ubuntu, prepare the
isolated runtime and the extension bundle outside the repository:

```bash
mkdir -p /tmp/tu-billing-runtime /tmp/tu-billing-pg
npm --prefix /tmp/tu-billing-runtime install --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
(cd /tmp/tu-billing-pg && apt-get -o APT::Sandbox::User=root download postgresql-16-pgtap=1.3.2-2)
dpkg-deb -x /tmp/tu-billing-pg/postgresql-16-pgtap_1.3.2-2_all.deb /tmp/tu-billing-pg/extracted
mkdir -p /tmp/tu-billing-pg/bundle/share/postgresql/extension
cp /tmp/tu-billing-pg/extracted/usr/share/postgresql/16/extension/pgtap* /tmp/tu-billing-pg/bundle/share/postgresql/extension/
tar -czf /tmp/tu-billing-pg/pgtap.tar.gz -C /tmp/tu-billing-pg/bundle share

# From the repository root:
TU_PGLITE_ROOT=/tmp/tu-billing-runtime/node_modules/@electric-sql/pglite \
TU_PGTAP_BUNDLE=/tmp/tu-billing-pg/pgtap.tar.gz \
node scripts/test-billing-pglite.mjs
```

The apt sandbox option above was needed in this root-only container to download
packages; it does not install a database service. An ordinary host can use its
normal package download command or supply its installed pgTAP SQL/control files.
The runner never edits the SQL suites, opens a socket, or loads repository env
files. It exits nonzero on SQL errors, failed TAP assertions, or test-plan errors.

2026-10-01 final rerun: new migration replay and reapply succeeded; **37 legacy + 84
obligation assertions passed**; RLS and service-role execution checks passed.
Local Supabase startup and the CLI database test command were blocked because
Docker/Podman is absent. No production access was used to work around that limit.

Generated obligation history intentionally cannot be deleted. Do not run the
legacy `tu-test:cleanup` account deletion flow against obligation-test accounts;
use these rollback-based suites or reset a disposable local database. The
production prohibition remains unchanged.


## Follow-up validation evidence — 2026-10-01

From the repository root, the following commands were executed:

```bash
npm --workspace services/api test
# PASS: 191 tests, 20 files. Notification delivery is mocked; no messages sent.

TU_PGLITE_ROOT=/tmp/tu-billing-runtime/node_modules/@electric-sql/pglite \
TU_PGTAP_BUNDLE=/tmp/tu-billing-pg/pgtap.tar.gz \
node scripts/test-billing-pglite.mjs
# PASS: 165 assertions = 37 legacy + 84 obligations + 44 reporting/integration.
# PASS: ordered migrations, follow-up reapplication, populated financial preservation.

npm run guard:waiver-schema
# PASS

git diff --check
# PASS

npm run supabase:start
# BLOCKED: docker not found; podman not found.

npm run test:billing-db
# BLOCKED: local 127.0.0.1:54322 connection refused; never used a linked DB.
```

The fallback now seeds `scripts/fixtures/billing-pre-obligations.sql` after the
catalog and before `20260930063526`, preserving a synthetic subscription, charge,
partial payment and allocation. `billing-post-obligations.sql` compares full
original row JSON after migrations and reapplication (excluding only the new null
charge column), fails on unexpected obligations/legacy generation, and removes
only its fixture. These files must only run in a disposable local database; the
PGlite runner never accepts a connection URL or loads any env file.

New integration assertions verify report cardinality and discount/refund/write-off
balances, retained ended debt, void/paid exclusion, date thresholds, no-charge
covered enrollment/replacement, repeated UUIDs, rejected coverage/overlap, immutable
terms/history, replacement-chain overlap regression, view grants/invoker security,
and actual `service_role` SQL execution. The separate API tests verify role gates,
request validation, response shapes, additive report queries, and both reminder
consumers with the transport mocked.

Still environment-blocked (required before a separately authorized rollout):

1. Local Supabase migration replay/reapplication with real auth schema, default
   grants and PostgREST; validate the additive view/RPC discovery and service-key
   versus anon/authenticated HTTP behavior.
2. Local API → PostgREST exercise of create/list/transition, no-charge enrollment,
   both report slugs, record-payment, discounts and refunds. Stub Discord transport;
   do not configure or send a real webhook for this validation.
3. Independent database connections: simultaneous generator/generator calls and
   generator races with pause, end, replacement (both lock acquisition orders).
   Assert one row per obligation/period, unchanged historical charge terms, no
   partial replacement and no ancestor/descendant overlap. Generation that wins
   before a pause/end can legitimately issue the current period's full charge;
   a lifecycle operation that wins first must prevent a new charge.
4. Concurrent same-UUID create/activation and competing replacement activation;
   expect create conflict or activation no-op, exactly one accepted replacement.
   Exercise covered enrollment races and review unsupported mixed legacy/covered
   enrollment requests before frontend adoption.

No single-session result above is evidence that these multi-connection or HTTP
checks passed. Worker deployment remains disabled regardless of local results.
