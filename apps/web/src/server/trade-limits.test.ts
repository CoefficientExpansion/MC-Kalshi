import { type MarketState, type Quote, quoteContracts, quotePoints } from "@mc-kalshi/engine";
import { describe, expect, it } from "vitest";
import {
  checkSizeRules,
  DEFAULT_MAX_SLIPPAGE,
  DEFAULT_TRADE_RATE_LIMIT_PER_MIN,
  getTradeRateLimitPerMin,
  MAX_INPUT_CONTRACTS,
  MAX_INPUT_POINTS,
  MAX_SLIPPAGE,
  MAX_TRADE_POINTS,
  MAX_TRADE_POINTS_PER_B,
  MIN_BUY_POINTS,
  MIN_TRADE_CONTRACTS,
  maxBuyPoints,
} from "./trade-limits";

const fresh: MarketState = { b: 100, qYes: 0, qNo: 0 };

/** A state where YES is almost certain, so a NO sell pays almost nothing. */
const lopsided: MarketState = { b: 50, qYes: 2000, qNo: 1 };

describe("constants", () => {
  it("match the spec's size rules table", () => {
    expect(MIN_TRADE_CONTRACTS).toBe(0.01);
    expect(MIN_BUY_POINTS).toBe(1);
    expect(MAX_TRADE_POINTS).toBe(5000);
    expect(MAX_TRADE_POINTS_PER_B).toBe(50);
    expect(MAX_INPUT_CONTRACTS).toBe(1e6);
    expect(MAX_INPUT_POINTS).toBe(1e9);
    expect(DEFAULT_MAX_SLIPPAGE).toBe(2);
    expect(MAX_SLIPPAGE).toBe(10);
    expect(DEFAULT_TRADE_RATE_LIMIT_PER_MIN).toBe(20);
  });

  it("caps a buy at min(5000, 50·b)", () => {
    expect(maxBuyPoints(50)).toBe(2500);
    expect(maxBuyPoints(100)).toBe(5000);
    expect(maxBuyPoints(500)).toBe(5000);
  });
});

describe("getTradeRateLimitPerMin", () => {
  it("defaults to 20", () => {
    expect(getTradeRateLimitPerMin(undefined)).toBe(20);
    expect(getTradeRateLimitPerMin("")).toBe(20);
  });

  it("reads a positive whole number", () => {
    expect(getTradeRateLimitPerMin("5")).toBe(5);
    expect(getTradeRateLimitPerMin(" 30 ")).toBe(30);
  });

  it.each(["0", "-3", "abc", "1.5", "1e3", "20 per min", "99999999"])(
    "falls back to the default for %j",
    (raw) => {
      expect(getTradeRateLimitPerMin(raw)).toBe(20);
    },
  );
});

describe("checkSizeRules: buys", () => {
  it("accepts the worked example (500 points on YES at b=100)", () => {
    const quote = quotePoints(fresh, "YES", 500);
    expect(checkSizeRules({ mode: "buy_points", quote, b: 100, heldOnSide: 0 })).toBeNull();
  });

  it("rejects 0.009 contracts and accepts 0.01", () => {
    const small = quoteContracts(fresh, "YES", 0.009);
    expect(checkSizeRules({ mode: "buy_contracts", quote: small, b: 100, heldOnSide: 0 })).toEqual({
      code: "trade_too_small",
    });
    const ok = quoteContracts(fresh, "YES", 0.01);
    expect(ok.payoutIfWin).toBeGreaterThanOrEqual(ok.costPoints);
    expect(checkSizeRules({ mode: "buy_contracts", quote: ok, b: 100, heldOnSide: 0 })).toBeNull();
  });

  it("rejects a buy that pays less than it costs", () => {
    // 0.011 contracts at p≈0.5 costs the 1-point minimum but pays floor(1.1) = 1; at p≈0.99 the
    // same size costs 2 and pays 1.
    const quote = quoteContracts(lopsided, "YES", 0.011);
    expect(quote.payoutIfWin).toBeLessThan(quote.costPoints);
    expect(checkSizeRules({ mode: "buy_contracts", quote, b: 50, heldOnSide: 0 })).toEqual({
      code: "trade_too_small",
    });
  });

  it("accepts the per-trade maximum exactly and rejects one point more", () => {
    const atCap = quotePoints(fresh, "YES", 5000);
    expect(atCap.costPoints).toBe(5000);
    expect(checkSizeRules({ mode: "buy_points", quote: atCap, b: 100, heldOnSide: 0 })).toBeNull();
    const over = quotePoints(fresh, "YES", 5001);
    expect(checkSizeRules({ mode: "buy_points", quote: over, b: 100, heldOnSide: 0 })).toEqual({
      code: "trade_too_large",
      maxPoints: 5000,
    });
  });

  it("uses 50·b below b=100", () => {
    const state: MarketState = { b: 50, qYes: 0, qNo: 0 };
    const over = quotePoints(state, "NO", 2501);
    expect(checkSizeRules({ mode: "buy_points", quote: over, b: 50, heldOnSide: 0 })).toEqual({
      code: "trade_too_large",
      maxPoints: 2500,
    });
    const byContracts = quoteContracts(state, "NO", 100);
    expect(byContracts.costPoints).toBeGreaterThan(2500);
    expect(
      checkSizeRules({ mode: "buy_contracts", quote: byContracts, b: 50, heldOnSide: 0 }),
    ).toEqual({ code: "trade_too_large", maxPoints: 2500 });
  });
});

describe("checkSizeRules: sells", () => {
  const moved: MarketState = { b: 100, qYes: 50, qNo: 0 };

  it("accepts 0.01 contracts with proceeds and rejects 0.009 when more is held", () => {
    // A 0.01 sell pays floor(100·p·0.01) = 0 points at any p < 1, so the smallest sell that is
    // not a close-out and pays anything is about 0.02 contracts on a likely side.
    const rich: MarketState = { b: 100, qYes: 500, qNo: 0 };
    const ok = quoteContracts(rich, "YES", -0.02);
    expect(ok.costPoints).toBe(-1);
    expect(checkSizeRules({ mode: "sell_contracts", quote: ok, b: 100, heldOnSide: 5 })).toBe(null);
    // At p_yes ≈ 0.62, 0.01 pays floor(0.62) = 0 points: zero proceeds, not a close-out.
    const zero = quoteContracts(moved, "YES", -0.01);
    expect(zero.costPoints).toBe(0);
    expect(checkSizeRules({ mode: "sell_contracts", quote: zero, b: 100, heldOnSide: 5 })).toEqual({
      code: "trade_too_small",
    });
    const small = quoteContracts(moved, "YES", -0.009);
    expect(checkSizeRules({ mode: "sell_contracts", quote: small, b: 100, heldOnSide: 5 })).toEqual(
      { code: "trade_too_small" },
    );
  });

  it("accepts a dust close-out of the entire holding (0.004 contracts, zero proceeds)", () => {
    const quote = quoteContracts(moved, "YES", -0.004);
    expect(quote.costPoints).toBe(0);
    expect(checkSizeRules({ mode: "sell_contracts", quote, b: 100, heldOnSide: 0.004 })).toBe(null);
  });

  it("rejects a sell with zero proceeds unless it closes out the side", () => {
    // At p_no ≈ 0, 0.5 NO contracts pay floor(<1) = 0 points.
    const quote = quoteContracts(lopsided, "NO", -0.5);
    expect(quote.costPoints).toBe(0);
    expect(checkSizeRules({ mode: "sell_contracts", quote, b: 50, heldOnSide: 1 })).toEqual({
      code: "trade_too_small",
    });
    expect(checkSizeRules({ mode: "sell_contracts", quote, b: 50, heldOnSide: 0.5 })).toBeNull();
  });

  it("never caps a sell", () => {
    const big: MarketState = { b: 50, qYes: 500, qNo: 0 };
    const quote = quoteContracts(big, "YES", -500);
    expect(-quote.costPoints).toBeGreaterThan(maxBuyPoints(50));
    expect(checkSizeRules({ mode: "sell_contracts", quote, b: 50, heldOnSide: 500 })).toBeNull();
  });

  it("leaves selling more than is held to the holdings check", () => {
    const quote = quoteContracts(moved, "YES", -3);
    expect(checkSizeRules({ mode: "sell_contracts", quote, b: 100, heldOnSide: 1 })).toBeNull();
  });
});

describe("checkSizeRules: misuse", () => {
  it("throws when the quote's direction disagrees with the mode", () => {
    const buy: Quote = quoteContracts(fresh, "YES", 1);
    expect(() =>
      checkSizeRules({ mode: "sell_contracts", quote: buy, b: 100, heldOnSide: 1 }),
    ).toThrow();
    const sell: Quote = quoteContracts({ b: 100, qYes: 5, qNo: 0 }, "YES", -1);
    expect(() =>
      checkSizeRules({ mode: "buy_contracts", quote: sell, b: 100, heldOnSide: 0 }),
    ).toThrow();
  });
});
