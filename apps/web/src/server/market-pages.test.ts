import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { categories, markets, profiles } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { createTestDb, type TestDb } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { grantSignupBonus } from "./ledger";
import { loadMarketDetail, loadMarketList, loadMarketTrading } from "./market-pages";
import { placeTrade } from "./trading";

describe("market page loaders", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedDatabase(db, new Date("2026-10-29T16:00:00Z"));
    const [weather] = await db.select().from(categories);
    if (!weather) throw new Error("seed produced no categories");
    await db.insert(markets).values({
      slug: "moderator-draft",
      title: "A draft",
      rules: "Draft rules.",
      categoryId: weather.id,
      status: "proposed",
      closeAt: new Date("2026-12-01T00:00:00Z"),
    });
  });
  afterAll(() => close());

  it("reports an unconfigured database for both loaders", async () => {
    expect(await loadMarketList(undefined)).toEqual({ kind: "unconfigured" });
    expect(await loadMarketDetail(undefined, "anything")).toEqual({ kind: "unconfigured" });
  });

  it("lists the seeded markets with a 50% price, and never a proposal", async () => {
    const result = await loadMarketList(db);
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.markets.map((m) => m.slug)).not.toContain("moderator-draft");
    const seeded = result.markets;
    expect(seeded).toHaveLength(6);
    for (const m of seeded) expect(m.displayPrice).toBe(50);
  });

  it("passes an explicit filter through", async () => {
    const result = await loadMarketList(db, { status: "proposed" });
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.markets.map((m) => m.slug)).toEqual(["moderator-draft"]);
  });

  it("loads a market by slug", async () => {
    const result = await loadMarketDetail(db, "snow-before-december");
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    expect(result.market.title).toMatch(/snow/i);
    expect(result.market.category.slug).toBe("weather");
  });

  it("treats an unknown slug and a proposed market as not found", async () => {
    expect(await loadMarketDetail(db, "no-such-market")).toEqual({ kind: "not-found" });
    expect(await loadMarketDetail(db, "moderator-draft")).toEqual({ kind: "not-found" });
  });

  it("returns unavailable (and logs only the error name) when the query throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      select() {
        throw new Error("password authentication failed for postgres://user:secret@host/db");
      },
    } as unknown as AnyDb;
    expect(await loadMarketList(broken)).toEqual({ kind: "unavailable" });
    expect(await loadMarketDetail(broken, "x")).toEqual({ kind: "unavailable" });
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("secret");
    spy.mockRestore();
  });
});

describe("loadMarketTrading", () => {
  const U1 = "00000000-0000-4000-8000-000000000001";
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedDatabase(db, new Date());
    await db
      .insert(profiles)
      .values({ id: U1, email: "a@my.maryvillecollege.edu", displayName: "A" });
    await grantSignupBonus(db, U1, 10_000);
  });
  afterAll(() => close());

  async function market(slug: string) {
    const result = await loadMarketDetail(db, slug);
    if (result.kind !== "ok") throw new Error(result.kind);
    return result.market;
  }

  it("gives the public state and an untraded history to a signed-out visitor", async () => {
    const m = await market("snow-before-december");
    const t = await loadMarketTrading(db, m, null, "1W");
    expect(t.state).toMatchObject({ status: "open", b: m.b, qYes: 0, qNo: 0, displayPrice: 50 });
    expect(t.state.closeAt).toBe(m.closeAt.toISOString());
    expect("balance" in t.state).toBe(false);
    expect(t.history?.range).toBe("1W");
    expect(t.history?.hasTrades).toBe(false);
  });

  it("adds the member's balance and position, and the trade to the history", async () => {
    const m = await market("snow-before-december");
    const traded = await placeTrade(
      db,
      U1,
      {
        marketId: m.id,
        side: "YES",
        mode: "buy_points",
        amount: 500,
        expectedAvgPrice: 51,
        idempotencyKey: "market-pages-key-0001",
      },
      { tradingPaused: false, rateLimit: async () => null },
    );
    if (!traded.ok) throw new Error(traded.code);
    const t = await loadMarketTrading(db, m, U1, "ALL");
    expect(t.state.balance).toBe(9_500);
    expect(t.state.position).toEqual(traded.position);
    expect(t.state.displayPrice).toBe(traded.market.displayPrice);
    expect(t.history?.hasTrades).toBe(true);
    expect(t.history?.points.at(-1)?.probabilityYes).toBe(traded.market.probabilityYes);
  });

  it("falls back to the page's market state and no chart when a query throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await market("snow-before-december");
    const broken = {
      select() {
        throw new Error("postgres://user:secret@host/db");
      },
    } as unknown as AnyDb;
    const t = await loadMarketTrading(broken, m, U1, "1W");
    expect(t.history).toBeNull();
    expect(t.state).toEqual({
      status: m.status,
      closeAt: m.closeAt.toISOString(),
      b: m.b,
      qYes: m.qYes,
      qNo: m.qNo,
      probabilityYes: m.probabilityYes,
      displayPrice: m.displayPrice,
    });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret");
    spy.mockRestore();
  });
});
