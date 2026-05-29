# Temple Underground — signup / API monorepo (agent guide)

This is the **API repository** and the home of the deployed backend. It is the single
source of truth for `services/api` (Express, JavaScript) and the Supabase schema
(`supabase/migrations/`). The deployed service runs from here — treat the database as
**live production data**.

npm-workspaces monorepo. Node >= 22, npm >= 10.

```
services/api/        Express + JS backend (admin + viewer + public waiver/lead routes). DEPLOYED.
supabase/migrations/ Ordered SQL migrations — the schema source of truth.
apps/waiver-v2/      Public waiver signing app.
apps/waiver-viewer/  Cloudflare-Access waiver review app.
apps/dashboard/      Operator dashboard (reporting views + admin actions).
apps/receipts/       Operator finance tool (cash log, invoices, formal billing).
apps/marketing/      Marketing site (POST /api/lead).
docs/                Architecture, admin-api reference, finance subsystem, audits.
```

> A separate **`admin`** repo holds front-end design docs for the admin apps. It has **no
> backend** — never point it at a second API. All backend work happens here.

## Commands

```bash
npm install              # installs all workspaces
npm run dev:api          # API on :3001 (node --watch)
npm run start            # production start (node src/index.js)
npm run dev:dashboard    # operator dashboard
npm run dev:receipts     # receipts finance tool
npm run supabase:push    # apply pending migrations to the linked project
npm run supabase:pull    # pull schema from the linked project
```

There is **no build step** for the API and **no typecheck** (plain JS). Tests:
`npm run test:receipts`, `npm run test:marketing`, and the API's own `vitest` suite
(`npm --workspace services/api run test`).

## Database workflow (read before changing schema)

- The schema lives in `supabase/migrations/NNNN_*.sql`, applied in numeric order.
- **Known drift (verify first):** as of 2026-05-29 the live project is applied through
  `0016`, but the repo contains `0017` (`personal_finance_entries`), `0018` (private-schema
  grants), and `0019` (`charge_discounts` + discount-aware `view_charge_net`). The API
  already depends on `0017` and `0019`. See `docs/api-schema-audit.md`. Check
  `list_migrations` (Supabase MCP) before assuming the DB matches the repo.
- To add schema: write a new numbered migration, apply it (`supabase db push` or the
  Supabase MCP `apply_migration`), then re-verify with `list_tables` / `execute_sql`.
- Migrations should be idempotent (`create table if not exists`, `create or replace`,
  `grant`).
- After schema changes, update the relevant doc in `docs/` (e.g. `admin-api.md`,
  `database-overview.md`) so the front-end design docs in the `admin` repo stay accurate.

## API conventions

- **Auth:** `/api/admin/*` requires header `x-admin-key` == `ADMIN_API_KEY`. `/api/viewer/*`
  uses Cloudflare Access (JWT + email allowlist). Public: `/api/lead`, `/api/waivers/submit`,
  `/health`.
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

## Secrets

`services/api/.env` is git-ignored. For real Supabase access set `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_API_KEY` (plus optional `DISCORD_WEBHOOK_URL`,
`SLACK_WEBHOOK_URL`, and the `CF_ACCESS_*` / `WAIVER_VIEWER_*` viewer settings) as
environment secrets. Project ref: `jhxzecxkccqlgyazhsnb`.
