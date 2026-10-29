-- Custom migration (hand-written): tightening from the M3 security review. See
-- docs/adr/0006-app-database-role.md.
--
-- 1. mc_app held UPDATE on every column of `profiles` (0005), so a bug in app code could promote
--    a member to admin or lift a suspension. Role and suspension are admin decisions (M4, through
--    the owner connection or a narrower function), so the table-wide grant becomes column-level:
--    only the two settings a member changes about themselves (display name, M5; leaderboard
--    opt-out, SOP-09). Sign-in needs no UPDATE: ensureProfile inserts with ON CONFLICT DO NOTHING.
--    The mc_app_update policy (0005) stays; the column grant is what limits it.
REVOKE UPDATE ON "profiles" FROM mc_app;--> statement-breakpoint
GRANT UPDATE ("display_name", "leaderboard_opt_out") ON "profiles" TO mc_app;--> statement-breakpoint

-- 2. Postgres lets PUBLIC execute every new function by default. 0002 revokes that for the sign-up
--    hook by hand; from here on a function the migrating role creates is executable only by the
--    roles a migration grants it to. This is the global form on purpose: PUBLIC's EXECUTE is a
--    global default, and Postgres cannot revoke a global default per schema, so
--    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` would
--    change nothing. It applies only to functions the migrating role creates (not to existing
--    functions, nor to Supabase's own, which other roles create).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
