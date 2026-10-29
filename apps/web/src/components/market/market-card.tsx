import Link from "next/link";
import {
  closeSummary,
  formatAbsolute,
  type MarketStatus,
  type Outcome,
  statusBadge,
} from "@/lib/market-format";
import { PriceSplit } from "./price-split";
import { StatusBadge } from "./status-badge";

/** The fields a card shows; `MarketView` satisfies it. */
export interface CardMarket {
  readonly slug: string;
  readonly title: string;
  readonly status: MarketStatus;
  readonly outcome: Outcome | null;
  readonly closeAt: Date;
  readonly displayPrice: number;
  readonly category: { readonly slug: string; readonly name: string };
}

/** One market. The title is the only link; it stretches over the card so the whole card clicks. */
export function MarketCard({ market, now }: { market: CardMarket; now: Date }) {
  return (
    <article className="relative flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 focus-within:ring-2 focus-within:ring-brand-ink hover:border-brand-ink">
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-sm font-semibold uppercase tracking-widest text-brand-ink">
          {market.category.name}
        </p>
        <StatusBadge badge={statusBadge(market, now)} />
      </div>
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-display text-2xl font-semibold leading-tight">
          <Link
            href={`/markets/${encodeURIComponent(market.slug)}`}
            className="outline-none after:absolute after:inset-0"
          >
            {market.title}
          </Link>
        </h3>
        <p className="shrink-0 text-right leading-tight">
          <span className="sr-only">YES </span>
          <span className="block text-3xl font-semibold tabular-nums text-yes">
            {market.displayPrice}%
          </span>
          <span className="text-sm">chance</span>
        </p>
      </div>
      <PriceSplit yesPrice={market.displayPrice} />
      <p className="mt-auto text-sm">
        {closeSummary(market.closeAt, now)}
        <span aria-hidden="true"> · </span>
        <br className="sm:hidden" />
        <time dateTime={market.closeAt.toISOString()}>{formatAbsolute(market.closeAt)}</time>
      </p>
    </article>
  );
}
