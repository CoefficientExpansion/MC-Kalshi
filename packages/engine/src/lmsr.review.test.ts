import { describe, expect, it } from "vitest";
import { EngineError, MAX_CONTRACTS } from "./errors";
import { quoteContracts, quotePoints, tradeCost } from "./lmsr";
import { roundContracts } from "./rounding";
import type { MarketState, Quote, Side } from "./types";

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

/** True when one more micro-contract than `quote` costs more than `points` or breaks the cap. */
function oneMoreDoesNotFit(state: MarketState, side: Side, quote: Quote, points: number): boolean {
  const next = roundContracts(quote.contracts + 0.000001);
  const qAfter = (side === "YES" ? state.qYes : state.qNo) + next;
  if (next > MAX_CONTRACTS || roundContracts(qAfter) > MAX_CONTRACTS) {
    return true;
  }
  return quoteContracts(state, side, next).costPoints > points;
}

describe("tradeCost for buys beyond 700·b on a side whose price has underflowed", () => {
  const state: MarketState = { qYes: 0, qNo: 13150395, b: 100 };

  it("does not cancel d against −d, so the cost matches ln(1 + p_yes·e^d) closely", () => {
    // p_yes·e^d = e^((13149473 − 13150395)/100) = e^-9.22, so the exact cost is 1e4·ln(1 + e^-9.22).
    const expected = 1e4 * Math.log1p(Math.exp(-9.22));
    const cost = tradeCost(state, "YES", 13149473);
    expect(Math.abs(cost - expected)).toBeLessThan(1e-9);
    expect(cost).toBeLessThan(1);
    expect(quoteContracts(state, "YES", 13149473).costPoints).toBe(1);
  });

  it("inverts a one-point budget", () => {
    const quote = quotePoints(state, "YES", 1);
    expect(quote.contracts).toBeGreaterThan(0);
    expect(quote.costPoints).toBeLessThanOrEqual(1);
  });
});

describe("quotePoints: bisection on the six-decimal grid", () => {
  it("buys exactly the cap when the budget is exactly what the cap costs", () => {
    const quote = quotePoints({ qYes: 0, qNo: 0, b: 50 }, "YES", 99999996535);
    expect(quote.contracts).toBe(1e9);
    expect(quote.costPoints).toBeLessThanOrEqual(99999996535);
  });

  it("rejects a budget the market cannot absorb because q is already at the cap", () => {
    expect(codeOf(() => quotePoints({ qYes: 999999999, qNo: 0, b: 100 }, "YES", 1000))).toBe(
      "INVALID_POINTS",
    );
  });

  it("returns the largest grid amount that fits the budget", () => {
    const state: MarketState = { qYes: 0, qNo: 824824.745124, b: 100 };
    const quote = quotePoints(state, "YES", 1);
    expect(quote.costPoints).toBeLessThanOrEqual(1);
    expect(oneMoreDoesNotFit(state, "YES", quote, 1)).toBe(true);
  });

  it("is not one micro-contract short for a grid-exact answer near the cap", () => {
    const state: MarketState = { qYes: -910705264.178603, qNo: -0.000039, b: 170 };
    const points = 97044017323;
    const quote = quotePoints(state, "NO", points);
    expect(quote.costPoints).toBeLessThanOrEqual(points);
    expect(oneMoreDoesNotFit(state, "NO", quote, points)).toBe(true);
    // 970440173.23 costs exactly the budget; one micro-contract more costs one point more.
    expect(quoteContracts(state, "NO", 970440173.23).costPoints).toBe(points);
    expect(quote.contracts).toBe(970440173.23);
  });
});

describe("payoutIfWin in micro-contract integers", () => {
  it("does not misround large six-decimal amounts", () => {
    expect(quoteContracts({ qYes: 0, qNo: 0, b: 100 }, "YES", 537000000.05).payoutIfWin).toBe(
      53700000005,
    );
  });
});

describe("hostile inputs", () => {
  it("a Symbol state throws EngineError, never a TypeError", () => {
    expect(codeOf(() => quoteContracts(Symbol() as never, "YES", 1))).toBe("INVALID_STATE");
    expect(
      codeOf(() => quoteContracts({ qYes: 0, qNo: 0, b: 100 }, "YES", Symbol() as never)),
    ).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => quotePoints({ qYes: 0, qNo: 0, b: 100 }, "YES", Symbol() as never))).toBe(
      "INVALID_POINTS",
    );
  });
});

describe("final adversarial pass (cycle 3, Low findings)", () => {
  const fresh: MarketState = { qYes: 0, qNo: 0, b: 100 };

  it("rejects a null-prototype state with INVALID_STATE, not a TypeError", () => {
    expect(codeOf(() => quoteContracts(Object.create(null) as never, "YES", 1))).toBe(
      "INVALID_STATE",
    );
  });

  it("rejects a state whose qYes getter throws with INVALID_STATE", () => {
    const hostile = {
      get qYes(): number {
        throw new Error("boom");
      },
      qNo: 0,
      b: 100,
    };
    expect(codeOf(() => quoteContracts(hostile as never, "YES", 1))).toBe("INVALID_STATE");
  });

  it("rejects a state whose fields are null-prototype objects with INVALID_STATE", () => {
    const odd = Object.create(null);
    expect(codeOf(() => quoteContracts({ qYes: odd, qNo: 0, b: 100 } as never, "YES", 1))).toBe(
      "INVALID_STATE",
    );
    expect(codeOf(() => quoteContracts({ qYes: 0, qNo: 0, b: odd } as never, "YES", 1))).toBe(
      "INVALID_STATE",
    );
  });

  it("rejects a null-prototype budget with INVALID_POINTS", () => {
    expect(codeOf(() => quotePoints(fresh, "YES", Object.create(null) as never))).toBe(
      "INVALID_POINTS",
    );
  });

  it("rejects a budget whose toString throws with INVALID_POINTS", () => {
    const fn = Object.assign(() => 0, {
      toString(): string {
        throw new Error("boom");
      },
    });
    expect(codeOf(() => quotePoints(fresh, "YES", fn as never))).toBe("INVALID_POINTS");
  });

  it("rejects null-prototype contracts and sides with EngineError", () => {
    const odd = Object.create(null);
    expect(codeOf(() => quoteContracts(fresh, "YES", odd as never))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => quoteContracts(fresh, odd as never, 1))).toBe("INVALID_SIDE");
  });

  it("tradeCost of −0 contracts is +0", () => {
    expect(Object.is(tradeCost(fresh, "YES", -0), 0)).toBe(true);
    expect(Object.is(tradeCost(fresh, "NO", -0), 0)).toBe(true);
  });

  it("stateAfter never carries −0", () => {
    const q = quoteContracts({ qYes: 0, qNo: -0, b: 100 }, "YES", 1);
    expect(Object.is(q.stateAfter.qNo, 0)).toBe(true);
    const r = quoteContracts({ qYes: -0, qNo: 0, b: 100 }, "NO", 1);
    expect(Object.is(r.stateAfter.qYes, 0)).toBe(true);
  });
});
