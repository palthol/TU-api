# Waiver Viewer

Standalone, mobile-first waiver review app for trusted operators.

It intentionally lives outside the full dashboard so a phone can open only the waiver review workflow.

## Data source

The app calls the API with `x-admin-key` and reads:

```text
GET /api/admin/reporting/views/waiver-documents
```

That endpoint is backed by the existing Supabase view:

```text
view_waiver_documents
```

No browser service-role key is used.

## Run

```bash
# from repo root
npm run dev:api
npm run dev:waiver-viewer
```

Open the Vite URL, usually:

```text
http://localhost:5176
```

Set `VITE_API_BASE_URL` if the API is not at `http://localhost:3001`.

Paste the API `ADMIN_API_KEY` into the app when prompted. The key is held only in memory for the current page session.

## MVP behavior

- Lists waivers as mobile-first cards.
- Sorts by:
  - most recent first
  - participant name alphabetically
- Expands a card to show participant, waiver, emergency contact, medical, and audit/document details.
