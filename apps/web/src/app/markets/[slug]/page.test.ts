import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { categories, markets } from "@/db/schema";
import { SEED_MARKETS, seedDatabase } from "@/db/seed";
import { createTestDb, type TestDb } from "@/db/test-db";
import { copyViolations, visibleText } from "@/lib/copy-guard";
import MarketPage, { generateMetadata } from "./page";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ getDb: () => holder.db }));

type Props = Parameters<typeof MarketPage>[0];
const props = (slug: string) => ({ params: Promise.resolve({ slug }) }) as Props;
const render = async (slug: string) => renderToStaticMarkup(await MarketPage(props(slug)));

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
    holder.db = db;
  });
  afterAll(() => close());

  it("shows the not-configured state when there is no database", async () => {
    holder.db = undefined;
    const html = await render(open.slug);
    holder.db = db;
    expect(html).toContain("Markets are not connected yet");
  });

  it("renders title, rules, category, prices, dates, status and the disabled ticket", async () => {
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
    expect(text).toContain("Trading opens soon");
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
    expect(html).not.toMatch(/<form/);
  });

  it("shows a settled market's outcome, source and resolution date, and closed ticket copy", async () => {
    const text = visibleText(await render("settled-yes"));
    expect(text).toContain("Resolved YES");
    expect(text).toContain("The campus calendar");
    expect(text).toMatch(/Resolved [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(text).toContain("Trading is closed for this market.");
    expect(text).not.toContain("Trading opens soon");
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
