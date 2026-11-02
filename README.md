# Temple Underground API

Express API and Supabase schema for Temple Underground. Start with [AGENTS.md](./AGENTS.md) and [docs/README.md](./docs/README.md).

```bash
npm install
cp services/api/.env.example services/api/.env
npm run dev
```

API listens on `:3001`. Env **names** only live in `services/api/.env.example` and [docs/deployment.md](./docs/deployment.md). Never commit secrets.

## Public POST hardening

`POST /api/lead` and `POST /api/waivers/submit` are rate-limited per client IP (`express-rate-limit`). Defaults: **10 leads / 15 minutes**, **5 waiver submits / 15 minutes**. JSON body limits: **16kb** (lead) and **512kb** (waiver, sized for signature-pad PNG + `vectorJson`). `TRUST_PROXY` defaults to `1` for Render (do not set `true`).

Optional env names (defaults shown in `.env.example`):

- `TRUST_PROXY`
- `LEAD_RATE_LIMIT_MAX` / `LEAD_RATE_LIMIT_WINDOW_MS` / `LEAD_JSON_LIMIT`
- `WAIVER_SUBMIT_RATE_LIMIT_MAX` / `WAIVER_SUBMIT_RATE_LIMIT_WINDOW_MS` / `WAIVER_SUBMIT_JSON_LIMIT`
- `TURNSTILE_SECRET_KEY` — when set, those routes siteverify `turnstileToken` (or `cf-turnstile-response`) before Storage, PDF, or Discord/Slack. When unset, they log a warning and still accept the request.

Honeypot field: `website` (omit or leave blank).
