import { probabilityYes } from "@mc-kalshi/engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categories, markets, priceSnapshots, profiles } from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import { grantSignupBonus } from "./ledger";
import { parseNumeric } from "./numeric";
import { downsample, getPriceHistory, MAX_CHART_POINTS } from "./price-history";
import { placeTrade } from "./trading";

const U1 = "00000000-0000-4000-8000-000000000001";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPTS = { tradingPaused: false, rateLimit: async () => null };

let h: TestDbHandle;
const ids: Record<string, string> = {};
let keyN = 0;

async function buy(marketId: string, side: "YES" | "NO", points: number) {
  const first = await placeTrade(
    h.db,
    U1,
    {
      marketId,
      side,
      mode: "buy_points",
      amount: points,
      expectedAvgPrice: 50,
      maxSlippage: 10,
      idempotencyKey: `history-key-${String(++keyN).padStart(6, "0")}`,
    },
    OPTS,
  );
  if (first.ok) return first;
  if (first.code !== "slippage_exceeded") throw new Error(first.code);
  const again = await placeTrade(
    h.db,
    U1,
    {
      marketId,
      side,
      mode: "buy_points",
      amount: points,
      expectedAvgPrice: first.requote.avgPrice,
      maxSlippage: 0,
      idempotencyKey: `history-key-${String(++keyN).padStart(6, "0")}`,
    },
    OPTS,
  );
  if (!again.ok) throw new Error(again.code);
  return again;
}

async function addMarket(slug: string, openedAt: Date | null, createdAt?: Date) {
  const [category] = await h.db.select().from(categories).limit(1);
  const [row] = await h.db
    .insert(markets)
    .values({
      slug,
      title: slug,
      rules: "R",
      categoryId: category?.id ?? "",
      status: "open",
      closeAt: new Date(Date.now() + 30 * DAY),
      openedAt,
      ...(createdAt ? { createdAt } : {}),
    })
    .returning({ id: markets.id });
  return row?.id ?? "";
}

async function currentProbability(id: string) {
  const [m] = await h.db.select().from(markets).where(eq(markets.id, id));
  if (!m) throw new Error("no market");
  return probabilityYes({ b: m.b, qYes: parseNumeric(m.qYes), qNo: parseNumeric(m.qNo) });
}

beforeAll(async () => {
  h = await openTestDb();
  await h.db.insert(categories).values({ slug: "c", name: "C" });
  await h.db
    .insert(profiles)
    .values({ id: U1, email: "1@my.maryvillecollege.edu", displayName: "U" });
  await grantSignupBonus(h.db, U1, 10_000);

  ids.quiet = await addMarket("quiet", null, new Date(Date.now() - 2 * DAY));
  ids.traded = await addMarket("traded", new Date(Date.now() - HOUR));
  await buy(ids.traded, "YES", 500);
  await buy(ids.traded, "NO", 200);
  await buy(ids.traded, "YES", 300);

  // An older market: opened 20 days ago, one real trade now, plus earlier snapshots (the chart
  // reads snapshots only, so older ones stand in for trades made on earlier days).
  ids.old = await addMarket("old", new Date(Date.now() - 20 * DAY));
  await buy(ids.old, "YES", 400);
  await h.db.insert(priceSnapshots).values([
    { marketId: ids.old, at: new Date(Date.now() - 15 * DAY), probabilityYes: 0.4 },
    { marketId: ids.old, at: new Date(Date.now() - 3 * DAY), probabilityYes: 0.45 },
    { marketId: ids.old, at: new Date(Date.now() - 2 * HOUR), probabilityYes: 0.55 },
  ]);
});
afterAll(() => h.close());

describe("getPriceHistory", () => {
  it("is null for an unknown market or a malformed id", async () => {
    expect(await getPriceHistory(h.db, "00000000-0000-4000-8000-0000000000ff", "1W")).toBeNull();
    expect(await getPriceHistory(h.db, "not-a-uuid", "1W")).toBeNull();
  });

  it("is a flat 50% from the creation time to now when nobody has traded", async () => {
    const now = new Date();
    const history = await getPriceHistory(h.db, ids.quiet as string, "ALL", now);
    const [market] = await h.db
      .select()
      .from(markets)
      .where(eq(markets.id, ids.quiet as string));
    expect(history).toEqual({
      range: "ALL",
      from: market?.createdAt.getTime(),
      to: now.getTime(),
      hasTrades: false,
      points: [
        { at: market?.createdAt.getTime(), probabilityYes: 0.5 },
        { at: now.getTime(), probabilityYes: 0.5 },
      ],
    });
  });

  it("starts at the opening time and the first trade's prob_before, then every snapshot, then now", async () => {
    const now = new Date();
    const history = await getPriceHistory(h.db, ids.traded as string, "1W", now);
    if (!history) throw new Error("no history");
    const [market] = await h.db
      .select()
      .from(markets)
      .where(eq(markets.id, ids.traded as string));
    expect(history.hasTrades).toBe(true);
    expect(history.from).toBe(market?.openedAt?.getTime());
    expect(history.points).toHaveLength(5);
    expect(history.points[0]).toEqual({ at: history.from, probabilityYes: 0.5 });
    const snaps = await h.db
      .select()
      .from(priceSnapshots)
      .where(eq(priceSnapshots.marketId, ids.traded as string));
    expect(history.points.slice(1, 4).map((p) => p.probabilityYes)).toEqual(
      [...snaps].sort((a, b) => a.at.getTime() - b.at.getTime()).map((s) => s.probabilityYes),
    );
    expect(history.points[4]).toEqual({
      at: now.getTime(),
      probabilityYes: await currentProbability(ids.traded as string),
    });
  });

  it("cuts 1D and 1W at the range start, carrying the price in force then", async () => {
    const now = new Date();
    const day = await getPriceHistory(h.db, ids.old as string, "1D", now);
    expect(day?.from).toBe(now.getTime() - DAY);
    expect(day?.points[0]).toEqual({ at: now.getTime() - DAY, probabilityYes: 0.45 });
    expect(day?.points.map((p) => p.probabilityYes).slice(1, 2)).toEqual([0.55]);
    expect(day?.points).toHaveLength(4);

    const week = await getPriceHistory(h.db, ids.old as string, "1W", now);
    expect(week?.points[0]).toEqual({ at: now.getTime() - 7 * DAY, probabilityYes: 0.4 });
    expect(week?.points).toHaveLength(5);

    const all = await getPriceHistory(h.db, ids.old as string, "ALL", now);
    // The first real trade's prob_before is 0.5; the older stand-in snapshots follow it.
    expect(all?.points[0]?.probabilityYes).toBe(0.5);
    expect(all?.points).toHaveLength(6);
    expect(all?.points.at(-1)?.probabilityYes).toBe(await currentProbability(ids.old as string));
  });

  it("keeps a long history to at most 200 points", async () => {
    const start = Date.now() - 10 * DAY;
    await h.db.insert(priceSnapshots).values(
      Array.from({ length: 1000 }, (_, i) => ({
        marketId: ids.old as string,
        at: new Date(start + i * 10 * 60_000),
        probabilityYes: 0.3 + (i % 50) / 100,
      })),
    );
    const history = await getPriceHistory(h.db, ids.old as string, "ALL");
    expect(history?.points.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
    expect(history?.points.length).toBeGreaterThan(50);
  });
});

describe("downsample", () => {
  const pts = (n: number, step = 1) =>
    Array.from({ length: n }, (_, i) => ({ at: i * step, probabilityYes: i / n }));

  it("keeps everything when it already fits", () => {
    expect(downsample(pts(10), 0, 10, 20)).toEqual(pts(10));
  });

  it("keeps the last snapshot of each time bucket", () => {
    // 100 points over [0, 100) into 10 buckets of width 10: keep 9, 19, ..., 99.
    const out = downsample(pts(100), 0, 100, 10);
    expect(out.map((p) => p.at)).toEqual([9, 19, 29, 39, 49, 59, 69, 79, 89, 99]);
  });

  it("puts a point at the range end in the last bucket, and handles an empty range", () => {
    const out = downsample([...pts(30), { at: 30, probabilityYes: 1 }], 0, 30, 3);
    expect(out.at(-1)).toEqual({ at: 30, probabilityYes: 1 });
    expect(out).toHaveLength(3);
    expect(downsample(pts(5, 0), 0, 0, 2)).toEqual([{ at: 0, probabilityYes: 0.8 }]);
    expect(downsample([], 0, 10, 5)).toEqual([]);
  });
});
