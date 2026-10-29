import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMarketBySlug, listMarkets } from "@/server/markets";
import { categories, markets } from "./schema";
import { SEED_MARKETS, seedDatabase } from "./seed";
import { createTestDb, type TestDb } from "./test-db";

describe("seedDatabase", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  const now = new Date("2026-10-29T12:00:00Z");

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  it("creates 4 categories and 6 open markets with future close dates", async () => {
    expect(await seedDatabase(db, now)).toEqual({ categoriesSeeded: 4, marketsCreated: 6 });
    expect(await db.select().from(categories)).toHaveLength(4);
    const open = await listMarkets(db, { status: "open" });
    expect(open).toHaveLength(6);
    for (const m of open) {
      expect(m.b).toBe(100);
      expect(m.closeAt.getTime()).toBeGreaterThan(now.getTime());
      expect(m.rules.length).toBeGreaterThan(40);
    }
  });

  it("is idempotent: a second run adds nothing", async () => {
    expect(await seedDatabase(db, now)).toEqual({ categoriesSeeded: 4, marketsCreated: 0 });
    const counts = await db.execute(
      sql`select (select count(*)::int from categories) as c, (select count(*)::int from markets) as m`,
    );
    expect(counts.rows).toEqual([{ c: 4, m: 6 }]);
  });

  it("does not reset a market that has moved since seeding", async () => {
    await db
      .update(markets)
      .set({ qYes: "25", status: "closed" })
      .where(sql`${markets.slug} = ${SEED_MARKETS[0]?.slug}`);
    await seedDatabase(db, now);
    const market = await getMarketBySlug(db, SEED_MARKETS[0]?.slug ?? "");
    expect(market).toMatchObject({ qYes: 25, status: "closed" });
  });

  it("serves fresh seeded markets at probYes 0.5 and displayPrice 50", async () => {
    const market = await getMarketBySlug(db, SEED_MARKETS[1]?.slug ?? "");
    expect(market).toMatchObject({ probYes: 0.5, displayPrice: 50 });
  });

  it("keeps the copy play-money safe and off athletics", () => {
    for (const m of SEED_MARKETS) {
      const text = `${m.title} ${m.rules}`;
      expect(text, m.slug).not.toMatch(/\bbet(s|ting)?\b|\$|cash.?out|athletic|\bgame\b/i);
    }
  });
});
