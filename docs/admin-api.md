# Admin API — Temple Underground

All admin routes require the **`x-admin-key`** header matching **`ADMIN_API_KEY`** on the API server. Use HTTPS in production; never expose the admin key in public frontends (the optional `apps/dashboard` merge UI is for trusted operators only).

**Base URL:** same host as `services/api` (e.g. `http://localhost:3001`).

---

## Conventions

| Topic | Rule |
|--------|------|
| **Auth** | Header `x-admin-key: <ADMIN_API_KEY>` |
| **Supabase** | Server uses **service role**; internal billing/affiliate RPCs (`record_payment_refund`, `merge_participants`, `upgrade_subscription_prorated`, `upgrade_per_class_to_monthly`, `create_pay_per_class_charge`, `generate_monthly_charges`, `create_affiliation`, `record_payment_affiliate_credits`, `get_referrer_credit_balance`, `apply_credits_to_account`, `can_attend_group_session`) are **service_role execute only** (migrations `0007` through `0009`) |
| **Idempotency** | `POST .../payment-refunds` accepts optional `idempotency_key` (unique when set); replays return the same `refund_id` |
| **Backdated charges** | When inserting charges manually (SQL or future endpoint), set `coverage_start`, `coverage_end`, and `due_at` to the real period; add a `notes` reason (e.g. entered after class) |
| **Partial payments** | Sum of `payment_allocations` for a charge must not exceed **net due** from `view_charge_net` (`gross - affiliate credits - write-offs`). Sum of allocations per `payment_id` must not exceed `payments.amount_cents`. Enforce in app logic when building allocation UIs |
| **Card / invoice** | Prefer exact-amount payment links; if overcharged, record a **refund** for the difference (no wallet / unapplied credit) |
| **Discord** | Set **`DISCORD_WEBHOOK_URL`** on the API service for admin notification routes; messages are plain text (max ~2000 chars) |

---

## Endpoints

### `POST /api/lead` (public)

Stores a marketing-site trial inquiry in **`marketing_leads`**. No admin key. Rate-limit at the edge in production if needed.

**Body (JSON)** — align with `apps/marketing` (`name`, `goals`, `preferredTime`; at least one of `email` or `phone`):

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "",
  "goals": "first-class",
  "preferredTime": "Evenings after 6pm",
  "notes": "Optional"
}
```

**`goals`:** `first-class` | `fitness-confidence` | `competition` | `weight-management` | `youth-inquiry`

**Response:** `{ "ok": true }`

**Errors:** `400` — `invalid_name`, `email_or_phone_required`, `invalid_email`, `invalid_goals`, `invalid_preferred_time`, etc.

---

### `GET /api/admin/waivers/:id`

Existing: waiver metadata + signed URLs for PDF and signature.

---

### `POST /api/admin/billing/charge-adjustments`

Insert a **write-off** row (`charge_adjustments`). Reduces **net due** via `view_charge_net` (with affiliate credits).

**Body (JSON):**

```json
{
  "charge_id": "uuid",
  "amount_cents": 2500,
  "reason": "Hardship — agreed balance reduction",
  "created_by": "optional string"
}
```

**Response:** `{ "ok": true, "id": "<adjustment uuid>" }`

**Errors:** DB trigger if `affiliate_credit_applications + write-offs > charge.amount_cents`.

---

### `POST /api/admin/billing/payment-refunds`

Calls RPC `record_payment_refund`: inserts `payment_refunds`, shrinks `payment_allocations` FIFO, reopens `charges.status` from `paid` → `open` when allocations no longer cover net due. When cumulative refunds for the payment reach the full payment amount, `payments.status` is set to **`refunded`**.

**Body (JSON):**

```json
{
  "payment_id": "uuid",
  "amount_cents": 5000,
  "reason": "Medical partial refund",
  "idempotency_key": "optional-unique-string",
  "created_by": "optional override; defaults to admin_api"
}
```

**Response:** `{ "ok": true, "refund_id": "<uuid>" }`

**Validation (RPC):** payment must be `succeeded`; refund total ≤ payment amount; refund ≤ sum of allocations for that payment.

---

### `POST /api/admin/billing/subscription-upgrade`

Calls RPC `upgrade_subscription_prorated`: **upgrade only** (new plan `price_cents` > old). Inserts a **prorated delta** `charges` row for the rest of the current period (from `effective_date` or today through period end) and sets `subscriptions.plan_definition_id`.

**Body (JSON):**

```json
{
  "subscription_id": "uuid",
  "new_plan_definition_id": "uuid",
  "effective_date": "YYYY-MM-DD optional; defaults to current date in DB"
}
```

**Response:** `{ "ok": true, "proration_charge_id": "<uuid>" }`

---

### `POST /api/admin/billing/per-class/charge-from-attendance`

Calls RPC `create_pay_per_class_charge` to create one `charges` row from one attendance row.

Rules:
- Manual-only flow (no automatic trigger on attendance writes).
- Attendance must be `present`.
- Participant must have an active `per_session` subscription covering the attendance date.
- Idempotent by attendance row (same attendance returns the existing charge).

**Body (JSON):**

```json
{
  "attendance_record_id": "uuid",
  "due_at": "YYYY-MM-DD optional; defaults to session date",
  "notes": "optional text",
  "created_by": "optional override; defaults to admin_api"
}
```

**Response:** `{ "ok": true, "charge_id": "<uuid>" }`

---

### `POST /api/admin/billing/per-class/upgrade-to-monthly`

Calls RPC `upgrade_per_class_to_monthly`: ends the active `per_session` subscription as of `effective_date`, creates a monthly subscription, and optionally creates an initial monthly charge.

Policy:
- Explicit `conversion_policy` mode:
  - `no_credit` (default)
  - `manual_writeoff_allowed` (still no automatic deduction; admin may apply a manual write-off separately)

**Body (JSON):**

```json
{
  "participant_id": "uuid",
  "new_plan_definition_id": "uuid",
  "effective_date": "YYYY-MM-DD optional; defaults to current date in DB",
  "create_initial_charge": "boolean optional; defaults to true",
  "notes": "optional text",
  "conversion_policy": "optional: no_credit | manual_writeoff_allowed"
}
```

**Response:**

```json
{
  "ok": true,
  "old_subscription_id": "uuid",
  "new_subscription_id": "uuid",
  "initial_charge_id": "uuid | null"
}
```

---

### `POST /api/admin/billing/record-payment`

Creates a **succeeded** `payments` row, **`payment_allocations`** to one or more charges (same `account_id`), optionally a **`money_in`** receipt. Marks each charge **`paid`** when total allocations for that charge reach **net due** (`view_charge_net`).

**Body (JSON):**

```json
{
  "account_id": "uuid",
  "amount_cents": 15000,
  "method": "card",
  "issued_by": "front_desk",
  "allocations": [{ "charge_id": "uuid", "amount_cents": 15000 }],
  "paid_at": "ISO-8601 optional",
  "reference": "optional",
  "notes": "optional",
  "issue_receipt": true
}
```

**`method`:** one of `cash`, `card`, `cashapp`, `venmo`, `paypal`, `zelle`, `other` (see `PAYMENT_METHODS` in `billing.js`).

**Response:** `{ "ok": true, "payment_id": "uuid", "receipt_id": "uuid | null" }`

---

### `POST /api/admin/billing/receipts/:receiptId/void`

**Body:** `{ "void_reason": "required text" }`

**Response:** `{ "ok": true, "receipt_id": "uuid" }`

---

### `POST /api/admin/billing/receipts/issue-for-refund`

After a **`payment_refunds`** row exists: voids the active **`money_in`** receipt for that payment (if any) and inserts **`money_out_refund`** tied to the refund.

**Body:** `{ "payment_refund_id": "uuid", "issued_by": "required", "notes": "optional" }`

---

### `GET /api/admin/billing/marketing-leads`

**Query:** `limit` — optional, default `100`, max `500`

**Response:** `{ "ok": true, "rows": [ ... ] }`

---

### `GET /api/admin/billing/operating-expenses`

**Query:** `limit` — optional, default `100`, max `500`

**Response:** `{ "ok": true, "rows": [ ... ] }`

---

### `POST /api/admin/billing/operating-expenses`

**Body:**

```json
{
  "category": "rent",
  "amount_cents": 120000,
  "expense_date": "2026-04-01",
  "vendor_name": "optional",
  "notes": "optional",
  "created_by": "optional"
}
```

**`category`:** `rent` | `utilities` | `other`

**Response:** `{ "ok": true, "id": "uuid" }`

---

### `POST /api/admin/billing/personal-finance-entries`

Operator-owned rows in **`personal_finance_entries`**: quick cash log or lightweight invoice drafts. Does **not** replace `payments` / `receipts`; use formal billing routes when you need allocations against `charges`.

**Body — cash received**

```json
{
  "entry_kind": "cash_received",
  "member_display_name": "Jane Doe",
  "amount_cents": 15000,
  "method": "cash",
  "issued_by": "Your name",
  "notes": "optional",
  "account_id": "optional uuid",
  "charge_id": "optional uuid"
}
```

**`method`:** one of `cash`, `card`, `cashapp`, `venmo`, `paypal`, `zelle`, `other`.

**Body — invoice**

```json
{
  "entry_kind": "invoice",
  "member_display_name": "Jane Doe",
  "amount_cents": 15000,
  "issued_by": "Your name",
  "notes": "optional",
  "due_at": "2026-04-23",
  "invoice_status": "draft"
}
```

If `due_at` is omitted, the API defaults to **tomorrow (UTC date)**. `invoice_status` defaults to `draft` and must be one of `draft`, `sent`, `paid`, `void`.

**Response:** `{ "ok": true, "id": "<uuid>" }`

---

### `GET /api/admin/billing/personal-finance-entries`

**Query:** `limit` (optional, default `100`, max `500`), `entry_kind` (optional: `cash_received` or `invoice`)

**Response:** `{ "ok": true, "rows": [ ... ] }`

---

### `POST /api/admin/billing/personal-finance-entries/:entryId/invoice-status`

Updates **`invoice_status`** for an **`invoice`** entry only.

**Body:** `{ "status": "sent" }` — one of `draft`, `sent`, `paid`, `void`

**Response:** `{ "ok": true, "id": "<uuid>", "invoice_status": "sent" }`

---

### `POST /api/admin/notifications/discord/payment-reminders`

Reads **`view_member_payment_reminders`** (overdue + due within 3 days) and posts a formatted message to **`DISCORD_WEBHOOK_URL`**.

**Response:** `{ "ok": true, "posted": true, "rowCount": N }`

**Errors:** `500` — `discord_webhook_not_configured`; `502` — Discord HTTP failure

---

### `POST /api/admin/notifications/discord/daily-digest`

Posts a **daily summary** to Discord: new **`marketing_leads`** in the last 24 hours, counts for payment reminders, plus the same overdue / due-soon list as the payment-reminders route.

**Response:** `{ "ok": true, "posted": true, "summary": { "date", "reminderTotal", "overdueCount", "dueSoonCount", "marketingLeads24h" } }`

---

### `POST /api/admin/participants/merge`

Calls RPC `merge_participants`: repoints FKs from duplicate → canonical; sets `participants.merged_into_participant_id` and `merged_at` on the duplicate. Does **not** delete rows. If merging produces duplicate **active** `affiliate_referrals` rows for the same (referrer, referred), extras are ended (`status = ended`, `ended_at` set) so the partial unique index stays valid.

**Body (JSON):**

```json
{
  "canonical_participant_id": "uuid",
  "duplicate_participant_id": "uuid"
}
```

**Response:** `{ "ok": true }`

---

### `GET /api/admin/participants/search`

Participant-first lookup for finance and admin operator flows. Searches existing participants by name, email, or phone, then returns linked accounts and a preferred `account_id` when available.

**Query:**

- `q` — required string, minimum 2 characters
- `limit` — optional, default `8`, min `1`, max `25`

**Response:**

```json
{
  "ok": true,
  "rows": [
    {
      "participant_id": "uuid",
      "full_name": "Jane Doe",
      "email": "jane@example.com",
      "cell_phone": "555-111-2222",
      "home_phone": null,
      "account_count": 1,
      "preferred_account_id": "uuid",
      "accounts": [
        {
          "account_id": "uuid",
          "role": "payer",
          "account_status": "active",
          "account_primary_contact_name": "Jane Doe"
        }
      ]
    }
  ]
}
```

**Errors:** `400` — `query_min_length_2` (or DB/select errors)

---

## Database reporting (authenticated admins)

- **`view_charge_net`:** `gross_cents`, `credit_applied_cents` (affiliate), `write_off_cents`, `net_due_cents`
- **`view_member_payment_board` / `view_member_payment_reminders`:** use `net_due_cents` automatically via `view_charge_net`
- **`participant_entitlement_status`:** for limited plans, `remaining` = `max(0, limit - usage - credits_available)` so it matches `has_availability` (migration `0007`)

### `GET /api/admin/reporting/views/:slug`

Read-only preview of a **whitelisted** reporting view. Uses the API’s **service role** client (bypasses RLS). Intended for trusted operators.

**Query:**

- `limit` — optional, default `200`, max `500`
- `offset` — optional, default `0`, max `100000`
- `sort` — optional, view-specific sortable column
- `order` — optional `asc|desc` (default `desc` when sort is used)
- `start` / `end` — optional `YYYY-MM-DD` date range for views that expose a date column
- `revenue-waterfall-monthly` view-specific filters:
  - `min_net_cash_cents` — optional non-negative integer
  - `min_collected_cents` — optional non-negative integer
  - `max_refunded_cents` — optional non-negative integer

**Slugs → Postgres objects:**

| Slug | View / relation |
|------|------------------|
| `primary-kpis` | `view_analytics_primary_kpis_monthly` |
| `payment-board` | `view_member_payment_board` |
| `payment-reminders` | `view_member_payment_reminders` |
| `orphan-waivers` | `view_orphan_waivers` |
| `orphan-waiver-summary` | `view_orphan_waiver_summary` |
| `charge-net` | `view_charge_net` |
| `waiver-documents` | `view_waiver_documents` |
| `participant-entitlements` | `participant_entitlement_status` |
| `today-sessions` | `view_ops_today_sessions` |
| `upcoming-access-issues` | `view_ops_upcoming_access_issues` |
| `waiver-compliance-gaps` | `view_ops_waiver_compliance_gaps` |
| `ar-aging` | `view_ops_ar_aging` |
| `payment-risk` | `view_ops_unallocated_or_partial_payment_risk` |
| `revenue-waterfall-monthly` | `view_analytics_revenue_waterfall_monthly` |
| `subscription-movement` | `view_analytics_subscription_movement` |
| `attendance-utilization-weekly` | `view_analytics_attendance_utilization_weekly` |
| `entitlement-burn` | `view_analytics_entitlement_burn` |
| `affiliate-performance` | `view_analytics_affiliate_program_performance` |
| `data-hygiene` | `view_analytics_data_hygiene` |

**Response:** `{ "ok": true, "slug", "view", "limit", "offset", "sort", "order", "start", "end", "filters", "rowCount", "rows": [ ... ] }`

**Errors:** `400` with `unknown_view` and `allowed: [...]` if slug is not whitelisted; `400` if PostgREST/DB rejects the select.

---

### `GET /api/admin/reporting/summary/primary-kpis`

Primary KPI summary for a month window used by dashboard cards.

**Query:**
- `month` — optional `YYYY-MM`; defaults to current UTC month

**KPI definitions:**
- `expected_revenue_open_due_cents` — open due for charges due in selected month
- `actual_revenue_net_cash_cents` — net cash (`collected - refunded`) in selected month
- `total_visitors_present_checkins` — count of `attendance_records.status = 'present'` in selected month
- `current_monthly_members_active_count` — active monthly subscriptions as of `current_date`

**Response:**

```json
{
  "ok": true,
  "kpis": {
    "month_start": "2026-03-01",
    "month_end": "2026-03-31",
    "expected_revenue_open_due_cents": 0,
    "actual_revenue_net_cash_cents": 0,
    "total_visitors_present_checkins": 0,
    "current_monthly_members_active_count": 0
  }
}
```

---

### `GET /api/admin/finance/monthly-summary`

Monthly finance summary contract for dashboard export and bookkeeping sustainability checks.

**Query:**
- `month` — optional `YYYY-MM`; defaults to current UTC month

**Response:**

```json
{
  "ok": true,
  "summary": {
    "month": "2026-04",
    "month_start": "2026-04-01",
    "month_end": "2026-04-30",
    "revenue_cents": 185000,
    "expenses_cents": 120000,
    "operating_delta_cents": 65000,
    "deficit_to_cover_cents": 0,
    "owner_subsidy_cents": 0
  }
}
```

**Field definitions:**
- `revenue_cents` — net member cash for month (from `view_analytics_revenue_waterfall_monthly.net_cash_collected_cents`)
- `expenses_cents` — sum of `operating_expenses.amount_cents` for `expense_date` in month
- `operating_delta_cents` — `revenue_cents - expenses_cents`
- `deficit_to_cover_cents` — `max(0, expenses_cents - revenue_cents)`
- `owner_subsidy_cents` — currently `0` placeholder until subsidy-specific storage is introduced

---

## Waiver PDF routes

Mounted under `/api/waivers/*` with the same `requireAdmin` pattern where applicable (see `services/api/src/index.js`).

---

## Local dashboard (`apps/dashboard`)

- **Sidebar layout:** **Analysis** now starts with **Primary KPIs** (expected revenue, actual revenue, visitors, monthly members), then whitelisted reporting views for deeper inspection. **Administration** groups **Merge**, **Write-off**, **Refund**, **Upgrade**, **Pay-per-class**, and **Waiver** URLs.
- Sticky header: API base + admin key. Changing analysis view (or pasting the key) auto-loads data; **Refresh** re-fetches with the current row limit (max 500).
- `revenue-waterfall-monthly` includes quick date presets in the UI (`3M`, `6M`, `12M`, `YTD`) plus optional threshold filters for net cash / collected / refunded cents.
- `npm run dev:dashboard` (from repo root; run `npm install` in the monorepo first)
- Set `VITE_API_BASE_URL` if the API is not on `http://localhost:3001`
- `apps/marketing` dev server proxies `/api/*` to `http://localhost:3001` so `POST /api/lead` works when the API is running locally
- Paste **x-admin-key** only in trusted sessions; do not commit keys
