import { displayPrice, type Side } from "@mc-kalshi/engine";
import { MIN_TRADE_CONTRACTS } from "@/server/trade-limits";
import type { Requote, TradeFailure, TradeMode, TradeView } from "@/server/trade-types";
import type { TicketQuote, TicketQuoteFailure, TicketTab } from "./ticket-quote";

// Every order ticket string (docs/specs/m3-trading.md, "Order ticket (UI)"). Points show as "pts"
// and chances as "%"; no currency sign anywhere (docs/design/theme.md, copy rules). The UI maps
// each server error code to fixed copy here and never shows the server's raw message. A test
// scans this file and the ticket components for banned words.

const pointsFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const contractsFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dustFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const MICRO = 1e6;

/** "5,000 pts". */
export function formatPoints(points: number): string {
  return `${pointsFormat.format(points)} pts`;
}

/** Unsigned contracts: two decimals, or up to six for amounts under 0.01. */
export function formatContracts(contracts: number): string {
  const n = Math.abs(contracts);
  return n > 0 && n < MIN_TRADE_CONTRACTS ? dustFormat.format(n) : contractsFormat.format(n);
}

function contractsNoun(contracts: number): string {
  return Math.abs(contracts) === 1 ? "contract" : "contracts";
}

/** Fixed labels. */
export const TICKET_COPY = {
  title: "Trade",
  orderType: "Order type",
  buy: "Buy",
  sell: "Sell",
  outcome: "Outcome",
  unit: "Amount in",
  points: "Points",
  contracts: "Contracts",
  amountPoints: "Amount in points",
  amountContracts: "Contracts to sell",
  amountContractsBuy: "Contracts to buy",
  max: "Max",
  maxLabel: "Fill the most you can use",
  quoteHeading: "Your order",
  advanced: "Advanced",
  tolerance: "Price tolerance",
  toleranceHelp: "If the price moves more than this before your order lands, nothing is traded.",
  signIn: "Sign in to trade",
  signInNote: "Prices update live. Sign in with your Maryville College email to trade.",
  suspended: "Your account can't trade right now",
  closed: "Trading is closed",
  closedNote: "This market no longer takes orders.",
  pending: "Placing order…",
  enterAmount: "Enter an amount",
  networkError: "We could not reach the server. Check your connection and try again.",
  openSheet: "Open the order ticket",
  close: "Close",
  balance: "Balance",
  holding: "You hold",
  playMoney: "Play money only. Points have no cash value.",
} as const;

/** One side segment: the word and the price ("YES 62 pts"). */
export function sideSegmentLabel(side: Side, pricePts: number): string {
  return `${side} ${pricePts} pts`;
}

/** A tolerance option ("2 pts per contract"). */
export function toleranceOption(points: number): string {
  return `${points} pts per contract`;
}

/** "Buy YES", "Sell NO", and "Buy YES anyway" when the price moves more than 5 points. */
export function submitLabel(tab: TicketTab, side: Side, highImpact: boolean): string {
  const verb = tab === "buy" ? "Buy" : "Sell";
  return `${verb} ${side}${highImpact ? " anyway" : ""}`;
}

/** The button after a slippage reject: "Buy at 54 pts". */
export function requoteSubmitLabel(tab: TicketTab, avgPrice: number): string {
  return `${tab === "buy" ? "Buy" : "Sell"} at ${avgPrice} pts`;
}

/** "The price moved from 51 to 54 pts. Review the new price." */
export function requoteMessage(fromPrice: number, toPrice: number): string {
  return `The price moved from ${fromPrice} to ${toPrice} pts. Review the new price.`;
}

/** The warning chip for a big price move. */
export function impactWarning(q: TicketQuote): string {
  return `Big price move: ${q.side} goes from ${q.priceBeforePct}% to ${q.newPricePct}%`;
}

export interface QuoteRow {
  readonly label: string;
  readonly value: string;
}

/** The quote rows: buys show price, contracts or cost, payout and new price; sells show proceeds. */
export function quoteRows(q: TicketQuote): QuoteRow[] {
  if (q.mode === "sell_contracts") {
    const rows: QuoteRow[] = [
      { label: "Avg price", value: `${q.avgPrice} pts` },
      { label: "You receive", value: formatPoints(q.youReceive) },
      { label: "New price", value: `${q.newPricePct}%` },
    ];
    if (q.leftInPosition !== null) {
      rows.push({
        label: "Left in position",
        value: `${formatContracts(q.leftInPosition)} ${q.side} ${contractsNoun(q.leftInPosition)}`,
      });
    }
    return rows;
  }
  return [
    { label: "Avg price", value: `${q.avgPrice} pts (${q.breakEvenPct}% to break even)` },
    q.mode === "buy_points"
      ? { label: "Contracts", value: formatContracts(q.contracts) }
      : { label: "You pay", value: formatPoints(q.youPay) },
    { label: `Payout if ${q.side}`, value: formatPoints(q.payoutIfWin) },
    { label: "New price", value: `${q.newPricePct}%` },
  ];
}

/**
 * The rows for the server's fresh quote after a slippage reject (the ticket swaps them in). For a
 * sell, pass the contracts `held` on that side to keep the "Left in position" row.
 */
export function requoteRows(
  order: { readonly mode: TradeMode; readonly side: Side; readonly amount?: number },
  r: Requote,
  held: number | null = null,
): QuoteRow[] {
  const yes = displayPrice(r.probAfter);
  const newPrice = { label: "New price", value: `${order.side === "YES" ? yes : 100 - yes}%` };
  if (order.mode === "sell_contracts") {
    const rows: QuoteRow[] = [
      { label: "Avg price", value: `${r.avgPrice} pts` },
      { label: "You receive", value: formatPoints(Math.abs(r.costPoints)) },
      newPrice,
    ];
    if (held !== null) {
      const sold = Math.abs(order.amount ?? r.contracts);
      const left = Math.max(0, Math.round((held - sold) * MICRO) / MICRO);
      rows.push({
        label: "Left in position",
        value: `${formatContracts(left)} ${order.side} ${contractsNoun(left)}`,
      });
    }
    return rows;
  }
  return [
    { label: "Avg price", value: `${r.avgPrice} pts (${r.avgPrice}% to break even)` },
    order.mode === "buy_points"
      ? { label: "Contracts", value: formatContracts(r.contracts) }
      : { label: "You pay", value: formatPoints(r.costPoints) },
    { label: `Payout if ${order.side}`, value: formatPoints(r.payoutIfWin) },
    newPrice,
  ];
}

const TOO_SMALL = `Too small: the smallest trade is ${MIN_TRADE_CONTRACTS} contracts`;
const tooBig = (maxPoints: number) =>
  `Too big: the most you can buy at once here is ${formatPoints(maxPoints)}`;
const notEnough = (balance: number, needed: number) =>
  `Not enough points: you have ${pointsFormat.format(balance)} and need ${pointsFormat.format(needed)}`;
const onlyHold = (held: number, side: Side) =>
  held > 0
    ? `You only hold ${formatContracts(held)} ${side} ${contractsNoun(held)}`
    : `You hold no ${side} contracts to sell`;

/** Why the amount cannot be quoted, as one line under the input; null when there is nothing to say. */
export function inputProblem(f: TicketQuoteFailure, side: Side): string | null {
  switch (f.reason) {
    case "empty":
      return null;
    case "not_a_number":
      return "Enter a number, like 500.";
    case "too_many_decimals":
      return f.maxDecimals === 0 ? "Use whole points." : "Use at most 6 decimal places.";
    case "below_minimum":
      return TOO_SMALL;
    case "above_maximum":
      return f.maxPoints === null ? "That amount is too large." : tooBig(f.maxPoints);
    case "exceeds_holdings":
      return onlyHold(f.held, side);
    case "exceeds_balance":
      return notEnough(f.balance, f.needed);
  }
}

/** Fixed copy for a server failure; the raw `message` is for logs only. */
export function tradeErrorMessage(
  f: TradeFailure,
  ctx: { readonly side: Side; readonly expectedAvgPrice: number },
): string {
  switch (f.code) {
    case "trading_paused":
      return "Trading is paused";
    case "unauthenticated":
      return "Your session ended. Sign in again to trade.";
    case "account_suspended":
      return TICKET_COPY.suspended;
    case "invalid_input":
      return "Something in this order is not valid. Check the amount and try again.";
    case "market_not_found":
      return "This market is no longer available.";
    case "market_not_open":
    case "market_closed":
      return TICKET_COPY.closed;
    case "slippage_exceeded":
      return requoteMessage(ctx.expectedAvgPrice, f.requote.avgPrice);
    case "trade_too_small":
      return TOO_SMALL;
    case "trade_too_large":
      return tooBig(f.maxPoints);
    case "insufficient_balance":
      return notEnough(f.balance, f.needed);
    case "insufficient_position":
      return onlyHold(f.held, ctx.side);
    case "rate_limited":
      return `Slow down a little and try again in ${Math.max(1, Math.ceil(f.retryAfterSec))} s`;
    case "idempotency_key_reused":
      return "This order changed while it was sending. Review it and submit again.";
    case "internal_error":
      // Not "nothing was traded": a failed COMMIT can still have applied. A retry keeps the key.
      return "Something went wrong. Check your portfolio before trying again.";
  }
}

/** "Bought 9.76 YES contracts for 500 pts." or "Sold 4.2 NO contracts for 230 pts." */
export function successMessage(trade: TradeView): string {
  const bought = trade.contracts > 0;
  const amount = `${formatContracts(trade.contracts)} ${trade.side} ${contractsNoun(trade.contracts)}`;
  return `${bought ? "Bought" : "Sold"} ${amount} for ${formatPoints(Math.abs(trade.costPoints))}.`;
}
