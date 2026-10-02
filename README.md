# Trilha

A web product that helps an individual advertising creative turn an arbitrary brief into creative concepts, using AI analysis and a catalog of editorial creative paths maintained in Notion.

## What exists today

| Area | State |
|---|---|
| Next.js application (App Router, TypeScript strict) | Accounts, jobs, immutable briefing revisions (S1); AI analysis, path recommendations, catalog explorer, manual and random selection, concept generation and editing, finalists, editable presentation (S2) |
| Database (`supabase/`) | Migrations for pgTAP, S1 and S2, applied to the hosted development project; S3 migration (not applied yet; applied by the manual `s3-migration` workflow); pgTAP tests for S1, S2 and S3 |
| S3 refinements | Reversible concept dismissal, immutable saved presentation versions with full-text copy, permanent owner-only job deletion |
| AI (`lib/ai/`) | Anthropic Messages API with structured output, validated again with Zod; server-only |
| Catalog import (`scripts/import-catalog.ts`) | Notion → Supabase snapshot of exactly 67 paths, all-or-nothing validation |
| Environment handling | `lib/env/`: Zod schemas, a server-only module for secrets, validation on use, unit tests |
| Quality checks | ESLint, TypeScript, Vitest, production build, GitHub Actions CI |
| Domain model documents | `docs/data-model/` (v1.1 to v1.4) |
| Current domain decisions | `docs/adr/0001-catalog-creative-paths.md` |
| Legacy prototype | `prototype/trilha-criativa-legacy.html` (simulated data, obsolete stages) |

**Not done yet:** the catalog has not been imported (it needs a Notion token), no AI key is configured, and the app is not deployed. Until then the app shows those steps as unavailable instead of simulating them.

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

## Dismissal, presentation versions and job deletion (S3)

Migration `20261002120000_s3_dismissal_versions_deletion.sql`, tests in `supabase/tests/database/s3_dismissal_versions_deletion.test.sql`.

1. **Dismissal.** `concepts.dismissed_at` (null means active). `set_concept_dismissed` dismisses or restores a concept of the caller's job; repeating either is a no-op. A check constraint keeps a concept from being a finalist and dismissed at once: a finalist must be taken out of the finalists first. Content and provenance never change.
2. **Presentation versions.** The generated presentation is an editable draft. `save_presentation_version` (“Guardar apresentação”) appends a row to `presentation_versions` with the structured content, the finalist titles as they read then, and the complete text rendered once by the database. Rows are never updated; each save is a new version, numbered per job. Existing presentations stay drafts; no version is created for them.
3. **Job deletion.** `delete_job` checks ownership, locks the job and its generation requests, and deletes every job-owned row and the job in one transaction. Job-owned rows stay undeletable everywhere else: their delete triggers allow a delete only for the job that `delete_job` is deleting in the same transaction (a marker in `private.job_deletions`, unreachable by API roles). Catalog rows are never touched.

Applying S3 to the development project: the manual workflow `.github/workflows/s3-migration.yml` (Actions → "S3 migration (willcriando dev)" → Run workflow, type `anhaonrifwakoekksopv`) applies this migration to `anhaonrifwakoekksopv` only, with Supabase CLI 2.119.0 (`supabase db push`), so the hosted history records version `20261002120000`. Steps, each failing closed, implemented in `.github/scripts/s3-migration/`:

1. Source: HEAD descends from `476377b3ed19c168ea95326ac2e1c64d79df094c`, `supabase/` is identical to it, the checkout is clean, and the migration's SHA256 is `135152c4d48849b61a134c379cd8b785fd05281951180c314a5a00c7e84b40e5`.
2. Target: the connection string is a session-mode (port 5432) connection for `anhaonrifwakoekksopv`.
3. Preflight, read-only: the hosted history is exactly the four prior migrations, no S3 object exists, the catalog has 67 paths, `supabase migration list` shows S3 as the only pending migration, and `supabase db push --dry-run` would push only S3. Row counts and content fingerprints are recorded.
4. `supabase db push`, once. A failure or timeout is never retried.
5. Read-only classification: applied (history has S3 exactly once and every S3 object exists), not applied (history and schema unchanged) or uncertain. Only "applied" continues.
6. Read-only validation of the S3 schema, grants and policies, and of record preservation (same counts and fingerprints as before; no presentation version is created).
7. The S1, S2 and S3 pgTAP files (41, 71 and 66 tests), each one transaction that rolls back, then a check that no record changed.

Required secret (repository or `willcriando-dev` environment): `SUPABASE_DB_URL`, the willcriando session pooler connection string (Dashboard → Connect → Session pooler, port 5432, user `postgres.anhaonrifwakoekksopv`, with the database password). GitHub runners have no IPv6, so the direct `db.anhaonrifwakoekksopv.supabase.co` host usually cannot be reached from them. No Supabase access token is needed. The workflow deploys nothing.

## Catalog import (S2)

The 67 editorial paths are copied from Notion into a versioned snapshot; the app never reads Notion at request time.

```bash
node scripts/import-catalog.ts --inspect   # property names and types, detected mapping
node scripts/import-catalog.ts             # fetch, map and validate; writes nothing
node scripts/import-catalog.ts --apply     # validate, then store the snapshot
```

It needs `NOTION_CREATIVE_PATHS_DATABASE_ID`, `NOTION_API_KEY` (optional where the environment injects the Notion credential; in cloud sessions run it with `NODE_USE_ENV_PROXY=1`) and, for `--apply`, `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, from the environment only. Any discrepancy (not exactly 67 valid pages, duplicate ids or numbers, missing text, ambiguous mapping) stops it before anything is written. Re-importing identical content is a no-op.

Online, the manual workflow `.github/workflows/catalog-import.yml` (Actions → "Catalog import (willcriando dev)" → Run workflow) runs the same importer against the development project `anhaonrifwakoekksopv` only: read-only validation, `--apply`, then `--apply` again, requiring the same snapshot id both times. It reads `NOTION_API_KEY`, `NOTION_CREATIVE_PATHS_DATABASE_ID`, `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from GitHub Actions secrets and prints only counts and the job summary.

## Server secrets for a deployment

Set in the hosting provider's secret store, never in files: `SUPABASE_SERVICE_ROLE_KEY` (backend generation functions only), `AI_PROVIDER_API_KEY` (Anthropic), optional `AI_MODEL`. The public variables are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Next increment

Import the catalog, configure the AI key and deploy a test environment, then run the browser test of the whole flow.
