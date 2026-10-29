import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EngineError, MAX_CONTRACTS, MAX_POINTS } from "./errors";
import { quoteContracts, quotePoints } from "./lmsr";
import {
  applyFill,
  EMPTY_POSITION,
  type Position,
  settlePayouts,
  voidRefunds,
  withinSlippage,
} from "./positions";
import { maxPoolLoss, payout, voidRefund } from "./settlement";
import type { MarketState, Quote, Side } from "./types";

const toMicro = (x: number): number => Math.round(x * 1e6);
const fromMicro = (m: number): number => m / 1e6;

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

const pos = (contractsYes: number, contractsNo: number, costBasisPoints: number): Position => ({
  contractsYes,
  contractsNo,
  costBasisPoints,
});

describe("applyFill", () => {
  it("adds contracts to the right side and accumulates the cost basis", () => {
    const buy = quoteContracts({ b: 100, qYes: 0, qNo: 0 }, "YES", 10);
    const p1 = applyFill(EMPTY_POSITION, buy);
    expect(p1).toEqual(pos(10, 0, buy.costPoints));
    const buyNo = quoteContracts(buy.stateAfter, "NO", 2.5);
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
    expect(
      codeOf(() =>
        applyFill(pos(3, 0, 100), { side: "YES", contracts: -3.000001, costPoints: -90 }),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => applyFill(EMPTY_POSITION, { side: "NO", contracts: -1, costPoints: -1 })),
    ).toBe("INVALID_CONTRACTS");
  });

  it("rejects malformed fills", () => {
    expect(
      codeOf(() => applyFill(EMPTY_POSITION, { side: "YES", contracts: 0, costPoints: 0 })),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() =>
        applyFill(EMPTY_POSITION, { side: "YES", contracts: Number.NaN, costPoints: 1 }),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => applyFill(EMPTY_POSITION, { side: "YES", contracts: 1, costPoints: 1.5 })),
    ).toBe("INVALID_POINTS");
    expect(
      codeOf(() =>
        applyFill(EMPTY_POSITION, { side: "YES", contracts: 1, costPoints: Number.NaN }),
      ),
    ).toBe("INVALID_POINTS");
    expect(
      codeOf(() =>
        applyFill(EMPTY_POSITION, { side: "MAYBE" as never, contracts: 1, costPoints: 1 }),
      ),
    ).toBe("INVALID_SIDE");
  });

  it("rejects a fill below one micro-contract, an oversized fill, and non-numbers", () => {
    expect(
      codeOf(() => applyFill(EMPTY_POSITION, { side: "YES", contracts: 0.0000004, costPoints: 1 })),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() =>
        applyFill(EMPTY_POSITION, { side: "YES", contracts: MAX_CONTRACTS * 2, costPoints: 1 }),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() =>
        applyFill(EMPTY_POSITION, { side: "YES", contracts: "1" as never, costPoints: 1 }),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => applyFill(EMPTY_POSITION, { side: "YES", contracts: 1, costPoints: 2 ** 53 })),
    ).toBe("INVALID_POINTS");
    expect(codeOf(() => applyFill(EMPTY_POSITION, null as never))).toBe("INVALID_STATE");
  });

  it("rejects a fill that would push holdings or the cost basis out of range", () => {
    expect(
      codeOf(() =>
        applyFill(pos(MAX_CONTRACTS, 0, 0), { side: "YES", contracts: 1, costPoints: 1 }),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => applyFill(pos(0, 0, MAX_POINTS), { side: "NO", contracts: 1, costPoints: 1 })),
    ).toBe("INVALID_POINTS");
  });

  it("rejects a malformed position with assertPosition's codes", () => {
    const fill = { side: "YES" as const, contracts: 1, costPoints: 1 };
    expect(codeOf(() => applyFill(null as never, fill))).toBe("INVALID_STATE");
    expect(codeOf(() => applyFill(pos(-1, 0, 0), fill))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => applyFill(pos(0, 0, 0.5), fill))).toBe("INVALID_POINTS");
  });

  it("never returns −0", () => {
    const sold = applyFill(pos(1, -0, -0), { side: "YES", contracts: -1, costPoints: -0 });
    expect(Object.is(sold.contractsYes, 0)).toBe(true);
    expect(Object.is(sold.contractsNo, 0)).toBe(true);
    expect(Object.is(sold.costBasisPoints, 0)).toBe(true);
    const bought = applyFill(pos(-0, -0, -0), { side: "NO", contracts: 1, costPoints: 1 });
    expect(Object.is(bought.contractsYes, 0)).toBe(true);
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

  it("agrees with payout() for every user (one source of truth)", () => {
    for (const outcome of ["YES", "NO"] as const) {
      for (const [user, amount] of settlePayouts(positions, outcome)) {
        expect(amount).toBe(payout(positions.get(user) as Position, outcome));
      }
    }
  });

  it("returns an entry for every user, in input order, and accepts plain entry arrays", () => {
    const out = settlePayouts([...positions.entries()], "YES");
    expect([...out.keys()]).toEqual(["ann", "bob", "cat", "dee"]);
  });

  it("rejects duplicate users and invalid outcomes", () => {
    expect(
      codeOf(() =>
        settlePayouts(
          [
            ["a", EMPTY_POSITION],
            ["a", EMPTY_POSITION],
          ],
          "YES",
        ),
      ),
    ).toBe("INVALID_STATE");
    expect(codeOf(() => settlePayouts(positions, "MAYBE" as never))).toBe("INVALID_SIDE");
    expect(codeOf(() => settlePayouts([], "MAYBE" as never))).toBe("INVALID_SIDE");
  });

  it("rejects an invalid position", () => {
    expect(codeOf(() => settlePayouts([["a", pos(-1, 0, 0)]], "YES"))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => settlePayouts([["a", pos(0, Number.NaN, 0)]], "YES"))).toBe(
      "INVALID_CONTRACTS",
    );
    expect(codeOf(() => settlePayouts([["a", pos(0, 0, 0.5)]], "YES"))).toBe("INVALID_POINTS");
  });
});

describe("voidRefunds", () => {
  it("refunds each user's net cost basis, which may be a debit", () => {
    const input = new Map<string, Position>([
      ["ann", pos(5, 0, 260)],
      ["bob", pos(0, 0, -15)],
      ["cat", pos(0, 0, -0)],
    ]);
    const out = voidRefunds(input);
    expect(out.get("ann")).toBe(260);
    expect(out.get("bob")).toBe(-15);
    expect(out.get("cat")).toBe(0);
    expect(Object.is(out.get("cat"), 0)).toBe(true);
    for (const [user, amount] of out) {
      expect(amount).toBe(voidRefund(input.get(user) as Position));
    }
  });

  it("rejects duplicates and invalid positions", () => {
    expect(
      codeOf(() =>
        voidRefunds([
          ["a", EMPTY_POSITION],
          ["a", EMPTY_POSITION],
        ]),
      ),
    ).toBe("INVALID_STATE");
    expect(codeOf(() => voidRefunds([["a", pos(0, 0, 1.5)]]))).toBe("INVALID_POINTS");
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

  it("accepts a real quote at the price it was quoted at", () => {
    const quote = quoteContracts({ qYes: 0, qNo: 0, b: 100 }, "YES", 10);
    expect(withinSlippage(quote.avgPrice, quote, 0)).toBe(true);
  });

  it("rejects invalid input", () => {
    expect(codeOf(() => withinSlippage(Number.NaN, buy(50)))).toBe("INVALID_POINTS");
    expect(codeOf(() => withinSlippage(50, buy(Number.NaN)))).toBe("INVALID_POINTS");
    expect(codeOf(() => withinSlippage(50, buy(50), -1))).toBe("INVALID_POINTS");
    expect(codeOf(() => withinSlippage(50, buy(50), Number.NaN))).toBe("INVALID_POINTS");
    expect(codeOf(() => withinSlippage(50, { contracts: 0, avgPrice: 50 }))).toBe(
      "INVALID_CONTRACTS",
    );
    expect(
      codeOf(() => withinSlippage(50, { contracts: Number.POSITIVE_INFINITY, avgPrice: 50 })),
    ).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => withinSlippage(50, null as never))).toBe("INVALID_STATE");
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
    let quote: Quote | undefined;
    if (op.kind === "points") {
      const cap = Math.min(balance, maxSpend);
      if (cap < 1) continue;
      quote = quotePoints(sim.market, op.side, 1 + Math.floor(op.frac * (cap - 1)));
    } else if (op.kind === "contracts") {
      const micro = 1 + Math.floor(op.frac * 50_000_000); // up to 50 contracts
      quote = quoteContracts(sim.market, op.side, fromMicro(micro));
      if (quote.costPoints > balance) continue;
    } else {
      const heldMicro = toMicro(op.side === "YES" ? position.contractsYes : position.contractsNo);
      if (heldMicro < 1) continue;
      quote = quoteContracts(
        sim.market,
        op.side,
        -fromMicro(1 + Math.floor(op.frac * (heldMicro - 1))),
      );
    }
    sim.balances[op.user] = balance - quote.costPoints;
    sim.positions[op.user] = applyFill(position, quote);
    sim.market = quote.stateAfter;
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

describe("applyFill sign checks (M1 adversarial review)", () => {
  it("rejects a buy that costs less than 1 point and a sell that charges the user", () => {
    expect(
      codeOf(() => applyFill(EMPTY_POSITION, { side: "YES", contracts: 100, costPoints: 0 })),
    ).toBe("INVALID_POINTS");
    expect(
      codeOf(() => applyFill(EMPTY_POSITION, { side: "NO", contracts: 1, costPoints: -5 })),
    ).toBe("INVALID_POINTS");
    const held = applyFill(EMPTY_POSITION, { side: "YES", contracts: 2, costPoints: 101 });
    expect(codeOf(() => applyFill(held, { side: "YES", contracts: -1, costPoints: 3 }))).toBe(
      "INVALID_POINTS",
    );
    expect(applyFill(held, { side: "YES", contracts: -1, costPoints: 0 }).contractsYes).toBe(1);
  });
});
