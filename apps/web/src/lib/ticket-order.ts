import type { Side } from "@mc-kalshi/engine";
import type { Requote, TradeInput, TradeMode, TradeResult } from "@/server/trade-types";
import type { TicketQuote } from "./ticket-quote";
import { requoteMessage, successMessage, tradeErrorMessage } from "./trade-copy";

// What the order ticket submits, and how it reads the answer (docs/specs/m3-trading.md, "Order
// ticket (UI)": submit, key lifecycle, slippage UX). Pure, so the rules are unit-tested without a
// browser; the component only holds the state.

/**
 * The input the ticket sends. `expectedCostPoints` (the cost the ticket displayed) is required by
 * placeTrade for `buy_contracts`; declared here so the ticket compiles against either version of
 * `TradeInput` while the server side adds it.
 */
export type TicketTradeInput = TradeInput & { readonly expectedCostPoints?: number };

/** One order as the user confirmed it, without market or key. */
export interface TicketOrder {
  readonly mode: TradeMode;
  readonly side: Side;
  readonly amount: number;
  readonly expectedAvgPrice: number;
  readonly maxSlippage: number;
  readonly expectedCostPoints?: number;
}

/** The order for a displayed quote: its average price, and its cost for a buy by contracts. */
export function orderFromQuote(q: TicketQuote, maxSlippage: number): TicketOrder {
  const order: TicketOrder = {
    mode: q.mode,
    side: q.side,
    amount: q.amount,
    expectedAvgPrice: q.avgPrice,
    maxSlippage,
  };
  return q.expectedCostPoints === undefined
    ? order
    : { ...order, expectedCostPoints: q.expectedCostPoints };
}

/** The same order at the server's fresh price (the "Buy at 54 pts" button). */
export function orderFromRequote(order: TicketOrder, requote: Requote): TicketOrder {
  const next: TicketOrder = { ...order, expectedAvgPrice: requote.avgPrice };
  return order.mode === "buy_contracts"
    ? { ...next, expectedCostPoints: requote.costPoints }
    : next;
}

/** An idempotency key and the exact submission it belongs to. */
export interface KeyedOrder {
  readonly key: string;
  readonly signature: string;
}

function signature(marketId: string, o: TicketOrder): string {
  return JSON.stringify([
    marketId,
    o.mode,
    o.side,
    o.amount,
    o.expectedAvgPrice,
    o.maxSlippage,
    o.expectedCostPoints ?? null,
  ]);
}

/**
 * The key for a submission: the previous key when the submission is identical (a retry after a
 * network error or timeout), else a fresh one. Side, unit (mode), amount, expected price, tolerance
 * and expected cost are all part of what makes a submission identical.
 */
export function keyFor(
  prev: KeyedOrder | null,
  marketId: string,
  order: TicketOrder,
  newKey: () => string,
): KeyedOrder {
  const sig = signature(marketId, order);
  return prev && prev.signature === sig ? prev : { key: newKey(), signature: sig };
}

export function buildTradeInput(
  marketId: string,
  order: TicketOrder,
  key: string,
): TicketTradeInput {
  return { marketId, idempotencyKey: key, ...order };
}

/** Ticket states that a server answer can force until the page reloads. */
export type TicketLock = "closed" | "suspended" | "signed_out";

export type TicketOutcome =
  | { readonly kind: "success"; readonly message: string; readonly dropKey: true }
  | {
      readonly kind: "requote";
      readonly message: string;
      readonly requote: Requote;
      readonly fromPrice: number;
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly lock: TicketLock | null;
      /** True when the next submission must use a new key. */
      readonly dropKey: boolean;
    };

/** How the ticket reacts to a placeTrade result. Never resubmits on its own. */
export function outcomeOf(result: TradeResult, order: TicketOrder): TicketOutcome {
  if (result.ok) {
    return { kind: "success", message: successMessage(result.trade), dropKey: true };
  }
  if (result.code === "slippage_exceeded") {
    return {
      kind: "requote",
      message: requoteMessage(order.expectedAvgPrice, result.requote.avgPrice),
      requote: result.requote,
      fromPrice: order.expectedAvgPrice,
    };
  }
  const message = tradeErrorMessage(result, {
    side: order.side,
    expectedAvgPrice: order.expectedAvgPrice,
  });
  const lock: TicketLock | null =
    result.code === "market_closed" || result.code === "market_not_open"
      ? "closed"
      : result.code === "account_suspended"
        ? "suspended"
        : result.code === "unauthenticated"
          ? "signed_out"
          : null;
  return { kind: "error", message, lock, dropKey: result.code === "idempotency_key_reused" };
}
