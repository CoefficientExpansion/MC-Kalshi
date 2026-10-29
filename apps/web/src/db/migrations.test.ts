import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categories, HOUSE_ACCOUNT_ID, ledgerEntries, markets, profiles, trades } from "./schema";
import { createTestDb, type TestDb } from "./test-db";

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function rejection(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return `${(error as Error).message} ${cause?.message ?? ""}`;
  }
  throw new Error("expected the statement to be rejected");
}

describe("custom migration: RLS and append-only", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  const userId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await db
      .insert(profiles)
      .values({ id: userId, email: "b@my.maryvillecollege.edu", displayName: "B" });
    const [category] = await db
      .insert(categories)
      .values({ slug: "academics", name: "Academics" })
      .returning({ id: categories.id });
    const [market] = await db
      .insert(markets)
      .values({
        slug: "m",
        title: "M",
        rules: "R",
        categoryId: category?.id ?? "",
        closeAt: new Date("2030-01-01T00:00:00Z"),
      })
      .returning({ id: markets.id });
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
      marketId: market?.id ?? "",
      userId,
      side: "YES",
      contracts: "1",
      costPoints: 50,
      probBefore: 0.5,
      probAfter: 0.51,
      idempotencyKey: "k",
    });
  });
  afterAll(async () => {
    await close();
  });

  it("enables Row Level Security on every table, with no policies", async () => {
    const tables = await db.execute(
      sql`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(tables.rows).toHaveLength(11);
    for (const row of tables.rows) {
      expect(row.relrowsecurity, String(row.relname)).toBe(true);
    }
    const policies = await db.execute(sql`select 1 from pg_policies where schemaname = 'public'`);
    expect(policies.rows).toHaveLength(0);
  });

  it.each([
    ["UPDATE", "ledger_entries", sql`update ledger_entries set delta_points = 0`],
    ["DELETE", "ledger_entries", sql`delete from ledger_entries`],
    ["TRUNCATE", "ledger_entries", sql`truncate ledger_entries`],
    ["UPDATE", "trades", sql`update trades set cost_points = 0`],
    ["DELETE", "trades", sql`delete from trades`],
    ["TRUNCATE", "trades", sql`truncate trades`],
  ])("raises on %s of %s, even for the owner role", async (op, table, statement) => {
    const message = await rejection(db.execute(statement));
    expect(message).toContain(`${op} on ${table} is not allowed`);
  });

  it("leaves the rows untouched after the rejected statements", async () => {
    const sum = await db.execute(
      sql`select sum(delta_points)::int as s, count(*)::int as n from ledger_entries`,
    );
    expect(sum.rows).toEqual([{ s: 0, n: 2 }]);
    const tradeCount = await db.execute(sql`select count(*)::int as n from trades`);
    expect(tradeCount.rows).toEqual([{ n: 1 }]);
  });

  it("still allows INSERT into both tables", async () => {
    await db.insert(ledgerEntries).values([
      { accountType: "house", accountId: HOUSE_ACCOUNT_ID, deltaPoints: -1, reason: "stipend" },
      { accountType: "user", accountId: userId, deltaPoints: 1, reason: "stipend" },
    ]);
  });
});
