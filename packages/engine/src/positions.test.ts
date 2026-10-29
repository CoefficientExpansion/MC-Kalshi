import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromMicro, type MarketState, maxPoolLoss, type Side, toMicro } from "./lmsr";
import {
  applyFill,
  EMPTY_POSITION,
  type Position,
  settlePayouts,
  voidRefunds,
  withinSlippage,
} from "./positions";
import { quoteBuyContracts, quoteBuyWithPoints, quoteSellContracts } from "./quote";

const pos = (contractsYes: number, contractsNo: number, costBasisPoints: number): Position => ({
  contractsYes,
  contractsNo,
  costBasisPoints,
});

describe("applyFill", () => {
  it("adds contracts to the right side and accumulates the cost basis", () => {
    const buy = quoteBuyContracts({ b: 100, qYes: 0, qNo: 0 }, "YES", 10);
    const p1 = applyFill(EMPTY_POSITION, buy);
    expect(p1).toEqual(pos(10, 0, buy.costPoints));
    const buyNo = quoteBuyContracts(buy.nextState, "NO", 2.5);
    const p2 = applyFill(p1, buyNo);
    expect(p2).toEqual(pos(10, 2.5, buy.costPoints + buyNo.costPoints));
  });

  it("a sell reduces contracts and the cost basis (proceeds are negative cost)", () => {
    const start = pos(10, 0, 520);
    const sold = applyFill(start, { side: "YES", contracts: -4, costPoints: -190 });
    expect(sold).toEqual(pos(6, 0, 330));
  });

  it("keeps contracts exact to 6 dp where float addition would drift", () => {
    let p = EMPTY_POSITION;
    for (let i = 0; i < 10; i++) {
      p = applyFill(p, { side: "YES", contracts: 0.1, costPoints: 1 });
    }
    expect(p.contractsYes).toBe(1);
    expect(
      applyFill(pos(0.3, 0, 0), { side: "NO", contracts: 0.7, costPoints: 1 }).contractsNo,
    ).toBe(0.7);
    expect(
      applyFill(pos(0.3, 0, 0), { side: "YES", contracts: 0.000001, costPoints: 1 }).contractsYes,
    ).toBe(0.300001);
  });

  it("does not mutate its input", () => {
    const start = pos(1, 2, 3);
    applyFill(start, { side: "YES", contracts: 1, costPoints: 1 });
    expect(start).toEqual(pos(1, 2, 3));
  });

  it("allows selling everything held, but not more", () => {
    expect(applyFill(pos(3, 0, 100), { side: "YES", contracts: -3, costPoints: -90 })).toEqual(
      pos(0, 0, 10),
    );
    expect(() =>
      applyFill(pos(3, 0, 100), { side: "YES", contracts: -3.000001, costPoints: -90 }),
    ).toThrow(RangeError);
    expect(() => applyFill(EMPTY_POSITION, { side: "NO", contracts: -1, costPoints: -1 })).toThrow(
      RangeError,
    );
  });

  it("rejects malformed fills", () => {
    expect(() => applyFill(EMPTY_POSITION, { side: "YES", contracts: 0, costPoints: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      applyFill(EMPTY_POSITION, { side: "YES", contracts: Number.NaN, costPoints: 1 }),
    ).toThrow(RangeError);
    expect(() => applyFill(EMPTY_POSITION, { side: "YES", contracts: 1, costPoints: 1.5 })).toThrow(
      RangeError,
    );
    expect(() =>
      applyFill(EMPTY_POSITION, { side: "YES", contracts: 1, costPoints: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      applyFill(EMPTY_POSITION, { side: "MAYBE" as never, contracts: 1, costPoints: 1 }),
    ).toThrow(RangeError);
  });
});

describe("settlePayouts", () => {
  const positions = new Map<string, Position>([
    ["ann", pos(9.761859, 0, 500)],
    ["bob", pos(0, 3.333333, 170)],
    ["cat", pos(1.999999, 2, 190)],
    ["dee", pos(0, 0, 0)],
  ]);

  it("pays floor(winning contracts × 100) per user, rounding down", () => {
    const yes = settlePayouts(positions, "YES");
    expect(yes.get("ann")).toBe(976);
    expect(yes.get("bob")).toBe(0);
    expect(yes.get("cat")).toBe(199);
    expect(yes.get("dee")).toBe(0);
    const no = settlePayouts(positions, "NO");
    expect(no.get("ann")).toBe(0);
    expect(no.get("bob")).toBe(333);
    expect(no.get("cat")).toBe(200);
  });

  it("returns an entry for every user, in input order, and accepts plain entry arrays", () => {
    const out = settlePayouts([...positions.entries()], "YES");
    expect([...out.keys()]).toEqual(["ann", "bob", "cat", "dee"]);
  });

  it("rejects duplicate users and invalid outcomes", () => {
    expect(() =>
      settlePayouts(
        [
          ["a", EMPTY_POSITION],
          ["a", EMPTY_POSITION],
        ],
        "YES",
      ),
    ).toThrow(RangeError);
    expect(() => settlePayouts(positions, "MAYBE" as never)).toThrow(RangeError);
  });

  it("rejects an invalid position", () => {
    expect(() => settlePayouts([["a", pos(-1, 0, 0)]], "YES")).toThrow(RangeError);
    expect(() => settlePayouts([["a", pos(0, Number.NaN, 0)]], "YES")).toThrow(RangeError);
    expect(() => settlePayouts([["a", pos(0, 0, 0.5)]], "YES")).toThrow(RangeError);
  });
});

describe("voidRefunds", () => {
  it("refunds each user's net cost basis, which may be a debit", () => {
    const out = voidRefunds(
      new Map<string, Position>([
        ["ann", pos(5, 0, 260)],
        ["bob", pos(0, 0, -15)],
        ["cat", pos(0, 0, 0)],
      ]),
    );
    expect(out.get("ann")).toBe(260);
    expect(out.get("bob")).toBe(-15);
    expect(out.get("cat")).toBe(0);
    expect(Object.is(out.get("cat"), 0)).toBe(true);
  });

  it("rejects duplicates and invalid positions", () => {
    expect(() =>
      voidRefunds([
        ["a", EMPTY_POSITION],
        ["a", EMPTY_POSITION],
      ]),
    ).toThrow(RangeError);
    expect(() => voidRefunds([["a", pos(0, 0, 1.5)]])).toThrow(RangeError);
  });
});

describe("withinSlippage", () => {
  const buy = (avgPrice: number) => ({ contracts: 5, avgPrice });
  const sell = (avgPrice: number) => ({ contracts: -5, avgPrice });

  it("buys reject only when the fill is more expensive than expected + tolerance", () => {
    expect(withinSlippage(50, buy(50))).toBe(true);
    expect(withinSlippage(50, buy(40))).toBe(true); // cheaper is always fine
    expect(withinSlippage(50, buy(52))).toBe(true); // exactly at the 2-point default
    expect(withinSlippage(50, buy(52.01))).toBe(false);
    expect(withinSlippage(50, buy(51), 0.5)).toBe(false);
    expect(withinSlippage(50, buy(50.5), 0.5)).toBe(true);
  });

  it("sells reject only when the fill pays less than expected − tolerance", () => {
    expect(withinSlippage(50, sell(50))).toBe(true);
    expect(withinSlippage(50, sell(60))).toBe(true);
    expect(withinSlippage(50, sell(48))).toBe(true);
    expect(withinSlippage(50, sell(47.99))).toBe(false);
    expect(withinSlippage(50, sell(49), 0)).toBe(false);
  });

  it("rejects invalid input", () => {
    expect(() => withinSlippage(Number.NaN, buy(50))).toThrow(RangeError);
    expect(() => withinSlippage(50, buy(Number.NaN))).toThrow(RangeError);
    expect(() => withinSlippage(50, buy(50), -1)).toThrow(RangeError);
    expect(() => withinSlippage(50, buy(50), Number.NaN)).toThrow(RangeError);
    expect(() => withinSlippage(50, { contracts: 0, avgPrice: 50 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Multi-user simulation shared by properties 4 and 6.
// ---------------------------------------------------------------------------------------------

type Kind = "points" | "contracts" | "sell";
interface Op {
  user: number;
  kind: Kind;
  side: Side;
  /** Fraction in [0, 1] of the maximum sensible amount for this operation. */
  frac: number;
}

const N_USERS = 4;
const START_BALANCE = 1_000_000;

const opArb: fc.Arbitrary<Op> = fc.record({
  user: fc.integer({ min: 0, max: N_USERS - 1 }),
  kind: fc.constantFrom<Kind>("points", "contracts", "sell"),
  side: fc.constantFrom<Side>("YES", "NO"),
  frac: fc.integer({ min: 0, max: 1_000_000 }).map((n) => n / 1e6),
});

interface Sim {
  b: number;
  market: MarketState;
  balances: number[];
  positions: Position[];
  /** Sum of every fill's costPoints = points that moved from users into the pool. */
  poolRevenue: number;
  trades: number;
}

/** Run `ops`, calling `check` after each applied trade. Users only sell what they hold. */
function simulate(
  b: number,
  ops: readonly Op[],
  maxSpend: number,
  check?: (sim: Sim) => void,
): Sim {
  const sim: Sim = {
    b,
    market: { b, qYes: 0, qNo: 0 },
    balances: Array.from({ length: N_USERS }, () => START_BALANCE),
    positions: Array.from({ length: N_USERS }, () => EMPTY_POSITION),
    poolRevenue: 0,
    trades: 0,
  };
  for (const op of ops) {
    const balance = sim.balances[op.user] ?? 0;
    const position = sim.positions[op.user] ?? EMPTY_POSITION;
    let quote: ReturnType<typeof quoteBuyWithPoints> | undefined;
    if (op.kind === "points") {
      const cap = Math.min(balance, maxSpend);
      if (cap < 1) continue;
      quote = quoteBuyWithPoints(sim.market, op.side, 1 + Math.floor(op.frac * (cap - 1)));
    } else if (op.kind === "contracts") {
      const micro = 1 + Math.floor(op.frac * 50_000_000); // up to 50 contracts
      quote = quoteBuyContracts(sim.market, op.side, fromMicro(micro));
      if (quote.costPoints > balance) continue;
    } else {
      const heldMicro = toMicro(op.side === "YES" ? position.contractsYes : position.contractsNo);
      if (heldMicro < 1) continue;
      quote = quoteSellContracts(
        sim.market,
        op.side,
        fromMicro(1 + Math.floor(op.frac * (heldMicro - 1))),
      );
    }
    sim.balances[op.user] = balance - quote.costPoints;
    sim.positions[op.user] = applyFill(position, quote);
    sim.market = quote.nextState;
    sim.poolRevenue += quote.costPoints;
    sim.trades += 1;
    check?.(sim);
  }
  return sim;
}

describe("simulated markets", () => {
  it("property 4: pool liability max(qYes, qNo)·100 − Σ costPoints never exceeds 100·b·ln 2", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.array(opArb, { minLength: 1, maxLength: 80 }),
        fc.constantFrom(500, 5_000, 100_000),
        (b, ops, maxSpend) => {
          const bound = maxPoolLoss(b);
          simulate(b, ops, maxSpend, (sim) => {
            const liability = 100 * Math.max(sim.market.qYes, sim.market.qNo) - sim.poolRevenue;
            expect(liability).toBeLessThanOrEqual(bound + 1e-6);
            // AMM q is exactly what users hold in total
            const held = (side: Side) =>
              sim.positions.reduce(
                (sum, p) => sum + toMicro(side === "YES" ? p.contractsYes : p.contractsNo),
                0,
              );
            expect(held("YES")).toBe(toMicro(sim.market.qYes));
            expect(held("NO")).toBe(toMicro(sim.market.qNo));
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("property 4 (settlement): after payouts the pool is never down by more than 100·b·ln 2", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.array(opArb, { minLength: 1, maxLength: 60 }),
        fc.constantFrom<Side>("YES", "NO"),
        (b, ops, outcome) => {
          const sim = simulate(b, ops, 100_000);
          const payouts = settlePayouts(
            sim.positions.map((p, i) => [i, p] as const),
            outcome,
          );
          let paid = 0;
          for (const v of payouts.values()) {
            expect(Number.isInteger(v)).toBe(true);
            paid += v;
          }
          expect(paid - sim.poolRevenue).toBeLessThanOrEqual(maxPoolLoss(b) + 1e-6);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("property 6: voidRefunds restores every user's balance exactly (integer arithmetic)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.array(opArb, { minLength: 0, maxLength: 80 }),
        fc.constantFrom(500, 5_000, 100_000),
        (b, ops, maxSpend) => {
          const sim = simulate(b, ops, maxSpend);
          const refunds = voidRefunds(sim.positions.map((p, i) => [i, p] as const));
          let refundTotal = 0;
          sim.balances.forEach((balance, user) => {
            const refund = refunds.get(user) ?? Number.NaN;
            expect(Number.isInteger(refund)).toBe(true);
            expect(Number.isInteger(balance)).toBe(true);
            expect(balance + refund).toBe(START_BALANCE);
            refundTotal += refund;
          });
          // the pool pays back exactly what it took in
          expect(refundTotal).toBe(sim.poolRevenue);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("actually exercises buys, sells and both sides (guards against a vacuous simulation)", () => {
    const ops: Op[] = [
      { user: 0, kind: "points", side: "YES", frac: 0.5 },
      { user: 1, kind: "contracts", side: "NO", frac: 0.2 },
      { user: 0, kind: "sell", side: "YES", frac: 0.5 },
      { user: 2, kind: "points", side: "NO", frac: 1 },
    ];
    const sim = simulate(100, ops, 5_000);
    expect(sim.trades).toBe(4);
    expect(sim.positions[0]?.contractsYes).toBeGreaterThan(0);
    expect(sim.positions[1]?.contractsNo).toBeGreaterThan(0);
    expect(sim.market.qNo).toBeGreaterThan(0);
  });
});
