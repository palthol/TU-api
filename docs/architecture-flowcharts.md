# Application breakdown (flowcharts)

## What this codebase is

| Layer | Location | Role |
|--------|----------|------|
| Marketing site | `marketing/TU-web` (sibling repo) | Vite + React Router: public pages, schedule/pricing, lead capture → `POST /api/lead`. |
| Waiver / signup | `TU-Signup` (sibling repo) | Single-page wizard (`WaiverPage`): personal info, medical, legal, review; optional household modes; posts JSON to the API. |
| Waiver review | `admin/apps/waiver-viewer` (sibling repo) | Mobile-first waiver review UI (Cloudflare Access). |
| Operations admin | `admin/apps/dashboard` (sibling repo) | API base URL + `x-admin-key` — reporting views and admin actions (merge, write-off, refund, upgrade, waiver URL lookup). |
| Finance operator | `admin/apps/receipts` (sibling repo) | Cash log, invoices, formal billing, share text. |
| Backend API | [`services/api`](../services/api) | Express (`services/api/src/index.js`): waiver submit, admin routes, PDF generation mounted under `/api/waivers`. |
| Data | [`supabase/migrations`](../supabase/migrations) | Postgres schema + RLS patterns; Storage buckets for signatures and signed PDFs (referenced in API code). |

Root scripts ([`package.json`](../package.json)): `dev` and `start` run the API. Dashboard, receipts, marketing, and waiver signup run from sibling repos.

---

## Chart 1 — High-level system architecture

```mermaid
flowchart TB
  subgraph clients [Frontends]
    M[Marketing app]
    W[Waiver app]
    D[Dashboard ops app]
  end

  subgraph api [services/api Express]
    H["/health"]
    SUB["POST /api/waivers/submit"]
    PDF["GET /api/waivers/:id/pdf"]
    ADM["/api/admin/*"]
  end

  subgraph sb [Supabase]
    PG[(Postgres)]
    ST[Storage buckets]
  end

  M -->|"static content / links"| W
  W -->|JSON submit| SUB
  W -->|optional PDF download| PDF
  D -->|x-admin-key| ADM
  D -->|x-admin-key| PDF
  SUB --> PG
  SUB --> ST
  PDF --> PG
  ADM --> PG
```

---

## Chart 2 — Participant waiver submit flow (core "signup" path)

This matches the handler in [`services/api/src/index.js`](../services/api/src/index.js) (from validation through response).

```mermaid
flowchart TD
  A[User completes waiver wizard] --> B[POST /api/waivers/submit]
  B --> V{Validate body}
  V -->|400| E[Return field errors]
  V -->|ok| F[Find or insert participant by email DOB phone]
  F --> G[createOrBindParticipantAccount]
  G --> H[Generate waiver UUID]
  H --> I[Upload signature PNG to Storage]
  I --> J[Build PDF embed signature upload PDF]
  J --> K[Insert waivers row]
  K --> L[Insert emergency_contacts if any]
  L --> M[Insert waiver_medical_histories if any]
  M --> N[Insert audit_trails with SHA256]
  N --> R[200 JSON waiverId participantId account ids]
```

---

## Chart 3 — Admin / operations flow

The dashboard sidebar (`admin/apps/dashboard`) drives two families of behavior:

```mermaid
flowchart LR
  subgraph analysis [Analysis views]
    P[payment-board]
    C[charge-net]
    R[payment-reminders]
    E[participant-entitlements]
    WD[waiver-documents]
    O1[orphan-waiver-summary]
    O2[orphan-waivers]
  end

  subgraph admin [Admin tabs]
    MG[merge participants]
    WO[write-off]
    RF[refund]
    UP[plan upgrade]
    WL[waiver URLs]
  end

  D[Dashboard] --> analysis
  D --> admin
  analysis -->|GET /api/admin/reporting/views/:slug| API[Express]
  admin -->|POSTs under /api/admin/billing etc.| API
  WL -->|GET /api/admin/waivers/:id| API
```

Registered server routes include [`registerAdminBillingRoutes`](../services/api/src/routes/admin/billing.js), [`registerAdminParticipantRoutes`](../services/api/src/routes/admin/participants.js), and [`registerAdminReportingRoutes`](../services/api/src/routes/admin/reporting.js), all behind `requireAdmin` on [`/api/admin`](../services/api/src/index.js).

---

## Summary

- **Public funnel:** Marketing → (link) → Waiver app.
- **Core integration:** Waiver app → Express `POST /api/waivers/submit` → Supabase tables + Storage + account binding.
- **Back office:** `admin/apps/dashboard` and `admin/apps/receipts` (API key) → Express admin + reporting endpoints → same Supabase data.
