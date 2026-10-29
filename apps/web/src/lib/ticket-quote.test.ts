import { type MarketState, quotePoints } from "@mc-kalshi/engine";
import { describe, expect, it } from "vitest";
import { quoteTrade } from "@/server/quote";
import { maxBuyPoints } from "@/server/trade-limits";
import {
  buildTicketQuote,
  maxAmountText,
  PRICE_IMPACT_WARN_POINTS,
  type TicketState,
  ticketMode,
} from "./ticket-quote";

const fresh: TicketState = { b: 100, qYes: 0, qNo: 0 };
const rich: TicketState = {
  ...fresh,
  balance: 10_000,
  position: { contractsYes: 4.2, contractsNo: 0, costBasisPoints: 200 },
};

function ok(result: ReturnType<typeof buildTicketQuote>) {
  if (!result.ok) throw new Error(`expected a quote, got ${result.reason}`);
  return result.quote;
}

describe("ticketMode", () => {
  it("maps tab and unit to the trade mode", () => {
    expect(ticketMode("buy", "points")).toBe("buy_points");
    expect(ticketMode("buy", "contracts")).toBe("buy_contracts");
    expect(ticketMode("sell", "contracts")).toBe("sell_contracts");
    // Sell is always contracts.
    expect(ticketMode("sell", "points")).toBe("sell_contracts");
  });
});

describe("buildTicketQuote: quote = fill", () => {
  it("shows the worked example: 500 points on YES in a fresh b=100 market", () => {
    const q = ok(buildTicketQuote(fresh, "buy", "YES", "points", "500"));
    expect(q.mode).toBe("buy_points");
    expect(q.amount).toBe(500);
    expect(q.contracts).toBe(9.761859);
    expect(q.costPoints).toBe(500);
    expect(q.avgPrice).toBe(51);
    expect(q.breakEvenPct).toBe(51);
    expect(q.payoutIfWin).toBe(976);
    expect(q.priceBeforePct).toBe(50);
    expect(q.newPricePct).toBe(52);
    expect(q.highImpact).toBe(false);
    expect(q.expectedCostPoints).toBeUndefined();
  });

  it.each<[string, MarketState, "YES" | "NO", "buy" | "sell", "points" | "contracts", string]>([
    ["buy points YES", fresh, "YES", "buy", "points", "500"],
    ["buy points NO, moved market", { b: 250, qYes: 30, qNo: 5.5 }, "NO", "buy", "points", "1234"],
    ["buy contracts YES", fresh, "YES", "buy", "contracts", "10"],
    ["buy contracts NO", { b: 100, qYes: 12, qNo: 0 }, "NO", "buy", "contracts", "3.25"],
    ["sell YES", { b: 100, qYes: 10, qNo: 0 }, "YES", "sell", "contracts", "4"],
  ])("equals quoteTrade for the same inputs (%s)", (_, state, side, tab, unit, text) => {
    const held = { contractsYes: 50, contractsNo: 50, costBasisPoints: 0 };
    const q = ok(buildTicketQuote({ ...state, position: held }, tab, side, unit, text));
    const server = quoteTrade(state, side, ticketMode(tab, unit), Number(text));
    if (!server.ok) throw new Error("server could not quote");
    expect(q.quote).toEqual(server.quote);
    expect(q.avgPrice).toBe(server.quote.avgPrice);
  });

  it("exposes costPoints as expectedCostPoints for a buy by contracts", () => {
    const q = ok(buildTicketQuote(fresh, "buy", "YES", "contracts", "10"));
    expect(q.mode).toBe("buy_contracts");
    expect(q.expectedCostPoints).toBe(q.costPoints);
    expect(q.youPay).toBe(q.costPoints);
    expect(q.contracts).toBe(10);
  });

  it("shows the NO side's own price and payout", () => {
    const q = ok(buildTicketQuote({ b: 100, qYes: 20, qNo: 0 }, "buy", "NO", "points", "100"));
    expect(q.priceBeforePct).toBe(100 - 55);
    expect(q.newPricePct).toBeGreaterThan(q.priceBeforePct);
    expect(q.payoutIfWin).toBe(Math.floor(q.contracts * 100));
  });

  it("shows proceeds and what is left for a sell", () => {
    const state: TicketState = {
      b: 100,
      qYes: 10,
      qNo: 0,
      position: { contractsYes: 10, contractsNo: 0, costBasisPoints: 520 },
    };
    const q = ok(buildTicketQuote(state, "sell", "YES", "contracts", "4"));
    expect(q.mode).toBe("sell_contracts");
    expect(q.contracts).toBe(4);
    expect(q.youReceive).toBe(-q.costPoints);
    expect(q.youReceive).toBeGreaterThan(0);
    expect(q.leftInPosition).toBe(6);
    expect(q.newPricePct).toBeLessThan(q.priceBeforePct);
  });

  it("flags a price impact above 5 percentage points", () => {
    expect(PRICE_IMPACT_WARN_POINTS).toBe(5);
    const big = ok(buildTicketQuote(rich, "buy", "YES", "points", "2000"));
    expect(big.priceImpact).toBeGreaterThan(5);
    expect(big.highImpact).toBe(true);
    const small = ok(buildTicketQuote(rich, "buy", "YES", "points", "100"));
    expect(small.highImpact).toBe(false);
  });

  it("accepts thousands separators and surrounding spaces", () => {
    const q = ok(buildTicketQuote(rich, "buy", "YES", "points", " 1,000 "));
    expect(q.amount).toBe(1000);
  });

  it("treats trailing zeros as whole points", () => {
    expect(ok(buildTicketQuote(rich, "buy", "YES", "points", "500.00")).amount).toBe(500);
  });
});

describe("buildTicketQuote: reasons it cannot quote", () => {
  it("is empty for blank input", () => {
    expect(buildTicketQuote(fresh, "buy", "YES", "points", "")).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(buildTicketQuote(fresh, "buy", "YES", "points", "   ")).toMatchObject({
      reason: "empty",
    });
  });

  it.each(["abc", "-5", "1e3", "5..0", "1.2.3", "0x10", "Infinity", "."])(
    "rejects %s as not a number",
    (text) => {
      expect(buildTicketQuote(fresh, "buy", "YES", "contracts", text)).toEqual({
        ok: false,
        reason: "not_a_number",
      });
    },
  );

  it("wants whole points and at most six decimals for contracts", () => {
    expect(buildTicketQuote(fresh, "buy", "YES", "points", "10.5")).toEqual({
      ok: false,
      reason: "too_many_decimals",
      maxDecimals: 0,
    });
    expect(buildTicketQuote(fresh, "buy", "YES", "contracts", "1.1234567")).toEqual({
      ok: false,
      reason: "too_many_decimals",
      maxDecimals: 6,
    });
    expect(buildTicketQuote(fresh, "buy", "YES", "contracts", "1.123456").ok).toBe(true);
  });

  it("is below the minimum for zero and for less than 0.01 contracts", () => {
    expect(buildTicketQuote(fresh, "buy", "YES", "points", "0")).toMatchObject({
      ok: false,
      reason: "below_minimum",
      minContracts: 0.01,
    });
    expect(buildTicketQuote(fresh, "buy", "YES", "contracts", "0.009")).toMatchObject({
      ok: false,
      reason: "below_minimum",
    });
    expect(buildTicketQuote(fresh, "buy", "YES", "contracts", "0.01").ok).toBe(true);
  });

  it("allows a dust close-out below 0.01 contracts", () => {
    const state: TicketState = {
      ...fresh,
      qYes: 0.004,
      position: { contractsYes: 0.004, contractsNo: 0, costBasisPoints: 1 },
    };
    expect(buildTicketQuote(state, "sell", "YES", "contracts", "0.004").ok).toBe(true);
    expect(buildTicketQuote(state, "sell", "YES", "contracts", "0.003")).toMatchObject({
      reason: "below_minimum",
    });
  });

  it("is above the maximum past the per-trade cap, and still shows the quote", () => {
    const r = buildTicketQuote({ ...rich, balance: 100_000 }, "buy", "YES", "points", "5001");
    expect(r).toMatchObject({ ok: false, reason: "above_maximum", maxPoints: 5000 });
    if (r.ok || r.reason !== "above_maximum") throw new Error("unreachable");
    expect(r.quote?.costPoints).toBeGreaterThan(5000);
    const small = buildTicketQuote({ b: 20, qYes: 0, qNo: 0 }, "buy", "YES", "points", "1001");
    expect(small).toMatchObject({ reason: "above_maximum", maxPoints: maxBuyPoints(20) });
  });

  it("is above the maximum past the input sanity caps", () => {
    expect(buildTicketQuote(fresh, "buy", "YES", "points", "2000000000")).toMatchObject({
      reason: "above_maximum",
      maxPoints: 5000,
    });
    expect(buildTicketQuote(fresh, "buy", "YES", "contracts", "2000000")).toMatchObject({
      reason: "above_maximum",
    });
  });

  it("exceeds holdings when selling more than is held (signed in only)", () => {
    expect(buildTicketQuote(rich, "sell", "YES", "contracts", "5")).toEqual({
      ok: false,
      reason: "exceeds_holdings",
      held: 4.2,
    });
    expect(buildTicketQuote(rich, "sell", "NO", "contracts", "1")).toEqual({
      ok: false,
      reason: "exceeds_holdings",
      held: 0,
    });
    // Signed out: no position is known, so the quote still works.
    expect(buildTicketQuote({ ...fresh, qYes: 10 }, "sell", "YES", "contracts", "5").ok).toBe(true);
  });

  it("exceeds the balance when a buy costs more than the user has, with the quote", () => {
    const r = buildTicketQuote({ ...rich, balance: 320 }, "buy", "YES", "contracts", "10");
    expect(r).toMatchObject({ ok: false, reason: "exceeds_balance", balance: 320 });
    if (r.ok || r.reason !== "exceeds_balance") throw new Error("unreachable");
    expect(r.needed).toBe(r.quote.costPoints);
    expect(r.needed).toBeGreaterThan(320);
  });
});

describe("maxAmountText", () => {
  it("fills the held contracts on that side for a sell, exactly", () => {
    const state: TicketState = {
      ...fresh,
      position: { contractsYes: 4.199999, contractsNo: 0, costBasisPoints: 0 },
    };
    expect(maxAmountText(state, "sell", "YES", "contracts")).toBe("4.199999");
    expect(maxAmountText(state, "sell", "NO", "contracts")).toBe("0");
  });

  it("fills the balance capped at the per-trade maximum for a buy by points", () => {
    expect(maxAmountText({ ...fresh, balance: 320 }, "buy", "YES", "points")).toBe("320");
    expect(maxAmountText({ ...fresh, balance: 10_000 }, "buy", "YES", "points")).toBe("5000");
  });

  it("fills the contracts that budget buys for a buy by contracts", () => {
    const text = maxAmountText({ ...fresh, balance: 500 }, "buy", "YES", "contracts");
    expect(text).toBe(String(quotePoints(fresh, "YES", 500).contracts));
    const q = ok(
      buildTicketQuote({ ...fresh, balance: 500 }, "buy", "YES", "contracts", text ?? ""),
    );
    expect(q.costPoints).toBeLessThanOrEqual(500);
  });

  it("is null when nothing is known (signed out) or the balance is empty", () => {
    expect(maxAmountText(fresh, "buy", "YES", "points")).toBeNull();
    expect(maxAmountText(fresh, "sell", "YES", "contracts")).toBeNull();
    expect(maxAmountText({ ...fresh, balance: 0 }, "buy", "YES", "contracts")).toBeNull();
  });
});
