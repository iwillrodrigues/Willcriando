# Trilha

A web product that helps an individual advertising creative turn an arbitrary brief into creative concepts, using AI analysis and a catalog of editorial creative paths maintained in Notion.

## What exists today

| Area | State |
|---|---|
| Next.js application (App Router, TypeScript strict) | Minimal shell: one Portuguese page saying the MVP is under construction |
| Environment handling | `lib/env/`: Zod schemas, a server-only module for secrets, validation on use, unit tests |
| Quality checks | ESLint, TypeScript, Vitest, production build, GitHub Actions CI |
| Domain model documents | `docs/data-model/` (v1.1 to v1.4) |
| Current domain decisions | `docs/adr/0001-catalog-creative-paths.md` |
| Legacy prototype | `prototype/trilha-criativa-legacy.html` (simulated data, obsolete stages) |

**Not implemented yet:** AI analysis, Notion synchronization, Supabase, persistence, authentication, and every product screen. No external integration has been built or tested.

## Product flow

Briefing → AI analysis → Explore creative paths → Apply selected path → Generate concepts → Select finalists → Presentation

A creative path is an editorial method from the catalog, not a final concept. It can be selected three ways: recommended by AI, picked manually, or drawn at random. The user always makes the final choice. See ADR 0001 for the full decision.

## Local setup

Requirements: Node.js 22.12 or newer, and npm.

```bash
npm ci
cp .env.example .env.local   # optional for now: no variable is required yet
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
| `NEXT_PUBLIC_SUPABASE_URL` | Public (browser) | Supabase client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (browser) | Supabase client, protected by row-level security |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged database tasks |
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

## Next increment

Supabase foundation:

1. authentication for a single user;
2. `jobs` table;
3. immutable `briefing_versions`;
4. row-level security by owner;
5. creating and reopening an isolated job that survives a reload.

AI, Notion and product screens come after that.
