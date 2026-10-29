import { displayPrice, probYes } from "@mc-kalshi/engine";
import { and, asc, eq } from "drizzle-orm";
import { type Category, categories, type Market, markets } from "@/db/schema";
import type { AnyDb } from "@/db/types";

// Read-only market queries. Writes (open, trade, resolve) arrive with M3/M4.

/** A market row with the AMM state parsed to numbers and the current price attached. */
export interface MarketView extends Omit<Market, "qYes" | "qNo"> {
  readonly qYes: number;
  readonly qNo: number;
  readonly category: Pick<Category, "slug" | "name">;
  /** P(YES) from the LMSR state, in (0, 1). */
  readonly probYes: number;
  /** Integer cents-style price, 1–99. */
  readonly displayPrice: number;
}

export interface MarketFilter {
  readonly status?: Market["status"];
  readonly categorySlug?: string;
}

type Row = { market: Market; category: Pick<Category, "slug" | "name"> };

/** `numeric(18,6)` arrives as a string; parse once here so callers only see numbers. */
function toView({ market, category }: Row): MarketView {
  const qYes = Number(market.qYes);
  const qNo = Number(market.qNo);
  const p = probYes({ b: market.b, qYes, qNo });
  return { ...market, qYes, qNo, category, probYes: p, displayPrice: displayPrice(p) };
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
        filter.status ? eq(markets.status, filter.status) : undefined,
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
