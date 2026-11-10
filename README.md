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
- **Cookie**: `__Host-tu_admin_session` (host-only; `HttpOnly; Secure; Path=/; SameSite=Strict`; no `Domain`).
- **Required env names** (see `services/api/.env.example`):
  - `SESSION_SECRET` (>= 32 chars; generate with `openssl rand -base64 48`)
  - `ADMIN_EMAIL` and `ADMIN_USER_ID` (Singh's confirmed Supabase Auth user)
  - `ADMIN_ALLOWED_ORIGINS` (admin UI origins; credentialed CORS + cookie CSRF allowlist)
  - `SUPABASE_ANON_KEY` (used for Supabase Auth password sign-in)
- **Optional**: `SESSION_SECRET_PREVIOUS` (decrypt-only during rotation), `SESSIONS_VALID_AFTER` (ISO timestamp; reject older `auth_time`).
- **CORS/CSRF**: `ALLOWED_ORIGIN` remains the public CORS list and never gets credentials. Only `ADMIN_ALLOWED_ORIGINS` get `Access-Control-Allow-Credentials: true` and pass cookie-auth CSRF. If `ADMIN_ALLOWED_ORIGINS` is unset, mutating cookie-auth requests return `403`.
- **Trust proxy**: `TRUST_PROXY` is the Render hop count (default `1`). Do not set `true`.

### Singh setup (production)

1. In the production Supabase project, disable public sign-ups.
2. Create Singh's Auth user, confirm the email, and copy the user id into `ADMIN_USER_ID`.
3. Generate `SESSION_SECRET` with `openssl rand -base64 48`. Set Render env vars: `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_USER_ID`, `ADMIN_ALLOWED_ORIGINS`, `SUPABASE_ANON_KEY` (plus optional `SESSION_SECRET_PREVIOUS` / `SESSIONS_VALID_AFTER`). Do not rotate keys from this change.

## Public POST hardening

`POST /api/lead` and `POST /api/waivers/submit` are rate-limited per client IP (`express-rate-limit`). Defaults: **10 leads / 15 minutes**, **10 waiver submits / 15 minutes**. JSON body limits: **16kb** (lead) and **512kb** (waiver, sized for signature-pad PNG + `vectorJson`). `TRUST_PROXY` defaults to `1` for Render (do not set `true`).

Optional env names (defaults shown in `.env.example`):

- `TRUST_PROXY`
- `TRUST_CF_CONNECTING_IP` — only when the origin is locked to Cloudflare; otherwise rate limits use `req.ip` and ignore `CF-Connecting-IP`
- `LEAD_RATE_LIMIT_MAX` / `LEAD_RATE_LIMIT_WINDOW_MS` / `LEAD_JSON_LIMIT`
- `WAIVER_SUBMIT_RATE_LIMIT_MAX` / `WAIVER_SUBMIT_RATE_LIMIT_WINDOW_MS` / `WAIVER_SUBMIT_JSON_LIMIT`
- `TURNSTILE_SECRET_KEY` — when set, those routes siteverify `turnstileToken` (or `cf-turnstile-response`) before Storage, PDF, or Discord/Slack. When unset, they log a warning and still accept the request.

Honeypot field: `website` (omit or leave blank).
