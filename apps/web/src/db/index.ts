import "server-only";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { resolveRuntimeDatabaseUrl } from "./url";

// Server only: never import this module from a client component.
// Supabase's transaction pooler needs `prepare: false`; one connection per serverless instance.
// `connect_timeout` (5 s) sits above the health route's 2 s budget so a slow-but-live pooler is
// not mistaken for dead, yet frees the single connection quickly when a connect is stuck.

/**
 * TLS options for the connection. With `DATABASE_CA_CERT` (the provider's CA certificate as PEM
 * text; literal `\n` escapes are accepted because the Vercel variable editor is single-line) the
 * server certificate and host name are verified. Without it, `"require"` still encrypts the
 * session but does not authenticate the server. Never log the value.
 */
export function buildSslOption(
  caCert: string | undefined,
): "require" | { ca: string; rejectUnauthorized: true } {
  const ca = caCert?.replace(/\\n/g, "\n").trim();
  return ca ? { ca, rejectUnauthorized: true } : "require";
}

function createClient(url: string) {
  const client = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 5,
    ssl: buildSslOption(process.env.DATABASE_CA_CERT),
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createClient>;

// `next dev` re-evaluates this module on every hot reload; caching on globalThis stops each
// reload from opening another pooled connection.
const store = globalThis as typeof globalThis & {
  __mcKalshiDb?: Db;
  __mcKalshiDbRefused?: true;
  __mcKalshiDbRoleCheck?: Promise<boolean>;
  __mcKalshiDbRoleRefused?: true;
};

/** The only role production may connect as (docs/adr/0006-app-database-role.md). */
export const APP_DB_ROLE = "mc_app";

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * The Drizzle client, or `undefined` when no runtime database URL (`DATABASE_URL`, else
 * `POSTGRES_URL`; see `./url`) is configured. In production (`VERCEL_ENV=production`) it also
 * refuses to connect when `DATABASE_CA_CERT` is unset or blank, so the server certificate is
 * always verified there; it logs that once, naming only the variable. It also returns `undefined`
 * once {@link getDbChecked} has found the production connection logged in as a role other than
 * {@link APP_DB_ROLE}. Code that reads or writes for a request uses `getDbChecked`.
 */
export function getDb(): Db | undefined {
  const url = resolveRuntimeDatabaseUrl();
  if (!url) {
    return undefined;
  }
  if (isProduction() && buildSslOption(process.env.DATABASE_CA_CERT) === "require") {
    if (!store.__mcKalshiDbRefused) {
      store.__mcKalshiDbRefused = true;
      console.error("[db] refusing to connect: DATABASE_CA_CERT is not set in production");
    }
    return undefined;
  }
  if (isProduction() && store.__mcKalshiDbRoleRefused) {
    return undefined;
  }
  store.__mcKalshiDb ??= createClient(url);
  return store.__mcKalshiDb;
}

/** The role the connection is logged in as. */
export type RoleQuery = (db: Db) => Promise<string>;

const queryCurrentUser: RoleQuery = async (db) => {
  const rows = await db.execute<{ current_user: string }>(sql`select current_user`);
  return String(rows[0]?.current_user ?? "");
};

/**
 * {@link getDb}, plus the production role guard: in production, the first call asks the database
 * `select current_user` and, unless the answer is {@link APP_DB_ROLE}, refuses the connection for
 * the life of the instance (returns `undefined` here and from `getDb`, logging one line without
 * secrets), so a DATABASE_URL holding the owner's string fails closed. Outside production it never
 * asks. A check that fails (database down) throws and is retried by the next call. `queryRole` is
 * injectable for tests.
 */
export async function getDbChecked(
  queryRole: RoleQuery = queryCurrentUser,
): Promise<Db | undefined> {
  const db = getDb();
  if (!db || !isProduction()) {
    return db;
  }
  if (!store.__mcKalshiDbRoleCheck) {
    store.__mcKalshiDbRoleCheck = queryRole(db).then((role) => role === APP_DB_ROLE);
  }
  const check = store.__mcKalshiDbRoleCheck;
  let allowed: boolean;
  try {
    allowed = await check;
  } catch (error) {
    if (store.__mcKalshiDbRoleCheck === check) {
      store.__mcKalshiDbRoleCheck = undefined;
    }
    throw error;
  }
  if (!allowed) {
    if (!store.__mcKalshiDbRoleRefused) {
      store.__mcKalshiDbRoleRefused = true;
      console.error(
        `[db] refusing to connect: the production database role is not ${APP_DB_ROLE} (ADR-0006)`,
      );
    }
    return undefined;
  }
  return db;
}

/** Cheapest possible round-trip, used by `GET /api/health`. */
export async function pingDatabase(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
