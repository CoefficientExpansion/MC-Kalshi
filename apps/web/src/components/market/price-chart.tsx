"use client";

import { displayPrice } from "@mc-kalshi/engine";
import Link from "next/link";
import { type PointerEvent, useState } from "react";
import { chartGeometry, chartSummary, priceChange, priceChangeLabel } from "@/lib/price-chart";
import { PRICE_RANGES, type PriceHistory, type PriceRange } from "@/lib/price-range";

// The YES price over time (docs/specs/m3-trading.md, "Price chart"): hand-written SVG, a step-after
// line, theme tokens through Tailwind's stroke/fill utilities and currentColor, so light and dark
// mode follow the CSS variables. The range picker is plain links (`?range=`), so the page stays
// server-rendered; the only client work is the hover/touch crosshair.

const WIDTH = 560;
const HEIGHT = 200;
const LABEL_GUTTER = 40;
const GRID = [1, 0.75, 0.5, 0.25, 0] as const;

const RANGE_LABEL: Record<PriceRange, string> = { "1D": "1D", "1W": "1W", ALL: "ALL" };
const RANGE_NAME: Record<PriceRange, string> = {
  "1D": "Last day",
  "1W": "Last week",
  ALL: "Since trading opened",
};

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export interface PriceChartProps {
  readonly history: PriceHistory;
  /** The market page path; range links append `?range=`. */
  readonly basePath: string;
}

export function PriceChart({ history, basePath }: PriceChartProps) {
  const { points, from, to, range } = history;
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const empty = !history.hasTrades || points.length < 2;
  const geometry = chartGeometry(points, from, to, { width: WIDTH, height: HEIGHT });
  const change = priceChange(points);

  const hovered =
    hoverAt === null ? null : ([...points].reverse().find((p) => p.at <= hoverAt) ?? points[0]);
  const crossX = geometry.xOf(Math.min(to, Math.max(from, hoverAt ?? from)));

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const plotWidth = (rect.width * WIDTH) / (WIDTH + LABEL_GUTTER);
    if (plotWidth <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / plotWidth));
    setHoverAt(from + ratio * (to - from));
  };

  return (
    <section aria-labelledby="chart-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="chart-heading" className="font-display text-2xl font-semibold">
          Price history
        </h2>
        <nav aria-label="Chart range">
          <ul className="flex gap-1">
            {PRICE_RANGES.map((r) => (
              <li key={r}>
                <Link
                  href={`${basePath}?range=${r}`}
                  scroll={false}
                  aria-current={r === range ? "page" : undefined}
                  aria-label={RANGE_NAME[r]}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink ${
                    r === range
                      ? "bg-foreground text-background"
                      : "border border-border hover:bg-surface"
                  }`}
                >
                  {RANGE_LABEL[r]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {empty ? (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-border bg-surface p-4">
          <p className="font-semibold">No trades yet</p>
        </div>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{priceChangeLabel(change)}</span>{" "}
            <span>{RANGE_NAME[range].toLowerCase()}</span>
          </p>
          <div className="relative">
            <svg
              role="img"
              aria-label={chartSummary(points, range)}
              viewBox={`0 0 ${WIDTH + LABEL_GUTTER} ${HEIGHT + 8}`}
              className="h-auto w-full touch-pan-y overflow-visible"
              onPointerMove={onPointer}
              onPointerDown={onPointer}
              onPointerLeave={() => setHoverAt(null)}
            >
              <g>
                {GRID.map((p) => (
                  <g key={p}>
                    <line
                      x1={0}
                      x2={WIDTH}
                      y1={geometry.yOf(p) + 4}
                      y2={geometry.yOf(p) + 4}
                      className="stroke-border"
                      strokeWidth={1}
                    />
                    <text
                      x={WIDTH + 6}
                      y={geometry.yOf(p) + 8}
                      className="fill-muted text-xs tabular-nums"
                    >
                      {Math.round(p * 100)}%
                    </text>
                  </g>
                ))}
              </g>
              <g transform="translate(0 4)" className="text-yes">
                <path d={geometry.area} fill="currentColor" fillOpacity={0.12} stroke="none" />
                <path
                  d={geometry.line}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                />
              </g>
              {hovered ? (
                <g transform="translate(0 4)" className="text-foreground">
                  <line
                    x1={crossX}
                    x2={crossX}
                    y1={0}
                    y2={HEIGHT}
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={crossX}
                    cy={geometry.yOf(hovered.probabilityYes)}
                    r={4}
                    fill="currentColor"
                  />
                </g>
              ) : null}
            </svg>
            {hovered ? (
              <p
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-2 rounded-md border border-border bg-background px-2 py-1 text-sm shadow-sm"
              >
                <span>{timeFormat.format(hoverAt ?? hovered.at)}</span>{" "}
                <span className="font-semibold tabular-nums">
                  YES {displayPrice(hovered.probabilityYes)}%
                </span>
              </p>
            ) : null}
          </div>
          <div aria-hidden="true" className="flex justify-between text-sm text-muted">
            <span>{timeFormat.format(from)}</span>
            <span>{timeFormat.format(to)}</span>
          </div>
        </>
      )}
    </section>
  );
}
