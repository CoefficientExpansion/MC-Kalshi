-- Custom migration (hand-written): the app's runtime role. See docs/adr/0006-app-database-role.md.
--
-- The app connected as the table owner, which bypasses RLS and could disable the append-only
-- triggers (0001). `mc_app` holds only what the server code needs: no DELETE or TRUNCATE
-- anywhere, no UPDATE on `ledger_entries` or `trades`, no DDL, no ownership. It is created
-- NOLOGIN; the owner enables login and points DATABASE_URL at it (docs/owner-todos.md), while
-- migrations keep running as the owner (MIGRATION_DATABASE_URL). A new table needs its own
-- grant and policy in the migration that creates it.

-- Roles are cluster-wide: a second database on the same server finds it already there, and two
-- databases migrating at once may race to create it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mc_app') THEN
    CREATE ROLE mc_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO mc_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "ledger_entries", "trades", "price_snapshots" TO mc_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "balances", "positions", "markets", "profiles" TO mc_app;--> statement-breakpoint
GRANT SELECT ON "categories" TO mc_app;--> statement-breakpoint
GRANT USAGE ON SEQUENCE "ledger_entries_id_seq" TO mc_app;--> statement-breakpoint

-- RLS (0001) is deny-all and mc_app is not BYPASSRLS, so each grant above gets a matching
-- permissive policy for mc_app alone; anon and authenticated still match no policy.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'trades', 'price_snapshots', 'balances', 'positions',
                           'markets', 'profiles', 'categories'] LOOP
    EXECUTE format('CREATE POLICY mc_app_select ON %I FOR SELECT TO mc_app USING (true)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'trades', 'price_snapshots', 'balances', 'positions',
                           'markets', 'profiles'] LOOP
    EXECUTE format('CREATE POLICY mc_app_insert ON %I FOR INSERT TO mc_app WITH CHECK (true)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['balances', 'positions', 'markets', 'profiles'] LOOP
    EXECUTE format('CREATE POLICY mc_app_update ON %I FOR UPDATE TO mc_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;
