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
docs/                Architecture, admin-api reference, finance subsystem, audits.
```

**Sibling repos (front-ends live elsewhere):**

- **`admin`** — `apps/dashboard`, `apps/receipts`, `apps/waiver-viewer` (no backend).
- **`marketing`** — `TU-web` (public site), `TU-marketing` (campaign minisite).

> Never add a second API or duplicate operator/marketing apps here. All backend work
> happens in this repo; UI work happens in `admin` or `marketing`.

## Commands

```bash
npm install              # installs all workspaces
npm run dev:api          # API on :3001 (node --watch)
npm run start            # production start (node src/index.js)
npm run dev:waiver       # public waiver signing app
npm run supabase:push    # apply pending migrations to the linked project
npm run supabase:pull    # pull schema from the linked project
```

There is **no build step** for the API and **no typecheck** (plain JS). Tests: the API's
own `vitest` suite (`npm --workspace services/api run test`), plus waiver guard/smoke
scripts at the repo root.

Operator and marketing UIs run from sibling repos:

```bash
# admin repo (dashboard, receipts, waiver-viewer)
npm run dev:dashboard
npm run dev:receipts
npm run dev:waiver-viewer

# marketing repo (TU-web)
cd TU-web && npm run dev
```

## Database workflow (read before changing schema)

- The schema lives in `supabase/migrations/NNNN_*.sql`, applied in numeric order.
- **Migration sync:** live project is applied through **`0019`** (including
  `personal_finance_entries`, private-schema grants, `charge_discounts`). Before new
  schema work, confirm in Supabase Dashboard → Database → Migrations or `list_migrations`.
  See `docs/api-schema-audit.md` and `docs/api-capability-audit.md`.
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
