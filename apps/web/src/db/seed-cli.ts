import { getDb } from "./index";
import { seedDatabase } from "./seed";

// `npm run db:seed`: seeds the database named by MIGRATION_DATABASE_URL, else DATABASE_URL
// (apps/web/.env.local when present).
// An async main(), not top-level await: tsx runs this package's .ts files as CommonJS.
async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: rely on the process environment
  }

  // Seeding inserts categories, which the app role (mc_app, ADR-0006) may not do: prefer the
  // owner connection used for migrations when it is configured.
  if (process.env.MIGRATION_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  }
  const db = getDb();
  if (!db) {
    console.error("Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set: nothing to seed.");
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
