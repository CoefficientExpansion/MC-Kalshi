import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { categories, markets } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { createTestDb, type TestDb } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { loadMarketDetail, loadMarketList } from "./market-pages";

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
