import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categories, markets } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { getMarketBySlug, listMarkets, PUBLIC_MARKET_STATUSES } from "./markets";

describe("market reads", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const cats = await db
      .insert(categories)
      .values([
        { slug: "campus-life", name: "Campus Life" },
        { slug: "weather", name: "Weather" },
      ])
      .returning();
    const campus = cats.find((c) => c.slug === "campus-life")?.id ?? "";
    const weather = cats.find((c) => c.slug === "weather")?.id ?? "";
    const base = { rules: "Rules.", closeAt: new Date("2030-01-02T00:00:00Z") };
    await db.insert(markets).values([
      {
        ...base,
        slug: "late",
        title: "Late",
        categoryId: campus,
        status: "open",
        closeAt: new Date("2030-03-01T00:00:00Z"),
      },
      { ...base, slug: "early", title: "Early", categoryId: campus, status: "open" },
      { ...base, slug: "snow", title: "Snow", categoryId: weather, status: "open", b: 200 },
      { ...base, slug: "idea", title: "Idea", categoryId: weather, status: "proposed" },
      {
        ...base,
        slug: "lean",
        title: "Lean",
        categoryId: campus,
        status: "closed",
        qYes: "100",
        qNo: "0",
      },
    ]);
  });
  afterAll(async () => {
    await close();
  });

  describe("getMarketBySlug", () => {
    it("returns a fresh market at probabilityYes 0.5 and displayPrice 50, numbers parsed", async () => {
      const market = await getMarketBySlug(db, "early");
      expect(market).toMatchObject({
        slug: "early",
        title: "Early",
        status: "open",
        b: 100,
        qYes: 0,
        qNo: 0,
        probabilityYes: 0.5,
        displayPrice: 50,
        category: { slug: "campus-life", name: "Campus Life" },
      });
    });

    it("prices from b, q_yes and q_no with the engine", async () => {
      const market = await getMarketBySlug(db, "lean");
      expect(market?.qYes).toBe(100);
      expect(market?.probabilityYes).toBeCloseTo(0.7310585786, 9);
      expect(market?.displayPrice).toBe(73);
    });

    it("returns null for an unknown slug", async () => {
      expect(await getMarketBySlug(db, "nope")).toBeNull();
    });
  });

  describe("listMarkets", () => {
    const slugs = (list: { slug: string }[]) => list.map((m) => m.slug);

    it("lists every status when no filter is given, soonest close first, ties by slug", async () => {
      expect(slugs(await listMarkets(db))).toEqual(["early", "idea", "lean", "snow", "late"]);
    });

    it("filters by status", async () => {
      expect(slugs(await listMarkets(db, { status: "open" }))).toEqual(["early", "snow", "late"]);
      expect(slugs(await listMarkets(db, { status: "voided" }))).toEqual([]);
    });

    it("filters by a list of statuses; the public list leaves proposals out", async () => {
      const all = await listMarkets(db);
      const hidden = all.filter((m) => m.status === "proposed" || m.status === "rejected");
      expect(hidden.length).toBeGreaterThan(0);
      const shown = slugs(await listMarkets(db, { status: PUBLIC_MARKET_STATUSES }));
      expect(shown).toEqual(slugs(all).filter((s) => !slugs(hidden).includes(s)));
      expect(await listMarkets(db, { status: [] })).toEqual([]);
    });

    it("filters by category slug, and by both", async () => {
      expect(slugs(await listMarkets(db, { categorySlug: "weather" }))).toEqual(["idea", "snow"]);
      expect(slugs(await listMarkets(db, { categorySlug: "weather", status: "open" }))).toEqual([
        "snow",
      ]);
      expect(await listMarkets(db, { categorySlug: "nope" })).toEqual([]);
    });

    it("attaches probabilityYes and displayPrice to every row", async () => {
      const open = await listMarkets(db, { status: "open" });
      expect(open.map((m) => [m.probabilityYes, m.displayPrice])).toEqual([
        [0.5, 50],
        [0.5, 50],
        [0.5, 50],
      ]);
    });
  });
});
