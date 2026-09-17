# Temple Underground — API repo (agent guide)

This is the **API repository** and the home of the deployed backend. It is the single
source of truth for `services/api` (Express, JavaScript) and the Supabase schema
(`supabase/migrations/`). The deployed service runs from here — treat the database as
**live production data**.

Also read the repository control documents before starting work:

- `docs/README.md`
- `docs/current-state.md`
- `docs/target-state.md`
- `work-queue/README.md`
- `docs/reviewer-guide.md`

## Taking a task

1. Cursor Cloud: follow **Cursor Cloud specific instructions** below before reading the queue.
2. Read `work-queue/README.md`. Pick one `ready` task from `work-queue/queue.json`.
3. Follow `work-queue/tasks/<ID>.md` only.
4. Create `work-queue/claims/<ID>.md` from the template. If it already exists, stop.
5. Branch from `develop` as `agent/<ID>-short-slug`.
6. Production DB writes are forbidden unless the task file says otherwise.
7. Stay in `allowed_paths` plus the shared queue files in the README.
8. Verify with the commands in the brief; mark the task `done` in `queue.json` and the README table.

npm-workspaces monorepo. Node >= 22, npm >= 10.

```
services/api/        Express + JS backend (admin + viewer + public waiver/lead routes). DEPLOYED.
supabase/migrations/ Ordered SQL migrations — the schema source of truth.
docs/                Start at `docs/README.md`. Live contracts, status, and domain notes.
                     Historical snapshots are in `docs/archive/`.
```

**Sibling repos (front-ends live elsewhere):**

- **`TU-Signup`** — participant waiver signing app (Vite + React).
- **`admin`** — `apps/dashboard`, `apps/receipts`, `apps/waiver-viewer` (no backend).
- **`marketing`** — `TU-web` (public site), `TU-marketing` (campaign minisite).

> Never add a second API or duplicate operator/marketing/waiver apps here. All backend work
> happens in this repo; UI work happens in sibling repos.

## Commands

```bash
npm install              # installs all workspaces
npm run dev              # API on :3001 (node --watch)
npm run dev:api          # same as dev
npm run start            # production start (workspace: node src/index.js in services/api)
npm run supabase:push    # apply pending migrations to the linked project
npm run supabase:pull    # pull schema from the linked project
```

There is **no build step** for the API and **no typecheck** (plain JS). Tests: the API's
own `vitest` suite (`npm --workspace services/api run test`), plus waiver guard/smoke
scripts at the repo root.

Operator, marketing, and waiver UIs run from sibling repos:

```bash
# TU-Signup (waiver)
cd ../TU-Signup && npm run dev

# admin repo (dashboard, receipts, waiver-viewer)
npm run dev:dashboard
npm run dev:receipts
npm run dev:waiver-viewer

# marketing repo (TU-web)
cd TU-web && npm run dev
```

## Database workflow (read before changing schema)

- The schema lives in `supabase/migrations/`, applied in version order.
- **Migration sync (reconciled 2026-09-14):** live history is **`0001`–`0020`** plus
  **`20260608191715`** (`marketing_leads` first/last name; formerly repo file `0021`).
  Pending in-repo only: `20260914150818` (waiver idempotency), `20260914185843`
  (staff RBAC), `20260914202053` (`generate_sessions`). Do not `db push` those until
  a task authorizes production schema writes. Before new schema work, confirm in
  Supabase Dashboard → Database → Migrations or `list_migrations`.
  See `docs/api-schema-audit.md` and `docs/api-capability-audit.md`.
- To add schema: create a timestamped file with `supabase migration new <name>`
  (version must sort after `20260914202053`), keep it idempotent, apply it
  (`supabase db push` or the Supabase MCP `apply_migration`), then re-verify with
  `list_tables` / `execute_sql`. Do not reuse sequential `0021`–`0024` filenames.
- Migrations should be idempotent (`create table if not exists`, `create or replace`,
  `grant`).
- After schema changes, update the relevant doc in `docs/` (e.g. `admin-api.md`,
  `database-overview.md`) so the front-end design docs in the `admin` repo stay accurate.

## API conventions

- **Auth:** `/api/admin/*` requires header `x-admin-key` == `ADMIN_API_KEY`. Discord
  notification routes also accept `x-cron-secret` when `CRON_SECRET` is set. `/api/viewer/*`
  uses Cloudflare Access (JWT + email allowlist). Public: `/api/lead`, `/api/waivers/submit`,
  `/health`, `/health/deep`. Admin-key PDF: `GET /api/waivers/:id/pdf`.
- **Supabase client** is **service-role** (bypasses RLS) — each route is responsible for its
  own authorization. Never log `ADMIN_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, and never
  expose them to any browser/Vite (`VITE_*`) bundle.
- **Money is integer cents** everywhere.
- **Response envelope:** success → `200 { ok:true, ... }`; failure → non-2xx
  `{ ok:false, error:"<machine_key>" }`. The front-ends read `data.error` / `data.<field>`.
- **Internal billing/affiliate RPCs** are `service_role`-execute-only
  (`record_payment_refund`, `merge_participants`, `upgrade_subscription_prorated`,
  `upgrade_per_class_to_monthly`, `create_pay_per_class_charge`, `apply_credits_to_account`,
  etc.). Prefer an RPC for any multi-write operation that must be atomic.
- Don't invent endpoints or rename fields the front-ends already consume; the contract is
  documented in `docs/admin-api.md` and mirrored in the `admin` repo's
  `docs/frontend-design/`.

## Cursor Cloud specific instructions

Cloud agents boot from a pre-built environment snapshot. On-disk files
(`work-queue/queue.json`, `work-queue/README.md`, claims) can lag
`origin/develop` even when `git log` already shows the latest commit. Do not
trust the working-tree queue until you refresh.

Before reading the queue or claiming a task:

```bash
git fetch origin develop
git checkout develop
git pull origin develop
git rev-parse HEAD origin/develop
```

`HEAD` and `origin/develop` must match. Then confirm the on-disk queue matches
that commit:

```bash
diff -u work-queue/queue.json <(git show HEAD:work-queue/queue.json)
```

If claims say `done` but `queue.json` still says `ready` (or the reverse), the
checkout is stale — fetch and re-read before picking work. Local checkouts that
are already fast-forwarded to `origin/develop` can skip this.

## Deployment

Production API runs on **Render** at **`https://api.templeunderground.com`**
(Render hostname `temple-underground-signup.onrender.com`). Health:
`GET /health`, `GET /health/deep`. CORS uses `ALLOWED_ORIGIN` or defaults to `*`.
Inventory: [`docs/deployment.md`](docs/deployment.md).

## Secrets

`services/api/.env` is git-ignored. Copy `services/api/.env.example` as a starting point.
For real Supabase access set `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_API_KEY`. Optional: `PORT`, `CRON_SECRET`,
`ALLOWED_ORIGIN` (defaults to `*`), `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`,
`CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`, `WAIVER_VIEWER_DEV_BYPASS` /
`WAIVER_VIEWER_ALLOWED_EMAILS`, `SIGNATURES_BUCKET`, `WAIVERS_BUCKET`, `PDF_ORG_*`,
and `API_EXPOSE_DB_ERRORS`. Project ref: `jhxzecxkccqlgyazhsnb`. Never commit secret
values or tokenized webhook URLs.
