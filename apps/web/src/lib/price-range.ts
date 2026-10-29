// Price chart ranges (docs/specs/m3-trading.md, "Price chart"). Shared by the loader, the page
// and the chart; no server-only code here.

export const PRICE_RANGES = ["1D", "1W", "ALL"] as const;
export type PriceRange = (typeof PRICE_RANGES)[number];

/** The default range: campus markets are short-lived (market-page note). */
export const DEFAULT_PRICE_RANGE: PriceRange = "1W";

const HOUR = 3_600_000;

/** How far back a range reaches; `null` means since the market opened. */
export const RANGE_SPAN_MS: Record<PriceRange, number | null> = {
  "1D": 24 * HOUR,
  "1W": 7 * 24 * HOUR,
  ALL: null,
};

/** The `?range=` value, or the default for anything else (missing, repeated, junk, lowercase). */
export function parsePriceRange(raw: string | string[] | undefined): PriceRange {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (PRICE_RANGES as readonly string[]).includes(first ?? "")
    ? (first as PriceRange)
    : DEFAULT_PRICE_RANGE;
}

/** One chart point: epoch milliseconds and P(YES) in [0, 1]. */
export interface PricePoint {
  readonly at: number;
  readonly probabilityYes: number;
}

export interface PriceHistory {
  readonly range: PriceRange;
  /** Range start (epoch ms): the market's opening time, or now minus the span if later. */
  readonly from: number;
  /** Range end (epoch ms): now. */
  readonly to: number;
  /** False when the market has no snapshot at all: the chart says "No trades yet". */
  readonly hasTrades: boolean;
  /** Start point, the last snapshot per time bucket, then "now"; at most 200 points. */
  readonly points: readonly PricePoint[];
}
