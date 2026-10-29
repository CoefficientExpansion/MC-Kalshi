import {
  displayPrice,
  type MarketState,
  type PositionLike,
  type Quote,
  quotePoints,
  type Side,
} from "@mc-kalshi/engine";
import { quoteTrade } from "@/server/quote";
import {
  checkSizeRules,
  MAX_INPUT_CONTRACTS,
  MAX_INPUT_POINTS,
  MIN_TRADE_CONTRACTS,
  maxBuyPoints,
} from "@/server/trade-limits";
import type { TradeMode } from "@/server/trade-types";

// The order ticket's quote (docs/specs/m3-trading.md, "Quote = fill"). Pure: it quotes through
// the same adapter placeTrade uses (`server/quote.ts`), so for the same {b, qYes, qNo} the ticket
// shows exactly what the server fills. The size rules come from `server/trade-limits.ts`, the same
// table the server enforces.

export type TicketTab = "buy" | "sell";
export type TicketUnit = "points" | "contracts";

/** Market state plus, when signed in, the user's balance and position. MarketStateDto fits. */
export interface TicketState extends MarketState {
  readonly balance?: number | null;
  readonly position?: PositionLike | null;
}

/** Above this many percentage points of movement the ticket warns before submit. */
export const PRICE_IMPACT_WARN_POINTS = 5;

const MICRO = 1e6;

/** Everything the ticket shows for a quotable order. Contracts are unsigned here. */
export interface TicketQuote {
  readonly mode: TradeMode;
  readonly side: Side;
  /** The parsed amount: whole points for `buy_points`, else contracts. */
  readonly amount: number;
  /** The engine quote, unchanged (signed contracts and cost). */
  readonly quote: Quote;
  /** Points per contract; the value sent as `expectedAvgPrice`. */
  readonly avgPrice: number;
  /** The YES/NO chance at which this order breaks even, in percent (equals avgPrice). */
  readonly breakEvenPct: number;
  /** Contracts bought or sold (positive). */
  readonly contracts: number;
  /** The engine's signed cost: positive paid, negative received. */
  readonly costPoints: number;
  /** Points paid (buys), else 0. */
  readonly youPay: number;
  /** Points received (sells), else 0. */
  readonly youReceive: number;
  /** Points this order pays if its side wins (0 for a sell). */
  readonly payoutIfWin: number;
  /** The chosen side's price before and after, in whole percent. */
  readonly priceBeforePct: number;
  readonly newPricePct: number;
  /** How far the chosen side's chance moves, in percentage points (unrounded). */
  readonly priceImpact: number;
  readonly highImpact: boolean;
  /** Contracts left on that side after a sell; null for buys or when the position is unknown. */
  readonly leftInPosition: number | null;
  /** For `buy_contracts` only: the cost the ticket displayed, sent as `expectedCostPoints`. */
  readonly expectedCostPoints: number | undefined;
}

export type TicketQuoteFailure =
  | { readonly ok: false; readonly reason: "empty" }
  | { readonly ok: false; readonly reason: "not_a_number" }
  | { readonly ok: false; readonly reason: "too_many_decimals"; readonly maxDecimals: 0 | 6 }
  | {
      readonly ok: false;
      readonly reason: "below_minimum";
      readonly minContracts: number;
      readonly quote?: TicketQuote;
    }
  | {
      readonly ok: false;
      readonly reason: "above_maximum";
      /** The per-trade buy cap in points; null for a sell past the input sanity cap. */
      readonly maxPoints: number | null;
      readonly quote?: TicketQuote;
    }
  | { readonly ok: false; readonly reason: "exceeds_holdings"; readonly held: number }
  | {
      readonly ok: false;
      readonly reason: "exceeds_balance";
      readonly balance: number;
      readonly needed: number;
      readonly quote: TicketQuote;
    };

export type TicketQuoteReason = TicketQuoteFailure["reason"];

export type TicketQuoteResult =
  | { readonly ok: true; readonly quote: TicketQuote }
  | TicketQuoteFailure;

/** Buy by points, buy by contracts, or sell (always contracts). */
export function ticketMode(tab: TicketTab, unit: TicketUnit): TradeMode {
  if (tab === "sell") return "sell_contracts";
  return unit === "points" ? "buy_points" : "buy_contracts";
}

/** Contracts the user holds on `side`, or null when no position is known (signed out). */
export function heldOnSide(state: TicketState, side: Side): number | null {
  const p = state.position;
  if (!p) return null;
  return side === "YES" ? p.contractsYes : p.contractsNo;
}

/** The chosen side's price in whole percent; NO is 100 − YES so the pair always sums to 100. */
function sidePricePct(probYes: number, side: Side): number {
  const yes = displayPrice(probYes);
  return side === "YES" ? yes : 100 - yes;
}

const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

type Parsed =
  | { readonly ok: true; readonly value: number }
  | Extract<TicketQuoteFailure, { reason: "empty" | "not_a_number" | "too_many_decimals" }>;

function parseAmount(text: string, wholeOnly: boolean): Parsed {
  const cleaned = text.trim().replace(/,/g, "");
  if (cleaned === "") return { ok: false, reason: "empty" };
  if (!NUMBER.test(cleaned)) return { ok: false, reason: "not_a_number" };
  const fraction = (cleaned.split(".")[1] ?? "").replace(/0+$/, "");
  const maxDecimals = wholeOnly ? 0 : 6;
  if (fraction.length > maxDecimals) {
    return { ok: false, reason: "too_many_decimals", maxDecimals };
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, reason: "not_a_number" };
  return { ok: true, value };
}

function describeQuote(
  quote: Quote,
  mode: TradeMode,
  amount: number,
  held: number | null,
): TicketQuote {
  const contracts = Math.abs(quote.contracts);
  const priceBeforePct = sidePricePct(quote.probBefore, quote.side);
  const newPricePct = sidePricePct(quote.probAfter, quote.side);
  const sideProb = (p: number) => (quote.side === "YES" ? p : 1 - p);
  const priceImpact = Math.abs(sideProb(quote.probAfter) - sideProb(quote.probBefore)) * 100;
  const isSell = mode === "sell_contracts";
  return {
    mode,
    side: quote.side,
    amount,
    quote,
    avgPrice: quote.avgPrice,
    breakEvenPct: quote.avgPrice,
    contracts,
    costPoints: quote.costPoints,
    youPay: isSell ? 0 : quote.costPoints,
    youReceive: isSell ? -quote.costPoints : 0,
    payoutIfWin: quote.payoutIfWin,
    priceBeforePct,
    newPricePct,
    priceImpact,
    highImpact: priceImpact > PRICE_IMPACT_WARN_POINTS,
    leftInPosition: isSell && held !== null ? Math.round((held - contracts) * MICRO) / MICRO : null,
    expectedCostPoints: mode === "buy_contracts" ? quote.costPoints : undefined,
  };
}

/**
 * Everything the ticket shows for `amountText`, or the typed reason it cannot quote. Checks run
 * in the order the user can fix them: shape, minimum, sanity caps, holdings, then the engine quote
 * and the server's size rules, then the balance. Holdings and balance are checked only when known.
 */
export function buildTicketQuote(
  state: TicketState,
  tab: TicketTab,
  side: Side,
  unit: TicketUnit,
  amountText: string,
): TicketQuoteResult {
  const mode = ticketMode(tab, unit);
  const isSell = mode === "sell_contracts";
  const parsed = parseAmount(amountText, mode === "buy_points");
  if (!parsed.ok) return parsed;
  const amount = parsed.value;
  if (amount === 0) {
    return { ok: false, reason: "below_minimum", minContracts: MIN_TRADE_CONTRACTS };
  }
  const buyCap = isSell ? null : maxBuyPoints(state.b);
  const sanityCap = mode === "buy_points" ? MAX_INPUT_POINTS : MAX_INPUT_CONTRACTS;
  if (amount > sanityCap) return { ok: false, reason: "above_maximum", maxPoints: buyCap };

  const held = heldOnSide(state, side);
  if (isSell && held !== null && Math.round(amount * MICRO) > Math.round(held * MICRO)) {
    return { ok: false, reason: "exceeds_holdings", held };
  }

  const market: MarketState = { b: state.b, qYes: state.qYes, qNo: state.qNo };
  const result = quoteTrade(market, side, mode, amount);
  if (!result.ok) return { ok: false, reason: "above_maximum", maxPoints: buyCap };
  const quote = describeQuote(result.quote, mode, amount, held);

  const violation = checkSizeRules({
    mode,
    quote: result.quote,
    b: state.b,
    heldOnSide: held ?? -1,
  });
  if (violation?.code === "trade_too_small") {
    return { ok: false, reason: "below_minimum", minContracts: MIN_TRADE_CONTRACTS, quote };
  }
  if (violation?.code === "trade_too_large") {
    return { ok: false, reason: "above_maximum", maxPoints: violation.maxPoints, quote };
  }

  const balance = state.balance;
  if (!isSell && typeof balance === "number" && quote.costPoints > balance) {
    return { ok: false, reason: "exceeds_balance", balance, needed: quote.costPoints, quote };
  }
  return { ok: true, quote };
}

/** A contract amount as input text: six decimals at most, trailing zeros dropped. */
export function contractsText(n: number): string {
  return n.toFixed(6).replace(/\.?0+$/, "") || "0";
}

/**
 * What `Max` puts in the amount box, or null when there is nothing to fill: a sell fills the
 * held contracts on that side exactly; a buy fills the balance capped at the per-trade maximum
 * (as points, or as the contracts that budget buys).
 */
export function maxAmountText(
  state: TicketState,
  tab: TicketTab,
  side: Side,
  unit: TicketUnit,
): string | null {
  if (tab === "sell") {
    const held = heldOnSide(state, side);
    return held === null ? null : contractsText(held);
  }
  if (typeof state.balance !== "number") return null;
  const budget = Math.floor(Math.min(state.balance, maxBuyPoints(state.b)));
  if (budget < 1) return null;
  if (unit === "points") return String(budget);
  try {
    const market: MarketState = { b: state.b, qYes: state.qYes, qNo: state.qNo };
    return contractsText(quotePoints(market, side, budget).contracts);
  } catch {
    return null;
  }
}
