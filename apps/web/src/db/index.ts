import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Server only: never import this module from a client component.
// Supabase's transaction pooler needs `prepare: false`; one connection per serverless instance.
// `connect_timeout` (5 s) sits above the health route's 2 s budget so a slow-but-live pooler is
// not mistaken for dead, yet frees the single connection quickly when a connect is stuck. `ssl: "require"` encrypts the session even when the URL
// carries no `sslmode`; move to "verify-full" with Supabase's CA before M2 stores user data.
function createClient(url: string) {
  const client = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 5,
    ssl: "require",
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createClient>;

// `next dev` re-evaluates this module on every hot reload; caching on globalThis stops each
// reload from opening another pooled connection.
const store = globalThis as typeof globalThis & { __mcKalshiDb?: Db };

/** The Drizzle client, or `undefined` when `DATABASE_URL` is not configured. */
export function getDb(): Db | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return undefined;
  }
  store.__mcKalshiDb ??= createClient(url);
  return store.__mcKalshiDb;
}

/** Cheapest possible round-trip, used by `GET /api/health`. */
export async function pingDatabase(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
