import "server-only";
import type { AnyDb } from "@/db/types";
import type { PriceHistory, PriceRange } from "@/lib/price-range";
import { loadMarketState } from "./market-state";
import {
  getMarketBySlug,
  listMarkets,
  type MarketFilter,
  type MarketView,
  PUBLIC_MARKET_STATUSES,
} from "./markets";
import { getPriceHistory } from "./price-history";
import type { MarketStateDto } from "./trade-types";

// Data loading for the public market pages. Every outcome is a value, never a throw, so a page
// renders a state (not configured, unavailable, empty) instead of a 500.

export type ListLoad =
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "ok"; markets: MarketView[] };

export type DetailLoad =
  | { kind: "unconfigured" }
  | { kind: "unavailable" }
  | { kind: "not-found" }
  | { kind: "ok"; market: MarketView };

/** Log the error's name only: driver messages can echo the connection string. */
function logFailure(what: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[market-pages] ${what} failed (${name})`);
}

/**
 * Every public market (or those matching `filter`); the pages filter and group in memory
 * (campus scale: tens of rows). Defaults to the public statuses so a proposal never leaks.
 */
export async function loadMarketList(
  db: AnyDb | undefined,
  filter: MarketFilter = { status: PUBLIC_MARKET_STATUSES },
): Promise<ListLoad> {
  if (!db) return { kind: "unconfigured" };
  try {
    return { kind: "ok", markets: await listMarkets(db, filter) };
  } catch (error) {
    logFailure("loading the market list", error);
    return { kind: "unavailable" };
  }
}

/** One market by slug. `proposed` and `rejected` markets are not public, so they read as missing. */
export async function loadMarketDetail(db: AnyDb | undefined, slug: string): Promise<DetailLoad> {
  if (!db) return { kind: "unconfigured" };
  try {
    const market = await getMarketBySlug(db, slug);
    if (!market || market.status === "proposed" || market.status === "rejected") {
      return { kind: "not-found" };
    }
    return { kind: "ok", market };
  } catch (error) {
    logFailure("loading a market", error);
    return { kind: "unavailable" };
  }
}

/** What the market page's ticket, chart and position card start from. */
export interface TradingLoad {
  /** The live state, with `balance` and `position` when `userId` is given and the lookup worked. */
  readonly state: MarketStateDto;
  /** Null when the history could not be loaded: the page then shows no chart. */
  readonly history: PriceHistory | null;
}

function stateOf(market: MarketView): MarketStateDto {
  return {
    status: market.status,
    closeAt: market.closeAt.toISOString(),
    b: market.b,
    qYes: market.qYes,
    qNo: market.qNo,
    probabilityYes: market.probabilityYes,
    displayPrice: market.displayPrice,
  };
}

/**
 * The trading data for a loaded market: its state (plus the member's balance and position) and
 * the price history for `range`. Never throws: a failed query falls back to the state the page
 * already has, without an account, and no chart.
 */
export async function loadMarketTrading(
  db: AnyDb,
  market: MarketView,
  userId: string | null,
  range: PriceRange,
): Promise<TradingLoad> {
  let state = stateOf(market);
  try {
    state = (await loadMarketState(db, market.id, userId)) ?? state;
  } catch (error) {
    logFailure("loading the market state", error);
  }
  let history: PriceHistory | null = null;
  try {
    history = await getPriceHistory(db, market.id, range);
  } catch (error) {
    logFailure("loading the price history", error);
  }
  return { state, history };
}
