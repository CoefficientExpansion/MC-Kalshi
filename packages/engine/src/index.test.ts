import { describe, expect, it } from "vitest";
import * as engine from "./index";
import { CONTRACT_PAYOUT_POINTS, PRICE_MAX, PRICE_MIN } from "./index";

describe("engine constants", () => {
  it("match architecture §5: a contract pays 100 points and quotes live in 1..99", () => {
    expect(CONTRACT_PAYOUT_POINTS).toBe(100);
    expect(PRICE_MIN).toBe(1);
    expect(PRICE_MAX).toBe(99);
  });
});

describe("public surface", () => {
  it("re-exports every runtime value the app may import", () => {
    expect(Object.keys(engine).sort()).toEqual(
      [
        "B_MAX",
        "B_MIN",
        "CONTRACT_PAYOUT_POINTS",
        "EMPTY_POSITION",
        "EngineError",
        "MAX_CONTRACTS",
        "MAX_POINTS",
        "PRICE_MAX",
        "PRICE_MIN",
        "applyFill",
        "clampProbability",
        "costFunction",
        "displayPrice",
        "maxPoolLoss",
        "payout",
        "probabilityYes",
        "quoteContracts",
        "quotePoints",
        "settlePayouts",
        "tradeCost",
        "voidRefund",
        "voidRefunds",
        "withinSlippage",
      ].sort(),
    );
  });
});
