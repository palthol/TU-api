# Waiver Viewer

Standalone, mobile-first waiver review app for trusted operators.

It intentionally lives outside the full dashboard so a phone can open only the waiver review workflow.

## Data source

The app calls the **viewer proxy** (not admin routes directly):

```text
GET /api/viewer/waiver-documents
```

That endpoint is protected by Cloudflare Access (production) or a local dev bypass, and reads from the existing Supabase view:

```text
view_waiver_documents
```

No browser service-role key or `VITE_ADMIN_API_KEY` is used.

## Run locally

```bash
# from repo root
# API: allow local dev without Cloudflare Access
# (set in services/api/.env or your shell)
WAIVER_VIEWER_DEV_BYPASS=true

npm run dev:api
npm run dev:waiver-viewer
```

Open the Vite URL, usually:

```text
http://localhost:5176
```

Vite proxies `/api` to `http://localhost:3001`.

Optional: set `VITE_API_BASE_URL` if the API is not on the same origin during dev.

## Deploy with Cloudflare Access

See [cloudflare/README.md](./cloudflare/README.md) for:

- GitHub login via Cloudflare Zero Trust
- Email allowlist on the API
- Session duration / “remember device”
- Tunnel + single-hostname routing
- Phone home-screen shortcut

## MVP behavior

- Lists waivers as mobile-first cards.
- Sorts by:
  - most recent first
  - participant name alphabetically
- Expands a card to show participant, waiver, emergency contact, medical, and audit/document details.
