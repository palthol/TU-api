# Temple Underground API

Express API and Supabase schema for Temple Underground. Start with [AGENTS.md](./AGENTS.md) and [docs/README.md](./docs/README.md).

```bash
npm install
cp services/api/.env.example services/api/.env
npm run dev
```

API listens on `:3001`. Env **names** only live in `services/api/.env.example` and [docs/deployment.md](./docs/deployment.md). Never commit secrets.

## Admin session auth (cookie)

The API supports cookie-based admin sessions for the admin UI while preserving existing `x-admin-key` scripts.

- **Routes**: `POST /api/auth/login` → `{ email }`, `GET /api/auth/me` → `{ email }` (rolling cookie), `POST /api/auth/logout` → `204`.
- **Required env names** (see `services/api/.env.example`):
  - `SESSION_SECRET` (>= 32 chars)
  - `ADMIN_EMAIL` (only this email may log in)
  - `SUPABASE_ANON_KEY` (used for Supabase Auth password sign-in)
  - `COOKIE_DOMAIN` (optional)
- **CORS/CSRF note**: credentialed CORS is enabled only when `ALLOWED_ORIGIN` is an explicit allowlist (never `*`). Cookie-authenticated mutating requests require an `Origin` header that matches the allowlist.

## Public POST hardening

`POST /api/lead` and `POST /api/waivers/submit` are rate-limited per client IP (`express-rate-limit`). Defaults: **10 leads / 15 minutes**, **5 waiver submits / 15 minutes**. JSON body limits: **16kb** (lead) and **512kb** (waiver, sized for signature-pad PNG + `vectorJson`). `TRUST_PROXY` defaults to `1` for Render (do not set `true`).

Optional env names (defaults shown in `.env.example`):

- `TRUST_PROXY`
- `LEAD_RATE_LIMIT_MAX` / `LEAD_RATE_LIMIT_WINDOW_MS` / `LEAD_JSON_LIMIT`
- `WAIVER_SUBMIT_RATE_LIMIT_MAX` / `WAIVER_SUBMIT_RATE_LIMIT_WINDOW_MS` / `WAIVER_SUBMIT_JSON_LIMIT`
- `TURNSTILE_SECRET_KEY` — when set, those routes siteverify `turnstileToken` (or `cf-turnstile-response`) before Storage, PDF, or Discord/Slack. When unset, they log a warning and still accept the request.

Honeypot field: `website` (omit or leave blank).
