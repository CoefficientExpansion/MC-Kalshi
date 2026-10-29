import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env files; load the local one when present (absent in CI and on Vercel).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: rely on the process environment
}

// Migrations run as the table owner. Once the app connects as the restricted `mc_app` role
// (docs/adr/0006-app-database-role.md), MIGRATION_DATABASE_URL holds the owner's URL.
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.warn(
    "Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set: `db:generate` works, `db:migrate` and `db:studio` will not.",
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
