import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  costFunction,
  DEFAULT_LIQUIDITY,
  displayPrice,
  fromMicro,
  initialState,
  LIQUIDITY_MAX,
  LIQUIDITY_MIN,
  type MarketState,
  maxPoolLoss,
  probNo,
  probYes,
  rawCost,
  type Side,
  shiftState,
  toMicro,
  validateLiquidity,
} from "./lmsr";

const state = (b: number, qYes: number, qNo: number): MarketState => ({ b, qYes, qNo });

/** Reference implementation with plain exp/log; only valid for small q/b. */
function naiveCost(s: MarketState): number {
  return 100 * s.b * Math.log(Math.exp(s.qYes / s.b) + Math.exp(s.qNo / s.b));
}

describe("micro-contract helpers", () => {
  it("round-trips whole micro-contracts exactly", () => {
    expect(toMicro(9.756123)).toBe(9_756_123);
    expect(fromMicro(9_756_123)).toBe(9.756123);
    expect(toMicro(0.29)).toBe(290_000);
  });

  it("property: fromMicro(m) is always an exact multiple of 1e-6", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e13, max: 1e13 }), (m) => {
        const x = fromMicro(m);
        expect(Math.round(x * 1e6) / 1e6).toBe(x);
        expect(toMicro(x)).toBe(m);
      }),
      { numRuns: 1000 },
    );
  });

  it("rejects non-finite input", () => {
    expect(() => toMicro(Number.NaN)).toThrow(RangeError);
    expect(() => toMicro(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(() => toMicro(1e10)).toThrow(RangeError);
    expect(() => fromMicro(1.5)).toThrow(RangeError);
  });
});

describe("validateLiquidity", () => {
  it("accepts 50..500 inclusive and returns the value", () => {
    expect(validateLiquidity(LIQUIDITY_MIN)).toBe(50);
    expect(validateLiquidity(DEFAULT_LIQUIDITY)).toBe(100);
    expect(validateLiquidity(LIQUIDITY_MAX)).toBe(500);
  });

  it("rejects out-of-range and non-finite values", () => {
    for (const bad of [49.99, 500.01, 0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateLiquidity(bad)).toThrow(RangeError);
    }
  });
});

describe("initialState", () => {
  it("defaults to b = 100 with nothing sold", () => {
    expect(initialState()).toEqual({ b: 100, qYes: 0, qNo: 0 });
    expect(initialState(250)).toEqual({ b: 250, qYes: 0, qNo: 0 });
  });

  it("validates liquidity", () => {
    expect(() => initialState(10)).toThrow(RangeError);
  });
});

describe("costFunction", () => {
  it("equals 100·b·ln 2 at q = (0, 0)", () => {
    expect(costFunction(state(100, 0, 0))).toBeCloseTo(100 * 100 * Math.LN2, 9);
  });

  it("agrees with the naive formula where that does not overflow", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (b, ay, an) => {
          const s = state(b, ay * b, an * b);
          const expected = naiveCost(s);
          expect(Math.abs(costFunction(s) - expected)).toBeLessThanOrEqual(
            1e-9 * (1 + Math.abs(expected)),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("does not overflow or return NaN for q up to ±1e6 with b = 50", () => {
    for (const [qy, qn] of [
      [1e6, 0],
      [0, 1e6],
      [-1e6, 1e6],
      [1e6, -1e6],
      [1e6, 1e6],
      [-1e6, -1e6],
    ] as const) {
      const c = costFunction(state(50, qy, qn));
      expect(Number.isFinite(c)).toBe(true);
    }
    // For a one-sided blow-out the cost is ~ 100 · max(q).
    expect(costFunction(state(50, 1e6, 0))).toBeCloseTo(100 * 1e6, 3);
  });

  it("rejects an invalid state", () => {
    expect(() => costFunction(state(0, 0, 0))).toThrow(RangeError);
    expect(() => costFunction(state(-1, 0, 0))).toThrow(RangeError);
    expect(() => costFunction(state(Number.NaN, 0, 0))).toThrow(RangeError);
    expect(() => costFunction(state(100, Number.NaN, 0))).toThrow(RangeError);
    expect(() => costFunction(state(100, 0, Number.POSITIVE_INFINITY))).toThrow(RangeError);
  });
});

describe("probYes / probNo", () => {
  it("is 0.5 at a fresh market and moves toward the side bought", () => {
    expect(probYes(state(100, 0, 0))).toBe(0.5);
    expect(probNo(state(100, 0, 0))).toBe(0.5);
    expect(probYes(state(100, 10, 0))).toBeGreaterThan(0.5);
    expect(probNo(state(100, 10, 0))).toBeLessThan(0.5);
    expect(probYes(state(100, 0, 10))).toBeLessThan(0.5);
  });

  it("matches the closed form 1 / (1 + e^{-(qy-qn)/b})", () => {
    expect(probYes(state(100, 9.76, 0))).toBeCloseTo(1 / (1 + Math.exp(-0.0976)), 12);
  });

  it("property 1: p_yes + p_no = 1 (1e-12) and 0 < p < 1 for all finite |q| ≤ 50·b", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        (b, ay, an) => {
          const s = state(b, ay * b, an * b);
          const py = probYes(s);
          const pn = probNo(s);
          expect(Math.abs(py + pn - 1)).toBeLessThanOrEqual(1e-12);
          expect(py).toBeGreaterThan(0);
          expect(py).toBeLessThan(1);
          expect(pn).toBeGreaterThan(0);
          expect(pn).toBeLessThan(1);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("property 1 (extremes): stays in (0, 1) and sums to 1 even at q = ±1e6 with b = 50", () => {
    for (const [qy, qn] of [
      [1e6, -1e6],
      [-1e6, 1e6],
      [1e6, 1e6],
      [0, 1e6],
    ] as const) {
      const s = state(50, qy, qn);
      expect(probYes(s)).toBeGreaterThan(0);
      expect(probYes(s)).toBeLessThan(1);
      expect(probNo(s)).toBeGreaterThan(0);
      expect(probNo(s)).toBeLessThan(1);
      expect(Math.abs(probYes(s) + probNo(s) - 1)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("property: probYes is monotone in qYes and in -qNo", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: 0.01, max: 3, noNaN: true }),
        (b, ay, an, step) => {
          const s = state(b, ay * b, an * b);
          expect(probYes(state(b, s.qYes + step * b, s.qNo))).toBeGreaterThanOrEqual(probYes(s));
          expect(probYes(state(b, s.qYes, s.qNo + step * b))).toBeLessThanOrEqual(probYes(s));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("displayPrice", () => {
  it("rounds probability × 100 to an integer in 1..99", () => {
    expect(displayPrice(0.5)).toBe(50);
    expect(displayPrice(0.524)).toBe(52);
    expect(displayPrice(0.526)).toBe(53);
    expect(displayPrice(0.07)).toBe(7);
  });

  it("clamps to 1 and 99", () => {
    expect(displayPrice(0)).toBe(1);
    expect(displayPrice(0.001)).toBe(1);
    expect(displayPrice(0.999)).toBe(99);
    expect(displayPrice(1)).toBe(99);
  });

  it("rejects non-finite input", () => {
    expect(() => displayPrice(Number.NaN)).toThrow(RangeError);
  });

  it("property: always an integer within 1..99", () => {
    fc.assert(
      fc.property(fc.double({ min: -1, max: 2, noNaN: true }), (p) => {
        const d = displayPrice(p);
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(99);
      }),
      { numRuns: 300 },
    );
  });
});

describe("rawCost", () => {
  it("is exactly 0 for a zero-size trade", () => {
    expect(rawCost(state(100, 12, 34), "YES", 0)).toBe(0);
    expect(rawCost(state(100, 12, 34), "NO", 0)).toBe(0);
  });

  it("matches C(after) - C(before) on a small market", () => {
    const s = state(100, 20, 5);
    const viaC = costFunction(state(100, 20 + 7.5, 5)) - costFunction(s);
    expect(rawCost(s, "YES", 7.5)).toBeCloseTo(viaC, 9);
    const viaCNo = costFunction(state(100, 20, 5 + 7.5)) - costFunction(s);
    expect(rawCost(s, "NO", 7.5)).toBeCloseTo(viaCNo, 9);
  });

  it("buying at p = 0.5 costs a bit over 50 points per contract", () => {
    const cost = rawCost(state(100, 0, 0), "YES", 1);
    expect(cost).toBeGreaterThan(50);
    expect(cost).toBeLessThan(50.5);
  });

  it("is negative for a sell (proceeds)", () => {
    expect(rawCost(state(100, 10, 0), "YES", -5)).toBeLessThan(0);
  });

  it("stays accurate at huge q, where C itself loses precision", () => {
    // Buying 1 contract when YES is 1e6 ahead costs ~100 points (p ≈ 1).
    const cost = rawCost(state(50, 1e6, 0), "YES", 1);
    expect(cost).toBeCloseTo(100, 6);
  });

  it("rejects bad input", () => {
    expect(() => rawCost(state(100, 0, 0), "YES", Number.NaN)).toThrow(RangeError);
    expect(() => rawCost(state(100, 0, 0), "MAYBE" as never, 1)).toThrow(RangeError);
    expect(() => rawCost(state(0, 0, 0), "YES", 1)).toThrow(RangeError);
  });

  it("property 2: raw cost(0) = 0, strictly increasing and convex in Δ", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 500, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.constantFrom<Side>("YES", "NO"),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        (b, ay, an, side, d0, g1, g2) => {
          const s = state(b, ay * b, an * b);
          expect(rawCost(s, side, 0)).toBe(0);
          const x0 = d0;
          const x1 = x0 + g1;
          const x2 = x1 + g2;
          const c0 = rawCost(s, side, x0);
          const c1 = rawCost(s, side, x1);
          const c2 = rawCost(s, side, x2);
          // strictly increasing
          expect(c1).toBeGreaterThan(c0);
          expect(c2).toBeGreaterThan(c1);
          // convex: slopes of consecutive chords increase (tolerance for float noise)
          const slope1 = (c1 - c0) / g1;
          const slope2 = (c2 - c1) / g2;
          expect(slope2).toBeGreaterThanOrEqual(slope1 - 1e-9);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("shiftState", () => {
  it("moves the chosen side by a whole number of micro-contracts, exactly", () => {
    const s = state(100, 1.234567, 0.000001);
    expect(shiftState(s, "YES", 1)).toEqual(state(100, 1.234568, 0.000001));
    expect(shiftState(s, "NO", -1)).toEqual(state(100, 1.234567, 0));
    expect(shiftState(s, "YES", 0)).toEqual(s);
  });

  it("does not mutate its input", () => {
    const s = state(100, 1, 2);
    shiftState(s, "YES", 5_000_000);
    expect(s).toEqual(state(100, 1, 2));
  });

  it("rejects non-integer shifts and results beyond the safe range", () => {
    expect(() => shiftState(state(100, 0, 0), "YES", 0.5)).toThrow(RangeError);
    expect(() => shiftState(state(100, 1, 0), "YES", Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => shiftState(state(100, 8e9, 0), "YES", 8e15)).toThrow(RangeError);
  });
});

describe("maxPoolLoss", () => {
  it("is 100·b·ln 2 (about 6,931 points at b = 100)", () => {
    expect(maxPoolLoss(100)).toBeCloseTo(6931.47, 2);
    expect(maxPoolLoss(50)).toBeCloseTo(100 * 50 * Math.LN2, 9);
  });

  it("rejects an invalid b", () => {
    expect(() => maxPoolLoss(0)).toThrow(RangeError);
  });
});
