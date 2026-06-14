# TU-API

Temple Underground backend: Express API and Supabase schema migrations.

This repository is the single source of truth for `services/api` and
`supabase/migrations/`. Front-end applications live in sibling repos.

## Quick start

```bash
npm install
cp services/api/.env.example services/api/.env   # fill in Supabase + admin key
npm run dev:api
```

## Related repositories

| Repo | Role |
|------|------|
| [TU-Signup](https://github.com/palthol/TU-Signup) | Public waiver / participant signup UI |
| **admin** | Dashboard, receipts, waiver viewer |
| **marketing** | Public marketing site |

See `AGENTS.md` for agent/contributor conventions and `docs/` for architecture
and API reference.

## Publishing TU-Signup (one-time split)

The waiver app was extracted to **TU-Signup**. This branch includes
`tu-signup-initial-import` — an orphan branch with the standalone signup repo
history. To populate the empty GitHub repo:

```bash
git push https://github.com/palthol/TU-Signup.git tu-signup-initial-import:main
```

Or clone TU-Signup locally and pull that branch.
