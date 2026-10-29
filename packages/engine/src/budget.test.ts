import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { B_MAX, B_MIN, EngineError, MAX_POINTS } from "./errors";
import { quoteContracts, quotePoints } from "./lmsr";
import { roundContracts } from "./rounding";
import type { MarketState, Side } from "./types";

const fresh: MarketState = { qYes: 0, qNo: 0, b: 100 };

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

describe("quotePoints: the worked example from architecture §5", () => {
  it("spends 500 points on YES in a fresh b=100 market", () => {
    const quote = quotePoints(fresh, "YES", 500);
    expect(quote.side).toBe("YES");
    expect(Math.abs(quote.contracts - 9.76)).toBeLessThan(0.01);
    expect(quote.costPoints).toBe(500);
    expect(quote.avgPrice).toBe(51);
    expect(quote.probBefore).toBe(0.5);
    expect(Math.abs(quote.probAfter - 0.524)).toBeLessThan(0.001);
    expect(quote.payoutIfWin).toBe(976);
    expect(quote.stateAfter).toEqual({ qYes: quote.contracts, qNo: 0, b: 100 });
  });

  it("is symmetric for NO", () => {
    const quote = quotePoints(fresh, "NO", 500);
    expect(quote.contracts).toBe(quotePoints(fresh, "YES", 500).contracts);
    expect(quote.stateAfter).toEqual({ qYes: 0, qNo: quote.contracts, b: 100 });
    expect(Math.abs(quote.probAfter - 0.476)).toBeLessThan(0.001);
  });

  it("spends a single point", () => {
    const quote = quotePoints(fresh, "YES", 1);
    expect(quote.costPoints).toBe(1);
    expect(quote.contracts).toBeGreaterThan(0.0199);
    expect(quote.contracts).toBeLessThan(0.02);
  });
});

describe("quotePoints: validation", () => {
  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a budget of %s with INVALID_POINTS",
    (points) => {
      expect(codeOf(() => quotePoints(fresh, "YES", points))).toBe("INVALID_POINTS");
    },
  );

  it("rejects an invalid state", () => {
    expect(codeOf(() => quotePoints({ qYes: 0, qNo: 0, b: 7 }, "YES", 10))).toBe("INVALID_STATE");
    expect(codeOf(() => quotePoints(null as never, "YES", 10))).toBe("INVALID_STATE");
  });

  it("rejects a side that is not exactly YES or NO", () => {
    expect(codeOf(() => quotePoints(fresh, "no" as never, 10))).toBe("INVALID_SIDE");
  });

  it("rejects budgets above MAX_POINTS, and budgets that would buy beyond MAX_CONTRACTS", () => {
    const fresh50: MarketState = { qYes: 0, qNo: 0, b: B_MIN };
    expect(codeOf(() => quotePoints(fresh50, "YES", MAX_POINTS + 1))).toBe("INVALID_POINTS");
    // 1e12 points pass the budget check but would buy about 1e10 contracts.
    expect(codeOf(() => quotePoints(fresh50, "YES", MAX_POINTS))).toBe("INVALID_POINTS");
    const large = quotePoints(fresh50, "YES", 1e10);
    expect(large.costPoints).toBeLessThanOrEqual(1e10);
    expect(large.costPoints).toBeGreaterThan(1e10 - 1);
    expect(Number.isSafeInteger(large.costPoints)).toBe(true);
  });

  it("still inverts a budget on a side whose price has underflowed to zero", () => {
    const quote = quotePoints({ qYes: -1e6, qNo: 1e6, b: B_MIN }, "YES", 10);
    expect(quote.contracts).toBeGreaterThan(0);
    expect(quote.costPoints).toBeLessThanOrEqual(10);
  });
});

describe("invariant 5: budget inversion never overspends and lands within a point", () => {
  // Keep the side's price representable (> e^-400) so the inversion is defined.
  const q = fc.double({ min: -1e4, max: 1e4, noNaN: true }).map((x) => roundContracts(x));
  const b = fc.double({ min: B_MIN, max: B_MAX, noNaN: true });
  const stateArb: fc.Arbitrary<MarketState> = fc.record({ qYes: q, qNo: q, b });
  const sideArb: fc.Arbitrary<Side> = fc.constantFrom("YES", "NO");
  const pointsArb = fc.integer({ min: 1, max: 1_000_000 });

  it("costPoints ≤ points, points − costPoints < 1, and re-quoting the contracts agrees", () => {
    fc.assert(
      fc.property(stateArb, sideArb, pointsArb, (state, side, points) => {
        const quote = quotePoints(state, side, points);
        expect(quote.contracts).toBeGreaterThan(0);
        expect(quote.costPoints).toBeLessThanOrEqual(points);
        expect(points - quote.costPoints).toBeLessThan(1);
        const again = quoteContracts(state, side, quote.contracts);
        expect(again.costPoints).toBe(quote.costPoints);
        expect(again.stateAfter).toEqual(quote.stateAfter);
      }),
      { numRuns: 500 },
    );
  });

  it("spending the budget in two halves never buys more than spending it at once", () => {
    fc.assert(
      fc.property(
        stateArb,
        sideArb,
        fc.integer({ min: 2, max: 1_000_000 }),
        (state, side, points) => {
          const whole = quotePoints(state, side, points);
          const half = Math.floor(points / 2);
          const first = quotePoints(state, side, half);
          const second = quotePoints(first.stateAfter, side, points - half);
          // Each leg floors to six decimals, so two legs may land up to two micro-contracts apart.
          expect(first.contracts + second.contracts).toBeLessThanOrEqual(whole.contracts + 2e-6);
        },
      ),
      { numRuns: 300 },
    );
  });
});
