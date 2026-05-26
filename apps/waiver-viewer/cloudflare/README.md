# Waiver Viewer — Cloudflare Access deployment

This app should be deployed **without** any browser admin key. Access is enforced in two layers:

1. **Cloudflare Access** (login gate: GitHub, email OTP, etc.)
2. **API viewer proxy** (`GET /api/viewer/waiver-documents`) which verifies the Access JWT and your email allowlist

## Architecture

```text
Phone/browser
  -> Cloudflare Access (GitHub login, session cookie)
  -> Waiver viewer static app
  -> API /api/viewer/waiver-documents (verifies Cf-Access-Jwt-Assertion)
  -> Supabase view_waiver_documents
```

Recommended: serve **viewer and API on one hostname** (path-based routing) so Access session + JWT work reliably from the phone shortcut.

Example (one hostname, paths):

- `https://waivers.templeunderground.com/` → static viewer (`apps/waiver-viewer/dist`)
- `https://waivers.templeunderground.com/api/*` → API service (`services/api`)
- Waiver data endpoint: `https://waivers.templeunderground.com/api/viewer/waiver-documents`

### Is it `api.templeunderground.com/viewer`?

**Not quite.** The viewer app is a separate frontend; the API route is `/api/viewer/waiver-documents` (under `/api`, not a top-level `/viewer` page on the API host).

| Pattern | Example | Recommended? |
| --- | --- | --- |
| **One hostname, paths** | `waivers.templeunderground.com/` + `waivers.templeunderground.com/api/*` | **Yes** — simplest for phone shortcut + Access JWT |
| **Split hostnames** | Viewer on `waivers.*`, API on `api.*` | Works, but needs Access on **both** hosts + CORS; more setup |
| **API subdomain only** | `api.templeunderground.com/viewer` as the UI URL | **No** — that path is not the viewer app unless you add custom routing |

If you already use `api.templeunderground.com` for the main API, you can still add a **DNS alias** (e.g. `waivers.templeunderground.com`) that points to the same tunnel and uses path routing in `config.yml`. You do not need to mount the viewer UI at `api.*/viewer` unless you deliberately configure that path.

## API environment variables

Set on the API service (never in Vite `VITE_*` vars):

| Variable | What it is | Where to find it |
| --- | --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Your Cloudflare Zero Trust **team domain** (used to verify Access JWTs). | Zero Trust dashboard → often shown as `https://<team>.cloudflareaccess.com` — use `<team>.cloudflareaccess.com` (no `https://`). |
| `CF_ACCESS_AUD` | **Application Audience** — a unique ID for your Access app; must match the JWT. | Zero Trust → **Access** → **Applications** → your waiver app → **Application Audience (AUD)**. |
| `WAIVER_VIEWER_ALLOWED_EMAILS` | Server-side allowlist; only these emails can use the viewer API after passing Access. | Set to **your** email, e.g. `you@example.com`. No one else’s email should be listed. |
| `WAIVER_VIEWER_DEV_BYPASS` | Skips Cloudflare checks for local dev only. | `true` on your laptop only; **never** in production. |

Local development:

```bash
WAIVER_VIEWER_DEV_BYPASS=true
npm run dev:api
npm run dev:waiver-viewer
```

## Cloudflare Zero Trust setup

### 1) Identity provider — GitHub

1. Cloudflare Zero Trust → **Settings** → **Authentication**
2. Add **GitHub** as an identity provider
3. Connect your GitHub account/org as needed

### 2) Access application

1. Zero Trust → **Access** → **Applications** → **Add an application**
2. Type: **Self-hosted**
3. Application domain: `waivers.yourdomain.com` (or your tunnel hostname)
4. Identity providers: **GitHub** (and optionally others)
5. Policy: **Allow** → Include → **GitHub member** or **Emails** → your email only
6. Copy the application **AUD** value → set `CF_ACCESS_AUD` on the API

### 3) Session duration (“remember device”)

In the Access application settings:

- Increase **Session duration** (for example 24 hours or 7 days)
- Optionally configure **Same-site cookie** behavior for your domain

After the first GitHub login, your phone home-screen shortcut should usually open directly until the session expires.

### 4) Tunnel (cloudflared)

Use `config.yml.example` in this folder as a starting point:

- Route `/` to the built viewer (`apps/waiver-viewer/dist`)
- Route `/api` to `http://localhost:3001` (or your API host)

Run:

```bash
cloudflared tunnel run waiver-viewer
```

## Viewer build env

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Optional. Leave unset when API is same-origin (`/api/...`). Set full API URL only for split-host dev. |

Do **not** set `VITE_ADMIN_API_KEY` in production.

## Phone shortcut

1. Deploy and log in once through Access in mobile Safari/Chrome
2. **Share** → **Add to Home Screen**
3. Open from the icon; re-auth only when the Access session expires

## Security notes

- Cloudflare Access blocks unauthenticated users before they reach your app.
- The viewer proxy blocks authenticated users not on `WAIVER_VIEWER_ALLOWED_EMAILS`.
- `ADMIN_API_KEY` stays server-side only; the browser never receives it.
- Admin routes (`/api/admin/*`) remain separate and still require `x-admin-key`.

---

## Deployment checklist (copy to Trello)

Priority: **important, not urgent.** Check off when done.

### DNS and routing

- [ ] **Choose hostname** — e.g. `waivers.templeunderground.com` (recommended) for both UI and `/api/*`.
- [ ] **Create DNS alias** — CNAME (or tunnel route) for that hostname → Cloudflare Tunnel or origin.
- [ ] **Path routing** — `/` → waiver viewer static build; `/api/*` → `services/api` (see `config.yml.example`).
- [ ] **Confirm URL** — browser can open viewer at `/` and API health at `/api/...` on the **same** hostname.
- [ ] **Do not** set `VITE_ADMIN_API_KEY` on the viewer build.

### Cloudflare Zero Trust (Access)

- [ ] **Open Zero Trust** — [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → your team.
- [ ] **Note team domain** — copy value for `CF_ACCESS_TEAM_DOMAIN` (e.g. `something.cloudflareaccess.com`).
- [ ] **Add GitHub** identity provider (Settings → Authentication).
- [ ] **Create Access application** — Self-hosted; domain = `waivers.templeunderground.com` (or your chosen host).
- [ ] **Access policy** — Allow only your GitHub account or your email (deny everyone else).
- [ ] **Copy AUD** — from the application → use for `CF_ACCESS_AUD` on the API.
- [ ] **Session duration** — set 24h–7d if you want the phone shortcut to stay signed in longer.

### API environment variables (production)

Set these on wherever `services/api` runs (Render, VPS, etc.):

- [ ] `CF_ACCESS_TEAM_DOMAIN` = your `*.cloudflareaccess.com` team domain
- [ ] `CF_ACCESS_AUD` = Application Audience from the Access app
- [ ] `WAIVER_VIEWER_ALLOWED_EMAILS` = your email only (e.g. `you@example.com`)
- [ ] **Omit** `WAIVER_VIEWER_DEV_BYPASS` in production (or leave unset/false)

### Viewer app build

- [ ] `npm run build:waiver-viewer` — deploy `apps/waiver-viewer/dist` to static hosting behind the same hostname.
- [ ] Leave `VITE_API_BASE_URL` **unset** if viewer and API share one hostname (uses relative `/api/viewer/...`).
- [ ] Smoke test: log in via GitHub → Load waivers → data appears.

### Phone shortcut

- [ ] Log in once on mobile via Access.
- [ ] Add **Add to Home Screen** for `https://waivers.templeunderground.com/` (or your URL).
- [ ] Confirm reopening the shortcut does not ask for login until session expires.

### Optional later

- [ ] CLI or Slack tool using the same Access-protected API (not required for MVP).
- [ ] Separate `api.templeunderground.com` only if you need split hosts — then duplicate Access apps + CORS (more work).
