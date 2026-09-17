# Docs

Read in this order for day-to-day work:

1. [current-state.md](./current-state.md) — what is verified vs unproven
2. [admin-api.md](./admin-api.md) — request/response contracts
3. [../work-queue/README.md](../work-queue/README.md) — live tasks (`queue.json` + `tasks/<ID>.md`)
4. [target-state.md](./target-state.md) and [reviewer-guide.md](./reviewer-guide.md) — direction and review bar
5. [validation-environment.md](./validation-environment.md) — non-production seed, cleanup, and VAL/HARD smokes (production DB out of bounds)

## Operating

| Doc | Use for |
| --- | --- |
| [current-state.md](./current-state.md) | Live status and production snapshot |
| [target-state.md](./target-state.md) | Intended outcomes and milestones |
| [decision-log.md](./decision-log.md) | Accepted ADRs |
| [reviewer-guide.md](./reviewer-guide.md) | Review severity and required checks |
| [admin-api.md](./admin-api.md) | HTTP contracts |
| [api-schema-audit.md](./api-schema-audit.md) | Live DB vs code |
| [api-capability-audit.md](./api-capability-audit.md) | Domain capability matrix |
| [use-guide.md](./use-guide.md) | Operator setup and day-to-day |
| [deployment.md](./deployment.md) | API host, platform, health, CORS, env names |
| [validation-environment.md](./validation-environment.md) | Local/non-prod validation: who may write, seed, cleanup |
| [database-overview.md](./database-overview.md) | Schema map |

## Domain references

These stay in the live tree because they explain behavior that `admin-api.md` does not.

| Doc | Use for |
| --- | --- |
| [application-ownership-and-data-flow.md](./application-ownership-and-data-flow.md) | Repo/app ownership |
| [architecture-flowcharts.md](./architecture-flowcharts.md) | Request paths |
| [v1-v2-application-map.md](./v1-v2-application-map.md) | Locked product decisions |
| [finance-subsystem-design.md](./finance-subsystem-design.md) | Bookkeeping design |
| [receipts-app.md](./receipts-app.md) | Receipts workflow from the API side |
| [event-ledger.md](./event-ledger.md) | How to read `event_ledger` |
| [phase2-high-impact-views.md](./phase2-high-impact-views.md) | Ops view semantics |
| [phase3-analytics-views.md](./phase3-analytics-views.md) | Analytics view semantics |
| [frontend-backend-payload.md](./frontend-backend-payload.md) | Waiver submit payload |
| [waiver-pdf-generation.md](./waiver-pdf-generation.md) | On-demand PDF renderer |
| [waiver-entrypoint-automation-checklist.md](./waiver-entrypoint-automation-checklist.md) | Submit → account tether (implemented; leftover monitoring checks) |

## Archived

Historical snapshots and superseded checklists live in [archive/](./archive/README.md). Do not treat them as current task lists or schema truth.
