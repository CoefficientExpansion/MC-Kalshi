import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

// Vitest only: never import this module from app code. PGlite is a devDependency, so a
// production import would fail the Vercel build, which is the intent.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * A fresh in-process Postgres with every committed migration applied (including the custom RLS
 * and append-only triggers). Each call is isolated; `ledger_entries` and `trades` reject
 * DELETE and TRUNCATE, so tests get a new database instead of cleaning up.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
