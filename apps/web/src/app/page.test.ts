import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SiteFooter } from "@/components/site-footer";
import { seedDatabase } from "@/db/seed";
import { createTestDb, type TestDb } from "@/db/test-db";
import { copyViolations, visibleText } from "@/lib/copy-guard";
import Home from "./page";

// `getDb()` is swapped per test: undefined = no DATABASE_URL, otherwise a PGlite database.
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ getDbChecked: async () => holder.db }));

type Props = Parameters<typeof Home>[0];
async function render(search: Record<string, string | string[]> = {}): Promise<string> {
  const element = await Home({ searchParams: Promise.resolve(search) } as Props);
  return renderToStaticMarkup(element);
}
const cardSlugs = (html: string) =>
  [...html.matchAll(/<article[^>]*>.*?href="\/markets\/([^"]+)"/g)].map((m) => m[1]);

describe("home page: market list", () => {
  let seeded: TestDb;
  let empty: TestDb;
  const closers: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    const a = await createTestDb();
    const b = await createTestDb();
    seeded = a.db;
    empty = b.db;
    closers.push(a.close, b.close);
    await seedDatabase(seeded, new Date());
  });
  afterAll(async () => {
    for (const close of closers) await close();
  });

  it("shows the database-not-configured state without throwing", async () => {
    holder.db = undefined;
    const html = await render();
    expect(html).toContain("Markets are not connected yet");
    expect(html).not.toContain("<article");
    expect(visibleText(html)).toMatch(/Play money, no cash, ever\./);
  });

  it("shows the empty state when there are no markets", async () => {
    holder.db = empty;
    const html = await render();
    expect(html).toContain("No markets yet");
  });

  it("lists every seeded market once, soonest-closing first, with chance and close times", async () => {
    holder.db = seeded;
    const html = await render();
    expect(cardSlugs(html)).toEqual([
      "spring-schedule-published-early",
      "dining-hall-holiday-menu",
      "library-open-past-midnight-finals",
      "warm-day-before-thanksgiving",
      "events-calendar-busy-week",
      "snow-before-december",
    ]);
    const text = visibleText(html);
    expect(text.match(/50% chance/g)).toHaveLength(6);
    expect(text).toMatch(/Closes in 14 days/);
    expect(text).toMatch(/\b[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M E[SD]T\b/);
    expect(html).toContain("Open now");
    expect(html).not.toContain("Closed and settled");
  });

  it("has one h1, a nav of categories, and marks All as current", async () => {
    holder.db = seeded;
    const html = await render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Categories"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>All/);
  });

  it("filters by ?category= and marks that chip current", async () => {
    holder.db = seeded;
    const html = await render({ category: "weather" });
    expect(cardSlugs(html).sort()).toEqual([
      "snow-before-december",
      "warm-day-before-thanksgiving",
    ]);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/\?category=weather"/);
  });

  it("ignores a malformed category and shows everything", async () => {
    holder.db = seeded;
    expect(cardSlugs(await render({ category: "a b;--" }))).toHaveLength(6);
  });

  it("explains an unknown category", async () => {
    holder.db = seeded;
    const html = await render({ category: "dining" });
    expect(html).toContain("We do not have that category");
    expect(html).not.toContain("<article");
  });

  it("never says bet, $, or cash out in any state", async () => {
    const pages: string[] = [];
    for (const [db, search] of [
      [undefined, {}],
      [empty, {}],
      [seeded, {}],
      [seeded, { category: "weather" }],
      [seeded, { category: "dining" }],
    ] as const) {
      holder.db = db;
      pages.push(await render(search));
    }
    pages.push(renderToStaticMarkup(SiteFooter()));
    for (const html of pages) {
      expect(copyViolations(visibleText(html))).toEqual([]);
    }
  });
});
