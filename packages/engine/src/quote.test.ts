import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type MarketState, probYes, rawCost, type Side } from "./lmsr";
import { quoteBuyContracts, quoteBuyWithPoints, quoteSellContracts } from "./quote";

const state = (b: number, qYes: number, qNo: number): MarketState => ({ b, qYes, qNo });
const fresh = (b = 100): MarketState => state(b, 0, 0);
const isMicro = (x: number): boolean => Math.round(x * 1e6) / 1e6 === x;
const sideArb = fc.constantFrom<Side>("YES", "NO");

describe("worked example (architecture §5)", () => {
  it("b = 100, q = (0, 0), 500 points on YES gives about 9.76 contracts", () => {
    const q = quoteBuyWithPoints(fresh(), "YES", 500);
    expect(q.side).toBe("YES");
    expect(q.contracts).toBeCloseTo(9.76, 1);
    expect(q.contracts).toBeCloseTo(100 * Math.log(2 * Math.exp(0.05) - 1), 4);
    expect(q.costPoints).toBeLessThanOrEqual(500);
    expect(q.costPoints).toBeGreaterThanOrEqual(499);
    expect(q.avgPrice).toBeGreaterThan(50.5);
    expect(q.avgPrice).toBeLessThan(51.5);
    expect(q.probBefore).toBe(0.5);
    expect(q.probAfter).toBeCloseTo(0.524, 3);
    expect([975, 976]).toContain(q.payoutIfWin);
    expect(q.payoutIfWin).toBe(Math.floor(q.contracts * 100));
    expect(isMicro(q.contracts)).toBe(true);
    expect(q.nextState).toEqual({ b: 100, qYes: q.contracts, qNo: 0 });
  });

  it("the same trade on NO is the mirror image", () => {
    const yes = quoteBuyWithPoints(fresh(), "YES", 500);
    const no = quoteBuyWithPoints(fresh(), "NO", 500);
    expect(no.contracts).toBe(yes.contracts);
    expect(no.costPoints).toBe(yes.costPoints);
    expect(no.probBefore).toBe(0.5);
    expect(no.probAfter).toBeCloseTo(1 - yes.probAfter, 12);
    expect(no.nextState).toEqual({ b: 100, qYes: 0, qNo: no.contracts });
  });
});

describe("quoteBuyContracts", () => {
  it("rounds the cost up to a whole point", () => {
    const q = quoteBuyContracts(fresh(), "YES", 1);
    const raw = rawCost(fresh(), "YES", 1);
    expect(raw).toBeGreaterThan(50);
    expect(raw).toBeLessThan(51);
    expect(q.costPoints).toBe(Math.ceil(raw));
    expect(q.costPoints).toBe(51);
    expect(Number.isInteger(q.costPoints)).toBe(true);
    expect(q.contracts).toBe(1);
    expect(q.avgPrice).toBe(51);
    expect(q.payoutIfWin).toBe(100);
  });

  it("reports probBefore / probAfter as P(YES) for both sides", () => {
    const s = state(100, 20, 5);
    const buyYes = quoteBuyContracts(s, "YES", 3);
    expect(buyYes.probBefore).toBe(probYes(s));
    expect(buyYes.probAfter).toBe(probYes(buyYes.nextState));
    expect(buyYes.probAfter).toBeGreaterThan(buyYes.probBefore);
    const buyNo = quoteBuyContracts(s, "NO", 3);
    expect(buyNo.probBefore).toBe(probYes(s));
    expect(buyNo.probAfter).toBeLessThan(buyNo.probBefore);
    expect(buyNo.nextState).toEqual({ b: 100, qYes: 20, qNo: 8 });
  });

  it("does not mutate the input state", () => {
    const s = state(100, 20, 5);
    quoteBuyContracts(s, "YES", 3);
    expect(s).toEqual(state(100, 20, 5));
  });

  it("rounds a fractional-micro input to the nearest micro-contract", () => {
    expect(quoteBuyContracts(fresh(), "YES", 0.29).contracts).toBe(0.29);
    expect(quoteBuyContracts(fresh(), "YES", 1.0000004).contracts).toBe(1);
  });

  it("charges at least 1 point even when the raw cost is vanishingly small", () => {
    const longShot = state(50, 0, 1e6); // YES is a ~0-probability long shot
    expect(rawCost(longShot, "YES", 0.000001)).toBeLessThan(1e-9);
    expect(quoteBuyContracts(longShot, "YES", 0.000001).costPoints).toBe(1);
  });

  it("never charges less than the exact cost", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        sideArb,
        fc.integer({ min: 1, max: 100_000_000 }),
        (b, qy, qn, side, micro) => {
          const s = state(b, qy, qn);
          const raw = rawCost(s, side, micro / 1e6);
          const q = quoteBuyContracts(s, side, micro / 1e6);
          expect(q.costPoints).toBeGreaterThanOrEqual(raw - 1e-9);
          expect(q.costPoints).toBeLessThanOrEqual(Math.max(1, raw + 1));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("rejects non-positive, non-finite and sub-micro amounts", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 4e-7, 1e10]) {
      expect(() => quoteBuyContracts(fresh(), "YES", bad)).toThrow(RangeError);
    }
  });

  it("rejects an invalid state or side", () => {
    expect(() => quoteBuyContracts(state(0, 0, 0), "YES", 1)).toThrow(RangeError);
    expect(() => quoteBuyContracts(fresh(), "MAYBE" as never, 1)).toThrow(RangeError);
  });
});

describe("quoteBuyWithPoints", () => {
  it("never spends more than the budget, and buys the most contracts that fit", () => {
    for (const budget of [1, 2, 7, 50, 500, 12_345]) {
      const q = quoteBuyWithPoints(fresh(), "YES", budget);
      expect(q.costPoints).toBeLessThanOrEqual(budget);
      // one more micro-contract would no longer fit in the budget
      const more = quoteBuyContracts(fresh(), "YES", q.contracts + 1e-6);
      expect(more.costPoints).toBeGreaterThan(budget);
    }
  });

  it("steps contracts down by 1e-6 when float error would push ceil(cost) over the budget", () => {
    // Found by search: the floored closed-form answer costs 2397 here; one micro-contract
    // fewer costs exactly the 2396 budget.
    const s = state(75, 2835.615367, 106.765509);
    const q = quoteBuyWithPoints(s, "YES", 2396);
    expect(q.costPoints).toBe(2396);
    expect(quoteBuyContracts(s, "YES", q.contracts + 1e-6).costPoints).toBe(2397);
  });

  it("rejects non-integer, non-positive and non-finite budgets", () => {
    for (const bad of [0, -5, 0.5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => quoteBuyWithPoints(fresh(), "YES", bad)).toThrow(RangeError);
    }
  });

  it("rejects budgets (unsafe integers, or contracts beyond the micro-contract range)", () => {
    expect(() => quoteBuyWithPoints(fresh(), "YES", 9e15)).toThrow(RangeError);
    expect(() => quoteBuyWithPoints(fresh(), "YES", 1e16)).toThrow(RangeError);
  });

  it("works when the market is already lopsided, on either side", () => {
    const s = state(50, 4000, 0); // p(YES) ≈ 1
    const buyNo = quoteBuyWithPoints(s, "NO", 300);
    expect(buyNo.costPoints).toBeLessThanOrEqual(300);
    expect(buyNo.costPoints).toBeGreaterThanOrEqual(299);
    const buyYes = quoteBuyWithPoints(s, "YES", 300);
    expect(buyYes.costPoints).toBeLessThanOrEqual(300);
    expect(buyYes.costPoints).toBeGreaterThanOrEqual(299);
    // a long shot is cheap per contract
    expect(buyNo.avgPrice).toBeLessThan(1);
  });

  it("property 5: costPoints ≤ c and ≥ c − 1 for c ≥ 1 and p ∈ [0.01, 0.99]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        // |qYes − qNo| / b ≤ ln(99) keeps p within [0.01, 0.99]
        fc.double({ min: -Math.log(99), max: Math.log(99), noNaN: true }),
        fc.integer({ min: -2000, max: 2000 }),
        sideArb,
        fc.integer({ min: 1, max: 200_000 }),
        (b, ratio, offset, side, budget) => {
          const diff = ratio * b;
          const base = 3000 + offset;
          const s = state(
            b,
            Math.round((base + diff / 2) * 1e6) / 1e6,
            Math.round((base - diff / 2) * 1e6) / 1e6,
          );
          const p = probYes(s);
          fc.pre(p >= 0.01 && p <= 0.99);
          const q = quoteBuyWithPoints(s, side, budget);
          expect(q.costPoints).toBeLessThanOrEqual(budget);
          expect(q.costPoints).toBeGreaterThanOrEqual(budget - 1);
          expect(isMicro(q.contracts)).toBe(true);
          expect(q.contracts).toBeGreaterThan(0);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("property 5 (extremes): the budget is respected even when p is outside [0.01, 0.99]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        sideArb,
        fc.integer({ min: 1, max: 50_000 }),
        (b, ratio, side, budget) => {
          const s = state(
            b,
            Math.round(Math.max(0, ratio * b) * 1e6) / 1e6,
            Math.round(Math.max(0, -ratio * b) * 1e6) / 1e6,
          );
          const q = quoteBuyWithPoints(s, side, budget);
          expect(q.costPoints).toBeLessThanOrEqual(budget);
          expect(q.costPoints).toBeGreaterThanOrEqual(1);
          expect(Number.isFinite(q.contracts)).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("quoteSellContracts", () => {
  it("returns proceeds rounded down as a negative costPoints", () => {
    const bought = quoteBuyContracts(fresh(), "YES", 10);
    const sold = quoteSellContracts(bought.nextState, "YES", 10);
    const raw = rawCost(bought.nextState, "YES", -10);
    expect(raw).toBeLessThan(0);
    expect(sold.costPoints).toBe(-Math.floor(-raw));
    expect(sold.costPoints).toBeLessThan(0);
    expect(sold.contracts).toBe(-10);
    expect(sold.payoutIfWin).toBe(0);
    expect(sold.avgPrice).toBe(-sold.costPoints / 10);
    expect(sold.probBefore).toBe(probYes(bought.nextState));
    expect(sold.probAfter).toBe(0.5);
    expect(sold.nextState).toEqual(fresh());
  });

  it("property: proceeds never exceed the exact value and are within 1 point of it", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        sideArb,
        fc.integer({ min: 1, max: 1_000_000_000 }),
        (b, qSide, qOther, side, micro) => {
          const s = side === "YES" ? state(b, qSide, qOther) : state(b, qOther, qSide);
          const amount = Math.min(micro, qSide * 1e6) / 1e6;
          const exact = -rawCost(s, side, -amount);
          const q = quoteSellContracts(s, side, amount);
          expect(-q.costPoints).toBeLessThanOrEqual(exact + 1e-9);
          expect(-q.costPoints).toBeGreaterThan(exact - 1);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("returns 0 (not -0) when the proceeds round down to nothing", () => {
    const q = quoteSellContracts(state(100, 5, 0), "YES", 0.000001);
    expect(Object.is(q.costPoints, 0)).toBe(true);
    expect(q.contracts).toBe(-0.000001);
    expect(q.avgPrice).toBe(0);
  });

  it("works for NO and lowers P(NO) / raises P(YES)", () => {
    const s = state(100, 0, 12);
    const q = quoteSellContracts(s, "NO", 4);
    expect(q.side).toBe("NO");
    expect(q.nextState).toEqual(state(100, 0, 8));
    expect(q.probAfter).toBeGreaterThan(q.probBefore);
    expect(q.costPoints).toBeLessThan(0);
  });

  it("allows selling the entire outstanding q but not more", () => {
    const s = state(100, 3.5, 0);
    expect(quoteSellContracts(s, "YES", 3.5).nextState.qYes).toBe(0);
    expect(() => quoteSellContracts(s, "YES", 3.500001)).toThrow(RangeError);
    expect(() => quoteSellContracts(s, "NO", 0.000001)).toThrow(RangeError);
  });

  it("rejects non-positive and non-finite amounts", () => {
    const s = state(100, 5, 5);
    for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY, 4e-7]) {
      expect(() => quoteSellContracts(s, "YES", bad)).toThrow(RangeError);
    }
  });

  it("property 3: buy Δ then sell Δ never returns more points than were paid", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        sideArb,
        fc.integer({ min: 1, max: 5_000_000_000 }),
        (b, qy, qn, side, micro) => {
          const s = state(b, qy, qn);
          const delta = micro / 1e6;
          const buy = quoteBuyContracts(s, side, delta);
          const sell = quoteSellContracts(buy.nextState, side, delta);
          expect(sell.nextState).toEqual(s);
          expect(-sell.costPoints).toBeLessThanOrEqual(buy.costPoints);
          expect(sell.costPoints).toBeLessThanOrEqual(0);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("property 3 (points): a budget buy followed by a full sell never returns more than was paid", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        sideArb,
        fc.integer({ min: 1, max: 100_000 }),
        (b, qy, qn, side, budget) => {
          const s = state(b, qy, qn);
          const buy = quoteBuyWithPoints(s, side, budget);
          const sell = quoteSellContracts(buy.nextState, side, buy.contracts);
          expect(-sell.costPoints).toBeLessThanOrEqual(buy.costPoints);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("quote consistency", () => {
  it("property: probAfter == probYes(nextState), contracts are whole micro-contracts, costs are integers", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        sideArb,
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.boolean(),
        (b, qy, qn, side, micro, byPoints) => {
          const s = state(b, qy, qn);
          const q = byPoints
            ? quoteBuyWithPoints(s, side, 1 + (micro % 10_000))
            : quoteBuyContracts(s, side, micro / 1e6);
          expect(q.probBefore).toBe(probYes(s));
          expect(q.probAfter).toBe(probYes(q.nextState));
          expect(isMicro(q.contracts)).toBe(true);
          expect(isMicro(q.nextState.qYes)).toBe(true);
          expect(isMicro(q.nextState.qNo)).toBe(true);
          expect(Number.isInteger(q.costPoints)).toBe(true);
          expect(Number.isInteger(q.payoutIfWin)).toBe(true);
          expect(q.avgPrice).toBeCloseTo(q.costPoints / q.contracts, 9);
          expect(q.nextState.b).toBe(b);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("no overflow or NaN for q up to ±1e6 with b = 50", () => {
    const quotes = [
      quoteBuyContracts(state(50, 1e6, 0), "YES", 1000),
      quoteBuyContracts(state(50, 1e6, 0), "NO", 1000),
      quoteBuyContracts(state(50, 0, 1e6), "YES", 1000),
      quoteBuyWithPoints(state(50, 1e6, 0), "NO", 1000),
      quoteBuyWithPoints(state(50, 1e6, 0), "YES", 1000),
      quoteBuyWithPoints(state(50, 0, 1e6), "YES", 1000),
      quoteSellContracts(state(50, 1e6, 1e6), "YES", 1000),
      quoteSellContracts(state(50, 1e6, 0), "YES", 999_999),
      quoteBuyContracts(state(50, 1e6, 1e6), "NO", 1e5),
    ];
    for (const q of quotes) {
      for (const v of [
        q.contracts,
        q.costPoints,
        q.avgPrice,
        q.probBefore,
        q.probAfter,
        q.payoutIfWin,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(Number.isFinite(q.nextState.qYes)).toBe(true);
      expect(Number.isFinite(q.nextState.qNo)).toBe(true);
    }
    // Buying the near-certain side costs about 100 points per contract.
    expect(quotes[0]?.avgPrice).toBeGreaterThan(99.9);
    expect(quotes[0]?.avgPrice).toBeLessThanOrEqual(100.0001);
  });
});
