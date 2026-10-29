import { describe, expect, it } from "vitest";
import { buildMarketList, type ListableMarket } from "./market-list";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-29T16:00:00Z");

function m(
  slug: string,
  category: string,
  status: ListableMarket["status"],
  closeInDays: number,
): ListableMarket {
  return {
    slug,
    status,
    closeAt: new Date(NOW.getTime() + closeInDays * DAY),
    category: { slug: category, name: category.toUpperCase() },
  };
}

const all = [
  m("a", "campus", "open", 5),
  m("b", "weather", "open", 2),
  m("c", "weather", "closed", -1),
  m("d", "campus", "proposed", 9),
  m("e", "campus", "rejected", 9),
  m("f", "weather", "resolved", -5),
  m("g", "weather", "open", -1), // past close_at, cron has not flipped it yet
];

describe("buildMarketList", () => {
  it("never lists proposed or rejected markets", () => {
    const { open, ended } = buildMarketList(all, undefined, NOW);
    const slugs = [...open, ...ended].map((x) => x.slug);
    expect(slugs).not.toContain("d");
    expect(slugs).not.toContain("e");
  });

  it("puts open markets first, soonest closing first", () => {
    const { open } = buildMarketList(all, undefined, NOW);
    expect(open.map((x) => x.slug)).toEqual(["b", "a"]);
  });

  it("puts closed and settled markets after, most recently closed first, including a lagging open one", () => {
    const { ended } = buildMarketList(all, undefined, NOW);
    expect(ended.map((x) => x.slug)).toEqual(["c", "g", "f"].sort(byRecency));
  });

  it("builds category chips with open counts, sorted by name", () => {
    const { categories } = buildMarketList(all, undefined, NOW);
    expect(categories).toEqual([
      { slug: "campus", name: "CAMPUS", openCount: 1 },
      { slug: "weather", name: "WEATHER", openCount: 1 },
    ]);
  });

  it("filters by category while keeping every chip", () => {
    const list = buildMarketList(all, "weather", NOW);
    expect(list.open.map((x) => x.slug)).toEqual(["b"]);
    expect(list.ended.map((x) => x.slug)).toEqual(["c", "g", "f"].sort(byRecency));
    expect(list.categories).toHaveLength(2);
    expect(list.activeCategory).toEqual({ slug: "weather", name: "WEATHER" });
    expect(list.unknownCategory).toBe(false);
  });

  it("flags a well-formed slug that matches no category", () => {
    const list = buildMarketList(all, "dining", NOW);
    expect(list.open).toEqual([]);
    expect(list.ended).toEqual([]);
    expect(list.activeCategory).toBeNull();
    expect(list.unknownCategory).toBe(true);
  });

  it("handles no markets at all", () => {
    const list = buildMarketList([], undefined, NOW);
    expect(list).toMatchObject({ open: [], ended: [], categories: [], unknownCategory: false });
  });
});

function byRecency(x: string, y: string) {
  const close = new Map(all.map((e) => [e.slug, e.closeAt.getTime()]));
  return (close.get(y) ?? 0) - (close.get(x) ?? 0);
}
