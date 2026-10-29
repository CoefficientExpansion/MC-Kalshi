import { sql } from "drizzle-orm";
import { categories, markets } from "./schema";
import type { AnyDb } from "./types";

// Dev and preview seed data: plain campus topics (no athletics until the owner answers open
// question 1 in the m2a spec), none about a named private individual. Copy follows hard
// constraint 1: no "bet", "$" or "cash out". Safe to run repeatedly.

export const SEED_CATEGORIES = [
  { slug: "campus-life", name: "Campus Life" },
  { slug: "academics", name: "Academics" },
  { slug: "weather", name: "Weather" },
  { slug: "clubs-events", name: "Clubs & Events" },
] as const;

interface SeedMarket {
  readonly slug: string;
  readonly title: string;
  readonly rules: string;
  readonly category: (typeof SEED_CATEGORIES)[number]["slug"];
  /** Trading stops this many days after seeding. */
  readonly closesInDays: number;
}

export const SEED_MARKETS: readonly SeedMarket[] = [
  {
    slug: "library-open-past-midnight-finals",
    title: "Will the library stay open past midnight during finals week?",
    rules:
      "Resolves YES if the library's posted finals-week hours show it open past 12:00 a.m. on at least one night of the fall finals week. Resolves NO if every night closes at or before midnight. Source: the library hours page.",
    category: "campus-life",
    closesInDays: 21,
  },
  {
    slug: "dining-hall-holiday-menu",
    title: "Will the dining hall post a special holiday menu before Thanksgiving break?",
    rules:
      "Resolves YES if a holiday-themed menu (for example a Thanksgiving meal) is posted on the dining services page or announced by dining services before the first day of Thanksgiving break. Otherwise NO.",
    category: "campus-life",
    closesInDays: 20,
  },
  {
    slug: "spring-schedule-published-early",
    title: "Will the spring course schedule be published by November 15?",
    rules:
      "Resolves YES if the spring course listing is visible to students on the registrar's site by 11:59 p.m. on November 15. A partial listing that includes most departments counts. Otherwise NO. Source: the registrar's site.",
    category: "academics",
    closesInDays: 14,
  },
  {
    slug: "snow-before-december",
    title: "Will Maryville get measurable snow before December 1?",
    rules:
      "Resolves YES if the National Weather Service reports at least 0.1 inch of snowfall in a single day for the Knoxville area (McGhee Tyson Airport) before December 1. A trace does not count. Otherwise NO.",
    category: "weather",
    closesInDays: 30,
  },
  {
    slug: "warm-day-before-thanksgiving",
    title: "Will the high reach 65°F on the Monday before Thanksgiving?",
    rules:
      "Resolves YES if the official high temperature for the Knoxville area (McGhee Tyson Airport) on the Monday before Thanksgiving is 65°F or higher, as reported by the National Weather Service. Otherwise NO.",
    category: "weather",
    closesInDays: 22,
  },
  {
    slug: "events-calendar-busy-week",
    title: "Will the campus events calendar list 10 or more events in the week before finals?",
    rules:
      "Resolves YES if the campus events calendar shows at least 10 events dated Monday through Sunday of the week before finals week. Recurring events count once per date. Otherwise NO. Source: the events calendar, checked the day after that week ends.",
    category: "clubs-events",
    closesInDays: 28,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedResult {
  readonly categoriesSeeded: number;
  readonly marketsCreated: number;
}

/**
 * Upsert the categories and create any seed market that is missing. Existing markets are left
 * alone (`ON CONFLICT DO NOTHING` on `slug`) so re-seeding never resets prices or status.
 */
export async function seedDatabase(db: AnyDb, now: Date = new Date()): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const cats = await tx
      .insert(categories)
      .values([...SEED_CATEGORIES])
      .onConflictDoUpdate({ target: categories.slug, set: { name: sql`excluded.name` } })
      .returning({ id: categories.id, slug: categories.slug });
    const categoryIds = new Map(cats.map((c) => [c.slug, c.id]));

    const created = await tx
      .insert(markets)
      .values(
        SEED_MARKETS.map((m) => ({
          slug: m.slug,
          title: m.title,
          rules: m.rules,
          categoryId: categoryIds.get(m.category) as string,
          status: "open" as const,
          b: 100,
          qYes: "0",
          qNo: "0",
          closeAt: new Date(now.getTime() + m.closesInDays * DAY_MS),
          openedAt: now,
        })),
      )
      .onConflictDoNothing({ target: markets.slug })
      .returning({ id: markets.id });

    return { categoriesSeeded: cats.length, marketsCreated: created.length };
  });
}
