# SOP-05: Release to production

**Purpose**: ship `main` to prod safely and reversibly.
**Cadence**: whenever `main` has a user-visible change and the gate is green; at least weekly during beta.

## Steps
1. `main` is green in CI (lint, typecheck, tests, build). No open P1 issues.
2. Pending migrations: review the `drizzle/` diff; migrations must be additive or two-step (expand now, contract in a later release). Never drop a column in the same release that stops writing it.
3. Run migrations against Supabase `prod` (`npm run db:migrate` with the prod `DATABASE_URL`) **before** deploying code that needs them.
4. Promote the Vercel deployment of `main` to production (or let the production branch deploy automatically).
5. Smoke test on prod with a moderator account: sign in, open a market, place a 10-point trade, view portfolio, check the audit log entry. Reverse nothing; a 10-point trade is noise.
6. Tag: `git tag v0.<minor>.<patch>` and add a CHANGELOG line (date, what changed, migration yes/no).
7. Announce in the beta channel if behavior changed.
8. Push `main` to both remotes (`origin`, then `deploy`) or, if `main` was merged on GitHub, use "Sync fork" on `CoefficientExpansion/MC-Kalshi`. Vercel builds from the fork, so a missed push or sync means no deploy.

## Rollback
- Code: Vercel → promote the previous deployment (seconds).
- Schema: only if the migration was two-step; otherwise fix forward. This is why step 2 exists.

## Checks
- Ledger invariant job green after the release.
- No new env var missing in Vercel prod (compare with `.env.example`).
