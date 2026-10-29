import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { B_MAX, B_MIN } from "./errors";
import { quoteContracts, tradeCost } from "./lmsr";
import { roundContracts } from "./rounding";
import type { MarketState, Side } from "./types";

// Trades in a campus market never push |q| anywhere near 1e6; keep states where the price is
// still representable so monotonicity and convexity are meaningful (p saturates beyond ~700·b).
// |q| ≤ 1e4 with b ≥ 50 keeps every side's price a normal double (≥ e^-400); beyond ~740·b the
// price is a denormal and two micro-trades can cost the same unrepresentable amount (seen on CI).
const q = fc.double({ min: -1e4, max: 1e4, noNaN: true }).map((x) => roundContracts(x));
const b = fc.double({ min: B_MIN, max: B_MAX, noNaN: true });
const stateArb: fc.Arbitrary<MarketState> = fc.record({ qYes: q, qNo: q, b });
const sideArb: fc.Arbitrary<Side> = fc.constantFrom("YES", "NO");
const deltaArb = fc.double({ min: 0.000001, max: 1e4, noNaN: true });

const rawCost = tradeCost;

describe("invariant 2: cost(0) = 0; cost is strictly increasing and convex in Δ", () => {
  it("cost of nothing is nothing", () => {
    fc.assert(
      fc.property(stateArb, sideArb, (state, side) => {
        expect(rawCost(state, side, 0)).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it("more contracts always cost more (unrounded), and rounded cost never decreases", () => {
    fc.assert(
      fc.property(stateArb, sideArb, deltaArb, deltaArb, (state, side, d1, d2) => {
        const [lo, hi] = d1 < d2 ? [d1, d2] : [d2, d1];
        fc.pre(hi - lo > 1e-6);
        expect(rawCost(state, side, hi)).toBeGreaterThan(rawCost(state, side, lo));
        expect(quoteContracts(state, side, hi).costPoints).toBeGreaterThanOrEqual(
          quoteContracts(state, side, lo).costPoints,
        );
      }),
      { numRuns: 500 },
    );
  });

  it("the midpoint never costs more than the average of the endpoints (convexity)", () => {
    fc.assert(
      fc.property(stateArb, sideArb, deltaArb, deltaArb, (state, side, d1, d2) => {
        const mid = (d1 + d2) / 2;
        const lhs = rawCost(state, side, mid);
        const rhs = (rawCost(state, side, d1) + rawCost(state, side, d2)) / 2;
        expect(lhs).toBeLessThanOrEqual(rhs + 1e-6 * Math.max(1, Math.abs(rhs)));
      }),
      { numRuns: 500 },
    );
  });
});

describe("invariant 3: buy then sell the same amount never returns more than was paid", () => {
  it("holds after rounding on both legs", () => {
    fc.assert(
      fc.property(stateArb, sideArb, deltaArb, (state, side, delta) => {
        const bought = quoteContracts(state, side, delta);
        const sold = quoteContracts(bought.stateAfter, side, -bought.contracts);
        expect(-sold.costPoints).toBeLessThanOrEqual(bought.costPoints);
        expect(sold.stateAfter.qYes).toBeCloseTo(state.qYes, 6);
        expect(sold.stateAfter.qNo).toBeCloseTo(state.qNo, 6);
      }),
      { numRuns: 500 },
    );
  });
});
