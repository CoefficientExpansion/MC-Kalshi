import { displayPrice, probabilityYes, quoteContracts, quotePoints } from "@mc-kalshi/engine";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  balances,
  categories,
  ledgerEntries,
  markets,
  positions,
  priceSnapshots,
  profiles,
  trades,
} from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { checkTradingInvariants } from "./invariants";
import { checkLedgerInvariants, grantSignupBonus } from "./ledger";
import { parseNumeric } from "./numeric";
import { TRADE_ERROR_CODES, type TradeResult, type TradeSuccess } from "./trade-types";
import { type PlaceTradeOptions, placeTrade } from "./trading";

// placeTrade on a fresh database per test (PGlite locally, a throwaway real database in the CI
// `postgres` job). Every test checks the ledger and trading invariants afterwards (afterEach), and every
// success is checked against the rows it wrote (expectBooked).

const user = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U1 = user(1);
const U2 = user(2);
const key = (n: number | string) => `test-key-${String(n).padStart(8, "0")}`;
const DAY = 86_400_000;
const NO_LIMIT: PlaceTradeOptions = { tradingPaused: false, rateLimit: async () => null };

interface Ctx {
  readonly h: TestDbHandle;
  readonly db: AnyDb;
  readonly marketId: string;
  readonly categoryId: string;
}

const handles: TestDbHandle[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  const open = handles.splice(0);
  try {
    for (const h of open) {
      const inv = await checkLedgerInvariants(h.db);
      expect(inv.ledgerSum).toBe(0);
      expect(inv.mismatches).toEqual([]);
      const trading = await checkTradingInvariants(h.db);
      expect(trading.issues).toEqual([]);
      expect(trading.ok).toBe(true);
    }
  } finally {
    await Promise.all(open.map((h) => h.close()));
  }
});

async function addUser(db: AnyDb, n: number, bonus = 10_000, suspended = false) {
  await db.insert(profiles).values({
    id: user(n),
    email: `u${n}@my.maryvillecollege.edu`,
    displayName: `User ${n}`,
    suspendedAt: suspended ? new Date() : null,
  });
  if (bonus > 0) await grantSignupBonus(db, user(n), bonus);
}

async function addMarket(
  db: AnyDb,
  categoryId: string,
  values: Partial<typeof markets.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(markets)
    .values({
      slug: `m-${Math.random().toString(36).slice(2)}`,
      title: "Will it snow?",
      rules: "Resolves YES if it snows.",
      categoryId,
      status: "open",
      closeAt: new Date(Date.now() + DAY),
      openedAt: new Date(),
      ...values,
    })
    .returning({ id: markets.id });
  if (!row) throw new Error("no market");
  return row.id;
}

/** A database with users 1 and 2 (10,000 points each) and one open b=100 market. */
async function setup(market: Partial<typeof markets.$inferInsert> = {}): Promise<Ctx> {
  const h = await openTestDb();
  handles.push(h);
  const [category] = await h.db
    .insert(categories)
    .values({ slug: "campus", name: "Campus" })
    .returning({ id: categories.id });
  if (!category) throw new Error("no category");
  await addUser(h.db, 1);
  await addUser(h.db, 2);
  const marketId = await addMarket(h.db, category.id, market);
  return { h, db: h.db, marketId, categoryId: category.id };
}

type Patch = Record<string, unknown>;

const input = (marketId: string, patch: Patch = {}): Patch => ({
  marketId,
  side: "YES",
  mode: "buy_points",
  amount: 500,
  expectedAvgPrice: 51,
  maxSlippage: 2,
  idempotencyKey: key(1),
  ...patch,
});

const trade = (
  ctx: Pick<Ctx, "db" | "marketId">,
  patch: Patch = {},
  userId = U1,
  opts: PlaceTradeOptions = { tradingPaused: false },
) => placeTrade(ctx.db, userId, input(ctx.marketId, patch), opts);

function ok(result: TradeResult): TradeSuccess {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

const balanceOf = async (db: AnyDb, userId: string) =>
  (await db.select().from(balances).where(eq(balances.userId, userId))).at(0)?.points;

async function qOf(db: AnyDb, marketId: string) {
  const [m] = await db.select().from(markets).where(eq(markets.id, marketId));
  if (!m) throw new Error("no market");
  return { qYes: parseNumeric(m.qYes), qNo: parseNumeric(m.qNo), b: m.b };
}

async function positionOf(db: AnyDb, marketId: string, userId: string) {
  const [p] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.marketId, marketId), eq(positions.userId, userId)));
  return p
    ? {
        contractsYes: parseNumeric(p.contractsYes),
        contractsNo: parseNumeric(p.contractsNo),
        costBasisPoints: p.costBasisPoints,
      }
    : undefined;
}

const tradeCount = async (db: AnyDb) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(trades))[0]?.n;

/** Every row the success claims to have written is in the database, and nothing disagrees. */
async function expectBooked(db: AnyDb, marketId: string, userId: string, result: TradeSuccess) {
  const [row] = await db.select().from(trades).where(eq(trades.id, result.trade.id));
  expect(row).toBeDefined();
  if (!row) return;
  expect(row).toMatchObject({ marketId, userId, side: result.trade.side });
  expect(parseNumeric(row.contracts)).toBe(result.trade.contracts);
  expect(row.costPoints).toBe(result.trade.costPoints);
  expect(row.probBefore).toBe(result.trade.probBefore);
  expect(row.probAfter).toBe(result.trade.probAfter);
  expect(row.createdAt.toISOString()).toBe(result.trade.createdAt);
  expect(row.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);

  expect(await positionOf(db, marketId, userId)).toEqual(result.position);
  const q = await qOf(db, marketId);
  expect({ qYes: q.qYes, qNo: q.qNo }).toEqual({
    qYes: result.market.qYes,
    qNo: result.market.qNo,
  });
  const p = probabilityYes(q);
  expect(result.market.probabilityYes).toBe(p);
  expect(result.market.displayPrice).toBe(displayPrice(p));
  expect(await balanceOf(db, userId)).toBe(result.balance);

  const ledger = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.refType, "trade"), eq(ledgerEntries.refId, result.trade.id)))
    .orderBy(asc(ledgerEntries.id));
  if (result.trade.costPoints === 0) {
    expect(ledger).toEqual([]);
  } else {
    expect(ledger.map((e) => [e.accountType, e.accountId, e.deltaPoints, e.reason])).toEqual([
      ["user", userId, -result.trade.costPoints, "trade"],
      ["market_pool", marketId, result.trade.costPoints, "trade"],
    ]);
  }

  // Joined in SQL: timestamps carry microseconds that a JS Date drops.
  const snaps = await db
    .select({ prob: priceSnapshots.probabilityYes })
    .from(priceSnapshots)
    .innerJoin(
      trades,
      and(eq(trades.marketId, priceSnapshots.marketId), eq(trades.createdAt, priceSnapshots.at)),
    )
    .where(eq(trades.id, result.trade.id));
  expect(snaps.map((s) => s.prob)).toContain(result.trade.probAfter);
}

/** Every row of every public table, order-independent. */
async function snapshotAll(h: TestDbHandle): Promise<Record<string, string[]>> {
  const tables = await h.rows<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  const out: Record<string, string[]> = {};
  for (const { table_name } of tables) {
    const rows = await h.rows(sql.raw(`select * from "${table_name}"`));
    out[table_name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

describe("placeTrade: fills", () => {
  it("books the worked example: 500 points on YES in a fresh b=100 market", async () => {
    const ctx = await setup();
    const expected = quotePoints({ b: 100, qYes: 0, qNo: 0 }, "YES", 500);
    const result = ok(await trade(ctx));

    expect(result.replayed).toBe(false);
    expect(result.trade).toMatchObject({
      side: "YES",
      contracts: expected.contracts,
      costPoints: 500,
      avgPrice: 51,
      probBefore: 0.5,
      probAfter: expected.probAfter,
    });
    expect(expected.contracts).toBe(9.761859);
    expect(result.balance).toBe(9_500);
    expect(result.position).toEqual({
      contractsYes: 9.761859,
      contractsNo: 0,
      costBasisPoints: 500,
    });
    expect(await qOf(ctx.db, ctx.marketId)).toEqual({ qYes: 9.761859, qNo: 0, b: 100 });
    await expectBooked(ctx.db, ctx.marketId, U1, result);
    expect(await tradeCount(ctx.db)).toBe(1);
  });

  it("buys by contracts on YES and on NO", async () => {
    const ctx = await setup();
    const yes = ok(
      await trade(ctx, {
        mode: "buy_contracts",
        amount: 10,
        expectedAvgPrice: 51,
        expectedCostPoints: 513,
      }),
    );
    expect(yes.trade).toMatchObject({ side: "YES", contracts: 10, costPoints: 513 });
    await expectBooked(ctx.db, ctx.marketId, U1, yes);

    const state = await qOf(ctx.db, ctx.marketId);
    const quote = quoteContracts(state, "NO", 10);
    const no = ok(
      await trade(
        ctx,
        {
          side: "NO",
          mode: "buy_contracts",
          amount: 10,
          expectedAvgPrice: quote.avgPrice,
          expectedCostPoints: quote.costPoints,
          idempotencyKey: key(2),
        },
        U2,
      ),
    );
    expect(no.trade).toMatchObject({ side: "NO", contracts: 10, costPoints: quote.costPoints });
    expect(await qOf(ctx.db, ctx.marketId)).toEqual({ qYes: 10, qNo: 10, b: 100 });
    await expectBooked(ctx.db, ctx.marketId, U2, no);
  });

  it("sells part of a position, then the rest", async () => {
    const ctx = await setup();
    ok(await trade(ctx));
    const part = quoteContracts(await qOf(ctx.db, ctx.marketId), "YES", -4);
    const sold = ok(
      await trade(ctx, {
        mode: "sell_contracts",
        amount: 4,
        expectedAvgPrice: part.avgPrice,
        idempotencyKey: key(2),
      }),
    );
    expect(sold.trade).toMatchObject({ contracts: -4, costPoints: part.costPoints });
    expect(sold.trade.costPoints).toBeLessThan(0);
    expect(sold.balance).toBe(9_500 - part.costPoints);
    expect(sold.position.contractsYes).toBe(5.761859);
    await expectBooked(ctx.db, ctx.marketId, U1, sold);

    const rest = quoteContracts(await qOf(ctx.db, ctx.marketId), "YES", -5.761859);
    const closed = ok(
      await trade(ctx, {
        mode: "sell_contracts",
        amount: 5.761859,
        expectedAvgPrice: rest.avgPrice,
        idempotencyKey: key(3),
      }),
    );
    expect(closed.position.contractsYes).toBe(0);
    expect(await qOf(ctx.db, ctx.marketId)).toEqual({ qYes: 0, qNo: 0, b: 100 });
    await expectBooked(ctx.db, ctx.marketId, U1, closed);
  });

  it("restores q after a buy and an identical sell, never paying the user extra", async () => {
    const ctx = await setup();
    const bought = ok(
      await trade(ctx, {
        mode: "buy_contracts",
        amount: 7.5,
        expectedAvgPrice: 60,
        expectedCostPoints: 400,
      }),
    );
    const sold = ok(
      await trade(ctx, {
        mode: "sell_contracts",
        amount: 7.5,
        expectedAvgPrice: 40,
        idempotencyKey: key(2),
      }),
    );
    expect(sold.trade.contracts).toBe(-bought.trade.contracts);
    expect(await qOf(ctx.db, ctx.marketId)).toEqual({ qYes: 0, qNo: 0, b: 100 });
    expect(sold.balance).toBeLessThanOrEqual(10_000);
    await expectBooked(ctx.db, ctx.marketId, U1, sold);
  });

  it("writes one price snapshot per trade at the trade's database time", async () => {
    const ctx = await setup();
    const first = ok(await trade(ctx));
    const second = ok(await trade(ctx, { idempotencyKey: key(2), expectedAvgPrice: 53 }));
    const snaps = await ctx.db
      .select()
      .from(priceSnapshots)
      .where(eq(priceSnapshots.marketId, ctx.marketId))
      .orderBy(asc(priceSnapshots.at));
    expect(snaps.map((s) => s.probabilityYes)).toEqual([
      first.trade.probAfter,
      second.trade.probAfter,
    ]);
    expect(second.trade.probBefore).toBe(first.trade.probAfter);
  });
});

/** Puts back the untraded market's q after a test stored an off-range value on purpose. */
async function restoreQ(ctx: Ctx): Promise<void> {
  await ctx.db.update(markets).set({ qYes: "0" }).where(eq(markets.id, ctx.marketId));
}

describe("placeTrade: rejections write nothing", () => {
  interface Case {
    readonly code: (typeof TRADE_ERROR_CODES)[number];
    /** Extra setup on the context; returns the call to make. */
    readonly arrange: (ctx: Ctx) => Promise<() => Promise<TradeResult>>;
    readonly extra?: Record<string, unknown>;
    /** Undoes deliberate corruption from `arrange`, so the afterEach invariant check sees valid data. */
    readonly restore?: (ctx: Ctx) => Promise<void>;
  }

  const cases: Case[] = [
    {
      code: "trading_paused",
      arrange: async (ctx) => () => trade(ctx, {}, U1, { tradingPaused: true }),
    },
    {
      code: "invalid_input",
      arrange: async (ctx) => () => trade(ctx, { side: "MAYBE" }),
    },
    {
      code: "invalid_input",
      arrange: async (ctx) => () => trade(ctx, { mode: "buy_contracts", amount: 5 }),
    },
    {
      code: "unauthenticated",
      arrange: async (ctx) => () => trade(ctx, {}, user(99)),
    },
    {
      code: "account_suspended",
      arrange: async (ctx) => {
        await addUser(ctx.db, 3, 10_000, true);
        return () => trade(ctx, {}, user(3));
      },
    },
    {
      code: "market_not_found",
      arrange: async (ctx) => () =>
        trade({ db: ctx.db, marketId: "11111111-1111-4111-8111-111111111111" }),
    },
    {
      code: "market_not_open",
      arrange: async (ctx) => {
        const marketId = await addMarket(ctx.db, ctx.categoryId, { status: "proposed" });
        return () => trade({ db: ctx.db, marketId });
      },
    },
    {
      code: "market_closed",
      arrange: async (ctx) => {
        const marketId = await addMarket(ctx.db, ctx.categoryId, {
          closeAt: new Date(Date.now() - 1000),
        });
        return () => trade({ db: ctx.db, marketId });
      },
    },
    {
      code: "slippage_exceeded",
      arrange: async (ctx) => () => trade(ctx, { expectedAvgPrice: 40 }),
      extra: { requote: expect.objectContaining({ avgPrice: 51, costPoints: 500 }) },
    },
    {
      code: "trade_too_small",
      arrange: async (ctx) => () =>
        trade(ctx, { mode: "buy_contracts", amount: 0.009, expectedCostPoints: 1 }),
    },
    {
      code: "trade_too_large",
      arrange: async (ctx) => () => trade(ctx, { amount: 5_001, expectedAvgPrice: 99 }),
      extra: { maxPoints: 5_000 },
    },
    {
      code: "insufficient_balance",
      arrange: async (ctx) => {
        // A new member with no balance row at all: the row placeTrade creates is rolled back.
        await addUser(ctx.db, 4, 0);
        return () => trade(ctx, {}, user(4));
      },
      extra: { balance: 0, needed: 500 },
    },
    {
      code: "insufficient_position",
      // Nothing held and q = 0: there is nothing to sell into.
      arrange: async (ctx) => () =>
        trade(ctx, { mode: "sell_contracts", amount: 1, expectedAvgPrice: 50 }),
      extra: { held: 0 },
    },
    {
      code: "rate_limited",
      arrange: async (ctx) => () =>
        trade(ctx, {}, U1, {
          tradingPaused: false,
          rateLimit: async () => ({ code: "rate_limited", retryAfterSec: 12 }),
        }),
      extra: { retryAfterSec: 12 },
    },
    {
      code: "idempotency_key_reused",
      arrange: async (ctx) => {
        ok(await trade(ctx));
        return () => trade(ctx, { side: "NO", expectedAvgPrice: 51 });
      },
    },
    {
      code: "internal_error",
      arrange: async (ctx) => {
        // Off the engine's range: the numeric boundary refuses it, which is a bug, not input.
        await ctx.db
          .update(markets)
          .set({ qYes: "2000000000" })
          .where(eq(markets.id, ctx.marketId));
        vi.spyOn(console, "error").mockImplementation(() => {});
        return () => trade(ctx);
      },
      restore: (ctx) => restoreQ(ctx),
    },
  ];

  it("covers every code in the taxonomy", () => {
    expect(new Set(cases.map((c) => c.code))).toEqual(new Set(TRADE_ERROR_CODES));
  });

  it.each(cases.map((c, i) => [`${c.code} #${i}`, c] as const))("%s", async (_, c) => {
    const ctx = await setup();
    const act = await c.arrange(ctx);
    const before = await snapshotAll(ctx.h);
    const result = await act();
    expect(result).toMatchObject({ ok: false, code: c.code, message: expect.any(String) });
    if (c.extra) expect(result).toMatchObject(c.extra);
    expect(await snapshotAll(ctx.h)).toEqual(before);
    await c.restore?.(ctx);
  });

  it("logs an internal error with ids only and a generic message", async () => {
    const ctx = await setup();
    await ctx.db.update(markets).set({ qYes: "2000000000" }).where(eq(markets.id, ctx.marketId));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await trade(ctx);
    expect(result).toMatchObject({ ok: false, code: "internal_error" });
    expect(result.ok ? "" : result.message).not.toMatch(/numeric|2000000000/i);
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(line).toEqual({
      event: "place_trade_internal_error",
      userId: U1,
      marketId: ctx.marketId,
      error: "NumericBoundaryError",
    });
    await restoreQ(ctx);
  });

  it("reads TRADING_PAUSED from the environment by default", async () => {
    const ctx = await setup();
    vi.stubEnv("TRADING_PAUSED", "true");
    expect(await placeTrade(ctx.db, U1, input(ctx.marketId))).toMatchObject({
      code: "trading_paused",
    });
    vi.stubEnv("TRADING_PAUSED", "false");
    ok(await placeTrade(ctx.db, U1, input(ctx.marketId)));
  });

  it("refuses a market that is closed by status", async () => {
    const ctx = await setup({ status: "closed" });
    expect(await trade(ctx)).toMatchObject({ ok: false, code: "market_not_open" });
  });

  it("refuses selling more than is held", async () => {
    const ctx = await setup();
    ok(await trade(ctx));
    ok(await trade(ctx, { idempotencyKey: key(2), expectedAvgPrice: 53 }, U2));
    const result = await trade(ctx, {
      mode: "sell_contracts",
      amount: 10,
      expectedAvgPrice: 50,
      idempotencyKey: key(3),
    });
    expect(result).toMatchObject({ ok: false, code: "insufficient_position", held: 9.761859 });
  });
});

describe("placeTrade: slippage", () => {
  it("offers a requote that a retry at the new price accepts", async () => {
    const ctx = await setup();
    const stale = await trade(ctx, { expectedAvgPrice: 45 });
    if (stale.ok || stale.code !== "slippage_exceeded") throw new Error("expected slippage");
    const quote = quotePoints({ b: 100, qYes: 0, qNo: 0 }, "YES", 500);
    expect(stale.requote).toEqual({
      avgPrice: quote.avgPrice,
      contracts: quote.contracts,
      costPoints: quote.costPoints,
      probAfter: quote.probAfter,
      payoutIfWin: quote.payoutIfWin,
    });
    const retry = ok(
      await trade(ctx, { expectedAvgPrice: stale.requote.avgPrice, idempotencyKey: key(2) }),
    );
    await expectBooked(ctx.db, ctx.marketId, U1, retry);
  });

  it("accepts a price within the tolerance", async () => {
    const ctx = await setup();
    ok(await trade(ctx, { expectedAvgPrice: 49, maxSlippage: 2 }));
  });

  it("rejects a contract buy whose total cost moved by more than ceil(maxSlippage × contracts)", async () => {
    const ctx = await setup();
    // 10 YES contracts cost 513 at avg 51: the average price passes, but the total is 21 over
    // the displayed 492 (allowance ceil(2 × 10) = 20).
    const stale = await trade(ctx, {
      mode: "buy_contracts",
      amount: 10,
      expectedAvgPrice: 51,
      expectedCostPoints: 492,
    });
    expect(stale).toMatchObject({
      ok: false,
      code: "slippage_exceeded",
      requote: { costPoints: 513, contracts: 10 },
    });
    ok(
      await trade(ctx, {
        mode: "buy_contracts",
        amount: 10,
        expectedAvgPrice: 51,
        expectedCostPoints: 493,
        idempotencyKey: key(2),
      }),
    );
  });

  it("rejects a sell whose price fell by more than the tolerance", async () => {
    const ctx = await setup();
    ok(await trade(ctx));
    expect(
      await trade(ctx, {
        mode: "sell_contracts",
        amount: 5,
        expectedAvgPrice: 60,
        idempotencyKey: key(2),
      }),
    ).toMatchObject({ ok: false, code: "slippage_exceeded" });
  });
});

describe("placeTrade: size rules", () => {
  const buyContracts = (amount: number, k: string, expectedAvgPrice = 50) => ({
    mode: "buy_contracts",
    amount,
    expectedAvgPrice,
    expectedCostPoints: 100,
    idempotencyKey: key(k),
  });

  it("rejects 0.009 contracts and accepts 0.01", async () => {
    const ctx = await setup();
    expect(await trade(ctx, buyContracts(0.009, "a"))).toMatchObject({
      code: "trade_too_small",
    });
    const result = ok(await trade(ctx, buyContracts(0.01, "b")));
    expect(result.trade).toMatchObject({ contracts: 0.01, costPoints: 1 });
    await expectBooked(ctx.db, ctx.marketId, U1, result);
  });

  it("accepts a dust close-out of 0.004 contracts that pays nothing", async () => {
    const ctx = await setup();
    ok(await trade(ctx, buyContracts(1.004, "a")));
    ok(
      await trade(ctx, {
        mode: "sell_contracts",
        amount: 1,
        expectedAvgPrice: 50,
        idempotencyKey: key("b"),
      }),
    );
    // Selling 0.004 of 0.004 held closes the side out even though it is under 0.01 and pays 0
    // (the engine then reports the minimum average price, which the ticket would display).
    const quote = quoteContracts(await qOf(ctx.db, ctx.marketId), "YES", -0.004);
    expect(quote.costPoints).toBe(0);
    const dust = ok(
      await trade(ctx, {
        mode: "sell_contracts",
        amount: 0.004,
        expectedAvgPrice: quote.avgPrice,
        idempotencyKey: key("c"),
      }),
    );
    expect(dust.trade).toMatchObject({ contracts: -0.004, costPoints: 0 });
    expect(dust.position.contractsYes).toBe(0);
    await expectBooked(ctx.db, ctx.marketId, U1, dust);
  });

  it("rejects a partial sell under 0.01 contracts", async () => {
    const ctx = await setup();
    ok(await trade(ctx));
    expect(
      await trade(ctx, {
        mode: "sell_contracts",
        amount: 0.005,
        expectedAvgPrice: 50,
        idempotencyKey: key(2),
      }),
    ).toMatchObject({ code: "trade_too_small" });
  });

  it("rejects a buy above min(5000, 50·b) points", async () => {
    const ctx = await setup({ b: 50 });
    expect(await trade(ctx, { amount: 2_501, expectedAvgPrice: 99 })).toMatchObject({
      code: "trade_too_large",
      maxPoints: 2_500,
    });
    ok(await trade(ctx, { amount: 2_500, expectedAvgPrice: 99, idempotencyKey: key(2) }));
  });

  it("rejects a buy that pays less than it costs", async () => {
    const ctx = await setup();
    ok(await trade(ctx, { amount: 2_500, expectedAvgPrice: 99 }));
    const quote = quoteContracts(await qOf(ctx.db, ctx.marketId), "YES", 0.019);
    expect(quote.payoutIfWin).toBeLessThan(quote.costPoints);
    expect(await trade(ctx, buyContracts(0.019, "b", 99))).toMatchObject({
      code: "trade_too_small",
    });
  });
});

describe("placeTrade: idempotency", () => {
  it("returns the original for the same key twice and debits once", async () => {
    const ctx = await setup();
    const first = ok(await trade(ctx));
    const again = ok(await trade(ctx));
    expect(again.replayed).toBe(true);
    expect(again.trade).toEqual(first.trade);
    expect(again.balance).toBe(9_500);
    expect(await tradeCount(ctx.db)).toBe(1);
    expect(await balanceOf(ctx.db, U1)).toBe(9_500);
  });

  it("still returns the original after the market closed", async () => {
    const ctx = await setup();
    const first = ok(await trade(ctx));
    await ctx.db
      .update(markets)
      .set({ closeAt: new Date(Date.now() - 1000) })
      .where(eq(markets.id, ctx.marketId));
    const again = ok(await trade(ctx));
    expect(again).toMatchObject({ replayed: true, trade: first.trade });
    await ctx.db.update(markets).set({ status: "closed" }).where(eq(markets.id, ctx.marketId));
    expect(ok(await trade(ctx)).trade).toEqual(first.trade);
  });

  it.each<[string, Patch]>([
    ["side", { side: "NO" }],
    ["amount", { amount: 501 }],
    ["mode", { mode: "buy_contracts", amount: 500, expectedCostPoints: 500 }],
    ["expectedAvgPrice", { expectedAvgPrice: 52 }],
    ["maxSlippage", { maxSlippage: 5 }],
  ])("refuses the same key with a different %s", async (_, patch) => {
    const ctx = await setup();
    ok(await trade(ctx));
    const before = await snapshotAll(ctx.h);
    expect(await trade(ctx, patch)).toMatchObject({ ok: false, code: "idempotency_key_reused" });
    expect(await snapshotAll(ctx.h)).toEqual(before);
  });

  it("refuses the same key for a different market", async () => {
    const ctx = await setup();
    ok(await trade(ctx));
    const other = await addMarket(ctx.db, ctx.categoryId);
    expect(await trade({ db: ctx.db, marketId: other })).toMatchObject({
      code: "idempotency_key_reused",
    });
  });

  it("refuses the same key with a different expectedCostPoints", async () => {
    const ctx = await setup();
    const buy = { mode: "buy_contracts", amount: 10, expectedCostPoints: 513 };
    ok(await trade(ctx, buy));
    expect(await trade(ctx, { ...buy, expectedCostPoints: 514 })).toMatchObject({
      code: "idempotency_key_reused",
    });
  });

  it("keeps two users' identical keys independent", async () => {
    const ctx = await setup();
    const a = ok(await trade(ctx, {}, U1));
    const b = ok(await trade(ctx, { expectedAvgPrice: 53 }, U2));
    expect(b.replayed).toBe(false);
    expect(b.trade.id).not.toBe(a.trade.id);
    expect(await tradeCount(ctx.db)).toBe(2);
  });

  it("books one trade for 5 identical concurrent calls and returns it to every caller", async () => {
    const ctx = await setup();
    const results = (await Promise.all([1, 2, 3, 4, 5].map(() => trade(ctx)))).map(ok);
    expect(await tradeCount(ctx.db)).toBe(1);
    const ids = new Set(results.map((r) => r.trade.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balanceOf(ctx.db, U1)).toBe(9_500);
  });

  it("serves a replay before the rate limit and before re-validating", async () => {
    const ctx = await setup();
    const first = ok(await trade(ctx));
    const limited: PlaceTradeOptions = {
      tradingPaused: false,
      rateLimit: async () => ({ code: "rate_limited", retryAfterSec: 30 }),
    };
    expect(ok(await trade(ctx, {}, U1, limited)).trade).toEqual(first.trade);
  });
});

describe("placeTrade: numeric boundary", () => {
  it("keeps q an exact multiple of 1e-6 after 1,000 tiny trades", async () => {
    const ctx = await setup();
    let micros = { YES: 0, NO: 0 };
    for (let i = 0; i < 1_000; i++) {
      const side = i % 2 === 0 ? "YES" : "NO";
      const amount = (10_000 + ((i * 7919) % 5_000)) / 1e6; // 0.01..0.014999
      ok(
        await placeTrade(
          ctx.db,
          i % 3 === 0 ? U2 : U1,
          input(ctx.marketId, {
            side,
            mode: "buy_contracts",
            amount,
            expectedAvgPrice: 100,
            expectedCostPoints: 10,
            idempotencyKey: key(`n${i}`),
          }),
          NO_LIMIT,
        ),
      );
      micros = { ...micros, [side]: micros[side] + Math.round(amount * 1e6) };
    }
    const q = await qOf(ctx.db, ctx.marketId);
    expect(Math.round(q.qYes * 1e6)).toBe(micros.YES);
    expect(Math.round(q.qNo * 1e6)).toBe(micros.NO);
    expect(Math.round(q.qYes * 1e6) / 1e6).toBe(q.qYes);
    expect(Math.round(q.qNo * 1e6) / 1e6).toBe(q.qNo);
  }, 300_000);
});

describe("placeTrade: limits and new users", () => {
  it("refuses the 21st trade in a minute", async () => {
    const ctx = await setup();
    for (let i = 0; i < 20; i++) {
      ok(
        await trade(ctx, {
          amount: 10,
          expectedAvgPrice: 99,
          idempotencyKey: key(`r${i}`),
        }),
      );
    }
    const result = await trade(ctx, { amount: 10, expectedAvgPrice: 99, idempotencyKey: key(21) });
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
    expect(result.ok ? 0 : "retryAfterSec" in result && result.retryAfterSec).toBeGreaterThan(0);
  });

  it("gives a new member with no balance row insufficient_balance and leaves no row", async () => {
    const ctx = await setup();
    await addUser(ctx.db, 5, 0);
    expect(await trade(ctx, {}, user(5))).toMatchObject({
      code: "insufficient_balance",
      balance: 0,
      needed: 500,
    });
    expect(await balanceOf(ctx.db, user(5))).toBeUndefined();
  });

  it("lets a member spend exactly their whole balance", async () => {
    const ctx = await setup();
    await addUser(ctx.db, 6, 500);
    const result = ok(await trade(ctx, {}, user(6)));
    expect(result.balance).toBe(0);
    await expectBooked(ctx.db, ctx.marketId, user(6), result);
  });
});
