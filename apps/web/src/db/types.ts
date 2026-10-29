import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Any Drizzle Postgres database or transaction over this schema. Server code takes this instead
 * of the postgres-js `Db`, so the same functions run against Supabase and against PGlite in tests.
 */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;
