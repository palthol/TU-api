# API task claim

- Task ID: API-VAL-001
- Owner: Cursor Cloud Agent
- Claimed at: 2026-09-11
- Base branch: `develop`
- Base commit: `e5df987`
- Production write authorized: no
- Status: `done`

Note: the work-queue brief suggests branching as `agent/API-VAL-001-finance-smoke`, but this run uses the required Cursor Cloud branch naming scheme.

## Scope and allowed files

- `docs/current-state.md`
- `docs/api-schema-audit.md` checklist
- `work-queue/claims/API-VAL-001.md`
- `work-queue/queue.json` (API-VAL-001 row only)
- `work-queue/README.md` (API-VAL-001 row only)
- Test/script files only if a fixture bug must be fixed to complete the smoke

## Verification evidence

Executed (non-prod only; local Supabase + local API):

- `npm install`
- Local Docker was missing; installed `docker.io`, started `dockerd` in tmux, and set legacy iptables forward policy to ACCEPT so containers can talk.
- `npm run supabase:start` (log captured; contains local-only keys): `/opt/cursor/artifacts/supabase_start.log`
- `npm run dev:api` with local `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_API_KEY=local-admin-key` (tmux session: `api-val-001-api`)
- Seed (runId `39567f55`): `/opt/cursor/artifacts/tu_test_seed_billing.log`
- Finance + receipts smoke (happy + failure paths):
  - personal finance entries (create cash_received; invalid_entry_kind; invoice status update; invalid_status)
  - charge discounts (create/list; invalid_percent_basis_points; missing charge_id)
  - record-payment (happy; allocation_sum_must_equal_payment_amount)
  - receipt void (happy; receipt_not_found)
  - refund (record_payment_refund happy; reason_required; issue-for-refund happy; payment_refund_not_found)
  - Evidence log: `/opt/cursor/artifacts/api_val_001_smoke.log`
- Cleanup (execute): `/opt/cursor/artifacts/tu_test_cleanup_execute.log`
- `npm --workspace services/api run test` (63/63): `/opt/cursor/artifacts/services_api_vitest.log`

Did not do:

- No production writes.
- No requests to `https://api.templeunderground.com` or Supabase project `jhxzecxkccqlgyazhsnb`.

## Handoff or blocker

Done. Residual risk: `record-payment` is still non-atomic (API-HARD-001); failures mid-flow can leave partial rows.

