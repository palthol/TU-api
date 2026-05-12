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

By default, paste the API `ADMIN_API_KEY` into the app when prompted. The key is held only in memory for the current page session.

## Optional environment-configured admin key

For a private/trusted deployment, you can configure:

```text
VITE_ADMIN_API_KEY=<same value as the API service ADMIN_API_KEY>
```

When this is present, the viewer uses it automatically and does not ask for a runtime key.

Important: `VITE_ADMIN_API_KEY` is a browser-exposed build variable. Anyone who can access the built viewer can inspect this value. Only use this for a locked-down/internal deployment. Do not use the Supabase service-role key here.

## MVP behavior

- Lists waivers as mobile-first cards.
- Sorts by:
  - most recent first
  - participant name alphabetically
- Expands a card to show participant, waiver, emergency contact, medical, and audit/document details.
