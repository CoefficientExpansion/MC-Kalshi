import Link from "next/link";
import {
  chanceLabel,
  formatAbsolute,
  formatRelative,
  noPrice,
  pointsLabel,
  statusBadge,
} from "@/lib/market-format";
import type { PriceHistory } from "@/lib/price-range";
import type { DetailLoad } from "@/server/market-pages";
import type { MarketView } from "@/server/markets";
import type { MarketStateDto } from "@/server/trade-types";
import { MarketTradePanel } from "./market-trade-panel";
import { Notice } from "./notice";
import type { OrderTicketProps, TicketAccount } from "./order-ticket";
import { PositionCard } from "./position-card";
import { PriceChart } from "./price-chart";
import { StatusBadge } from "./status-badge";

const SHELL = "mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8";
const H2 = "font-display text-2xl font-semibold";

function DateRow({ label, date, now }: { label: string; date: Date; now: Date }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-display text-sm font-semibold uppercase tracking-widest text-brand-ink">
        {label}
      </dt>
      <dd>
        <time dateTime={date.toISOString()}>{formatAbsolute(date)}</time>
        <span className="block text-sm">{formatRelative(date, now)}</span>
      </dd>
    </div>
  );
}

/** What the page passes for the ticket, chart and position card. */
export interface MarketTrading {
  readonly state: MarketStateDto;
  readonly history: PriceHistory | null;
  /** The signed-in member's balance and position here (suspended or not); null when signed out. */
  readonly account: TicketAccount | null;
  readonly suspended: boolean;
  /** placeTradeAction. */
  readonly submit: OrderTicketProps["submit"];
}

function Detail({
  market,
  now,
  trading,
}: {
  market: MarketView;
  now: Date;
  trading: MarketTrading;
}) {
  const badge = statusBadge(market, now);
  const tradable = market.status === "open" && market.closeAt.getTime() > now.getTime();
  return (
    <div className={SHELL}>
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link
              href="/"
              className="font-semibold text-brand-ink underline-offset-2 hover:underline"
            >
              Markets
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/?category=${encodeURIComponent(market.category.slug)}`}
              className="font-semibold text-brand-ink underline-offset-2 hover:underline"
            >
              {market.category.name}
            </Link>
          </li>
        </ol>
      </nav>

      {/* Mobile order: headline, chart, YES/NO buttons, then the rest; from 1024 px the ticket
          is a sticky right column beside both blocks. */}
      <article className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="flex flex-col gap-8 lg:col-start-1 lg:row-start-1">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display text-sm font-semibold uppercase tracking-widest text-brand-ink">
                {market.category.name}
              </p>
              <StatusBadge badge={badge} />
            </div>
            <h1 className="font-display text-4xl font-bold leading-tight">{market.title}</h1>
            <p className="flex flex-col">
              <span className={tradable ? "sr-only" : "text-sm"}>
                {tradable ? "Current YES price: " : "Last YES price"}
              </span>
              <span className="text-5xl font-semibold tabular-nums text-yes">
                {chanceLabel(market.displayPrice)}
              </span>
            </p>
          </header>

          {trading.history ? (
            <PriceChart history={trading.history} basePath={`/markets/${market.slug}`} />
          ) : null}
        </div>

        <aside
          aria-label="Order ticket"
          className="flex flex-col gap-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <MarketTradePanel
            marketId={market.id}
            market={trading.state}
            account={trading.account}
            suspended={trading.suspended}
            submit={trading.submit}
            now={now.getTime()}
          />
          {trading.account ? (
            <PositionCard position={trading.account.position} yesPrice={market.displayPrice} />
          ) : null}
        </aside>

        <div className="flex flex-col gap-8 lg:col-start-1 lg:row-start-2">
          <section aria-labelledby="prices-heading" className="flex flex-col gap-3">
            <h2 id="prices-heading" className={H2}>
              Prices
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
                <p className="font-display text-sm font-semibold uppercase tracking-widest text-yes">
                  YES
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {pointsLabel(market.displayPrice)}
                </p>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
                <p className="font-display text-sm font-semibold uppercase tracking-widest text-no">
                  NO
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {pointsLabel(noPrice(market.displayPrice))}
                </p>
              </div>
            </div>
            <p className="text-sm">
              Prices are points per contract. A contract pays 100 points if its side is right and
              nothing if it is wrong.
            </p>
          </section>

          <section aria-labelledby="rules-heading" className="flex flex-col gap-2">
            <h2 id="rules-heading" className={H2}>
              Rules
            </h2>
            <p className="max-w-prose whitespace-pre-line">{market.rules}</p>
            {market.resolutionSource ? (
              <p className="max-w-prose text-sm">Source: {market.resolutionSource}</p>
            ) : null}
          </section>

          <section aria-labelledby="dates-heading" className="flex flex-col gap-3">
            <h2 id="dates-heading" className={H2}>
              Dates
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DateRow label="Trading closes" date={market.closeAt} now={now} />
              {market.resolveBy ? (
                <DateRow label="Resolves by" date={market.resolveBy} now={now} />
              ) : (
                <div className="flex flex-col gap-0.5">
                  <dt className="font-display text-sm font-semibold uppercase tracking-widest text-brand-ink">
                    Resolves by
                  </dt>
                  <dd>Not set yet</dd>
                </div>
              )}
              {market.resolvedAt ? (
                <DateRow label="Resolved" date={market.resolvedAt} now={now} />
              ) : null}
            </dl>
          </section>
        </div>
      </article>
    </div>
  );
}

/** The `/markets/[slug]` body for every load state except `not-found` (the page calls notFound). */
export function MarketDetailView({
  load,
  now,
  trading,
}: {
  load: Exclude<DetailLoad, { kind: "not-found" }>;
  now: Date;
  /** Required to render the ticket, chart and position card of an `ok` load. */
  trading?: MarketTrading;
}) {
  if (load.kind === "ok") {
    if (!trading) throw new Error("MarketDetailView: an ok load needs trading data");
    return <Detail market={load.market} now={now} trading={trading} />;
  }
  return (
    <div className={SHELL}>
      {load.kind === "unconfigured" ? (
        <Notice
          title="Markets are not connected yet"
          headingLevel={1}
          action={{ href: "/", label: "Back to markets" }}
        >
          The market database is not set up for this site, so this market cannot be shown. Please
          check back soon.
        </Notice>
      ) : (
        <Notice
          title="This market is unavailable right now"
          headingLevel={1}
          action={{ href: "/", label: "Back to markets" }}
        >
          We could not load it. Please try again in a minute.
        </Notice>
      )}
    </div>
  );
}
