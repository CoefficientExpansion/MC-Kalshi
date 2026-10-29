import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { categories, markets, profiles, trades } from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { checkTradeRateLimit } from "./rate-limit";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const handles: TestDbHandle[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(handles.splice(0).map((h) => h.close()));
});

async function fresh(): Promise<{ db: AnyDb; marketId: string }> {
  const h = await openTestDb();
  handles.push(h);
  for (const id of [USER, OTHER]) {
    await h.db
      .insert(profiles)
      .values({ id, email: `${id.slice(-1)}@my.maryvillecollege.edu`, displayName: "U" });
  }
  const [category] = await h.db
    .insert(categories)
    .values({ slug: "c", name: "C" })
    .returning({ id: categories.id });
  const [market] = await h.db
    .insert(markets)
    .values({
      slug: "m",
      title: "M",
      rules: "R",
      categoryId: category?.id ?? "",
      status: "open",
      closeAt: new Date(Date.now() + 86_400_000),
    })
    .returning({ id: markets.id });
  return { db: h.db, marketId: market?.id ?? "" };
}

/** `count` trades for `userId`, created `secondsAgo` seconds before the database's now(). */
async function addTrades(
  db: AnyDb,
  marketId: string,
  userId: string,
  count: number,
  secondsAgo: number,
) {
  for (let i = 0; i < count; i++) {
    await db.insert(trades).values({
      marketId,
      userId,
      side: "YES",
      contracts: "1",
      costPoints: 50,
      probBefore: 0.5,
      probAfter: 0.5,
      idempotencyKey: `key-${secondsAgo}-${i}-${userId}`,
      requestFingerprint: "f",
      createdAt: sql`now() - make_interval(secs => ${secondsAgo})`,
    });
  }
}

describe("checkTradeRateLimit", () => {
  it("allows a user with no recent trades", async () => {
    const { db } = await fresh();
    expect(await checkTradeRateLimit(db, USER)).toBeNull();
  });

  it("allows the 20th trade in a minute and refuses the 21st", async () => {
    const { db, marketId } = await fresh();
    await addTrades(db, marketId, USER, 19, 10);
    expect(await checkTradeRateLimit(db, USER)).toBeNull();
    await addTrades(db, marketId, USER, 1, 5);
    const limited = await checkTradeRateLimit(db, USER);
    // The oldest trade in the window is 10 s old, so it leaves the window in about 50 s.
    expect(limited).toEqual({ code: "rate_limited", retryAfterSec: expect.any(Number) });
    expect(limited?.retryAfterSec).toBeGreaterThanOrEqual(49);
    expect(limited?.retryAfterSec).toBeLessThanOrEqual(51);
  });

  it("ignores trades older than 60 seconds and other users' trades", async () => {
    const { db, marketId } = await fresh();
    await addTrades(db, marketId, USER, 20, 61);
    await addTrades(db, marketId, OTHER, 20, 1);
    expect(await checkTradeRateLimit(db, USER)).toBeNull();
    expect(await checkTradeRateLimit(db, OTHER)).toMatchObject({ code: "rate_limited" });
  });

  it("reads the limit from TRADE_RATE_LIMIT_PER_MIN", async () => {
    vi.stubEnv("TRADE_RATE_LIMIT_PER_MIN", "2");
    const { db, marketId } = await fresh();
    await addTrades(db, marketId, USER, 1, 30);
    expect(await checkTradeRateLimit(db, USER)).toBeNull();
    await addTrades(db, marketId, USER, 1, 1);
    expect(await checkTradeRateLimit(db, USER)).toMatchObject({ code: "rate_limited" });
  });

  it("measures the window on the clock at the call, not at the transaction's start", async () => {
    const { db, marketId } = await fresh();
    // Inside one transaction now() stands still: trades 59.5 s before it are 60.5 s old on the
    // clock once the transaction has slept a second, so they are out of the window.
    const limited = await db.transaction(async (tx) => {
      await addTrades(tx, marketId, USER, 20, 59.5);
      await tx.execute(sql`select pg_sleep(1)`);
      return checkTradeRateLimit(tx, USER);
    });
    expect(limited).toBeNull();
  });

  it("never asks for less than one second", async () => {
    const { db, marketId } = await fresh();
    // 59 s old, not 59.9: the window is checked against the real clock after the inserts, so a
    // margin under a second leaves room for a slow machine without the oldest trade ageing out.
    await addTrades(db, marketId, USER, 20, 59);
    expect(await checkTradeRateLimit(db, USER)).toEqual({ code: "rate_limited", retryAfterSec: 1 });
  });
});
