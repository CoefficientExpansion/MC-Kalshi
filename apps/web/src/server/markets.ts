import "server-only";
import { displayPrice, probabilityYes } from "@mc-kalshi/engine";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Category, categories, type Market, markets } from "@/db/schema";
import type { AnyDb } from "@/db/types";

// Read-only market queries. Writes (open, trade, resolve) arrive with M3/M4.

/** A market row with the AMM state parsed to numbers and the current price attached. */
export interface MarketView extends Omit<Market, "qYes" | "qNo"> {
  readonly qYes: number;
  readonly qNo: number;
  readonly category: Pick<Category, "slug" | "name">;
  /**
   * P(YES) from the LMSR state, in [0, 1]: exactly 0 or 1 only at extreme states, so never
   * divide by it; show it through `displayPrice`, which clamps to 1–99.
   */
  readonly probabilityYes: number;
  /** Whole-percent price, 1–99 (engine `displayPrice`). */
  readonly displayPrice: number;
}

type MarketStatus = Market["status"];

/** Statuses anyone may see. `proposed` and `rejected` are moderator-only. */
export const PUBLIC_MARKET_STATUSES: readonly MarketStatus[] = [
  "open",
  "closed",
  "resolved",
  "finalized",
  "voided",
];

export interface MarketFilter {
  /** One status or several; public pages pass {@link PUBLIC_MARKET_STATUSES}. */
  readonly status?: MarketStatus | readonly MarketStatus[];
  readonly categorySlug?: string;
}

type Row = { market: Market; category: Pick<Category, "slug" | "name"> };

/** `numeric(18,6)` arrives as a string; parse once here so callers only see numbers. */
function toView({ market, category }: Row): MarketView {
  const qYes = Number(market.qYes);
  const qNo = Number(market.qNo);
  const p = probabilityYes({ b: market.b, qYes, qNo });
  return { ...market, qYes, qNo, category, probabilityYes: p, displayPrice: displayPrice(p) };
}

function statusCondition(status: MarketFilter["status"]) {
  if (status === undefined) return undefined;
  return typeof status === "string"
    ? eq(markets.status, status)
    : inArray(markets.status, [...status]);
}

const select = (db: AnyDb) =>
  db
    .select({ market: markets, category: { slug: categories.slug, name: categories.name } })
    .from(markets)
    .innerJoin(categories, eq(markets.categoryId, categories.id));

/**
 * Markets soonest-closing first (slug breaks ties). With no `status` every status comes back,
 * proposals included, so public pages must pass one.
 */
export async function listMarkets(db: AnyDb, filter: MarketFilter = {}): Promise<MarketView[]> {
  const rows = await select(db)
    .where(
      and(
        statusCondition(filter.status),
        filter.categorySlug ? eq(categories.slug, filter.categorySlug) : undefined,
      ),
    )
    .orderBy(asc(markets.closeAt), asc(markets.slug));
  return rows.map(toView);
}

export async function getMarketBySlug(db: AnyDb, slug: string): Promise<MarketView | null> {
  const [row] = await select(db).where(eq(markets.slug, slug)).limit(1);
  return row ? toView(row) : null;
}
