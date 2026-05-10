# Admin dashboard (internal)

shadcn-style UI (Tailwind + Radix) for admin workflows:

- **Merge** participants  
- **Write-off** (`POST /api/admin/billing/charge-adjustments`)  
- **Refund** (`POST /api/admin/billing/payment-refunds`)  
- **Upgrade** (`POST /api/admin/billing/subscription-upgrade`)  
- **Waiver** signed URL lookup (`GET /api/admin/waivers/:id`)

See [docs/admin-api.md](../../docs/admin-api.md).

## Run

```bash
# from repo root
npm install
npm run dev:dashboard
```

Set `VITE_API_BASE_URL` if the API is not at `http://localhost:3001`.

Paste **`x-admin-key`** only in trusted environments; it is not persisted.
