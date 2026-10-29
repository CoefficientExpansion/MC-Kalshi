import type { Quote } from "@mc-kalshi/engine";
import type { TradeMode } from "./trade-types";

// Trade size rules and limits (docs/specs/m3-trading.md, "Size rules and limits"). One place for
// the constants; later movable to `settings`. Shared with client code (the ticket's Max button
// and copy): no server-only import.

/** Smallest buy, and smallest sell unless it closes out the side: pays 1 point if it wins. */
export const MIN_TRADE_CONTRACTS = 0.01;
/** Smallest budget for a buy by points (the engine's minimum). */
export const MIN_BUY_POINTS = 1;
/** Per-trade buy cap in points; the effective cap is min(this, MAX_TRADE_POINTS_PER_B × b). */
export const MAX_TRADE_POINTS = 5000;
export const MAX_TRADE_POINTS_PER_B = 50;
/** Sanity caps applied while parsing, before the engine sees the amount. */
export const MAX_INPUT_CONTRACTS = 1e6;
export const MAX_INPUT_POINTS = 1e9;
/** Slippage tolerance in points per contract. */
export const DEFAULT_MAX_SLIPPAGE = 2;
export const MAX_SLIPPAGE = 10;
/** Trades per user per rolling minute unless `TRADE_RATE_LIMIT_PER_MIN` overrides it. */
export const DEFAULT_TRADE_RATE_LIMIT_PER_MIN = 20;
/** Largest accepted override, so a typo cannot effectively disable the limit. */
const MAX_TRADE_RATE_LIMIT_PER_MIN = 10_000;

const MICRO = 1e6;
const MIN_TRADE_MICROS = MIN_TRADE_CONTRACTS * MICRO;

/** The most a single buy may cost in a market with liquidity `b`. */
export function maxBuyPoints(b: number): number {
  return Math.min(MAX_TRADE_POINTS, Math.floor(MAX_TRADE_POINTS_PER_B * b));
}

function readRateLimitEnv(): string | undefined {
  return typeof process === "undefined" ? undefined : process.env.TRADE_RATE_LIMIT_PER_MIN;
}

/**
 * The per-minute trade limit: `TRADE_RATE_LIMIT_PER_MIN` when it is a whole number in
 * 1..10,000, else the default 20 (a malformed value never disables the limit).
 */
export function getTradeRateLimitPerMin(raw: string | undefined = readRateLimitEnv()): number {
  const text = raw?.trim() ?? "";
  if (!/^\d+$/.test(text)) return DEFAULT_TRADE_RATE_LIMIT_PER_MIN;
  const n = Number(text);
  return n >= 1 && n <= MAX_TRADE_RATE_LIMIT_PER_MIN ? n : DEFAULT_TRADE_RATE_LIMIT_PER_MIN;
}

export type SizeRuleViolation =
  | { readonly code: "trade_too_small" }
  | { readonly code: "trade_too_large"; readonly maxPoints: number };

export interface SizeRuleArgs {
  readonly mode: TradeMode;
  /** A fresh engine quote for this trade (contracts negative for a sell). */
  readonly quote: Pick<Quote, "contracts" | "costPoints" | "payoutIfWin">;
  /** The market's liquidity. */
  readonly b: number;
  /** Contracts the user holds on the quote's side before the trade. */
  readonly heldOnSide: number;
}

/**
 * Applies every row of the size rules table to a quoted trade; null when it may proceed.
 * Buys: at least 0.01 contracts, payout if win at least the cost, cost at most min(5000, 50·b).
 * Sells: at least 0.01 contracts or exactly the whole holding on that side; zero proceeds only
 * for that close-out; never capped. Selling more than is held is left to the holdings check.
 * Throws if the quote's direction disagrees with `mode` (a caller bug).
 */
export function checkSizeRules({
  mode,
  quote,
  b,
  heldOnSide,
}: SizeRuleArgs): SizeRuleViolation | null {
  const micros = Math.round(quote.contracts * MICRO);
  const isSell = mode === "sell_contracts";
  if (isSell ? micros >= 0 : micros <= 0) {
    throw new Error(`quote direction does not match mode ${mode}`);
  }
  if (isSell) {
    const closesOut = -micros === Math.round(heldOnSide * MICRO);
    if (closesOut) return null;
    if (-micros < MIN_TRADE_MICROS || quote.costPoints === 0) return { code: "trade_too_small" };
    return null;
  }
  if (micros < MIN_TRADE_MICROS || quote.payoutIfWin < quote.costPoints) {
    return { code: "trade_too_small" };
  }
  const maxPoints = maxBuyPoints(b);
  return quote.costPoints > maxPoints ? { code: "trade_too_large", maxPoints } : null;
}
