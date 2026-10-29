import { displayPrice } from "@mc-kalshi/engine";
import type { PricePoint, PriceRange } from "./price-range";

// Pure helpers for the price chart (docs/specs/m3-trading.md, "Price chart"): the headline change,
// the screen-reader summary and the SVG geometry. No I/O; the component only draws.

/** Last minus first in the range, in whole percentage points of the YES price. */
export function priceChange(points: readonly PricePoint[]): number {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 0;
  return displayPrice(last.probabilityYes) - displayPrice(first.probabilityYes);
}

/** "up 4", "down 3", "no change". */
export function priceChangeLabel(change: number): string {
  if (change > 0) return `up ${change}`;
  if (change < 0) return `down ${-change}`;
  return "no change";
}

const RANGE_PHRASE: Record<PriceRange, string> = {
  "1D": "over the last day",
  "1W": "over the last week",
  ALL: "since trading opened",
};

/** "YES chance rose from 50% to 62% over the last week". */
export function chartSummary(points: readonly PricePoint[], range: PriceRange): string {
  const first = displayPrice(points[0]?.probabilityYes ?? 0.5);
  const last = displayPrice(points.at(-1)?.probabilityYes ?? 0.5);
  const phrase = RANGE_PHRASE[range];
  if (first === last) return `YES chance held at ${first}% ${phrase}`;
  return `YES chance ${last > first ? "rose" : "fell"} from ${first}% to ${last}% ${phrase}`;
}

export interface ChartBox {
  readonly width: number;
  readonly height: number;
}

export interface ChartGeometry {
  /** Step-after path of the YES probability. */
  readonly line: string;
  /** The same path closed down to 0%, for the light area under the line. */
  readonly area: string;
  readonly xOf: (at: number) => number;
  readonly yOf: (probability: number) => number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Time maps to x across [from, to]; probability maps to y with 100% at the top. Each point holds
 * its value until the next one (step-after), because the price only changes on a trade.
 */
export function chartGeometry(
  points: readonly PricePoint[],
  from: number,
  to: number,
  box: ChartBox,
): ChartGeometry {
  const span = to - from;
  const xOf = (at: number) => (span > 0 ? round(((at - from) / span) * box.width) : 0);
  const yOf = (p: number) => round((1 - Math.min(1, Math.max(0, p))) * box.height);
  let line = "";
  for (const [i, p] of points.entries()) {
    line +=
      i === 0 ? `M${xOf(p.at)},${yOf(p.probabilityYes)}` : `H${xOf(p.at)}V${yOf(p.probabilityYes)}`;
  }
  const first = points[0];
  const last = points.at(-1);
  const area = first && last ? `${line}V${round(box.height)}H${xOf(first.at)}Z` : "";
  return { line, area, xOf, yOf };
}
