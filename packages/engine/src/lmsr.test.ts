import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { B_MAX, B_MIN, EngineError } from "./errors";
import { costFunction, logProbabilities, probabilityYes, tradeCost } from "./lmsr";
import { roundContracts } from "./rounding";
import type { MarketState, Side } from "./types";

// States live on the six-decimal grid (assertState rejects anything else).
const grid = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true }).map((x) => roundContracts(x));
const q = grid(-1e6, 1e6);
const b = fc.double({ min: B_MIN, max: B_MAX, noNaN: true });
const stateArb: fc.Arbitrary<MarketState> = fc.record({ qYes: q, qNo: q, b });
const sideArb: fc.Arbitrary<Side> = fc.constantFrom("YES", "NO");

// Beyond this gap-to-b ratio, 1 − p is smaller than one ulp of 1 and p rounds to exactly 1.
const STRICT_GAP = 36;

const fresh = (bValue = 100): MarketState => ({ qYes: 0, qNo: 0, b: bValue });

describe("probabilityYes", () => {
  it("is exactly one half on a fresh market", () => {
    expect(probabilityYes(fresh())).toBe(0.5);
    expect(probabilityYes(fresh(B_MIN))).toBe(0.5);
    expect(probabilityYes(fresh(B_MAX))).toBe(0.5);
  });

  it("rises as YES contracts are sold and falls as NO contracts are sold", () => {
    expect(probabilityYes({ qYes: 10, qNo: 0, b: 100 })).toBeGreaterThan(0.5);
    expect(probabilityYes({ qYes: 0, qNo: 10, b: 100 })).toBeLessThan(0.5);
  });

  it("matches the closed form e^(qY/b) / (e^(qY/b) + e^(qN/b))", () => {
    const expected = Math.exp(0.3) / (Math.exp(0.3) + Math.exp(0.1));
    expect(probabilityYes({ qYes: 30, qNo: 10, b: 100 })).toBeCloseTo(expected, 12);
  });

  it("stays finite at extreme states where naive exp would overflow", () => {
    expect(probabilityYes({ qYes: 1e6, qNo: -1e6, b: B_MIN })).toBe(1);
    expect(probabilityYes({ qYes: -1e6, qNo: 1e6, b: B_MIN })).toBe(0);
    expect(probabilityYes({ qYes: 1e6, qNo: 1e6 - 50, b: B_MIN })).toBeCloseTo(
      Math.exp(1) / (Math.exp(1) + 1),
      12,
    );
  });

  it("rejects an invalid state", () => {
    expect(() => probabilityYes({ qYes: 0, qNo: 0, b: 10 })).toThrow(EngineError);
  });

  it("property (invariant 1): p in [0, 1], p(YES) + p(NO) = 1, strictly inside (0, 1) while the gap is representable", () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const p = probabilityYes(state);
        const pSwapped = probabilityYes({ qYes: state.qNo, qNo: state.qYes, b: state.b });
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(Math.abs(p + pSwapped - 1)).toBeLessThanOrEqual(1e-12);
        if (Math.abs(state.qYes - state.qNo) / state.b < STRICT_GAP) {
          expect(p).toBeGreaterThan(0);
          expect(p).toBeLessThan(1);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe("costFunction", () => {
  it("is 100·b·ln 2 on a fresh market", () => {
    expect(costFunction(fresh())).toBeCloseTo(100 * 100 * Math.LN2, 9);
    expect(costFunction(fresh(B_MAX))).toBeCloseTo(100 * B_MAX * Math.LN2, 9);
  });

  it("is finite at extreme states", () => {
    expect(Number.isFinite(costFunction({ qYes: 1e6, qNo: -1e6, b: B_MIN }))).toBe(true);
    expect(costFunction({ qYes: 1e6, qNo: -1e6, b: B_MIN })).toBeCloseTo(100 * 1e6, 3);
  });

  it("property: shifting both sides by k contracts adds exactly 100·k points", () => {
    const micros = fc.integer({ min: -1e12, max: 1e12 });
    fc.assert(
      fc.property(micros, micros, b, fc.integer({ min: -1e10, max: 1e10 }), (y, n, bValue, km) => {
        const state = { qYes: y / 1e6, qNo: n / 1e6, b: bValue };
        const k = km / 1e6;
        const shifted = { qYes: (y + km) / 1e6, qNo: (n + km) / 1e6, b: bValue };
        const lhs = costFunction(shifted) - costFunction(state);
        expect(Math.abs(lhs - 100 * k)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(100 * k)));
      }),
      { numRuns: 500 },
    );
  });

  it("property: cost is never below 100·max(q) and never above that plus 100·b·ln 2", () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const c = costFunction(state);
        const floor = 100 * Math.max(state.qYes, state.qNo);
        expect(c).toBeGreaterThanOrEqual(floor - 1e-6);
        expect(c).toBeLessThanOrEqual(floor + 100 * state.b * Math.LN2 + 1e-6);
      }),
      { numRuns: 500 },
    );
  });
});

describe("tradeCost", () => {
  it("equals the difference of cost-function values where that difference is well conditioned", () => {
    fc.assert(
      fc.property(
        fc.record({
          qYes: grid(-1e3, 1e3),
          qNo: grid(-1e3, 1e3),
          b,
        }),
        sideArb,
        fc.double({ min: -500, max: 500, noNaN: true }),
        (state, side, rawDelta) => {
          const after =
            side === "YES"
              ? { ...state, qYes: roundContracts(state.qYes + rawDelta) }
              : { ...state, qNo: roundContracts(state.qNo + rawDelta) };
          const delta = side === "YES" ? after.qYes - state.qYes : after.qNo - state.qNo;
          const viaDifference = costFunction(after) - costFunction(state);
          expect(tradeCost(state, side, delta)).toBeCloseTo(viaDifference, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("costs half a point per contract at even odds, to first order", () => {
    expect(tradeCost(fresh(), "YES", 0.01)).toBeCloseTo(0.5, 3);
    expect(tradeCost(fresh(), "NO", -0.01)).toBeCloseTo(-0.5, 3);
  });

  it("is zero for zero contracts and rejects non-finite amounts", () => {
    expect(tradeCost(fresh(), "YES", 0)).toBe(0);
    expect(() => tradeCost(fresh(), "YES", Number.NaN)).toThrow(EngineError);
  });

  it("rejects a side that is not exactly YES or NO", () => {
    for (const side of ["yes", "VOID", undefined]) {
      expect(() => tradeCost(fresh(), side as never, 1)).toThrow(
        expect.objectContaining({ code: "INVALID_SIDE" }),
      );
    }
  });
});

/** ln(e^a + e^c), computed independently of the engine. */
function logAddExp(a: number, c: number): number {
  const hi = Math.max(a, c);
  return hi + Math.log1p(Math.exp(Math.min(a, c) - hi));
}

describe("logProbabilities", () => {
  it("property: ln p_yes and ln p_no sum to probability one even at |q| up to 1e9", () => {
    fc.assert(
      fc.property(
        grid(-1e9 + 1e4, 1e9 - 1e4),
        grid(-1e4, 1e4),
        fc.constantFrom(B_MIN, B_MAX),
        (qYes, gap, bValue) => {
          const state = { qYes, qNo: roundContracts(qYes + gap), b: bValue };
          const { logPYes, logPNo } = logProbabilities(state);
          expect(Math.abs(logAddExp(logPYes, logPNo))).toBeLessThanOrEqual(1e-12);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("keeps full precision for a one-contract gap at 1e9", () => {
    const { logPYes, logPNo } = logProbabilities({ qYes: 1e9, qNo: 1e9 - 1, b: B_MIN });
    expect(Math.abs(logPYes + Math.log1p(Math.exp(-1 / B_MIN)))).toBeLessThanOrEqual(1e-15);
    expect(Math.abs(logAddExp(logPYes, logPNo))).toBeLessThanOrEqual(1e-12);
  });

  it("agrees with probabilityYes on moderate states", () => {
    for (const state of [
      { qYes: 0, qNo: 0, b: 100 },
      { qYes: 30, qNo: 10, b: 100 },
      { qYes: -250.5, qNo: 400.25, b: B_MIN },
      { qYes: 1000, qNo: -1000, b: B_MAX },
    ]) {
      const { logPYes } = logProbabilities(state);
      expect(Math.abs(probabilityYes(state) - Math.exp(logPYes))).toBeLessThanOrEqual(1e-15);
    }
  });
});
