# Participants/Waivers Validation Results

Validation run target: linked Supabase database  
Date: 2026-03-24

## Artifacts

- `docs/(working)/participants-waivers-runtime-validation.sql`
- `docs/(working)/participants-waivers-validation-summary.sql`

## Summary Outcome

Status: **PASS**

| Check | Result |
|---|---|
| Required tables found | `9 / 9` |
| Required views found | `2 / 2` |
| Target FK constraints found | `7` |
| RLS enabled (target tables) | `8 / 8` |
| Admin policies found | `8 / 8` |
| Orphan waivers | `0` |
| Orphan emergency contacts (by waiver) | `0` |
| Orphan emergency contacts (by participant) | `0` |
| Orphan waiver medical histories | `0` |
| Invalid compliance rows (`view_ops_waiver_compliance_gaps`) | `0` |

## Notes

- This pass used read-only runtime checks and schema/policy introspection queries.
- Since all gate checks passed, KPI console implementation proceeded.
