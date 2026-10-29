import { describe, expect, it } from "vitest";
import type { Requote, TradeFailure, TradeSuccess } from "@/server/trade-types";
import { parseTradeInput } from "@/server/trade-types";
import {
  buildTradeInput,
  keyFor,
  orderFromQuote,
  orderFromRequote,
  outcomeOf,
  type TicketOrder,
} from "./ticket-order";
import { buildTicketQuote } from "./ticket-quote";

const MARKET = "6f1c2a1e-1111-4222-8333-444455556666";
const fresh = { b: 100, qYes: 0, qNo: 0 };

function quote(tab: "buy" | "sell", unit: "points" | "contracts", text: string) {
  const state = {
    ...fresh,
    qYes: 20,
    position: { contractsYes: 20, contractsNo: 0, costBasisPoints: 0 },
  };
  const r = buildTicketQuote(state, tab, "YES", unit, text);
  if (!r.ok) throw new Error(r.reason);
  return r.quote;
}

let n = 0;
const newKey = () => `key-${String(++n).padStart(16, "0")}`;

const requote: Requote = {
  avgPrice: 54,
  contracts: 9.2,
  costPoints: 520,
  probAfter: 0.55,
  payoutIfWin: 920,
};

describe("orderFromQuote", () => {
  it("sends the displayed average price and the chosen tolerance", () => {
    const q = quote("buy", "points", "500");
    expect(orderFromQuote(q, 5)).toEqual({
      mode: "buy_points",
      side: "YES",
      amount: 500,
      expectedAvgPrice: q.avgPrice,
      maxSlippage: 5,
    });
  });

  it("adds expectedCostPoints for a buy by contracts only", () => {
    const q = quote("buy", "contracts", "10");
    expect(orderFromQuote(q, 2).expectedCostPoints).toBe(q.costPoints);
    expect(orderFromQuote(quote("sell", "contracts", "4"), 2)).not.toHaveProperty(
      "expectedCostPoints",
    );
  });
});

describe("orderFromRequote", () => {
  it("takes the new average price, and the new cost for a buy by contracts", () => {
    const byPoints = orderFromQuote(quote("buy", "points", "500"), 2);
    expect(orderFromRequote(byPoints, requote)).toEqual({ ...byPoints, expectedAvgPrice: 54 });
    const byContracts = orderFromQuote(quote("buy", "contracts", "10"), 2);
    expect(orderFromRequote(byContracts, requote)).toEqual({
      ...byContracts,
      expectedAvgPrice: 54,
      expectedCostPoints: 520,
    });
  });
});

describe("keyFor: idempotency key lifecycle", () => {
  const order: TicketOrder = orderFromQuote(quote("buy", "points", "500"), 2);

  it("makes a key for the first submission", () => {
    const k = keyFor(null, MARKET, order, newKey);
    expect(k.key).toMatch(/^key-/);
  });

  it("keeps the key when retrying an identical submission", () => {
    const first = keyFor(null, MARKET, order, newKey);
    expect(keyFor(first, MARKET, { ...order }, newKey)).toBe(first);
  });

  it.each<[string, Partial<TicketOrder>]>([
    ["side", { side: "NO" }],
    ["unit (mode)", { mode: "buy_contracts" }],
    ["amount", { amount: 501 }],
    ["expected price", { expectedAvgPrice: order.expectedAvgPrice + 1 }],
    ["tolerance", { maxSlippage: 5 }],
  ])("renews the key when the %s changes", (_, change) => {
    const first = keyFor(null, MARKET, order, newKey);
    const next = keyFor(first, MARKET, { ...order, ...change }, newKey);
    expect(next.key).not.toBe(first.key);
  });

  it("renews the key for another market", () => {
    const first = keyFor(null, MARKET, order, newKey);
    expect(keyFor(first, "6f1c2a1e-1111-4222-8333-000000000000", order, newKey).key).not.toBe(
      first.key,
    );
  });
});

describe("buildTradeInput", () => {
  it("builds an input placeTrade accepts", () => {
    const order = orderFromQuote(quote("buy", "contracts", "10"), 2);
    const key = crypto.randomUUID();
    const input = buildTradeInput(MARKET, order, key);
    expect(input).toEqual({ marketId: MARKET, idempotencyKey: key, ...order });
    const parsed = parseTradeInput(input);
    expect(parsed.ok).toBe(true);
  });

  it("works for a sell", () => {
    const order = orderFromQuote(quote("sell", "contracts", "4"), 1);
    expect(parseTradeInput(buildTradeInput(MARKET, order, crypto.randomUUID())).ok).toBe(true);
  });
});

describe("outcomeOf", () => {
  const order = orderFromQuote(quote("buy", "points", "500"), 2);
  const fail = (code: TradeFailure["code"], extra: object = {}) =>
    ({ ok: false, code, message: "x", ...extra }) as TradeFailure;

  it("reports success copy and drops the key", () => {
    const success: TradeSuccess = {
      ok: true,
      replayed: false,
      trade: {
        id: "t",
        side: "YES",
        contracts: 9.761859,
        costPoints: 500,
        avgPrice: 51,
        probBefore: 0.5,
        probAfter: 0.52,
        createdAt: "2026-10-29T16:00:00Z",
      },
      position: { contractsYes: 9.761859, contractsNo: 0, costBasisPoints: 500 },
      balance: 9500,
      market: { qYes: 9.761859, qNo: 0, probabilityYes: 0.52, displayPrice: 52 },
    };
    expect(outcomeOf(success, order)).toEqual({
      kind: "success",
      message: "Bought 9.76 YES contracts for 500 pts.",
      dropKey: true,
    });
  });

  it("offers the requote on slippage, never resubmitting", () => {
    expect(outcomeOf(fail("slippage_exceeded", { requote }), order)).toEqual({
      kind: "requote",
      message: `The price moved from ${order.expectedAvgPrice} to 54 pts. Review the new price.`,
      requote,
      fromPrice: order.expectedAvgPrice,
    });
  });

  it("locks the ticket for closed markets and suspended accounts", () => {
    expect(outcomeOf(fail("market_closed"), order)).toMatchObject({
      kind: "error",
      lock: "closed",
    });
    expect(outcomeOf(fail("market_not_open"), order)).toMatchObject({ lock: "closed" });
    expect(outcomeOf(fail("account_suspended"), order)).toMatchObject({ lock: "suspended" });
    expect(outcomeOf(fail("unauthenticated"), order)).toMatchObject({ lock: "signed_out" });
  });

  it("renews the key when the server says it was reused, and keeps it otherwise", () => {
    expect(outcomeOf(fail("idempotency_key_reused"), order)).toMatchObject({ dropKey: true });
    expect(outcomeOf(fail("insufficient_balance", { balance: 320, needed: 500 }), order)).toEqual({
      kind: "error",
      message: "Not enough points: you have 320 and need 500",
      lock: null,
      dropKey: false,
    });
  });
});
