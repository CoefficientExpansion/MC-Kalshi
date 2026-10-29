// Which database URL each consumer uses (SOP-07, "Database URLs"). Supabase's Vercel integration
// sets POSTGRES_URL (pooled) and POSTGRES_URL_NON_POOLING rather than DATABASE_URL, so both are
// fallbacks. A blank value counts as unset. No `server-only` here: drizzle.config.ts imports it.
// Never log a returned value.

type Env = Readonly<Record<string, string | undefined>>;

function firstSet(env: Env, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/** The app at runtime: `DATABASE_URL`, else `POSTGRES_URL`. In production it must log in as mc_app. */
export function resolveRuntimeDatabaseUrl(env: Env = process.env): string | undefined {
  return firstSet(env, ["DATABASE_URL", "POSTGRES_URL"]);
}

/**
 * Migrations and seeding, which run as the table owner (ADR-0006): `MIGRATION_DATABASE_URL`, else
 * `DATABASE_URL`, else `POSTGRES_URL_NON_POOLING`, else `POSTGRES_URL`.
 */
export function resolveMigrationDatabaseUrl(env: Env = process.env): string | undefined {
  return firstSet(env, [
    "MIGRATION_DATABASE_URL",
    "DATABASE_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL",
  ]);
}
