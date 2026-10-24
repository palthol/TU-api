# API-AUTO-005 — Discord waiver summaries with vCards

- Status: **done**
- Lane: automation
- Depends on: API-AUTO-002
- Production writes: no
- Evidence: merged to `develop` via [#46](https://github.com/palthol/TU-api/pull/46) (2026-10-14T15:39:06Z); released to `main` via [#47](https://github.com/palthol/TU-api/pull/47) (2026-10-14T15:40:06Z). No GitHub release tag for this cut (latest tag remains `v1.1.0`).

## What landed

Two Discord messages per newly persisted waiver: operator summary embed and a separate message with `.vcf` contact attachments. Medical wording withheld. Slack layout unchanged. See `docs/discord-waiver-notifications.md`. PR #47 left “Production deploy after merge (Render)” unchecked; this index records the git release, not a verified Render deploy.
