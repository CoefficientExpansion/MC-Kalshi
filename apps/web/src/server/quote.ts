import {
  EngineError,
  type MarketState,
  type Quote,
  quoteContracts,
  quotePoints,
  type Side,
} from "@mc-kalshi/engine";
import type { TradeMode } from "./trade-types";

// The one engine adapter for trades (docs/specs/m3-trading.md, "Quote = fill"). placeTrade and
// the order ticket both quote through here, so the ticket shows exactly what the server fills
// for the same state. Shared with client code: no server-only import.

export type QuoteTradeResult =
  | { readonly ok: true; readonly quote: Quote }
  | { readonly ok: false; readonly code: "invalid_input" };

/**
 * Quotes a trade: `buy_points` spends `amount` whole points (quotePoints), `buy_contracts` buys
 * `amount` contracts (quoteContracts(+n)), `sell_contracts` sells them (quoteContracts(−n)).
 * Any EngineError, whatever its code, becomes `invalid_input`; anything else is a bug and is
 * rethrown (placeTrade maps it to `internal_error`).
 */
export function quoteTrade(
  state: MarketState,
  side: Side,
  mode: TradeMode,
  amount: number,
): QuoteTradeResult {
  try {
    switch (mode) {
      case "buy_points":
        return { ok: true, quote: quotePoints(state, side, amount) };
      case "buy_contracts":
        return { ok: true, quote: quoteContracts(state, side, amount) };
      case "sell_contracts":
        return { ok: true, quote: quoteContracts(state, side, -amount) };
      default:
        throw new TypeError(`unknown trade mode: ${String(mode)}`);
    }
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, code: "invalid_input" };
    throw e;
  }
}

/** Float noise allowed before a whole-point ceiling (0.1 × 30 must give 3, not 4). */
const CEIL_EPSILON = 1e-9;

/**
 * The contract-amount slippage rule: the fill may cost at most ceil(maxSlippage × |contracts|)
 * points more than the quoted cost (for a sell, costs are negative, so smaller proceeds count as
 * a higher cost). `withinSlippage` compares average prices, which the one-point minimum charge on
 * tiny buys does not move; this bounds the total. Throws RangeError on non-finite arguments or a
 * negative tolerance.
 */
export function withinCostSlippage(
  quotedCostPoints: number,
  fillCostPoints: number,
  maxSlippage: number,
  contracts: number,
): boolean {
  if (
    !Number.isFinite(quotedCostPoints) ||
    !Number.isFinite(fillCostPoints) ||
    !Number.isFinite(maxSlippage) ||
    maxSlippage < 0 ||
    !Number.isFinite(contracts)
  ) {
    throw new RangeError("withinCostSlippage needs finite costs, contracts and a slippage >= 0");
  }
  const allowance = Math.max(0, Math.ceil(maxSlippage * Math.abs(contracts) - CEIL_EPSILON));
  return fillCostPoints - quotedCostPoints <= allowance;
}
