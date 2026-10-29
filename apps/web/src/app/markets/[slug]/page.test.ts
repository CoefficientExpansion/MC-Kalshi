import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { categories, markets, profiles } from "@/db/schema";
import { SEED_MARKETS, seedDatabase } from "@/db/seed";
import { createTestDb, type TestDb } from "@/db/test-db";
import { copyViolations, visibleText } from "@/lib/copy-guard";
import { grantSignupBonus } from "@/server/ledger";
import { placeTrade } from "@/server/trading";
import MarketPage, { generateMetadata } from "./page";

const holder = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as { userId: string; suspended: boolean } | null,
}));
vi.mock("@/db", () => ({ getDbChecked: async () => holder.db }));
vi.mock("@/server/auth", () => ({ getSessionMember: async () => holder.session }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {} }),
}));

const U1 = "00000000-0000-4000-8000-000000000001";
type Props = Parameters<typeof MarketPage>[0];
const props = (slug: string, range?: string) =>
  ({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(range ? { range } : {}),
  }) as Props;
const render = async (slug: string, range?: string) =>
  renderToStaticMarkup(await MarketPage(props(slug, range)));

describe("market detail page", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  const open = {
    slug: "snow-before-december",
    title: "Will Maryville get measurable snow before December 1?",
    rules: SEED_MARKETS.find((m) => m.slug === "snow-before-december")?.rules ?? "",
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedDatabase(db, new Date());
    const [category] = await db.select().from(categories).limit(1);
    if (!category) throw new Error("seed produced no categories");
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db.insert(markets).values([
      {
        slug: "draft-idea",
        title: "A moderator draft",
        rules: "Draft.",
        categoryId: category.id,
        status: "proposed",
        closeAt: new Date(Date.now() + 86_400_000),
      },
      {
        slug: "settled-yes",
        title: "Did the bell ring?",
        rules: "Resolves YES if it rang.\nOtherwise NO.",
        categoryId: category.id,
        status: "resolved",
        outcome: "YES",
        qYes: "100",
        qNo: "0",
        closeAt: past,
        resolveBy: new Date(Date.now() + 86_400_000),
        resolvedAt: past,
        resolutionSource: "The campus calendar",
      },
    ]);
    await db
      .insert(profiles)
      .values({ id: U1, email: "a@my.maryvillecollege.edu", displayName: "A" });
    await grantSignupBonus(db, U1, 10_000);
    holder.db = db;
  });
  afterAll(() => close());
  beforeEach(() => {
    holder.session = null;
  });

  it("shows the not-configured state when there is no database", async () => {
    holder.db = undefined;
    const html = await render(open.slug);
    holder.db = db;
    expect(html).toContain("Markets are not connected yet");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("shows the unavailable state, with one <h1>, when the query fails", async () => {
    holder.db = {
      select: () => {
        throw new Error("connection refused");
      },
    };
    const html = await render(open.slug);
    holder.db = db;
    expect(html).toContain("This market is unavailable right now");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("renders title, rules, category, prices, dates, status, the chart and the signed-out ticket", async () => {
    const html = await render(open.slug);
    const text = visibleText(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain(open.title);
    expect(text).toContain(open.rules);
    expect(text).toContain("Weather");
    expect(text).toContain("50% chance");
    expect(text).toContain("YES 50 pts");
    expect(text).toContain("NO 50 pts");
    expect(text).toMatch(/Trading closes [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(text).toMatch(/Resolves by Not set yet/);
    expect(text).toMatch(/\bOpen\b/);
    expect(text).toContain("Sign in to trade");
    expect(html).toContain('href="/sign-in"');
    expect(text).toContain("Price history");
    expect(text).toContain("No trades yet");
    expect(html).toMatch(/aria-current="page"[^>]*>1W</);
    expect(text).not.toContain("Your position");
  });

  it("wires the ticket, chart and position card for a signed-in member with a trade", async () => {
    const detail = await db.select().from(markets);
    const m = detail.find((r) => r.slug === "dining-hall-holiday-menu");
    if (!m) throw new Error("no seeded market");
    const traded = await placeTrade(
      db,
      U1,
      {
        marketId: m.id,
        side: "YES",
        mode: "buy_points",
        amount: 500,
        expectedAvgPrice: 51,
        idempotencyKey: "market-page-test-key-1",
      },
      { tradingPaused: false, rateLimit: async () => null },
    );
    if (!traded.ok) throw new Error(traded.code);
    holder.session = { userId: U1, suspended: false };
    const html = await render(m.slug, "ALL");
    const text = visibleText(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain("Your position");
    expect(text).toContain("YES 9.76 contracts");
    expect(text).toContain("Pays 976 pts if YES");
    expect(text).toContain("Cost basis 500 pts");
    expect(text).toContain("9,500");
    expect(text).not.toContain("Sign in to trade");
    expect(html).toMatch(
      /<svg role="img" aria-label="YES chance rose from 50% to \d+% since trading opened"/,
    );
    expect(html).toMatch(/aria-current="page"[^>]*>ALL</);
    expect(copyViolations(text)).toEqual([]);

    holder.session = { userId: U1, suspended: true };
    const suspended = visibleText(await render(m.slug));
    expect(suspended).toMatch(/Your account can(&#x27;|')t trade right now/);
    expect(suspended).toContain("Your position");
  });

  it("shows a settled market's outcome, source and resolution date, and closed ticket copy", async () => {
    const text = visibleText(await render("settled-yes"));
    expect(text).toContain("Resolved YES");
    expect(text).toContain("The campus calendar");
    expect(text).toMatch(/Resolved [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(text).toContain("Trading is closed");
    expect(text).toContain("Last YES price");
  });

  it("returns Next's not-found for an unknown slug and for a proposed market", async () => {
    for (const slug of ["no-such-market", "draft-idea"]) {
      await expect(MarketPage(props(slug))).rejects.toMatchObject({
        digest: expect.stringContaining("404"),
      });
    }
  });

  it("titles the page after the market", async () => {
    expect(await generateMetadata(props(open.slug))).toEqual({ title: open.title });
    expect(await generateMetadata(props("no-such-market"))).toEqual({ title: "Market" });
  });

  it("never says bet, $, or cash out", async () => {
    for (const slug of [open.slug, "settled-yes", ...SEED_MARKETS.map((m) => m.slug)]) {
      expect(copyViolations(visibleText(await render(slug)))).toEqual([]);
    }
    holder.db = undefined;
    expect(copyViolations(visibleText(await render("x")))).toEqual([]);
    holder.db = db;
  });
});
