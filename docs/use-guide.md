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
| `apps/waiver-v2` | Waiver signup UI (Vite + React) |
| `apps/waiver-viewer` | Standalone mobile-first waiver review UI for trusted operators |
| `apps/dashboard` | Admin dashboard (Vite + React): waivers, participants, accounts, plans, subscriptions, billing, sessions, entitlement status; uses same Supabase DB |
| `services/api` | Express API: waiver PDF generation, can be extended for other endpoints |
| `supabase/migrations` | Database schema, RLS, view/function security, indexes (0001 → 0009). See `docs/database-overview.md` for what to expect. |

---

## 2. One-time setup

### 2.1 Supabase project

- Create a project at [Supabase](https://supabase.com).
- Copy **Project URL** and **anon key** (and **service_role key** for backend/script use only).

### 2.2 Environment

- **Waiver app** — If it talks to Supabase directly, set Supabase URL and anon key (e.g. in Vite env).
- **Dashboard app** — In `apps/dashboard`, copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same project as waiver). Use the **anon** / **public** (publishable) key from Project Settings → API, not the service_role key. Sign in with the admin user you add to `app_admin`.
- **API** — In `services/api`, add a `.env` with at least:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (for server-side PDF/DB access)
  - Optional notifications: `DISCORD_WEBHOOK_URL` and/or `SLACK_WEBHOOK_URL`
- **Waiver viewer app** — Set `VITE_API_BASE_URL` if the API is not at `http://localhost:3001`. For convenience on a private/trusted deployment, set `VITE_ADMIN_API_KEY` to the same value as the API service's `ADMIN_API_KEY`; because Vite exposes `VITE_*` values in the browser bundle, only do this when access to the viewer itself is restricted.

Keep `.env` out of git (already in `.gitignore`).

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

Or run the SQL files in order (0001 through 0006) in the Supabase Dashboard → SQL Editor.

Migrations do the following:

- **0001** — Participants, waivers, audit_trails + pgcrypto
- **0002** — Emergency contacts, waiver medical histories, waiver column
- **0003** — View `view_waiver_documents`
- **0004** — Gym schema (accounts, plans, subscriptions, billing, sessions, attendance, usage, overrides) + triggers
- **0005** — `generate_monthly_charges()`, view `participant_entitlement_status`, `can_attend_group_session()`
- **0006** — RLS: admin table, `private.is_admin()`, policies so only admins (and service_role) can access tables

### 2.4 Make yourself admin

After migrations, only the **service_role** key (or a user in `app_admin`) can read/write data. To give your own login full access:

1. In Supabase Dashboard → **Authentication** → **Users**, create a user (or use existing) — e.g. your email. Copy the user’s **UUID**.
2. In **SQL Editor**, run (with service_role context, i.e. “Run” in the dashboard uses the service role):

```sql
insert into public.app_admin (id)
select id from auth.users where email = 'your@email.com';
```

Replace `your@email.com` with the address you use to sign in. From then on, that user has full access to all tables when using the **anon** or **authenticated** key (e.g. from the **dashboard** app or waiver app).

**Order of operations:** You can create the Auth user before or after running migrations. What matters is that before signing into the dashboard, (1) migrations 0001–0006 have been applied, and (2) your auth user’s id is in `app_admin`.

### 2.5 Wiping the DB and starting fresh

Yes — you can wipe the database and start over for testing.

- **Supabase hosted (Dashboard):**  
  **Project Settings** → **General** → **Reset database**. This deletes all data and all Auth users, and clears applied migrations. After reset:
  1. Run migrations again (SQL Editor: run 0001 through 0006 in order, or use `npx supabase db push` if the project is linked).
  2. Create a new user under **Authentication** → **Users** (e.g. Add user → email + password).
  3. In **SQL Editor**, run:  
     `insert into public.app_admin (id) select id from auth.users where email = 'your@email.com';`

- **Supabase local (CLI):**  
  From the repo root: `npx supabase db reset`. That drops the DB and reapplies all migrations from scratch. You still need to create an Auth user and add them to `app_admin` (steps 2–3 above), since migrations don’t create users.

After that, you can use the dashboard (and waiver app) again with a clean DB.

---

## 3. Building and running

### 3.1 Waiver app

```bash
npm run dev:waiver
```

Or from `apps/waiver-v2`: `npm run dev`.  
Build: `npm run build:waiver` (from root) or `npm run build` in `apps/waiver-v2`.

### 3.2 API (waiver PDF, etc.)

```bash
npm run dev:api
```

Or from `services/api`: `npm run dev`.  
Production: `npm run start` from root or from `services/api`.

### 3.3 Both together

```bash
npm run dev
```

Runs waiver app and API in parallel.

---

## 4. Using the system day to day

### 4.1 Waivers and participants

- **Signing** — Participants use the waiver app; data goes to `participants`, `waivers`, `emergency_contacts`, `waiver_medical_histories`, `audit_trails`.
- **Viewing** — Use the view `view_waiver_documents` (Supabase Table Editor or SQL) for a joined snapshot.
- **PDFs** — Use your API’s waiver PDF endpoint (see `docs/waiver-pdf-generation.md` and `services/api` routes).

### 4.2 Gym admin (dashboard app + optional SQL)

Conceptually: **accounts** pay; **participants** consume. **Plans** define what’s offered; **subscriptions** attach a participant to a plan under an account. **Charges** are what’s owed; **payments** are what’s received; **payment_allocations** link payments to charges.

- **Plans** — Insert into `plan_definitions` (name, plan_category, billing_cadence, price_cents, etc.). Then add rows to `plan_entitlements` (e.g. group sessions or private minutes, limit_type, quantity, reset_rule like `calendar_week`).
- **Accounts** — One row per payer (family or individual). Optionally set primary_contact_*, notes.
- **Linking participants to accounts** — Insert into `account_members` (account_id, participant_id, role: member | payer | guardian).
- **Subscriptions** — Insert into `subscriptions` (account_id, participant_id, plan_definition_id, starts_at, status). Billing cycle is anchored to `starts_at` (day-of-month).
- **Charges** — Either insert manually or run `select * from generate_monthly_charges();` to create open charges for monthly subscriptions (see section 5).
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

- Add a **new migration** in `supabase/migrations` with the next number (e.g. `0007_my_change.sql`). Do not edit or reorder migrations that have already run.
- Apply: `npx supabase db push` or run the new file in SQL Editor.

### 5.2 Monthly charge generation

For **monthly** subscriptions, charges can be generated in bulk:

- In SQL Editor (as service_role or as admin, depending on how you call it):  
  `select * from generate_monthly_charges();`
- To automate later: use Supabase cron (pg_cron) or an external cron that calls the DB with the service_role key and runs that statement.

The function only creates charges for subscriptions that don’t already have a charge for the next period and only for `billing_cadence = 'monthly'`.

### 5.3 RLS and roles

- **Admin** — Add/remove admins by inserting/deleting from `app_admin` (do this with the **service_role** key or from Dashboard SQL, not from the anon app).
- **Service role** — Used for backend and scripts; it bypasses RLS. Never expose the service_role key in the browser or waiver app.

### 5.4 Backups

Use Supabase Dashboard → Project Settings → Backups (or your host’s backup policy). For critical changes, you can export data or take a dump before running migrations.

---

## 6. Troubleshooting

| Problem | What to do |
|--------|------------|
| Can’t read/write any table from the app | You’re not admin. Sign in as the user that’s in `app_admin`, or add that user: `insert into public.app_admin (id) select id from auth.users where email = 'your@email.com';` (run with service_role). |
| “Permission denied” or empty results after signing in | Same as above: ensure that auth user’s id is in `app_admin`. Check: `select * from app_admin;` (as service_role). |
| Need to run admin-only SQL from Dashboard | Dashboard SQL uses service_role, so it bypasses RLS. No extra step. |
| Charge generation creates nothing | Subscriptions must be `status = 'active'`, plan must be `billing_cadence = 'monthly'`, and the next due date must be today or in the past. Check for existing charges for that period. |
| Waiver PDF fails | Confirm API has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` and that the waiver/participant data exists in the DB. |

---

## 7. Quick reference

### Make yourself admin (new project or new user)

```sql
insert into public.app_admin (id) select id from auth.users where email = 'YOUR_EMAIL';
```

### Generate monthly charges

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

- `npm run dev` — Waiver app + API
- `npm run dev:waiver` — Waiver app only
- `npm run dev:dashboard` — Dashboard app (port 5174)
- `npm run dev:api` — API only
- `npm run build` / `npm run build:waiver` / `npm run build:dashboard` — Build
- `npm run start` — Run API (production)

---

You can extend this doc as you add an admin UI, more roles, or new workflows.
