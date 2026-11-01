# Billing obligation validation — 2026-10-03

## Result and tested source

**PASS for the requested local database, HTTP and concurrency gate.** The legacy
enrollment overlap defect was reproduced on real PostgreSQL and fixed in an
additive corrective migration. This is readiness for review of the uncommitted
changes, **not authorization to deploy or enable billing**.

- Repository: `palthol/TU-api`, local checkout
  `/Users/kleines/Documents/coding/Temple Underground API/TU-api`.
- Branch: `cursor/custom-household-billing`.
- HEAD: `0c97a4cce45cb69bf2c86d690f5152ef1b3a0708`, exactly the previous requested
  validation commit. After fetch, `HEAD...origin/cursor/custom-household-billing`
  divergence was `0 0`. The initially clean checkout was on `develop`; the requested
  branch was created tracking its remote. No force update/reset or discarded work.
- Final tests include the **uncommitted** migration `20261003045729` and test changes
  described below; the original commit alone still has the reproduced defect.
- Root `AGENTS.md`, repository control docs, all requested domain/environment docs,
  worker README, SQL migrations, scripts and relevant API implementations were read.
  `docs/obligation-validation-attempt-2026-10-01.md` was absent from this branch;
  earlier evidence is in `current-state.md` and `validation-environment.md`.

## Environment and safety

MacBook/macOS arm64; Node `24.19.0`, npm `11.17.0`; repository-installed Supabase CLI
**2.105.0**, as locked in `package-lock.json`. Global CLI was not used for the gate.
Docker daemon `29.8.1`; real Supabase PostgreSQL **17.6**, with real `auth.users`,
Auth, PostgREST, service-role grants, RLS and pgTAP, not PGlite or a database mock.

Docker Desktop's app bundle was missing even though prior Docker configuration and
volumes existed. It was restored to `/Applications/Docker.app` from the cached
official Docker DMG, launched, and verified with `docker info`. Installer was
unmounted afterward. Existing `ins` containers and its `supabase_db_ins`,
`supabase_storage_ins`, `supabase_edge_runtime_ins` volumes were preserved; none
were reset, stopped, or removed.

The **new, explicitly disposable** project is `tu_obligation_validation_20261003`,
workdir `tmp/obligation-validation-20261003`, Docker network of the same project
name. It has its own database/storage volumes. No linked-project metadata or
production env files were copied. Targets were verified before SQL:

| Service | Local target |
| --- | --- |
| Supabase API/PostgREST/Auth | `http://127.0.0.1:55321` |
| PostgreSQL | `127.0.0.1:55322`, database `postgres` |
| Studio | `http://127.0.0.1:55323` |
| Mail testing | `http://127.0.0.1:55324` |
| Actual Express API during harness | `http://127.0.0.1:53001` |
| Notification transport stub | `http://127.0.0.1:53002/stub` |

The harness only permits the exact disposable config, CLI version, API URL and
database host/port/name; it captures CLI status keys in memory without printing
them. Its actual Express entry-point child receives only an allowlisted local env
and `DOTENV_CONFIG_PATH=/dev/null`, avoiding checkout dotenv files. Synthetic UUIDs,
`[TU-TEST]` names and `@tu-test.invalid` emails are used. Discord is a loopback HTTP
stub; no real notification destination, Stripe service or Worker was contacted.

Docker publishes the development stack ports on all host interfaces even with
the bridge host-binding option. Express's existing listener also binds all
interfaces. Test clients used literal loopback targets; the notification stub
binds loopback. Do not expose this stack on an untrusted network. Its keys are
local development keys, never production credentials.

Analytics/logflare, vector and edge-runtime were deliberately excluded; database,
Auth, PostgREST, Storage, Realtime, mail, Studio and gateway ran. These exclusions
do not substitute mocks for the billing path.

## Migration and defect evidence

The full ordered history replayed from an empty local Supabase database: `0001`
through `0020`, then all eleven timestamped migrations through `20261003045729`.
Final ledger had **31 successfully applied versions**. Expected obligation tables,
views, RPCs, charge uniqueness index, lifecycle triggers and service-role execution
were verified by real SQL and real PostgREST requests. No failed SQL migration was
marked applied, no constraints were disabled, and no deployed migration was edited.

Populated preservation replay reset only the disposable DB to `20260921221500`,
loaded the existing synthetic pre-obligation fixture, and applied **and reapplied**
the two obligation migrations plus the corrective migration in one real PostgreSQL
session. Full subscription, charge, partial payment and allocation JSON remained
unchanged (excluding the new null charge obligation column). It also verified
that no obligations or retroactive legacy charges were inferred. A subsequent
fresh CLI startup replayed the entire history and recorded the final ledger
normally; preservation testing did not fabricate migration history entries.

Baseline reproduction: covered enrollment followed by `create_subscription`
accepted two overlapping active access records, and the legacy path issued its
separate catalog-priced initial charge. The legacy function had neither the
participant mutex nor overlap rejection used by the covered path.

Corrective migration `20261003045729_serialize_subscription_enrollment.sql` was
created using `supabase migration new serialize_subscription_enrollment`. It
replaces only the latest legacy `create_subscription` definition, retaining its
signature, existing definer/grant model, initial-charge calculation and response.
It locks the participant `FOR UPDATE`, then rejects intersecting inclusive
`daterange(starts_at,ends_at,'[]')` ranges for active subscriptions, across accounts.
Error is `overlapping_active_subscription`; failure creates neither subscription
nor charge. Cancelled and nonoverlapping historical access remain supported.
Covered enrollment already uses that row lock; its implementation was not changed.

The guarantee applies to the supported enrollment RPCs, not arbitrary direct
service-role SQL writes. Legacy paid upgrade/conversion semantics remain separate;
this is not a new blanket subscription exclusion constraint.

## Final checks

| Check | Final result |
| --- | --- |
| Complete CLI migration replay and catalog seed | PASS, 31 versions |
| Populated real-schema migration/reapplication preservation | PASS, 4 historical row snapshots |
| API Vitest suite | PASS, 191 tests / 20 files |
| Real Supabase pgTAP | PASS, 177 assertions / 4 suites |
| Live SQL/HTTP/concurrency harness | PASS, 22 named scenarios |
| Production-target guard self-test | PASS, 7 offline checks |
| Waiver schema guard | PASS |
| JS syntax and `git diff --check` | PASS |

pgTAP totals: **37** retained legacy billing assertions, **84** obligation assertions,
**44** reporting/entitlement assertions, **12** new enrollment-overlap assertions.
They include independent agreed/catalog amounts; household no-fanout; multiple
payers; day 29/30/31 common/leap February clamps and original March anchors;
year boundaries; current-period-only late catch-up without missed-period backfill;
void retry suppression; paused/ended debt retention; immutable terms and issued
history; discounts, allocations, refunds, write-offs, reminders, grants and RLS.

`scripts/test-billing-local.mjs` executed the actual Express entry point against
real PostgREST. HTTP checks exercised create/list/transition, concurrent generation,
no-charge entitlement enrollment, legacy overlap rejection, invalid FK rollback,
invalid enrollment/activation/payment atomicity, UUID conflict, discount/payment
with receipt/refund/write-off, both payer report slugs, staff role gates, cron
header boundaries, both reminder consumers and protected view/RPC denial using
both anon and a **real local Auth-issued authenticated JWT**. Three covered
participants produced one 12,340-cent household charge, the same payer's second
agreement produced 6,780 cents on its own cycle, and a separate payer produced
4,321 cents. Concurrent/repeated HTTP calls produced one charge per obligation.
The shared charge's discount/allocation/refund/write-off flow ended at exactly
10,000 cents outstanding, still collectible after ending the agreement.

Concurrency was **not sequential calls labeled concurrent**. There were 14 ordered
race cases using distinct PostgreSQL backend PIDs and independent `pg.Client`
connections. The first transaction performed its operation and remained open;
the second request was issued, and the observer verified its actual
`pg_stat_activity.wait_event_type = 'Lock'` before committing the first. Cases:

- Generator/generator: no duplicate period.
- Generator/pause and generator/end, both acquisition orders: generator-first may
  issue one full period; lifecycle-first prevents the target's charge.
- Generator/replacement, both orders: issued-period history prevents a conflicting
  cutover, or a successful cutover bills only the successor; retries preserve terms.
- Same-UUID create and activation: create conflicts atomically, activation is a no-op.
- Competing replacement activation: exactly one successor accepted; loser stays draft.
- Legacy/covered enrollment, both orders: exactly one access record and atomic loser;
  covered-first produces zero initial charges, legacy-first produces only its one.
- Covered/covered and legacy/legacy: one enrollment accepted.

Eight HTTP generator requests also executed together using `Promise.all`, followed
by ledger cardinality/amount/date assertions. No client-provided future `as_of`
overrode the actual New York business date used by the public RPC.

### Failures encountered and resolved

These are historical diagnostics, not final passes disguised as failures:

1. Sandboxed Vitest could not bind sockets (`EPERM`); with normal local execution,
   all 191 tests passed. No product change was needed.
2. The CLI help's suggested `analytics` exclusion was not accepted by this pinned
   runtime, causing a collision with existing port 54327. Its actual name is
   `logflare`; corrected exclusion preserved `ins` and fresh startup succeeded.
3. Reset without the custom network ID recreated the DB on the default network,
   disconnecting Auth/Storage/PostgREST. Using the matching `--network-id` fixed
   networking. An upstream 502 during reset recovery was resolved by restarting
   only the disposable PostgREST container and checking startup/health. The final
   gate used a clean stop/start from empty disposable volumes and succeeded.
4. A pgTAP test-container DNS failure was corrected by passing the same network ID.
5. One HTTP test incorrectly assumed descriptive links require payer membership at
   obligation creation. Membership is checked when granting access. The invalid
   fixture was corrected to a nonexistent participant FK; atomicity then passed.
6. Running global-empty-ledger pgTAP assertions after committed HTTP fixtures
   produced four invalid fixture-contamination failures. The final run was clean
   and sequential: pgTAP first, then HTTP. The harness now refuses a populated
   obligation starting state. All 177 final SQL assertions passed.
7. npm initially pruned unrelated optional peers while adding `pg`; the lockfile
   was narrowed to fourteen added package entries, including the pinned test client.

**Current failed checks: none. Current environment-blocked requested checks: none.**
Real notification delivery, production validation, deployment and cron enabling
were deliberately not performed; they were explicitly forbidden, not bypassed.

## Reproduction commands (no secret values)

Run from the checkout above. Do not change targets to the root/default project.
The fixture workdir contains no hosted project linkage. Create it only if absent;
if reusing it, confirm its exact disposable project ID before any reset/deletion.

```sh
git status --short
git remote -v
git fetch origin
git switch --track origin/cursor/custom-household-billing
git rev-parse HEAD
git rev-list --left-right --count HEAD...origin/cursor/custom-household-billing
docker info

# Already installed for this run; all other package versions retained.
npm install --save-dev --save-exact pg@8.16.3
export SUPABASE_TELEMETRY_DISABLED=1
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
node_modules/.bin/supabase --version
node_modules/.bin/supabase init --workdir tmp/obligation-validation-20261003
cp scripts/fixtures/obligation-validation.config.toml tmp/obligation-validation-20261003/supabase/config.toml
cp -R supabase/migrations tmp/obligation-validation-20261003/supabase/
cp supabase/seed.sql tmp/obligation-validation-20261003/supabase/
docker network create --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 tu_obligation_validation_20261003
node_modules/.bin/supabase start --workdir tmp/obligation-validation-20261003 --network-id tu_obligation_validation_20261003 --exclude logflare,vector,edge-runtime --yes

# Preservation: reset ONLY the disposable project. Keep the network ID consistent.
node_modules/.bin/supabase db reset --local --version 20260921221500 --workdir tmp/obligation-validation-20261003 --network-id tu_obligation_validation_20261003 --yes
node scripts/test-billing-local.mjs --preservation

# Clean full replay after preservation/committed synthetic fixture runs.
# Destructive ONLY to this documented disposable project's synthetic volumes.
node_modules/.bin/supabase stop --workdir tmp/obligation-validation-20261003 --network-id tu_obligation_validation_20261003 --no-backup --yes
node_modules/.bin/supabase start --workdir tmp/obligation-validation-20261003 --network-id tu_obligation_validation_20261003 --exclude logflare,vector,edge-runtime --yes

# Absolute suite path avoids the CLI changing path resolution with --workdir.
node_modules/.bin/supabase test db "$PWD/supabase/tests/database" --local --workdir tmp/obligation-validation-20261003 --network-id tu_obligation_validation_20261003
npm run test:billing-local
npm --workspace services/api test
node scripts/lib/tu-test-guard.selftest.mjs
npm run guard:waiver-schema
node --check scripts/test-billing-local.mjs
git diff --check
```

On a branch already checked out, do not rerun `git switch --track`; inspect status
and divergence instead. Existing workdir/network setup commands are one-time.
`supabase start/status` normally display **local** keys: keep output private. The
harness captures status internally and does not print keys. No key is in this
report or committed configuration. Baseline-only mode `--reproduce-legacy-gap`
requires the original legacy function (before corrective migration); it now refuses
to falsely report reproduction against the corrected function.

The corrective file was created with the pinned CLI's `migration new` command;
Docker app recovery used the existing cached DMG with `hdiutil attach`, `ditto` to
`/Applications/Docker.app`, `open -a /Applications/Docker.app`, and finally
`hdiutil detach /Volumes/Docker`. No remote Supabase CLI commands, `db push`,
backfill scripts, production curl, worker deploy, commit or push were run.

## Handoff and remaining risks

Uncommitted changes: additive migration; new 12-assertion SQL suite; real local
harness and disposable config; pinned `pg@8.16.3` dev dependency/package script;
focused lockfile additions; updated API/database/billing/current-state/environment
docs and this report. Existing thirty migrations and API production source were
not edited. No queue claims or queue changes were made for this direct request.

The disposable Supabase stack remains running with synthetic fixtures. The
temporary API and notification stub exited. Existing `ins` data is intact. Only
the disposable test project's synthetic volumes were discarded during clean
reruns; those interim fixtures were not backed up and were regenerated.

Ready for review/merge **with the corrective migration and tests included**, as
far as this requested local gate is concerned. Remaining rollout work: sibling
frontend adoption, operator review of explicit amounts/coverage/replacement and
paid-vs-no-charge access workflows, and separately authorized production migration
and deployment. No production state was inspected to re-confirm dated deployment
claims. Worker `triggers.crons` is still `[]`. Local results do not authorize
backfill, agreement activation or enabling automation.

Known existing limits: reminder delivery truncates at 2,000 characters and has no
delivery deduplication; global billing advisory locking trades throughput for
serialization and was not load-tested; service-role direct writes can bypass RPC
enrollment checks; missing-RPC payment fallback remains non-atomic. npm reported
seven moderate dependency advisories during install; unrelated dependency/security
upgrades were not folded into this billing fix. No claim of full-app, live Stripe,
or production readiness is made.
