import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { trades } from "@/db/schema";
import type { AnyDb } from "@/db/types";
import { getTradeRateLimitPerMin } from "./trade-limits";

// The trade rate-limit seam (docs/specs/m3-trading.md, "Rate limit"). M3's cheap version counts
// the user's trades in the last 60 seconds of database time (index trades(user_id, created_at)).
// M5 replaces the body with the shared limiter; the signature and the result do not change.

const WINDOW_SECONDS = 60;

export interface RateLimited {
  readonly code: "rate_limited";
  /** Whole seconds until the oldest trade in the window leaves it; at least 1. */
  readonly retryAfterSec: number;
}

/** Null when the user may trade now, else how long to wait. Time comes from the database. */
export async function checkTradeRateLimit(db: AnyDb, userId: string): Promise<RateLimited | null> {
  const limit = getTradeRateLimitPerMin();
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      // Seconds until the oldest trade in the window is WINDOW_SECONDS old.
      wait: sql<
        string | null
      >`extract(epoch from (min(${trades.createdAt}) + make_interval(secs => ${WINDOW_SECONDS}) - now()))`,
    })
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        gt(trades.createdAt, sql`now() - make_interval(secs => ${WINDOW_SECONDS})`),
      ),
    );
  const count = Number(row?.count ?? 0);
  if (count < limit) return null;
  const wait = Number(row?.wait ?? WINDOW_SECONDS);
  return { code: "rate_limited", retryAfterSec: Math.max(1, Math.ceil(wait)) };
}
