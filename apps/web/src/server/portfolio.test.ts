import { displayPrice, probabilityYes } from "@mc-kalshi/engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categories, markets, profiles } from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import { grantSignupBonus } from "./ledger";
import { parseNumeric } from "./numeric";
import { getPortfolio } from "./portfolio";
import { placeTrade } from "./trading";

// getPortfolio on PGlite, with every position created through placeTrade.

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";
const DAY = 86_400_000;
const OPTS = { tradingPaused: false, rateLimit: async () => null };

let h: TestDbHandle;
const ids: Record<string, string> = {};
let keyN = 0;

async function trade(
  userId: string,
  marketId: string,
  side: "YES" | "NO",
  mode: "buy_points" | "sell_contracts",
  amount: number,
) {
  // Ask for the current price with the widest tolerance: these fixtures never test slippage.
  const r = await placeTrade(
    h.db,
    userId,
    {
      marketId,
      side,
      mode,
      amount,
      expectedAvgPrice: 50,
      maxSlippage: 10,
      idempotencyKey: `portfolio-key-${String(++keyN).padStart(6, "0")}`,
    },
    OPTS,
  );
  if (!r.ok) {
    // Retry at the server's price (the fixture only needs the trade to happen).
    if (r.code !== "slippage_exceeded") throw new Error(r.code);
    const again = await placeTrade(
      h.db,
      userId,
      {
        marketId,
        side,
        mode,
        amount,
        expectedAvgPrice: r.requote.avgPrice,
        maxSlippage: 0,
        idempotencyKey: `portfolio-key-${String(++keyN).padStart(6, "0")}`,
      },
      OPTS,
    );
    if (!again.ok) throw new Error(again.code);
    return again;
  }
  return r;
}

async function addMarket(slug: string, closeInDays: number, b = 100): Promise<string> {
  const [category] = await h.db.select().from(categories).limit(1);
  const [row] = await h.db
    .insert(markets)
    .values({
      slug,
      title: `Market ${slug}`,
      rules: "R",
      categoryId: category?.id ?? "",
      status: "open",
      b,
      closeAt: new Date(Date.now() + closeInDays * DAY),
      openedAt: new Date(),
    })
    .returning({ id: markets.id });
  return row?.id ?? "";
}

beforeAll(async () => {
  h = await openTestDb();
  await h.db.insert(categories).values({ slug: "c", name: "C" });
  for (const id of [U1, U2, U3]) {
    await h.db
      .insert(profiles)
      .values({ id, email: `${id.slice(-1)}@my.maryvillecollege.edu`, displayName: "U" });
  }
  await grantSignupBonus(h.db, U1, 10_000);
  await grantSignupBonus(h.db, U2, 10_000);
  // U3 has a bonus but never trades.
  await grantSignupBonus(h.db, U3, 10_000);

  ids.late = await addMarket("late", 9);
  ids.early = await addMarket("early", 3);
  ids.both = await addMarket("both", 5, 200);
  ids.flat = await addMarket("flat", 4);
  ids.settled = await addMarket("settled", 2);
  ids.other = await addMarket("other", 6);

  await trade(U1, ids.late, "YES", "buy_points", 500);
  await trade(U1, ids.early, "NO", "buy_points", 300);
  await trade(U1, ids.both, "YES", "buy_points", 400);
  await trade(U1, ids.both, "NO", "buy_points", 200);
  // A position that was opened and closed again: zero contracts, so no row.
  const flat = await trade(U1, ids.flat, "YES", "buy_points", 100);
  await trade(U1, ids.flat, "YES", "sell_contracts", flat.position.contractsYes);
  await trade(U1, ids.settled, "YES", "buy_points", 250);
  // Someone else moves a market U1 holds, and trades one U1 does not.
  await trade(U2, ids.late, "YES", "buy_points", 1000);
  await trade(U2, ids.other, "NO", "buy_points", 100);
  // The settled market resolved after trading (M4 pays it out; today the row stays).
  await h.db
    .update(markets)
    .set({ status: "resolved", outcome: "YES", resolvedAt: new Date() })
    .where(eq(markets.id, ids.settled));
});
afterAll(() => h.close());

async function marketPrice(id: string): Promise<number> {
  const [m] = await h.db.select().from(markets).where(eq(markets.id, id));
  if (!m) throw new Error("no market");
  return displayPrice(
    probabilityYes({ b: m.b, qYes: parseNumeric(m.qYes), qNo: parseNumeric(m.qNo) }),
  );
}

describe("getPortfolio", () => {
  it("lists one row per market with a nonzero position: open and closed first, by close time", async () => {
    const p = await getPortfolio(h.db, U1);
    expect(p.positions.map((r) => r.slug)).toEqual(["early", "both", "late", "settled"]);
  });

  it("derives NO price, value now, pays if win and change exactly per the spec", async () => {
    const p = await getPortfolio(h.db, U1);
    for (const row of p.positions) {
      const yes = await marketPrice(row.marketId);
      expect(row.yesPrice).toBe(yes);
      expect(row.noPrice).toBe(100 - yes);
      expect(row.valueNow).toBe(
        Math.round(row.contractsYes * yes) + Math.round(row.contractsNo * (100 - yes)),
      );
      expect(row.paysIfYes).toBe(Math.floor(row.contractsYes * 100));
      expect(row.paysIfNo).toBe(Math.floor(row.contractsNo * 100));
      expect(row.change).toBe(row.valueNow - row.costBasisPoints);
    }
    const both = p.positions.find((r) => r.slug === "both");
    expect(both?.contractsYes).toBeGreaterThan(0);
    expect(both?.contractsNo).toBeGreaterThan(0);
    expect(both?.costBasisPoints).toBe(600);
    const late = p.positions.find((r) => r.slug === "late");
    // U2's buy pushed YES up after U1 bought, so U1's YES is worth more than it cost.
    expect(late?.change).toBeGreaterThan(0);
    expect(late).toMatchObject({ title: "Market late", status: "open", outcome: null });
    expect(p.positions.find((r) => r.slug === "settled")).toMatchObject({
      status: "resolved",
      outcome: "YES",
    });
  });

  it("totals the balance and the value of open and closed positions", async () => {
    const p = await getPortfolio(h.db, U1);
    // 10,000 − (500 + 300 + 400 + 200 + 100 + 250) + what the flat sell returned.
    expect(p.balance).toBeGreaterThan(10_000 - 1750);
    expect(p.balance).toBeLessThan(10_000 - 1650);
    const unsettled = p.positions.filter((r) => r.status === "open" || r.status === "closed");
    expect(p.positionsValue).toBe(unsettled.reduce((s, r) => s + r.valueNow, 0));
    expect(p.total).toBe(p.balance + p.positionsValue);
  });

  it("lists the member's trades, newest first, with market, side, contracts, points and price", async () => {
    const p = await getPortfolio(h.db, U1);
    expect(p.trades).toHaveLength(7);
    expect(p.trades.every((t) => t.slug !== "other")).toBe(true);
    const [newest] = p.trades;
    expect(newest).toMatchObject({ slug: "settled", side: "YES", costPoints: 250 });
    expect(newest?.contracts).toBeGreaterThan(0);
    expect(newest?.avgPrice).toBe(Math.round(250 / (newest?.contracts ?? 1)));
    const sell = p.trades.find((t) => t.contracts < 0);
    expect(sell?.slug).toBe("flat");
    expect(sell?.costPoints).toBeLessThan(0);
    for (let i = 1; i < p.trades.length; i++) {
      const a = p.trades[i - 1]?.createdAt.getTime() ?? 0;
      expect(a).toBeGreaterThanOrEqual(p.trades[i]?.createdAt.getTime() ?? 0);
    }
  });

  it("keeps only the last 20 trades", async () => {
    for (let i = 0; i < 21; i++) await trade(U2, ids.other as string, "YES", "buy_points", 5);
    const p = await getPortfolio(h.db, U2);
    expect(p.trades).toHaveLength(20);
    expect(p.trades.every((t) => t.costPoints === 5)).toBe(true);
  });

  it("is empty but has the balance for a member who never traded", async () => {
    expect(await getPortfolio(h.db, U3)).toEqual({
      balance: 10_000,
      positionsValue: 0,
      total: 10_000,
      positions: [],
      trades: [],
    });
  });

  it("is zero for an unknown member", async () => {
    const p = await getPortfolio(h.db, "00000000-0000-4000-8000-000000000099");
    expect(p).toEqual({ balance: 0, positionsValue: 0, total: 0, positions: [], trades: [] });
  });
});
