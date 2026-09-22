# Cloudflare monthly-charge scheduler

This Worker runs once daily at **12:00 UTC** and invokes the existing protected
Temple Underground API endpoint:

`POST /api/admin/billing/generate-monthly-charges`

It does not connect to Supabase and does not hold a Supabase service-role key.
The API authenticates the Worker with `x-cron-secret` and invokes the
service-role-only `generate_monthly_charges()` RPC. That function is
idempotent: repeated calls cannot create a second monthly-period charge for the
same subscription coverage start.

## Required secrets and configuration

Set the exact same secret value in both locations:

- Render API web service: `CRON_SECRET`
- Cloudflare Worker: `CRON_SECRET`

Do not use `ADMIN_API_KEY` in this Worker. It is more privileged than needed.

`API_BASE_URL` is a non-secret Worker variable and defaults to the production
API URL in `wrangler.jsonc`.

## Deploy

From this directory, authenticate to the intended Cloudflare account and deploy:

```bash
npx wrangler secret put CRON_SECRET
npx wrangler deploy
```

The configured Cron Trigger is `0 12 * * *` (UTC). Cron changes can take up to
15 minutes to propagate.

## Verify safely

1. Confirm the API service has `CRON_SECRET` configured.
2. Deploy the Worker and inspect **Workers & Pages → tu-billing-cron → Logs**.
3. Use Cloudflare's Cron Trigger test/preview facility or wait for the first
   scheduled invocation.
4. Confirm an API log event named
   `billing.generate_due_charges.succeeded`. A successful run with
   `created: 0` is expected when no subscription period is due.
5. If the Worker logs `401`, rotate/check the shared `CRON_SECRET`; it must
   match exactly on Cloudflare and Render.

Do not manually hit a public Worker URL to test billing. The Worker intentionally
has no public billing endpoint; manual billing generation stays on the protected
API route.

## Disable

Remove the cron trigger from `wrangler.jsonc` by setting `"crons": []`, then
deploy, or disable/delete the Worker in the Cloudflare dashboard. Removing the
trigger can take up to 15 minutes to propagate.
