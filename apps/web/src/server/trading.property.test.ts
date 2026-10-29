import { maxPoolLoss, type Side } from "@mc-kalshi/engine";
import { and, eq, inArray, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  balances,
  categories,
  ledgerEntries,
  markets,
  positions,
  profiles,
  trades,
} from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { checkTradingInvariants } from "./invariants";
import { checkLedgerInvariants, grantSignupBonus } from "./ledger";
import { parseNumeric } from "./numeric";
import { quoteTrade } from "./quote";
import { TRADE_ERROR_CODES, type TradeMode } from "./trade-types";
import { placeTrade } from "./trading";

// Spec "Property test": random sequences of up to 12 trades from 3 users on 1–2 fresh markets
// per run, all in one database for the file. After each run the books must balance exactly.

const RUNS = 100;
const MICRO = 1e6;
const micros = (s: string) => Math.round(parseNumeric(s) * MICRO);

let h: TestDbHandle;
let db: AnyDb;
let categoryId: string;
let serial = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;

beforeAll(async () => {
  h = await openTestDb();
  db = h.db;
  const [category] = await db
    .insert(categories)
    .values({ slug: "prop", name: "Prop" })
    .returning({ id: categories.id });
  if (!category) throw new Error("no category");
  categoryId = category.id;
});
afterAll(() => h.close());

const action = fc.record({
  user: fc.integer({ min: 0, max: 2 }),
  market: fc.integer({ min: 0, max: 1 }),
  side: fc.constantFrom<Side>("YES", "NO"),
  mode: fc.constantFrom<TradeMode>("buy_points", "buy_contracts", "sell_contracts"),
  /** buy_points: points; buy_contracts: micro-contracts; sell: per-mille of the holding. */
  seed: fc.integer({ min: 1, max: 6_000 }),
  sellAll: fc.boolean(),
  /** Added to the quoted price and cost, so some trades exceed the slippage tolerance. */
  skew: fc.integer({ min: -4, max: 4 }),
  /** Resend this user's previous key: with the previous request verbatim, or with this one. */
  reuse: fc.constantFrom("none", "none", "same", "different"),
});

const scenario = fc.record({
  bs: fc.array(fc.integer({ min: 50, max: 500 }), { minLength: 1, maxLength: 2 }),
  bonuses: fc.tuple(
    fc.integer({ min: 0, max: 12_000 }),
    fc.integer({ min: 0, max: 12_000 }),
    fc.integer({ min: 0, max: 12_000 }),
  ),
  actions: fc.array(action, { minLength: 1, maxLength: 12 }),
});

async function heldOn(marketId: string, userId: string, side: Side): Promise<number> {
  const [p] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.marketId, marketId), eq(positions.userId, userId)));
  return p ? parseNumeric(side === "YES" ? p.contractsYes : p.contractsNo) : 0;
}

async function stateOf(marketId: string) {
  const [m] = await db.select().from(markets).where(eq(markets.id, marketId));
  if (!m) throw new Error("no market");
  return { b: m.b, qYes: parseNumeric(m.qYes), qNo: parseNumeric(m.qNo) };
}

describe("placeTrade property", () => {
  it(`keeps the books exact over ${RUNS} random trade sequences`, async () => {
    const codes = new Set<string>(TRADE_ERROR_CODES);
    const seen = new Map<string, number>();
    const started = performance.now();

    await fc.assert(
      fc.asyncProperty(scenario, async ({ bs, bonuses, actions }) => {
        const users = bonuses.map(() => nextId());
        for (const [i, id] of users.entries()) {
          await db
            .insert(profiles)
            .values({ id, email: `p${id.slice(-12)}@my.maryvillecollege.edu`, displayName: "P" });
          const bonus = bonuses[i] ?? 0;
          if (bonus > 0) await grantSignupBonus(db, id, bonus);
        }
        const marketIds: string[] = [];
        for (const b of bs) {
          const [m] = await db
            .insert(markets)
            .values({
              slug: `prop-${serial}-${marketIds.length}`,
              title: "P",
              rules: "P",
              categoryId,
              status: "open",
              b,
              closeAt: new Date(Date.now() + 86_400_000),
            })
            .returning({ id: markets.id });
          if (!m) throw new Error("no market");
          marketIds.push(m.id);
        }

        const lastRequest = new Map<string, Record<string, unknown>>();
        for (const [n, a] of actions.entries()) {
          const userId = users[a.user] as string;
          const previous = lastRequest.get(userId);
          const marketId = marketIds[a.market % marketIds.length] as string;
          let amount: number;
          if (a.mode === "buy_points") {
            amount = a.seed;
          } else if (a.mode === "buy_contracts") {
            amount = (a.seed * 7_919) / MICRO; // 0.007919 .. 47.5 contracts
          } else {
            const held = await heldOn(marketId, userId, a.side);
            const part = Math.round((held * MICRO * (a.seed % 1_000)) / 1_000) / MICRO;
            amount = a.sellAll && held > 0 ? held : part > 0 ? part : a.seed / 1_000;
          }
          const q = quoteTrade(await stateOf(marketId), a.side, a.mode, amount);
          const price = q.ok ? q.quote.avgPrice : 50;
          const cost = q.ok ? q.quote.costPoints : 1;
          const fresh = {
            marketId,
            side: a.side,
            mode: a.mode,
            amount,
            expectedAvgPrice: Math.min(100, Math.max(0, price + a.skew)),
            expectedCostPoints: Math.max(1, cost + a.skew * 3),
            maxSlippage: 2,
            idempotencyKey: `prop-key-${serial}-${n}-${a.user}`.padEnd(20, "0"),
          };
          const request =
            previous && a.reuse === "same"
              ? previous
              : previous && a.reuse === "different"
                ? { ...fresh, idempotencyKey: previous.idempotencyKey }
                : fresh;
          lastRequest.set(userId, request);

          const result = await placeTrade(db, userId, request, { tradingPaused: false });
          const label = result.ok ? (result.replayed ? "replayed" : "ok") : result.code;
          seen.set(label, (seen.get(label) ?? 0) + 1);
          if (!result.ok) {
            expect(codes.has(result.code)).toBe(true);
            expect(result.code).not.toBe("internal_error");
          }
        }

        const inv = await checkLedgerInvariants(db);
        expect(inv.ledgerSum).toBe(0);
        expect(inv.mismatches).toEqual([]);
        const trading = await checkTradingInvariants(db);
        expect(trading.issues).toEqual([]);
        expect(trading.ok).toBe(true);

        const bal = await db.select().from(balances).where(inArray(balances.userId, users));
        for (const row of bal) expect(row.points).toBeGreaterThanOrEqual(0);

        for (const marketId of marketIds) {
          const [m] = await db.select().from(markets).where(eq(markets.id, marketId));
          if (!m) throw new Error("no market");
          const held = await db.select().from(positions).where(eq(positions.marketId, marketId));
          const sumYes = held.reduce((s, p) => s + micros(p.contractsYes), 0);
          const sumNo = held.reduce((s, p) => s + micros(p.contractsNo), 0);
          for (const p of held) {
            expect(micros(p.contractsYes)).toBeGreaterThanOrEqual(0);
            expect(micros(p.contractsNo)).toBeGreaterThanOrEqual(0);
          }
          expect(sumYes).toBe(micros(m.qYes));
          expect(sumNo).toBe(micros(m.qNo));

          const fills = await db.select().from(trades).where(eq(trades.marketId, marketId));
          const tradedYes = fills
            .filter((t) => t.side === "YES")
            .reduce((s, t) => s + micros(t.contracts), 0);
          const tradedNo = fills
            .filter((t) => t.side === "NO")
            .reduce((s, t) => s + micros(t.contracts), 0);
          expect([tradedYes, tradedNo]).toEqual([micros(m.qYes), micros(m.qNo)]);

          const [pool] = await db
            .select({ sum: sql<string>`coalesce(sum(${ledgerEntries.deltaPoints}), 0)` })
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.accountType, "market_pool"),
                eq(ledgerEntries.accountId, marketId),
              ),
            );
          const poolPoints = Number(pool?.sum ?? 0);
          expect(poolPoints).toBe(fills.reduce((s, t) => s + t.costPoints, 0));
          // What the pool would pay on each outcome (floor per holder) minus what it took in.
          const payYes = held.reduce((s, p) => s + Math.floor(micros(p.contractsYes) / 1e4), 0);
          const payNo = held.reduce((s, p) => s + Math.floor(micros(p.contractsNo) / 1e4), 0);
          expect(Math.max(payYes, payNo) - poolPoints).toBeLessThanOrEqual(maxPoolLoss(m.b));
        }
      }),
      { numRuns: RUNS },
    );

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.info(
      `[property] ${RUNS} runs in ${seconds} s; outcomes ${JSON.stringify(Object.fromEntries(seen))}`,
    );
    // The generator must exercise both fills and rejections, or the property says little.
    expect(seen.get("ok") ?? 0).toBeGreaterThan(RUNS / 2);
    expect(seen.size).toBeGreaterThan(4);
  }, 600_000);
});
