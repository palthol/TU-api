# Temple Underground — Use Guide

A single-operator guide for **building**, **maintaining**, and **using** this application. Written for you as the only user.

---

## 1. What this project is

- **Waiver flow** — Participants sign waivers (personal info, medical, emergency contact). Data lives in Supabase; you can generate PDFs via the API.
- **Gym admin** — Dashboard app (see below) plus DB: accounts, plans, subscriptions, charges, payments, sessions, attendance, entitlement status. You can also use Supabase Dashboard or SQL.
- **Auth** — Only **you** get full access. You are the admin; everyone else has no data access until you add more roles later.

**Repos / apps**

| Path | Purpose |
|------|--------|
| `TU-Signup` | Waiver signup UI (Vite + React) — **sibling repo** |
| `admin/apps/waiver-viewer` | Standalone mobile-first waiver review UI for trusted operators — **`admin` repo** |
| `services/api` | Express API: waiver PDF generation, admin routes, lead capture — **this repo** |
| `supabase/migrations` | Database schema, RLS, view/function security, indexes — **this repo** |
| `admin/apps/dashboard` | Admin dashboard: waivers, participants, billing, sessions, reporting — **`admin` repo** |
| `admin/apps/receipts` | Operator finance tool: cash log, invoices, formal billing — **`admin` repo** |
| `marketing/TU-web` | Public marketing site and lead form — **`marketing` repo** |

---

## 2. One-time setup

### 2.1 Supabase project

- Create a project at [Supabase](https://supabase.com).
- Copy **Project URL** and **anon key** (and **service_role key** for backend/script use only).

### 2.2 Environment

- **Waiver app** — In the **`TU-Signup`** repo, copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL` for production API access. Local dev proxies `/api` to `http://localhost:3001` when unset.
- **Dashboard app** — In the **`admin`** repo (`admin/apps/dashboard`), copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same project as waiver). Use the **anon** / **public** (publishable) key from Project Settings → API, not the service_role key. Sign in with the admin user you add to `app_admin`.
- **API** — In `services/api`, add a `.env` with at least:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (for server-side PDF/DB access)
  - `ADMIN_API_KEY` (required for `/api/admin/*` and the on-demand PDF route)
  - Optional: `PORT`, `ALLOWED_ORIGIN` (defaults to `*` when unset), `CRON_SECRET`
    (required on the API **and** the Render cron job once Discord digest is
    scheduled; header `x-cron-secret`), `DISCORD_WEBHOOK_URL` (API service only),
    `SLACK_WEBHOOK_URL`, Cloudflare viewer vars
    (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `WAIVER_VIEWER_DEV_BYPASS`,
    `WAIVER_VIEWER_ALLOWED_EMAILS`), storage (`SIGNATURES_BUCKET`, `WAIVERS_BUCKET`),
    PDF letterhead (`PDF_ORG_NAME`, `PDF_ORG_TAGLINE`, `PDF_ORG_ADDRESS`), and
    `API_EXPOSE_DB_ERRORS`
  - Full name list: `services/api/.env.example` and [deployment.md](./deployment.md)
  - Discord digest schedule: [deployment.md](./deployment.md) (Render Dashboard
    cron; this repo has no `render.yaml`)
- **Production API host** — `https://api.templeunderground.com` (Render;
  also `https://temple-underground-signup.onrender.com`). Set sibling
  `VITE_API_BASE_URL` to that URL (no trailing slash). Details:
  [deployment.md](./deployment.md).
- **Waiver viewer app** — Set `VITE_API_BASE_URL` if the API is not at `http://localhost:3001`. The viewer uses Cloudflare Access and must not receive `VITE_ADMIN_API_KEY`.

Keep `.env` out of git (already in `.gitignore`). Never commit secret values or webhook URLs.

**Dashboard: Auth redirect URLs (password reset / magic links)**  
If you use “Send password recovery” or magic links, Supabase redirects the user back to your app after they click the link. That redirect target is configured in the Supabase project, **not** in `.env`. If it’s wrong (e.g. `http://localhost:3000` while the dashboard runs on **5174**), you’ll see `access_denied` or land on the wrong page.

1. In Supabase Dashboard → **Authentication** → **URL Configuration**:
   - **Site URL**: Set to the URL where the dashboard actually runs. For local dev that’s `http://localhost:5174` (dashboard’s Vite port). For production, use your real dashboard URL.
   - **Redirect URLs**: Add the same URL so it’s allowed. For example: `http://localhost:5174`, and for production add `https://your-dashboard-domain.com`.
2. Save. Then password reset and magic-link emails will redirect to the dashboard; the app will read the token from the URL and complete sign-in.

### 2.3 Database migrations

From the project root (or wherever you run Supabase CLI):

```bash
npx supabase db push
```

Or run the SQL files in **version order** (`0001` through `0020`, then
`20260608191715`, then any later timestamped files) in the Supabase Dashboard →
SQL Editor. Prefer `npm run supabase:push` when the CLI project is linked.

Applied live history (last `list_migrations` 2026-09-03): `0001`–`0020` plus
`20260608191715_marketing_leads_first_last_name`. Repo filenames now use that
same version id. Pending in-repo only: `20260914150818`, `20260914185843`,
`20260914202053`. Do not push those until a task authorizes production schema
writes. See [api-schema-audit.md](./api-schema-audit.md).

What the numbered files do:

- **0001** — Foundation: participants, waivers, accounts, plans, subscriptions, charges, payments, sessions, attendance, RLS, `app_admin`
- **0002** — Affiliations, `generate_monthly_charges()`, entitlement helpers
- **0003** — Security hardening (`search_path`, grants)
- **0004** — Reporting views (`view_waiver_documents`, payment board, orphan waivers, …)
- **0005** — `charge_adjustments`
- **0006** — Refunds, participant merge, subscription upgrade RPCs
- **0007**–**0009** — Entitlement/merge grants, pay-per-class RPCs, conversion policy
- **0010**–**0013** — Event ledger + Phase 2/3 ops/analytics views + primary KPI summary
- **0014**–**0019** — Receipts, marketing leads, expenses, personal finance, discounts
- **0020** — `create_subscription` RPC, `sessions.cancelled_at`
- **20260608191715** — `marketing_leads` first/last name columns (formerly `0021`; matches live history)
- **20260914150818** — `waivers.idempotency_key` (formerly `0022`; in-repo, unapplied)
- **20260914185843** — `staff_users` / staff audit (formerly `0023`; in-repo, unapplied)
- **20260914202053** — `generate_sessions` RPC (formerly `0024`; in-repo, unapplied)

### 2.4 Make yourself admin

After migrations, only the **service_role** key (or a user in `app_admin`) can read/write data. To give your own login full access:

1. In Supabase Dashboard → **Authentication** → **Users**, create a user (or use existing) — e.g. your email. Copy the user’s **UUID**.
2. In **SQL Editor**, run (with service_role context, i.e. “Run” in the dashboard uses the service role):

```sql
insert into public.app_admin (id)
select id from auth.users where email = 'your@email.com';
```

Replace `your@email.com` with the address you use to sign in. From then on, that user has full access to all tables when using the **anon** or **authenticated** key (e.g. from the **dashboard** app or waiver app).

**Order of operations:** You can create the Auth user before or after running migrations. What matters is that before signing into the dashboard, (1) current **applied** migrations through **`20260608191715`** exist on the database, and (2) your auth user’s id is in `app_admin`.

### 2.5 Wiping the DB and starting fresh

Yes — you can wipe the database and start over for testing.

- **Supabase hosted (Dashboard):**  
  **Project Settings** → **General** → **Reset database**. This deletes all data and all Auth users, and clears applied migrations. After reset:
  1. Run migrations again (SQL Editor: run files in version order, or use `npm run supabase:push` if the project is linked). A full reset will also apply pending timestamped files (`20260914150818` onward) unless you stop after `20260608191715`.
  2. Create a new user under **Authentication** → **Users** (e.g. Add user → email + password).
  3. In **SQL Editor**, run:  
     `insert into public.app_admin (id) select id from auth.users where email = 'your@email.com';`

- **Supabase local (CLI):**  
  From the repo root: `npx supabase db reset`. That drops the DB and reapplies all migrations from scratch. You still need to create an Auth user and add them to `app_admin` (steps 2–3 above), since migrations don’t create users.

After that, you can use the dashboard (and waiver app) again with a clean DB.

---

## 3. Building and running

### 3.1 Waiver app

Run from the **`TU-Signup`** sibling repo:

```bash
cd ../TU-Signup
npm install
npm run dev
```

Build: `npm run build` in `TU-Signup`.

### 3.2 API (waiver PDF, etc.)

```bash
npm run dev:api
```

Or from `services/api`: `npm run dev`.  
Production: `npm run start` from root or from `services/api` (Render runs the same
workspace start; binds `PORT`).

**Health (local or production):**

- `GET /health` → `{ "ok": true }`
- `GET /health/deep` → `{ "ok": true, "db": true }` when Supabase is reachable

Production base URL: `https://api.templeunderground.com`. See [deployment.md](./deployment.md).

**CORS:** set `ALLOWED_ORIGIN` to a single origin when locking down browsers; if the
variable is absent, the API defaults to `*` (allow all).

### 3.3 API + waiver together

Start the API from this repo (`npm run dev`) and the waiver app from `TU-Signup` (`npm run dev`) in separate terminals.

---

## 4. Using the system day to day

### 4.1 Waivers and participants

- **Signing** — Participants use the waiver app; data goes to `participants`, `waivers`, `emergency_contacts`, `waiver_medical_histories`, `audit_trails`.
- **Viewing** — Use the view `view_waiver_documents` (Supabase Table Editor or SQL) for a joined snapshot.
- **PDFs** — Use your API’s waiver PDF endpoint (see `docs/waiver-pdf-generation.md` and `services/api` routes).

### 4.2 Gym admin (dashboard app + optional SQL)

Conceptually: **accounts** pay; **participants** consume. **Plans** define what’s offered; **subscriptions** attach a participant to a plan under an account. **Charges** are what’s owed; **payments** are what’s received; **payment_allocations** link payments to charges.

Preferred operator path is the **admin API** ([admin-api.md](./admin-api.md)): scheduling, subscription create, record-payment, discounts, and reporting views. Direct SQL still works for catalog setup (`plan_definitions`) and one-off repairs.

- **Plans** — Insert into `plan_definitions` (name, plan_category, billing_cadence, price_cents, etc.). Then add rows to `plan_entitlements` (e.g. group sessions or private minutes, limit_type, quantity, reset_rule like `calendar_week`).
- **Accounts** — One row per payer (family or individual). Optionally set primary_contact_*, notes.
- **Linking participants to accounts** — Insert into `account_members` (account_id, participant_id, role: member | payer | guardian).
- **Subscriptions** — Insert into `subscriptions` (account_id, participant_id, plan_definition_id, starts_at, status). Billing cycle is anchored to `starts_at` (day-of-month).
- **Charges** — Either insert manually, call `POST /api/admin/billing/generate-monthly-charges`, or run `select * from generate_monthly_charges();` (see section 5.2).
- **Payments** — Insert into `payments` (account_id, amount_cents, method, etc.). Then insert into `payment_allocations` (payment_id, charge_id, amount_cents). Mark charges as paid when fully covered (update `charges.status` to `'paid'`).
- **Sessions** — Insert into `sessions` (starts_at, ends_at, optional schedule_template_id, session_label).
- **Attendance** — Insert into `attendance_records` (session_id, participant_id, status: present | no_show | cancelled). “Present” consumes group session entitlements.
- **Private usage** — Insert into `private_usage` (participant_id, minutes_used, occurred_at, notes). Consumes private minutes entitlements.
- **Credits / overrides** — Use `entitlement_credits` for bonus minutes/sessions; use `access_overrides` (participant_id, allow_until, reason) to grant access outside normal entitlements.

**Useful reads**

- Who has availability: `select * from participant_entitlement_status where participant_id = '...';`
- Can they attend a group session: `select can_attend_group_session('participant-uuid', 'optional-session-label');`

---

## 5. Maintenance

### 5.1 Adding or changing the database

- Add a **new migration** with `npx supabase migration new <name>` so the version sorts after `20260914202053`. Do not edit, reorder, or reuse `0001`–`0020` / `20260608191715` / the three pending timestamped files.
- Apply: `npx supabase db push` or run the new file in SQL Editor.

### 5.2 Monthly charge generation

For **monthly** subscriptions, charges can be generated in bulk:

- **HTTP (supported):** `POST /api/admin/billing/generate-monthly-charges`  
  Auth matches Discord cron: header `x-admin-key` **or** `x-cron-secret` when `CRON_SECRET` is set. Success is `{ "ok": true, "created": N }`. The API logs the created count. No request body.
- **SQL Editor** (service_role):  
  `select * from generate_monthly_charges();`

The function only creates charges for `billing_cadence = 'monthly'` subscriptions that do not already have a non-void charge for the next `coverage_start`. A second run for the same period returns `created: 0`.

**Do not enable production cron for this route yet.** The endpoint exists so a later ops step can schedule it. Do not point the Discord digest Render cron (section 5.5) at this URL.

### 5.3 RLS and roles

- **Admin** — Add/remove admins by inserting/deleting from `app_admin` (do this with the **service_role** key or from Dashboard SQL, not from the anon app).
- **Service role** — Used for backend and scripts; it bypasses RLS. Never expose the service_role key in the browser or waiver app.

### 5.4 Backups

Use Supabase Dashboard → Project Settings → Backups (or your host’s backup policy). For critical changes, you can export data or take a dump before running migrations.

### 5.5 Discord daily digest (Render cron)

Staff Discord alerts are **outbound webhooks** from the API, not a scheduler
inside this repo. Full contract: [deployment.md](./deployment.md) (API-AUTO-002).

**Schedule one job only:** `POST /api/admin/notifications/discord/daily-digest`
daily at `0 13 * * *` UTC, header `x-cron-secret` matching env `CRON_SECRET`.
That digest already lists overdue and due-soon members. Do **not** also
schedule `POST /api/admin/notifications/discord/payment-reminders` at the same
time — it posts the same list and will double-spam the channel. Leave
payment-reminders for a manual click when you want an extra ping.

Env **names** (never commit values): `CRON_SECRET` and `DISCORD_WEBHOOK_URL` on
the API web service; `CRON_SECRET` on the Render Cron Job. The cron job curls
the public API; it does not need the webhook URL.

Create/suspend the Cron Job in the Render Dashboard (MCP cannot list this
account). Disable with **Suspend**, or rotate `CRON_SECRET` / clear
`DISCORD_WEBHOOK_URL` on the API.

This is **not** monthly charge generation (section 5.2 / API-AUTO-001). Do not
point a cron at a generate-monthly-charges HTTP route from this runbook.

---

## 6. Troubleshooting

| Problem | What to do |
|--------|------------|
| Can’t read/write any table from the app | You’re not admin. Sign in as the user that’s in `app_admin`, or add that user: `insert into public.app_admin (id) select id from auth.users where email = 'your@email.com';` (run with service_role). |
| “Permission denied” or empty results after signing in | Same as above: ensure that auth user’s id is in `app_admin`. Check: `select * from app_admin;` (as service_role). |
| Need to run admin-only SQL from Dashboard | Dashboard SQL uses service_role, so it bypasses RLS. No extra step. |
| Charge generation creates nothing | Subscriptions must be `status = 'active'`, plan must be `billing_cadence = 'monthly'`, and the next due date must be today or in the past. Check for existing charges for that period. |
| Waiver PDF fails | Confirm API has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` and that the waiver/participant data exists in the DB. |
| Discord digest cron fails / `401 unauthorized` | `CRON_SECRET` must be set on **both** the API and the cron job, and the cron must send header `x-cron-secret` (not `x-admin-key`). Check Render Cron Job logs. |
| Digest returns `500 discord_webhook_not_configured` | Set `DISCORD_WEBHOOK_URL` on the **API** web service (not on the cron job). |
| Digest returns `502` with `discord_http_…` | Discord rejected the webhook; see API logs `discord.webhook.failed`. |
| Two similar Discord reminder posts the same day | Digest already includes the overdue / due-soon list. Do not also schedule `payment-reminders`. Suspend the extra cron. |

---

## 7. Quick reference

### Make yourself admin (new project or new user)

```sql
insert into public.app_admin (id) select id from auth.users where email = 'YOUR_EMAIL';
```

### Generate monthly charges

```http
POST /api/admin/billing/generate-monthly-charges
x-admin-key: <ADMIN_API_KEY>
```

or `x-cron-secret` when `CRON_SECRET` is set. Response: `{ "ok": true, "created": N }`. Production scheduler is **not** enabled.

SQL fallback:

```sql
select * from generate_monthly_charges();
```

### Check a participant’s entitlements and usage

```sql
select * from participant_entitlement_status where participant_id = 'PARTICIPANT_UUID';
```

### Check if they can attend a group session

```sql
select can_attend_group_session('PARTICIPANT_UUID', null);
```

### npm scripts (from repo root)

- `npm run dev` / `npm run dev:api` — API only (this repo)
- `npm run start` — Run API (production)
- `npm run dev:dashboard` / `npm run dev:receipts` — Run from the **`admin`** repo
- `npm run dev` in **`TU-Signup`** — Waiver signup app

---

You can extend this doc as you add roles, schedulers, or new workflows. Operator UIs live in the `admin`, `TU-Signup`, and `marketing` sibling repos.
