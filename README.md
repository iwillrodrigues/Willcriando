# Trilha

A web product that helps an individual advertising creative turn an arbitrary brief into creative concepts, using AI analysis and a catalog of editorial creative paths maintained in Notion.

## What exists today

| Area | State |
|---|---|
| Next.js application (App Router, TypeScript strict) | S1: email and password accounts, job list and creation, raw briefing saved as immutable revisions |
| Database (`supabase/`) | Migrations for pgTAP and S1 (`jobs`, `briefing_revisions`, RLS, one save function), pgTAP tests |
| Environment handling | `lib/env/`: Zod schemas, a server-only module for secrets, validation on use, unit tests |
| Quality checks | ESLint, TypeScript, Vitest, production build, GitHub Actions CI |
| Domain model documents | `docs/data-model/` (v1.1 to v1.4) |
| Current domain decisions | `docs/adr/0001-catalog-creative-paths.md` |
| Legacy prototype | `prototype/trilha-criativa-legacy.html` (simulated data, obsolete stages) |

**Not implemented yet:** AI analysis, Notion synchronization, the creative path catalog, path selection, concepts, finalists, presentation and deployment. The S1 migration is written and statically checked but has not been applied to the hosted project yet (see "Supabase (S1)").

## Product flow

Briefing → AI analysis → Explore creative paths → Apply selected path → Generate concepts → Select finalists → Presentation

A creative path is an editorial method from the catalog, not a final concept. It can be selected three ways: recommended by AI, picked manually, or drawn at random. The user always makes the final choice. See ADR 0001 for the full decision.

## Local setup

Requirements: Node.js 22.12 or newer, and npm.

```bash
npm ci
cp .env.example .env.local   # then fill the two NEXT_PUBLIC_SUPABASE_* values
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serves the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates Next.js route types, then runs `tsc --noEmit` |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest once |
| `npm run check` | Lint, typecheck, tests and build, in that order |

## Environment variables

`.env.example` lists names only. Never commit real values: every `.env*` file except the template is ignored by git.

| Variable | Scope | Used by (future) |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase clients (in use since S1) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase clients, protected by row-level security (in use since S1) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Reserved for privileged tasks; not used by S1 |
| `AI_PROVIDER_API_KEY` | Server only | AI analysis, recommendations, concepts |
| `NOTION_API_KEY` | Server only | Catalog synchronization |
| `NOTION_CREATIVE_PATHS_DATABASE_ID` | Server only | Catalog synchronization |

Rules in code:

1. Server secrets never use the `NEXT_PUBLIC_` prefix. Covered by unit tests.
2. Server secrets are read only through `lib/env/server.ts`, which imports `server-only`, so Next.js rejects the module if a Client Component imports it. No committed automated test covers this boundary; it was checked manually during implementation.
3. Each integration validates its own variables when it is called, never at import or build time. Covered by unit tests. Lint, typecheck, tests and build therefore need no credential.
4. Error messages name missing variables and never include values. Covered by unit tests.

The unit tests (`lib/env/schema.test.ts`, `lib/env/server.test.ts`) cover the environment schemas and helpers. They replace `server-only` with a stub, so they do not exercise the client import boundary.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request. It installs with `npm ci` from the committed lockfile, then runs lint, typecheck, unit tests and build. It uses no secrets.

## Supabase (S1)

Development uses a hosted Supabase project with fictional data only. No Docker or local Supabase is needed.

Migrations live in `supabase/migrations/` and are applied to the hosted project in timestamp order. When a migration is applied through the Supabase connector, the remote history records its own timestamp; rename the file to that timestamp so both histories match.

Database tests live in `supabase/tests/database/`. Each file runs in one transaction, rolls back, and ends with a single `SELECT` of the full TAP output, so it can be submitted as one SQL payload. Any failing assertion raises an error that lists it.

Auth settings the app expects (Supabase dashboard, Authentication):

1. Email provider enabled, with email and password sign-in.
2. If "Confirm email" is on, add `<app origin>/auth/confirm` to the allowed Redirect URLs (for example `http://localhost:3000/auth/confirm`). The confirmation link must be opened in the browser that created the account.
3. If "Confirm email" is off, sign-up signs the user in directly.

Access rules (enforced by the database):

1. A user sees and changes only their own jobs.
2. Briefing revisions are append-only; they are written only through `save_briefing_revision`, which checks ownership and numbers revisions under a row lock.
3. The `anon` role has no access to application tables or functions.

## Next increment

S2: publish the app so S1 can be tested at a public URL. The creative path catalog, AI analysis and the later stages follow.
