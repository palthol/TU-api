# Receipts / finance log app (`apps/receipts`)

## Who it is for

Single operator (gym owner): you. It is not framed as a multi-user staff product. The UI assumes you paste your own admin API key and run it on a trusted device.

## What problem it solves

1. **Day-to-day cash memory** — Log who paid and how much without knowing Supabase `accounts.id` or `charges.id`.
2. **Upcoming dues** — Create lightweight **invoice drafts** (who owes what, by when) so you can text someone before their monthly subscription date.
3. **Formal billing when you want it** — Optional path that uses the real billing tables (`payments`, `payment_allocations`, `receipts`) when you do have UUIDs from the payment board.

## Data model split

| Layer | Storage | When to use |
|-------|---------|-------------|
| **Personal log** | `personal_finance_entries` (`cash_received` or `invoice`) | Default: name, amount, method (cash), notes, or invoice due date. |
| **Formal billing** | `payments`, `payment_allocations`, `receipts` | When allocations must hit real `charges` and you need official receipt rows. |

Personal rows may optionally store `account_id` / `charge_id` later if you want to link them; the API already accepts those fields on POST if you choose to send them.

## Expected functionality (current)

- **Cash log** — Creates `cash_received` entry; share/copy draft SMS text.
- **Invoice** — Creates `invoice` entry with `due_at` (defaults to tomorrow in the UI if you leave it) and `invoice_status = draft`; share draft; status transitions: draft → sent → paid or void.
- **Recent** — Lists personal entries; quick buttons for invoice status.
- **Formal billing** — Same as before: `record-payment` + optional money-in receipt.
- **Board lookup** — Read-only payment board for UUID discovery.
- **Void / refund receipt** — Formal `receipts` table only.

## Automation (planned, not required for first use)

- Scheduled job (e.g. nightly) that loads `invoice` rows with `invoice_status = sent` and `due_at` approaching, then posts Discord or prepares a digest.
- Optional: when you are ready, generate or link real `charges` from invoice drafts (separate design).

## Related API

See `docs/admin-api.md` sections for:

- `POST /api/admin/billing/personal-finance-entries`
- `GET /api/admin/billing/personal-finance-entries`
- `POST /api/admin/billing/personal-finance-entries/:id/invoice-status`

## Local run

From repo root:

```bash
npm run dev:api
npm run dev:receipts
```

Use the same API base URL and `x-admin-key` as the dashboard. The dashboard header includes an **Open Receipts app** link (`VITE_RECEIPTS_APP_URL` or `http://localhost:5176`).
