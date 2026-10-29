import type { AnyDb } from "@/db/types";
import { getMarketBySlug, listMarkets, type MarketView } from "./markets";

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

/** Every market; the pages filter and group in memory (campus scale: tens of rows). */
export async function loadMarketList(db: AnyDb | undefined): Promise<ListLoad> {
  if (!db) return { kind: "unconfigured" };
  try {
    return { kind: "ok", markets: await listMarkets(db) };
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
