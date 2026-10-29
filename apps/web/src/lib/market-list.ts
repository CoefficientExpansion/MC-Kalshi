import type { MarketStatus } from "./market-format";

// Pure grouping for the `/` market list.

/** The fields the list logic needs; `MarketView` satisfies it. */
export interface ListableMarket {
  readonly slug: string;
  readonly status: MarketStatus;
  readonly closeAt: Date;
  readonly category: { readonly slug: string; readonly name: string };
}

export interface CategoryChip {
  readonly slug: string;
  readonly name: string;
  /** Open markets in the category, whatever filter is active. */
  readonly openCount: number;
}

export interface MarketList<T extends ListableMarket> {
  /** Trading now, soonest-closing first. */
  readonly open: T[];
  /** Closed, resolved, finalized, voided (and "open" rows past their close time), newest first. */
  readonly ended: T[];
  readonly categories: CategoryChip[];
  readonly activeCategory: { slug: string; name: string } | null;
  /** A well-formed `?category=` slug that matches no category. */
  readonly unknownCategory: boolean;
}

const byCloseAsc = (a: ListableMarket, b: ListableMarket) =>
  a.closeAt.getTime() - b.closeAt.getTime() || a.slug.localeCompare(b.slug);
const byCloseDesc = (a: ListableMarket, b: ListableMarket) =>
  b.closeAt.getTime() - a.closeAt.getTime() || a.slug.localeCompare(b.slug);

/** Split markets into open and ended, build the category chips, apply the category filter. */
export function buildMarketList<T extends ListableMarket>(
  all: readonly T[],
  categorySlug: string | undefined,
  now: Date,
): MarketList<T> {
  // `proposed` and `rejected` are moderator-only states: never public.
  const visible = all.filter((m) => m.status !== "proposed" && m.status !== "rejected");
  const isOpen = (m: T) => m.status === "open" && m.closeAt.getTime() > now.getTime();

  const chips = new Map<string, { name: string; openCount: number }>();
  for (const m of visible) {
    const chip = chips.get(m.category.slug) ?? { name: m.category.name, openCount: 0 };
    if (isOpen(m)) chip.openCount += 1;
    chips.set(m.category.slug, chip);
  }
  const categories = [...chips]
    .map(([slug, c]) => ({ slug, ...c }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const active = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined;
  const shown = categorySlug ? visible.filter((m) => m.category.slug === categorySlug) : visible;

  return {
    open: shown.filter(isOpen).sort(byCloseAsc),
    ended: shown.filter((m) => !isOpen(m)).sort(byCloseDesc),
    categories,
    activeCategory: active ? { slug: active.slug, name: active.name } : null,
    unknownCategory: Boolean(categorySlug) && !active,
  };
}
