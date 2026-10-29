import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAllowedEmail } from "@/server/auth-email";
import { ALLOWED_EMAIL_CASES } from "@/server/auth-email-cases";
import * as schema from "./schema";
import { categories, HOUSE_ACCOUNT_ID, ledgerEntries, markets, profiles, trades } from "./schema";

// Runs against a real Postgres (the in-process PGlite used elsewhere has no second connection, so
// it cannot show row locking). Skipped unless TEST_DATABASE_URL points at a server where the role
// may CREATE DATABASE: CI uses a `postgres:16` service container, locally use any throwaway
// server, e.g. TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres. Each run
// creates its own database and drops it afterwards, so nothing it touches outlives the run.

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
const JOURNAL_LENGTH: number = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
).entries.length;

type PgError = Error & { code?: string; cause?: { code?: string; message?: string } };

/** The Postgres error behind a rejected statement (Drizzle wraps driver errors in `cause`). */
async function pgError(promise: PromiseLike<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as PgError;
    return { code: e.cause?.code ?? e.code, message: e.cause?.message ?? e.message };
  }
  throw new Error("expected the statement to be rejected");
}

describe.skipIf(!ADMIN_URL)("real Postgres", () => {
  const dbName = `mck_it_${randomBytes(6).toString("hex")}`;
  let admin: postgres.Sql;
  let conn: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const urlFor = (name: string) => {
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const connect = () => postgres(urlFor(dbName), { max: 1, onnotice: () => {} });

  const userId = "44444444-4444-4444-8444-444444444444";
  let marketId = "";

  beforeAll(async () => {
    admin = postgres(ADMIN_URL as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${dbName}"`);
    conn = connect();
    db = drizzle(conn, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await db
      .insert(profiles)
      .values({ id: userId, email: "it@my.maryvillecollege.edu", displayName: "IT" });
    const [category] = await db
      .insert(categories)
      .values({ slug: "academics", name: "Academics" })
      .returning({ id: categories.id });
    const [market] = await db
      .insert(markets)
      .values({
        slug: "lock-me",
        title: "Lock me",
        rules: "R",
        categoryId: category?.id ?? "",
        closeAt: new Date("2030-01-01T00:00:00Z"),
      })
      .returning({ id: markets.id });
    marketId = market?.id ?? "";
    await db.insert(ledgerEntries).values([
      {
        accountType: "house",
        accountId: HOUSE_ACCOUNT_ID,
        deltaPoints: -5,
        reason: "signup_bonus",
      },
      { accountType: "user", accountId: userId, deltaPoints: 5, reason: "stipend" },
    ]);
    await db.insert(trades).values({
      marketId,
      userId,
      side: "YES",
      contracts: "1",
      costPoints: 50,
      probBefore: 0.5,
      probAfter: 0.51,
      idempotencyKey: "k",
      requestFingerprint: "f",
    });
  });

  afterAll(async () => {
    await conn?.end({ timeout: 5 });
    if (admin) {
      await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
      await admin.end({ timeout: 5 });
    }
  });

  it("applied every migration to the fresh database", async () => {
    const [row] = await conn`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(row?.n).toBe(JOURNAL_LENGTH);
  });

  it("enables Row Level Security on every table in public; the only policies are for mc_app", async () => {
    const tables = await conn`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`;
    expect(tables).toHaveLength(11);
    for (const t of tables) {
      expect(t.relrowsecurity, String(t.relname)).toBe(true);
    }
    const roles = await conn`
      select distinct array_to_string(roles, ',') as roles from pg_policies where schemaname = 'public'`;
    expect(roles.map((r) => r.roles)).toEqual(["mc_app"]);
  });

  it.each([
    ["UPDATE", "ledger_entries", "update ledger_entries set delta_points = 0"],
    ["DELETE", "ledger_entries", "delete from ledger_entries"],
    ["TRUNCATE", "ledger_entries", "truncate ledger_entries"],
    ["UPDATE", "trades", "update trades set cost_points = 0"],
    ["DELETE", "trades", "delete from trades"],
    ["TRUNCATE", "trades", "truncate trades"],
  ])("raises on %s of %s", async (op, table, statement) => {
    const error = await pgError(conn.unsafe(statement));
    expect(error.code).toBe("23001"); // restrict_violation
    expect(error.message).toContain(`${op} on ${table} is not allowed`);
  });

  it("left the append-only rows untouched", async () => {
    const [ledger] =
      await conn`select count(*)::int as n, sum(delta_points)::int as s from ledger_entries`;
    expect(ledger).toMatchObject({ n: 2, s: 0 });
    const [t] = await conn`select count(*)::int as n from trades`;
    expect(t?.n).toBe(1);
  });

  describe("hook_before_user_created", () => {
    const callHook = async (email: unknown) => {
      const json = JSON.stringify({ metadata: {}, user: { email } });
      const [row] = await conn`select public.hook_before_user_created(${json}::text::jsonb) as r`;
      return row?.r as { error?: { http_code: number } };
    };

    it("agrees with isAllowedEmail on every case in the shared table", async () => {
      for (const { email, allowed } of ALLOWED_EMAIL_CASES) {
        const result = await callHook(email);
        expect(result.error === undefined, `SQL verdict for ${JSON.stringify(email)}`).toBe(
          allowed,
        );
        expect(isAllowedEmail(email), `TS verdict for ${JSON.stringify(email)}`).toBe(allowed);
      }
    });

    it("answers a disallowed address with a 403 error object", async () => {
      expect((await callHook("jane@gmail.com")).error?.http_code).toBe(403);
      expect(await callHook("jane@maryvillecollege.edu")).toEqual({});
    });

    it("is not executable by PUBLIC", async () => {
      await conn.unsafe("create role mck_stranger nologin");
      try {
        const [row] = await conn`
          select has_function_privilege('mck_stranger', 'public.hook_before_user_created(jsonb)', 'EXECUTE') as ok`;
        expect(row?.ok).toBe(false);
      } finally {
        await conn.unsafe("drop role mck_stranger");
      }
    });
  });

  describe("row locking (what a trade transaction relies on)", () => {
    let other: postgres.Sql;
    beforeAll(() => {
      other = connect();
    });
    afterAll(async () => {
      await other.end({ timeout: 5 });
    });

    /** Hold `FOR UPDATE` on the market row in one connection until `release()` is called. */
    function holdLock() {
      let release!: () => void;
      const released = new Promise<void>((r) => {
        release = r;
      });
      let locked!: () => void;
      const lockedSignal = new Promise<void>((r) => {
        locked = r;
      });
      const done = conn.begin(async (tx) => {
        await tx`select id from markets where id = ${marketId} for update`;
        locked();
        await released;
      });
      return { locked: lockedSignal, release, done };
    }

    it("a second connection's FOR UPDATE NOWAIT fails with lock_not_available", async () => {
      const lock = holdLock();
      await lock.locked;
      try {
        const error = await pgError(
          other.begin((tx) => tx`select id from markets where id = ${marketId} for update nowait`),
        );
        expect(error.code).toBe("55P03");
      } finally {
        lock.release();
        await lock.done;
      }
      // Once the first transaction has ended the row can be locked again.
      const rows = await other.begin(
        (tx) => tx`select id from markets where id = ${marketId} for update nowait`,
      );
      expect(rows).toHaveLength(1);
    });

    it("a plain FOR UPDATE waits for the holder to commit, then proceeds", async () => {
      const lock = holdLock();
      await lock.locked;
      let acquired = false;
      const waiter = other.begin(async (tx) => {
        await tx`select id from markets where id = ${marketId} for update`;
        acquired = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(acquired).toBe(false);
      lock.release();
      await lock.done;
      await waiter;
      expect(acquired).toBe(true);
    });
  });
});
