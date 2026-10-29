import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";
import type { AnyDb } from "./types";

// Vitest only: never import this module from app code. PGlite is a devDependency, so a
// production import would fail the Vercel build, which is the intent.
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

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

export interface TestDbHandle {
  /** Works with every server function (they take `AnyDb`). */
  readonly db: AnyDb;
  /** Runs raw SQL and returns plain row objects, whichever driver is underneath. */
  rows<T = Record<string, unknown>>(query: SQL): Promise<T[]>;
  readonly backend: "pglite" | "postgres";
  /** The throwaway database's URL (real Postgres only), for opening more connections to it. */
  readonly url?: string;
  close(): Promise<void>;
}

export interface OpenTestDbOptions {
  /** Runs on the empty database before the migrations (for example to mimic Supabase's roles). */
  readonly beforeMigrate?: (db: AnyDb) => Promise<void>;
}

/** `TEST_DATABASE_URL` with its database name replaced. */
export function testDatabaseUrl(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * A fresh, fully migrated database. With `TEST_DATABASE_URL` set (the CI `postgres` job) each
 * call creates its own throwaway database on that server and `close()` drops it; otherwise it is
 * an in-process PGlite, as `createTestDb`. Suites written against this run on both.
 */
export async function openTestDb(options: OpenTestDbOptions = {}): Promise<TestDbHandle> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    try {
      await options.beforeMigrate?.(db);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } catch (error) {
      await client.close();
      throw error;
    }
    return {
      db,
      backend: "pglite",
      close: () => client.close(),
      rows: async <T>(query: SQL) => (await db.execute(query)).rows as T[],
    };
  }

  const name = `mck_t_${randomBytes(6).toString("hex")}`;
  const url = testDatabaseUrl(adminUrl, name);
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${name}"`);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema });
  const close = async () => {
    await client.end({ timeout: 5 });
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end({ timeout: 5 });
  };
  try {
    await options.beforeMigrate?.(db);
    await migratePostgres(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    await close();
    throw error;
  }
  return {
    db,
    backend: "postgres",
    url,
    rows: async <T>(query: SQL) => [...(await db.execute(query))] as T[],
    close,
  };
}

/** Create a NOLOGIN role unless it exists (safe when several test files race on one server). */
export async function ensureRole(db: AnyDb, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`not a plain role name: ${role}`);
  }
  await db.execute(
    sql.raw(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} NOLOGIN;
      END IF;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END $$`),
  );
}

type PgErrorLike = Error & { code?: string; cause?: { code?: string; message?: string } };

/** The Postgres error behind a rejected statement (Drizzle wraps driver errors in `cause`). */
export async function pgError(
  promise: PromiseLike<unknown>,
): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as PgErrorLike;
    return { code: e.cause?.code ?? e.code, message: `${e.message} ${e.cause?.message ?? ""}` };
  }
  throw new Error("expected the statement to be rejected");
}

/** The statements of one committed migration file, split the way drizzle splits them. */
export function migrationStatements(tag: string): string[] {
  return readFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Thrown inside a transaction to roll it back on purpose. */
class Rollback extends Error {}

/**
 * Run `work` as `role` (SET LOCAL ROLE) in a transaction that is always rolled back. Resolves to
 * `undefined` when it succeeded, else the Postgres error code.
 */
export async function attemptAs(
  db: AnyDb,
  role: string,
  work: SQL | ((tx: AnyDb) => Promise<unknown>),
): Promise<string | undefined> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${role}`));
      if (typeof work === "function") {
        await work(tx);
      } else {
        await tx.execute(work);
      }
      throw new Rollback();
    });
  } catch (error) {
    if (error instanceof Rollback) {
      return undefined;
    }
    const e = error as PgErrorLike;
    return e.cause?.code ?? e.code ?? String(error);
  }
  return "not rolled back";
}
