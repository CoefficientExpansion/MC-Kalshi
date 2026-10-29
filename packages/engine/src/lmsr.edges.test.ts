import { describe, expect, it } from "vitest";
import { EngineError } from "./errors";
import { costFunction, fitContractsToBudget, quoteContracts, quotePoints, tradeCost } from "./lmsr";
import { roundContracts } from "./rounding";
import type { MarketState } from "./types";

const fresh50: MarketState = { qYes: 0, qNo: 0, b: 50 };
const fresh100: MarketState = { qYes: 0, qNo: 0, b: 100 };

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

describe("tradeCost beyond 700·b (where expm1 would overflow)", () => {
  it("agrees with the cost-function difference for a huge buy", () => {
    const delta = 50 * 701;
    const viaDifference = costFunction({ ...fresh50, qYes: delta }) - costFunction(fresh50);
    const direct = tradeCost(fresh50, "YES", delta);
    expect(Number.isFinite(direct)).toBe(true);
    expect(Math.abs(direct - viaDifference)).toBeLessThanOrEqual(1e-6 * viaDifference);
    expect(direct).toBeGreaterThan(100 * delta - 100 * 50 * Math.LN2 - 1);
  });
});

describe("fitContractsToBudget (the rounding guard behind quotePoints)", () => {
  // The largest six-decimal amount that 500 points buy on a fresh b=100 market.
  const base = quotePoints(fresh100, "YES", 500).contracts;
  const oneMore = roundContracts(base + 0.000001);

  it("returns the quote as is when the floored amount already fits the budget", () => {
    const quote = fitContractsToBudget(fresh100, "YES", base, 500);
    expect(quote.contracts).toBe(base);
    expect(quote.costPoints).toBe(500);
  });

  it("steps down one micro-contract when the floored amount overshoots by rounding", () => {
    expect(quoteContracts(fresh100, "YES", oneMore).costPoints).toBe(501);
    const quote = fitContractsToBudget(fresh100, "YES", oneMore, 500);
    expect(quote.contracts).toBe(base);
    expect(quote.costPoints).toBe(500);
  });

  it("bisects down to the largest amount that fits when the estimate overshoots by far", () => {
    expect(fitContractsToBudget(fresh100, "YES", base + 0.001, 500).contracts).toBe(base);
    expect(fitContractsToBudget(fresh100, "YES", base + 1000, 500).contracts).toBe(base);
  });

  it("probes forward when the estimate lands a few micro-contracts short", () => {
    expect(
      fitContractsToBudget(fresh100, "YES", roundContracts(base - 0.000003), 500).contracts,
    ).toBe(base);
  });

  it("rejects a budget below the one-point minimum charge once bisection finds nothing", () => {
    expect(codeOf(() => fitContractsToBudget(fresh100, "YES", 1, 0))).toBe("INVALID_POINTS");
  });

  it("rejects a side whose q already sits at MAX_CONTRACTS", () => {
    const full: MarketState = { qYes: 1e9, qNo: 0, b: 100 };
    expect(codeOf(() => fitContractsToBudget(full, "YES", 1, 1000))).toBe("INVALID_POINTS");
  });

  it("rejects an amount that floors to nothing", () => {
    expect(codeOf(() => fitContractsToBudget(fresh100, "YES", 0.0000001, 1))).toBe(
      "INVALID_POINTS",
    );
  });
});
