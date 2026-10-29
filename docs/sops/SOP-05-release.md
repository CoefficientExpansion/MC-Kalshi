# SOP-05: Release to production

**Purpose**: ship `main` to prod safely and reversibly.
**Cadence**: whenever `main` has a user-visible change and the gate is green; at least weekly during beta.

## Blocking, before Production gets any database URL (once per Supabase project)
**Production `DATABASE_URL` uses the `mc_app` role, never the `postgres` owner string** (ADR-0006).
Do this after migration `0005_app_role` has run on `prod` (step 3 below, run from your machine with the owner string) and before any database variable is saved in Vercel Production:
1. Supabase `prod` -> SQL Editor: `ALTER ROLE mc_app WITH LOGIN PASSWORD '<a new generated password>';` Generate the password in your password manager; never paste it into chat, an issue or a commit.
2. Build the pooled connection string with user `mc_app`: take the "Transaction" pooler string (port 6543) from Project Settings -> Database, replace the user with `mc_app.<project-ref>` and the password with the new one, and append `?sslmode=require`.
3. Vercel -> Settings -> Environment Variables -> Production: set it as `DATABASE_URL` (with `DATABASE_CA_CERT`). Do not rely on the Supabase integration's `POSTGRES_URL`, which logs in as the owner. Keep the owner string only in `MIGRATION_DATABASE_URL` on the machine that runs migrations, never in Vercel.
4. Redeploy and check `/api/health` reports `db: "ok"`.

The production role guard enforces this: with `VERCEL_ENV=production` the app runs `select current_user` on its first connection and, unless the answer is `mc_app`, refuses the database for the life of the instance (one `[db] refusing to connect` log line; `/api/health` reports `db: "error"`; pages show "not set up"). A `db: "error"` right after setting the URL usually means the owner string was used.

## Steps
1. `main` is green in CI (lint, typecheck, tests, build). No open P1 issues.
2. Pending migrations: review the `drizzle/` diff; migrations must be additive or two-step (expand now, contract in a later release). Never drop a column in the same release that stops writing it.
3. Run migrations against Supabase `prod` (`npm run db:migrate` from your machine with the prod owner string in `MIGRATION_DATABASE_URL`; `mc_app` cannot run DDL) **before** deploying code that needs them. On the first release, do the blocking section above before step 4.
4. Promote the Vercel deployment of `main` to production (or let the production branch deploy automatically).
5. Smoke test on prod with a moderator account: sign in, open a market, place a 10-point trade, view portfolio, check the audit log entry. Reverse nothing; a 10-point trade is noise.
6. Tag: `git tag v0.<minor>.<patch>` and add a CHANGELOG line (date, what changed, migration yes/no).
7. Announce in the beta channel if behavior changed.
8. Push `main` with `git push origin main`: `origin` has two push URLs, so this updates both `M4-on-Github/MC-Kalshi` and the fork `CoefficientExpansion/MC-Kalshi` that Vercel builds from. If `main` was merged on GitHub instead, push it from a local checkout, or use "Sync fork" on the fork as a fallback; a fork left behind means no deploy.

## Rollback
- Code: Vercel → promote the previous deployment (seconds).
- Schema: only if the migration was two-step; otherwise fix forward. This is why step 2 exists.

## Checks
- Ledger invariant job green after the release.
- No new env var missing in Vercel prod (compare with `.env.example`).
