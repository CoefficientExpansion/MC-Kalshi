import "server-only";
import { probabilityYes } from "@mc-kalshi/engine";
import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { markets, priceSnapshots, trades } from "@/db/schema";
import type { AnyDb } from "@/db/types";
import {
  type PriceHistory,
  type PricePoint,
  type PriceRange,
  RANGE_SPAN_MS,
} from "@/lib/price-range";
import { parseNumeric } from "./numeric";

// The price chart's series (docs/specs/m3-trading.md, "Price chart"). Prices are constant between
// trades, so the series is a step function: a start point, the snapshots in range (downsampled to
// the last one per time bucket), and "now" at the current probability.

/** The most points the chart draws, start and "now" included. */
export const MAX_CHART_POINTS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPENING_PROBABILITY = 0.5;

/**
 * At most `max` points: [from, to] split into `max` equal buckets, keeping the last point of
 * each (a step chart then still shows the price in force at the end of every bucket). `points`
 * must be sorted by time. Pure.
 */
export function downsample(
  points: readonly PricePoint[],
  from: number,
  to: number,
  max: number,
): PricePoint[] {
  if (points.length <= max) return [...points];
  const width = (to - from) / max;
  const kept = new Map<number, PricePoint>();
  for (const p of points) {
    const bucket =
      width > 0 ? Math.min(max - 1, Math.max(0, Math.floor((p.at - from) / width))) : 0;
    kept.set(bucket, p);
  }
  return [...kept.values()];
}

/**
 * The YES-probability series for `range`, or null for a malformed id or an unknown market. The
 * series starts at the opening time (`opened_at ?? created_at`) with the first trade's
 * `prob_before` (else 0.5); a 1D or 1W range that starts later begins with the price in force at
 * its start. It ends at `now` with the probability from the market's current `q`.
 */
export async function getPriceHistory(
  db: AnyDb,
  marketId: string,
  range: PriceRange,
  now: Date = new Date(),
): Promise<PriceHistory | null> {
  if (!UUID.test(marketId)) return null;
  const [market] = await db
    .select({
      b: markets.b,
      qYes: markets.qYes,
      qNo: markets.qNo,
      openedAt: markets.openedAt,
      createdAt: markets.createdAt,
    })
    .from(markets)
    .where(eq(markets.id, marketId));
  if (!market) return null;

  const to = now.getTime();
  const opened = Math.min((market.openedAt ?? market.createdAt).getTime(), to);
  const span = RANGE_SPAN_MS[range];
  const from = span === null ? opened : Math.max(opened, to - span);

  const [firstTrade] = await db
    .select({ probBefore: trades.probBefore })
    .from(trades)
    .where(eq(trades.marketId, marketId))
    .orderBy(asc(trades.createdAt), asc(trades.id))
    .limit(1);
  let startProbability = firstTrade?.probBefore ?? OPENING_PROBABILITY;
  if (from > opened) {
    const [before] = await db
      .select({ probabilityYes: priceSnapshots.probabilityYes })
      .from(priceSnapshots)
      .where(and(eq(priceSnapshots.marketId, marketId), lt(priceSnapshots.at, new Date(from))))
      .orderBy(desc(priceSnapshots.at))
      .limit(1);
    if (before) startProbability = before.probabilityYes;
  }

  const inRange = await db
    .select({ at: priceSnapshots.at, probabilityYes: priceSnapshots.probabilityYes })
    .from(priceSnapshots)
    .where(
      and(
        eq(priceSnapshots.marketId, marketId),
        gte(priceSnapshots.at, new Date(from)),
        lte(priceSnapshots.at, now),
      ),
    )
    .orderBy(asc(priceSnapshots.at));
  let hasTrades = inRange.length > 0 || firstTrade !== undefined;
  if (!hasTrades) {
    const [any] = await db
      .select({ at: priceSnapshots.at })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.marketId, marketId))
      .limit(1);
    hasTrades = any !== undefined;
  }

  const current = probabilityYes({
    b: market.b,
    qYes: parseNumeric(market.qYes),
    qNo: parseNumeric(market.qNo),
  });
  const middle = downsample(
    inRange.map((s) => ({ at: s.at.getTime(), probabilityYes: s.probabilityYes })),
    from,
    to,
    MAX_CHART_POINTS - 2,
  );
  return {
    range,
    from,
    to,
    hasTrades,
    points: [
      { at: from, probabilityYes: startProbability },
      ...middle,
      { at: to, probabilityYes: current },
    ],
  };
}
