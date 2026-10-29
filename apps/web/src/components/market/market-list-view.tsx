import type { MarketList } from "@/lib/market-list";
import type { ListLoad } from "@/server/market-pages";
import type { MarketView } from "@/server/markets";
import { CategoryChips } from "./category-chips";
import { MarketCard } from "./market-card";
import { Notice } from "./notice";

type View = MarketList<MarketView>;

function Cards({ markets, now }: { markets: readonly MarketView[]; now: Date }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {markets.map((m) => (
        <li key={m.id}>
          <MarketCard market={m} now={now} />
        </li>
      ))}
    </ul>
  );
}

function Body({ load, list, now }: { load: ListLoad; list: View | null; now: Date }) {
  if (load.kind === "unconfigured") {
    return (
      <Notice title="Markets are not connected yet">
        The market database is not set up for this site, so there is nothing to show. Please check
        back soon.
      </Notice>
    );
  }
  if (load.kind === "unavailable" || list === null) {
    return (
      <Notice title="Markets are unavailable right now">
        We could not load the markets. Please try again in a minute.
      </Notice>
    );
  }
  if (list.unknownCategory) {
    return (
      <Notice title="We do not have that category" action={{ href: "/", label: "See all markets" }}>
        Pick a category above, or look at every market.
      </Notice>
    );
  }
  if (list.open.length === 0 && list.ended.length === 0) {
    return list.activeCategory ? (
      <Notice
        title={`No markets in ${list.activeCategory.name}`}
        action={{ href: "/", label: "See all markets" }}
      >
        Nothing has been posted in this category yet.
      </Notice>
    ) : (
      <Notice title="No markets yet">
        Nothing is open for trading right now. Check back soon for new campus questions.
      </Notice>
    );
  }
  return (
    <>
      <section aria-labelledby="open-heading" className="flex flex-col gap-4">
        <h2 id="open-heading" className="font-display text-2xl font-semibold">
          Open now
        </h2>
        {list.open.length > 0 ? (
          <Cards markets={list.open} now={now} />
        ) : (
          <p>
            Nothing is open for trading{list.activeCategory ? " in this category" : ""} right now.
          </p>
        )}
      </section>
      {list.ended.length > 0 ? (
        <section aria-labelledby="ended-heading" className="flex flex-col gap-4">
          <h2 id="ended-heading" className="font-display text-2xl font-semibold">
            Closed and settled
          </h2>
          <Cards markets={list.ended} now={now} />
        </section>
      ) : null}
    </>
  );
}

/** The `/` page body for every load state. Pure: no data fetching, no clock reads. */
export function MarketListView({
  load,
  list,
  now,
}: {
  load: ListLoad;
  /** Built from `load` when it is `ok`; null otherwise. */
  list: View | null;
  now: Date;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 sm:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Campus markets
        </h1>
        <p className="max-w-prose text-lg">
          Trade campus events with points. Play money, no cash, ever.
        </p>
      </header>
      {list ? (
        <CategoryChips
          categories={list.categories}
          activeSlug={list.activeCategory?.slug ?? null}
        />
      ) : null}
      <Body load={load} list={list} now={now} />
    </div>
  );
}
