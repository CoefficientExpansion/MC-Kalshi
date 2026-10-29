import { type MarketState, quoteContracts, quotePoints } from "@mc-kalshi/engine";
import { describe, expect, it } from "vitest";
import { quoteTrade, withinCostSlippage } from "./quote";

const fresh: MarketState = { b: 100, qYes: 0, qNo: 0 };

describe("quoteTrade", () => {
  it("buys by points with quotePoints (the worked example)", () => {
    const result = quoteTrade(fresh, "YES", "buy_points", 500);
    expect(result).toEqual({ ok: true, quote: quotePoints(fresh, "YES", 500) });
    if (!result.ok) throw new Error("unreachable");
    expect(result.quote.contracts).toBe(9.761859);
    expect(result.quote.costPoints).toBe(500);
    expect(result.quote.stateAfter.qYes).toBe(9.761859);
  });

  it("buys by contracts with quoteContracts(+n)", () => {
    expect(quoteTrade(fresh, "NO", "buy_contracts", 10)).toEqual({
      ok: true,
      quote: quoteContracts(fresh, "NO", 10),
    });
  });

  it("sells with quoteContracts(−n)", () => {
    const state: MarketState = { b: 100, qYes: 10, qNo: 0 };
    const result = quoteTrade(state, "YES", "sell_contracts", 4);
    expect(result).toEqual({ ok: true, quote: quoteContracts(state, "YES", -4) });
    if (!result.ok) throw new Error("unreachable");
    expect(result.quote.contracts).toBe(-4);
    expect(result.quote.costPoints).toBeLessThan(0);
  });

  it.each<[string, MarketState, "buy_points" | "buy_contracts" | "sell_contracts", number]>([
    ["a fractional point budget", fresh, "buy_points", 1.5],
    ["zero contracts", fresh, "buy_contracts", 0],
    ["contracts that round to zero", fresh, "sell_contracts", 1e-7],
    ["b out of range", { b: 10, qYes: 0, qNo: 0 }, "buy_points", 10],
    ["q off the grid", { b: 100, qYes: 0.1 + 0.2, qNo: 0 }, "buy_points", 10],
  ])("maps an EngineError (%s) to invalid_input", (_, state, mode, amount) => {
    expect(quoteTrade(state, "YES", mode, amount)).toEqual({ ok: false, code: "invalid_input" });
  });

  it("maps a bad side to invalid_input", () => {
    expect(quoteTrade(fresh, "MAYBE" as "YES", "buy_points", 10)).toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  it("rethrows anything that is not an EngineError", () => {
    // An unknown mode is a caller bug (parseTradeInput admits only the three modes), not input.
    expect(() => quoteTrade(fresh, "YES", "hold" as "buy_points", 10)).toThrow(TypeError);
  });
});

describe("withinCostSlippage", () => {
  it("allows the fill to cost up to ceil(maxSlippage × contracts) more than the quote", () => {
    // 2 × 9.76 = 19.52, so up to 20 points more.
    expect(withinCostSlippage(500, 520, 2, 9.76)).toBe(true);
    expect(withinCostSlippage(500, 521, 2, 9.76)).toBe(false);
  });

  it("always allows a fill at or below the quote", () => {
    expect(withinCostSlippage(500, 500, 0, 10)).toBe(true);
    expect(withinCostSlippage(500, 450, 0, 10)).toBe(true);
    expect(withinCostSlippage(500, 501, 0, 10)).toBe(false);
  });

  it("gives at least one point of room on tiny orders with nonzero slippage", () => {
    expect(withinCostSlippage(1, 2, 2, 0.01)).toBe(true);
    expect(withinCostSlippage(1, 3, 2, 0.01)).toBe(false);
  });

  it("does not let float noise widen the allowance", () => {
    // 0.1 × 30 is 3.0000000000000004 in floating point; the allowance is 3, not 4.
    expect(withinCostSlippage(100, 103, 0.1, 30)).toBe(true);
    expect(withinCostSlippage(100, 104, 0.1, 30)).toBe(false);
  });

  it("works for sells (negative costs: smaller proceeds are a higher cost)", () => {
    expect(withinCostSlippage(-400, -392, 2, -4)).toBe(true);
    expect(withinCostSlippage(-400, -391, 2, -4)).toBe(false);
    expect(withinCostSlippage(-400, -410, 2, -4)).toBe(true);
  });

  it.each([
    [Number.NaN, 1, 2, 1],
    [1, Number.POSITIVE_INFINITY, 2, 1],
    [1, 1, -1, 1],
    [1, 1, Number.NaN, 1],
    [1, 1, 2, Number.NaN],
  ])("throws on invalid arguments %j", (q, f, s, c) => {
    expect(() => withinCostSlippage(q, f, s, c)).toThrow(RangeError);
  });
});
