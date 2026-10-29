# M0 — Scaffold

Status: in-progress (awaiting merge) · Milestone: M0 · Research: none · ADRs: 0003 (stack), 0004 (development model), 0005 (REA scope)

## Problem

Nothing runs yet. Every later milestone (engine, auth, trading) needs a repo that installs, typechecks, lints, tests, builds, and deploys the same way locally, in CI, and on Vercel. M0 builds that skeleton and proves the whole pipeline end to end with a hello page, so M1 can start on engine math without touching tooling.

## Objective

A working npm-workspaces monorepo with `apps/web` (Next.js) and `packages/engine` (pure TypeScript), one command set at the root, CI on GitHub Actions, Drizzle wired to the Supabase `dev` project through `DATABASE_URL`, and `main` deploying a hello page on Vercel. Success: a fresh clone passes the local gate, CI is green on `main`, and the production URL serves the page.

## Assumptions (made without a reviewer; correct them and the spec changes first)

1. Next.js is scaffolded with `create-next-app@latest` defaults: App Router, `src/` directory, TypeScript, Tailwind v4, Biome (no ESLint), import alias `@/*`, Turbopack, no React Compiler, no Cache Components.
2. `packages/engine` ships only constants and one small pure function in M0 (`clampProbability`), with a unit test and a fast-check property test, to prove the test harness. LMSR math is M1.
3. Drizzle is wired (client, config, scripts, empty schema) but no migration is generated: there are no tables until M2 (profiles). `npm run db:migrate` against `dev` is therefore a no-op that still proves connectivity.
4. The health route never requires secrets: with no `DATABASE_URL` it reports `db: "unconfigured"` and still returns 200, so the first Vercel deploy works before the human enters any key.
5. No Playwright in M0 (first user-visible flow that moves points is M3). No shadcn/ui until the first real screen (M2).
6. CI runs on `origin` (`M4-on-Github/MC-Kalshi`) only; the fork Vercel watches has Actions off, which is fine because `main` is squash-merged on `origin` first.
7. Node is pinned to 24.22.1 (`.nvmrc`, `engines`), npm workspaces without Turborepo or pnpm.
8. The human performs: adding `M4-on-Github` as a collaborator on the fork (or pushing from the alt account), entering env vars in Vercel, and the final squash-merge and production push if the tool classifier blocks them.

## Scope

In:
- Root workspace: `package.json` (workspaces, scripts), `tsconfig.base.json`, `biome.json`, root `vitest.config.ts` with projects, `.nvmrc`, `.gitattributes`, `.env.example`.
- `packages/engine`: package, tsconfig, Vitest + fast-check, `src/index.ts` with `CONTRACT_PAYOUT_POINTS`, `PRICE_MIN`, `PRICE_MAX`, `clampProbability`.
- `apps/web`: create-next-app output trimmed to a hello page; `GET /api/health`; `src/lib/health.ts` (pure, tested); `src/db/{index,schema}.ts`; `drizzle.config.ts`; `db:*` scripts.
- `.github/workflows/ci.yml`: lint, typecheck, test, build on push to `main` and on pull requests.
- Vercel project `mc-kalshi`: Root Directory `apps/web`; production from the fork's `main`.
- Docs: README "Getting started" updated to the real commands; this spec; `docs/specs/README.md` row.

Out:
- Any table, migration, auth, UI component library, chart, market, or point logic.
- Playwright, Sentry, rate limiting, cron routes, Supabase auth hook.
- Entering any secret anywhere (human-only, SOP-07).

## Acceptance criteria

- [x] Given a fresh clone on Node 24.22.1, when `npm ci && npm run typecheck && npm run lint && npm test && npm run build` run, then every command exits 0.
- [x] Given `npm run dev`, when `GET /` is opened, then a page titled "MC-Kalshi" shows the product name and a one-line play-money tagline containing none of the words "bet", "$", or "cash out".
- [x] Given `DATABASE_URL` is unset, when `GET /api/health` is requested, then the response is `200 {"ok":true,"db":"unconfigured","commit":"<sha or dev>"}`.
- [ ] Given `DATABASE_URL` points at the Supabase `dev` project, when `GET /api/health` is requested, then `db` is `"ok"` and the response time is under 2 s.
- [x] Given `DATABASE_URL` is wrong, when `GET /api/health` is requested, then the response is `503` with `db: "error"` and the body contains no part of the URL or the error message.
- [x] Given `packages/engine`, when `npm test -w packages/engine` runs, then the unit test and a fast-check property (≥ 100 runs) for `clampProbability` pass.
- [x] Given a push to `origin/main` or a pull request, when the `ci` workflow runs on Node 24, then lint, typecheck, test, and build all pass.
- [ ] Given Vercel Root Directory `apps/web` and the fork's `main` at the merged commit, when Vercel deploys, then the production URL serves `/` and `/api/health` returns `db: "unconfigured"` until the human adds env vars.
- [x] Given `.env.example`, when compared with `grep -rn "process.env" apps packages`, then every variable the code reads has a line.

## Tech stack (versions as of 2026-10-28; recorded exactly in `package-lock.json`)

| Piece   | Choice                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Runtime | Node 24.22.1, npm 11 workspaces                                                                                   |
| Web     | Next.js 16.4 (App Router), React 19.3, Tailwind 4.3, TypeScript as pinned by create-next-app, `strict: true`      |
| Engine  | TypeScript, zero runtime dependencies, ESM                                                                        |
| Data    | drizzle-orm 0.45, drizzle-kit 0.31, `postgres` 3.4 driver, Supabase Postgres (pooled connection string on Vercel) |
| Quality | Biome 2.6 (lint + format), Vitest 5, fast-check 4                                                                 |
| CI/CD   | GitHub Actions (`ubuntu-latest`, Node 24, `npm ci`), Vercel Hobby from the fork                                   |

## Commands (root)

```
npm ci                      install exactly what package-lock.json says
npm run dev                 next dev in apps/web
npm run build               next build in apps/web (engine is consumed as source)
npm test                    vitest run, all workspace projects
npm run test:watch          vitest in watch mode
npm run typecheck           tsc --noEmit in every workspace
npm run lint                biome check .
npm run format              biome format --write .
npm run db:generate         drizzle-kit generate (apps/web)
npm run db:migrate          drizzle-kit migrate against DATABASE_URL (apps/web)
npm run db:studio           drizzle-kit studio (apps/web)
```
The local gate (SOP-02 step 5) is `npm run typecheck && npm run lint && npm test`.

## Project structure

```
.github/workflows/ci.yml       lint → typecheck → test → build
apps/web/
  src/app/layout.tsx           root layout, metadata title "MC-Kalshi"
  src/app/page.tsx             hello page
  src/app/globals.css          Tailwind import
  src/app/api/health/route.ts  GET handler; thin, calls lib/health
  src/lib/health.ts            pure: builds the health body from inputs
  src/lib/health.test.ts
  src/db/index.ts              drizzle(postgres(DATABASE_URL)) singleton; server only
  src/db/schema.ts             empty in M0; M2 adds tables
  drizzle/                     generated migrations (none in M0)
  drizzle.config.ts
  next.config.ts, tsconfig.json, package.json, vitest.config.mts, .env.example
                               (Tailwind is wired through @tailwindcss/turbopack in next.config.ts)
packages/engine/
  src/index.ts                 constants + clampProbability
  src/index.test.ts            unit + property tests
  package.json, tsconfig.json, vitest.config.ts
biome.json                     one config for the repo
package.json                   workspaces + root scripts
tsconfig.base.json             strict, ESNext modules, bundler resolution
vitest.config.mts              projects: packages/engine, apps/web
.nvmrc / .npmrc / .gitattributes
```

## Code style

Biome defaults: 2-space indent, double quotes, semicolons, trailing commas, 100-column lines. Named exports everywhere except Next.js route files, which must default-export. Exported functions carry explicit return types, except React components, which follow the create-next-app convention of inferred JSX return types. Inputs are typed at the boundary and never trusted (`unknown` in, validated out). No `any`, no non-null assertions in product code.

```ts
// packages/engine/src/index.ts
export const CONTRACT_PAYOUT_POINTS = 100;
export const PRICE_MIN = 1;
export const PRICE_MAX = 99;

/** Clamp a probability into the closed interval the engine quotes in: [0.01, 0.99]. */
export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) {
    throw new RangeError(`probability must be finite, got ${p}`);
  }
  return Math.min(PRICE_MAX / 100, Math.max(PRICE_MIN / 100, p));
}
```

## Testing strategy

- Vitest everywhere; tests live next to the code as `*.test.ts`.
- `packages/engine`: every exported function gets a unit test and a fast-check property (`numRuns ≥ 100`). M1 raises the coverage threshold to 95 % lines.
- `apps/web`: pure helpers in `src/lib` are unit-tested; route handlers stay thin so they need no HTTP test in M0.
- CI runs the same `npm test` as the local gate; nothing is mocked that touches the network (the health DB check is exercised only by hand against `dev`).
- Playwright arrives in M3 with the first point-moving flow.

## Data touched

None. `src/db/schema.ts` exports nothing; `drizzle/` is empty. The health route runs `select 1` through Drizzle when `DATABASE_URL` is set. No ledger reasons.

## UX

One static page: product name, one-line tagline ("Trade campus events with points. Play money, no cash, ever."), and a note that sign-in arrives in M2. No Kalshi pattern adopted yet.

## Boundaries

- Always: spec before code; test first for `packages/engine`; run the local gate before every commit; Conventional Commits, no Claude attribution; `.env.example` line for every new variable; keep route handlers thin and logic in `src/lib`.
- Ask first: dependencies beyond the stack table; changing `ci.yml` after it is green; any Vercel setting other than Root Directory; adding a table or migration; enabling Playwright early.
- Never: commit `.env*`; print a secret or a connection string in chat, logs, or the health body; edit `rea/`; push to the `deploy` remote or `main` on the human's behalf when the tool classifier blocks it; relax a hard constraint from `CLAUDE.md`.

## Risks / open questions

- `create-next-app` output drifts between releases; whatever it generates is trimmed to the structure above and recorded here if different.
- TypeScript's current major may be 7; the version create-next-app pins wins, and `packages/engine` reuses the hoisted root copy so the repo has one TypeScript.
- The stored git credential is `M4-on-Github`, which cannot push to the fork until it is a collaborator there. Until then the human pushes to `deploy`.
- Supabase `dev` free tier pauses after a week idle; the health route against `dev` may return `error` after a pause until the project is restored in the dashboard.

## Tasks (from /agent-skills:plan)

Dependency graph: root workspace → engine package → web app → health route → Drizzle wiring → CI → Vercel root directory → docs. Each task leaves `main`-mergeable state; the local gate is `npm run typecheck && npm run lint && npm test`.

1. **Root workspace and tooling** (S, 5 files: `package.json`, `.nvmrc`, `.gitattributes`, `tsconfig.base.json`, `biome.json`) — Acceptance: `npm install` succeeds with empty workspaces; `npm run lint` exits 0; all new files are LF. Verify by: `npm install && npm run lint`; `git ls-files --eol`.
2. **Engine package, test first** (M, 5 files: `packages/engine/{package.json,tsconfig.json,vitest.config.ts,src/index.test.ts,src/index.ts}` + root `vitest.config.ts`) — Acceptance: the test file fails before `src/index.ts` exists and passes after; fast-check property runs ≥ 100 cases; `npm run typecheck` exits 0. Verify by: `npm test -w packages/engine` red then green; `npm run typecheck`.
3. **Web app scaffold trimmed to a hello page** (M, create-next-app output: `apps/web/{package.json,tsconfig.json,next.config.ts,src/app/layout.tsx,src/app/page.tsx,src/app/globals.css}`) — Acceptance: `npm run build` exits 0; `/` renders title "MC-Kalshi" and the tagline; no "bet"/"$"/"cash out" in page copy; Biome clean. Verify by: `npm run build`; `npm run dev` + `curl -s localhost:3000 | grep MC-Kalshi`; `npm run lint`.
   - **Checkpoint A**: full local gate green; commit per task so far.
4. **Health route, unconfigured path, test first** (S, 3 files: `apps/web/src/lib/health.test.ts`, `src/lib/health.ts`, `src/app/api/health/route.ts`) — Acceptance: `buildHealth({ dbCheck: undefined })` → `{ ok: true, db: "unconfigured", commit }`; route returns that with 200 when `DATABASE_URL` is unset. Verify by: `npm test -w apps/web`; `curl -i localhost:3000/api/health`.
5. **Drizzle wiring, ok and error paths** (M, 5 files: `apps/web/src/db/index.ts`, `src/db/schema.ts`, `drizzle.config.ts`, `.env.example`, `apps/web/package.json` scripts + deps) — Acceptance: with a bad `DATABASE_URL` the route returns 503 `db: "error"` and the body contains neither the URL nor the driver message; `npm run db:generate` reports nothing to generate; `.env.example` lists `DATABASE_URL`. Verify by: `DATABASE_URL=postgres://x:y@127.0.0.1:1/z npm run dev` + curl; `npm run db:generate`; `grep -rn "process.env" apps packages` vs `.env.example`. The `db: "ok"` case is verified by the human against `dev` (needs the secret).
6. **CI workflow** (XS, 1 file: `.github/workflows/ci.yml`) — Acceptance: on push, Actions runs `npm ci`, lint, typecheck, test, build on Node 24.22.1 with npm cache and passes. Verify by: push `feat/m0-scaffold` to `origin`, then `curl -s https://api.github.com/repos/M4-on-Github/MC-Kalshi/actions/runs?branch=feat/m0-scaffold` shows `conclusion: success`.
   - **Checkpoint B**: CI green on the branch; review passes (`/code-review`, `/agent-skills:review`) with findings recorded below.
7. **Vercel Root Directory** (settings change, no files) — Acceptance: project `mc-kalshi` has Root Directory `apps/web` and "Include files outside root directory" on. Verify by: Settings → General screenshot; a deploy after the human pushes `main` to `deploy` serves `/` and `/api/health`.
8. **Docs** (S, 3 files: `README.md`, `docs/sops/SOP-07-environment-and-secrets.md`, this spec) — Acceptance: README "Getting started" lists the real commands; SOP-07 state row for Vercel says Root Directory is set; spec DoD ticked except the human items. Verify by: read-through.
9. **Ship** — `/agent-skills:ship`; push the branch to `origin`; the human squash-merges to `main` and pushes `main` to `deploy`, then checks the production URL (DoD "preview checked by a human").

## Review (SOP-02 step 6)

Five-axis review of `main...feat/m0-scaffold` on 2026-10-29. Verdict: approve after the fixes below (commit `e49f37d`).

| Severity | Finding | Action |
|---|---|---|
| Important | `engines.node` was `>=24.22.1 <25` with `engine-strict` on; Vercel picks its own 24.x patch, so `npm ci` could fail there on a patch mismatch | Changed to `24.x`; the exact pin stays in `.nvmrc` for local and CI |
| Important | `postgres()` client had no `idle_timeout`/`connect_timeout`; a frozen serverless instance could hold a pooler slot and a dead network could hang past the health timeout | Added `idle_timeout: 20`, `connect_timeout: 10` |
| Nit | Engine test imported `./index.js` while the web test imported `./health` | Dropped the extension (bundler resolution) |
| Consider | `actions/checkout@v5` and `actions/setup-node@v5` are pinned by major tag, not SHA | Deferred to M5 hardening (`/security-review`) |
| FYI | `/api/health` is public on production and runs `select 1` per request (one connection, 2 s timeout). Fine for M0; rate limits arrive in M5 | None |
| FYI | `getDb()` returns `undefined` without `DATABASE_URL`; M2 adds a `requireDb()` for code paths that cannot run without a database | None |

Correctness: matches the spec; error and timeout paths tested; the health body is built from fixed fields so no driver text can leak. Readability: route handlers are thin; names match the spec. Architecture: engine has zero runtime deps; db access is server-only by convention (no client components exist yet; a `server-only` guard is an M2 ask-first dependency). Security: no secrets in code; `.env.example` matches `process.env` reads; Vercel Authentication protects previews. Performance: nothing unbounded.

Bug-hunt pass (`/code-review medium`), nine findings, all addressed in the follow-up commit: `connect_timeout` lowered to 5 s so a stuck connect cannot hold the single connection past the health budget; CI now also runs on `pull_request` to `main`; the DB client is cached on `globalThis` so `next dev` hot reloads do not leak pooled connections; `drizzle.config.ts` warns clearly when `DATABASE_URL` is unset; the spec index row was restored (an earlier `git checkout` of Markdown files had reverted it); root Vitest config renamed to `.mts` to silence Vite's CommonJS warning; `apps/web/vitest.config.mts` added with the `@` alias; spec structure text corrected (no `postcss.config.mjs`, `.env.example` lives in `apps/web`, closed interval); the route now asks `getDb()` instead of re-reading `DATABASE_URL`.

## Ship decision (SOP-02 step 7, `/agent-skills:ship`): GO, pending two human actions

Three specialist passes ran on 2026-10-29 against the branch; their findings were folded into commit `4fec650`.

- **code-reviewer**: Approve. No Critical or Important findings. Applied: `ssl: "require"` on the DB client, `poweredByHeader: false`, CI `permissions: contents: read`, `pingDatabase(db)` so the route does one lookup and the unconfigured throw is gone, comment wording on `connect_timeout`, identity property for `clampProbability`, spec exemption for React component return types. Not applied: collapsing CI to `push: branches: [main]` (same-repo PRs run the gate twice; accepted so a pushed branch gets CI before a PR exists); dark-mode variants on the hello page (replaced in M2).
- **security-auditor**: GO, 0 Critical/High, 1 Medium (plaintext Postgres session by default). Fixed in code and config: the client forces TLS, `.env.example` asks for `?sslmode=require` for drizzle-kit, and "Enforce SSL on incoming connections" is on in both Supabase projects (each restarted once; no data existed). Deferred with the spec's agreement: SHA-pinned actions plus Dependabot (M5), security `headers()` and `server-only` guard (M2), rate limit on `/api/health` (M5), sanitized server-side logging of health failures (M2). Dev-only esbuild advisory via drizzle-kit: no production exposure.
- **test-engineer**: nothing blocks merge. Added: default 2 s timeout pinned, timer cleanup, late rejection after timeout, empty commit treated as unset, `-Infinity` rejected, hello-page copy guard for hard constraint 1 (`page.test.ts`). Engine identity/monotonic properties and `getDb`/route tests wait for M1/M2.

Blockers: none in the diff. Condition: the TLS settings above are in place before `DATABASE_URL` is entered into Vercel (done). The repos stay public by the owner's decision (unofficial project); SOP-07 now records that and the no-user-data rule that goes with it.

Rollback plan: the only production artifact is a static page plus `/api/health`. Trigger: Vercel build failure after the Root Directory change, or `/` not serving. Procedure: Vercel → Deployments → promote the previous deployment (none exists yet, so instead revert the merge commit on `main` and push to `deploy`); no schema, no data, no env vars to unwind. Recovery time objective: under 10 minutes.

## Definition of Done

- [ ] Acceptance criteria met and demonstrated (test or screenshot)
- [x] Unit tests for logic; Playwright for any user-visible flow that moves points (none in M0)
- [x] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [x] No secrets in code; new env vars documented in `.env.example`
- [x] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human

## Next

Built, reviewed by three specialist passes, hardened, and green on CI at `4fec650` (`feat/m0-scaffold`, pushed to `origin`). Remaining for the human:
1. Squash-merge `feat/m0-scaffold` into `main` on GitHub, then push `main` to the fork (`git push deploy main` after adding `M4-on-Github` as a collaborator on the fork, or push from the alt account). Vercel builds from the fork with Root Directory `apps/web`.
2. Open the production URL: `/` shows the hello page, `/api/health` returns `db: "unconfigured"`. That ticks the two human DoD items; mark this spec `done`.
3. Before M2: put the Supabase `dev` `DATABASE_URL` (with `?sslmode=require`) into Vercel Preview and Production and into `apps/web/.env.local`; confirm `/api/health` reports `db: "ok"`.
4. Decide the public product name before any user sees the page (working name carries Kalshi's trademark; hard constraint 5); replace the default favicon at the same time.
Then M1: LMSR engine spec (`docs/specs/m1-engine.md`).
