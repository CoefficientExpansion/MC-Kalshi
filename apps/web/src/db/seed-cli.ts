import { getDb } from "./index";
import { seedDatabase } from "./seed";
import { resolveMigrationDatabaseUrl } from "./url";

// `npm run db:seed`: seeds the database named by MIGRATION_DATABASE_URL, else DATABASE_URL, else
// POSTGRES_URL_NON_POOLING, else POSTGRES_URL (src/db/url.ts; apps/web/.env.local when present).
// An async main(), not top-level await: tsx runs this package's .ts files as CommonJS.
async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: rely on the process environment
  }

  // Seeding inserts categories, which the app role (mc_app, ADR-0006) may not do: use the owner
  // connection that migrations use, by the same precedence.
  const url = resolveMigrationDatabaseUrl();
  if (url) {
    process.env.DATABASE_URL = url;
  }
  const db = getDb();
  if (!db) {
    console.error("No database URL is set (see apps/web/.env.example): nothing to seed.");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await seedDatabase(db);
    console.log(
      `Seeded ${result.categoriesSeeded} categories; created ${result.marketsCreated} new markets.`,
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
