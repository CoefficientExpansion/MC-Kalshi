import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categories, ledgerEntries, markets, profiles, trades } from "./schema";
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

describe("schema constraints", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let categoryId: string;
  let marketId: string;
  const userId = "11111111-1111-4111-8111-111111111111";

  const marketRow = (slug: string, overrides: Partial<typeof markets.$inferInsert> = {}) => ({
    slug,
    title: `Market ${slug}`,
    rules: "Resolves YES if it happens.",
    categoryId,
    closeAt: new Date("2030-01-01T00:00:00Z"),
    ...overrides,
  });

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    [{ id: categoryId = "" } = {}] = await db
      .insert(categories)
      .values({ slug: "campus-life", name: "Campus Life" })
      .returning({ id: categories.id });
    await db
      .insert(profiles)
      .values({ id: userId, email: "a@my.maryvillecollege.edu", displayName: "A" });
    [{ id: marketId = "" } = {}] = await db
      .insert(markets)
      .values(marketRow("base"))
      .returning({ id: markets.id });
  });
  afterAll(async () => {
    await close();
  });

  it("creates every table from architecture §7", async () => {
    const result = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "audit_log",
      "balances",
      "categories",
      "disputes",
      "ledger_entries",
      "markets",
      "positions",
      "price_snapshots",
      "profiles",
      "settings",
      "trades",
    ]);
  });

  it("defaults a new market to proposed, b = 100, q = (0, 0)", async () => {
    const [row] = await db.select().from(markets).where(sql`${markets.id} = ${marketId}`);
    expect(row).toMatchObject({ status: "proposed", b: 100, qYes: "0.000000", qNo: "0.000000" });
  });

  it.each([49, 501])("rejects a market with b = %i", async (b) => {
    const message = await rejection(db.insert(markets).values(marketRow(`bad-b-${b}`, { b })));
    expect(message).toContain("markets_b_range");
  });

  it.each([50, 500])("accepts a market with b = %i", async (b) => {
    await db.insert(markets).values(marketRow(`ok-b-${b}`, { b }));
  });

  it("rejects an unknown market status", async () => {
    const message = await rejection(
      db.insert(markets).values(marketRow("bad-status", { status: "paused" as "open" })),
    );
    expect(message).toContain("market_status");
  });

  it("rejects an unknown ledger reason and account type", async () => {
    const bad = { accountId: userId, deltaPoints: 1 };
    await expect(
      rejection(
        db
          .insert(ledgerEntries)
          .values({ ...bad, accountType: "user", reason: "bonus" as "trade" }),
      ),
    ).resolves.toContain("ledger_reason");
    await expect(
      rejection(
        db.insert(ledgerEntries).values({ ...bad, accountType: "bank" as "user", reason: "trade" }),
      ),
    ).resolves.toContain("account_type");
  });

  it("rejects a duplicate market or category slug", async () => {
    expect(await rejection(db.insert(markets).values(marketRow("base")))).toContain(
      "markets_slug_unique",
    );
    expect(
      await rejection(db.insert(categories).values({ slug: "campus-life", name: "Again" })),
    ).toContain("categories_slug_unique");
  });

  it("rejects a house ledger entry that is not on the house account", async () => {
    const message = await rejection(
      db.insert(ledgerEntries).values({
        accountType: "house",
        accountId: userId,
        deltaPoints: 1,
        reason: "signup_bonus",
      }),
    );
    expect(message).toContain("ledger_entries_house_account");
  });

  it("makes (user_id, idempotency_key) unique on trades", async () => {
    const trade = {
      marketId,
      userId,
      side: "YES" as const,
      contracts: "10",
      costPoints: 500,
      probBefore: 0.5,
      probAfter: 0.52,
      idempotencyKey: "key-1",
      requestFingerprint: "f",
    };
    await db.insert(trades).values(trade);
    expect(await rejection(db.insert(trades).values(trade))).toContain(
      "trades_user_idempotency_key_uq",
    );
    await db.insert(trades).values({ ...trade, idempotencyKey: "key-2" });
  });

  it("refuses a trade without a request fingerprint", async () => {
    const message = await rejection(
      db.execute(
        sql`insert into trades (market_id, user_id, side, contracts, cost_points, prob_before, prob_after, idempotency_key)
            values (${marketId}, ${userId}, 'YES', 1, 50, 0.5, 0.5, 'key-no-fingerprint')`,
      ),
    );
    expect(message).toContain("request_fingerprint");
  });
});
