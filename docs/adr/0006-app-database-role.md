# ADR-0006: The app connects as a restricted `mc_app` role; migrations run as the owner
Date: 2026-10-29 · Status: Proposed (M3 Execution plan, assumption 4; owner to confirm)

## Context
The M2 security audit found that the app connects to Postgres as the table owner (`postgres` on
Supabase). The owner bypasses Row Level Security and can run `ALTER TABLE ... DISABLE TRIGGER`,
so one SQL-injection bug or one careless line of server code could switch off the append-only
triggers on `ledger_entries` and `trades` (migration 0001) and then rewrite history, which breaks
hard constraint 3. M3 is the first slice where user input writes the ledger (`placeTrade`), so the
blast radius of the app's database identity has to shrink before it ships.

## Decision
1. Migration `0005_app_role` creates a `NOLOGIN` role `mc_app` (not superuser, no `BYPASSRLS`,
   `CREATEDB` or `CREATEROLE`, owns nothing) with only what `src/server/*.ts` needs:
   `SELECT, INSERT` on `ledger_entries`, `trades`, `price_snapshots`; `SELECT, INSERT, UPDATE` on
   `balances`, `positions`, `markets`, `profiles`; `SELECT` on `categories`; `USAGE` on schema
   `public` and on `ledger_entries_id_seq`. No `DELETE`, `TRUNCATE` or DDL anywhere and no grant
   on `settings`, `disputes` or `audit_log` until code reads them.
2. RLS stays on and deny-all for everyone else. Because `mc_app` does not bypass RLS, each grant
   gets a matching permissive policy `TO mc_app` (`mc_app_select`, `mc_app_insert`,
   `mc_app_update`); `anon` and `authenticated` still match no policy, and migration
   `0003_hardening` revokes all their grants and default privileges in `public` as well.
3. Migrations, `db:studio` and `db:seed` keep running as the owner. `drizzle.config.ts` reads
   `MIGRATION_DATABASE_URL` when set, else `DATABASE_URL`.
4. Owner step, per Supabase project (`dev`, then `prod`; tracked in `docs/owner-todos.md`): in the
   SQL editor run `ALTER ROLE mc_app WITH LOGIN PASSWORD '…'`, then point `DATABASE_URL` (Vercel
   and `.env.local`) at `mc_app` (pooler user `mc_app.<project-ref>`) and keep the owner string in
   `MIGRATION_DATABASE_URL` on the machine that runs migrations, never in Vercel.

## Consequences
- Privilege checks run before triggers, so as `mc_app` an `UPDATE`, `DELETE` or `TRUNCATE` of
  `ledger_entries` or `trades` fails with `42501`, and `DISABLE TRIGGER` fails because `mc_app`
  is not the owner. Tests: `src/db/privileges.test.ts` (PGlite and the CI Postgres job).
- Until the owner step is done nothing changes at runtime: the app still connects as the owner.
  The role and grants exist from the migration on, so the switch is a configuration change only.
- Every future table needs its grant and `mc_app` policies in the migration that creates it, or
  the app gets `42501` (fail closed). New server code that reads `settings`, `disputes` or
  `audit_log` (M4 admin work) needs a migration adding those grants.
- `SELECT ... FOR UPDATE` needs `UPDATE`, which `markets` and `balances` have; locking `trades` or
  `ledger_entries` rows is impossible as `mc_app`, which no code path needs.
- `0003`'s `ALTER DEFAULT PRIVILEGES` covers objects created by the migrating role only; default
  grants Supabase holds for its own `supabase_admin` role are unaffected (it creates nothing in
  `public` here).
- Seeding needs the owner string because `mc_app` may not insert `categories`.

## Alternatives considered
- `BYPASSRLS` on `mc_app` instead of policies: simpler, but needs a privileged grant that Supabase's
  `postgres` role may not be able to give, and it would let a future grant mistake expose rows.
  Rejected.
- A `SECURITY DEFINER` function per write path (the app holds only `EXECUTE`): strongest, but
  moves the trade logic into SQL away from `packages/engine` and the TypeScript tests. Rejected for
  the MVP; revisit if the threat model grows.
- Keep the owner and rely on the triggers alone: the triggers stop accidents, not an attacker
  holding the owner's connection. Rejected.
