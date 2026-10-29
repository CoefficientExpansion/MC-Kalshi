import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "./src/db/url";

// drizzle-kit does not read .env files; load the local one when present (absent in CI and on Vercel).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: rely on the process environment
}

// Migrations run as the table owner. Once the app connects as the restricted `mc_app` role
// (docs/adr/0006-app-database-role.md), MIGRATION_DATABASE_URL holds the owner's URL. Precedence:
// MIGRATION_DATABASE_URL, DATABASE_URL, POSTGRES_URL_NON_POOLING, POSTGRES_URL (src/db/url.ts).
const url = resolveMigrationDatabaseUrl();
if (!url) {
  console.warn(
    "No database URL is set (MIGRATION_DATABASE_URL, DATABASE_URL, POSTGRES_URL_NON_POOLING or POSTGRES_URL): `db:generate` works, `db:migrate` and `db:studio` will not.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "" },
  strict: true,
  verbose: true,
});
