import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markets, profiles } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { createTestDb, type TestDb } from "@/db/test-db";
import { copyViolations, visibleText } from "@/lib/copy-guard";
import { grantSignupBonus } from "@/server/ledger";
import { placeTrade } from "@/server/trading";
import PortfolioPage from "./page";

const holder = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as { userId: string; suspended: boolean } | null,
}));
vi.mock("@/db", () => ({ getDb: () => holder.db }));
vi.mock("@/server/auth", () => ({ getSessionMember: async () => holder.session }));

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const render = async () => renderToStaticMarkup(await PortfolioPage());

describe("/portfolio", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedDatabase(db, new Date());
    for (const id of [U1, U2]) {
      await db
        .insert(profiles)
        .values({ id, email: `${id.slice(-1)}@my.maryvillecollege.edu`, displayName: "U" });
      await grantSignupBonus(db, id, 10_000);
    }
    const [m] = await db.select().from(markets).limit(1);
    if (!m) throw new Error("no seeded market");
    const r = await placeTrade(
      db,
      U1,
      {
        marketId: m.id,
        side: "YES",
        mode: "buy_points",
        amount: 500,
        expectedAvgPrice: 51,
        idempotencyKey: "portfolio-page-key-01",
      },
      { tradingPaused: false, rateLimit: async () => null },
    );
    if (!r.ok) throw new Error(r.code);
    holder.db = db;
  });
  afterAll(() => close());
  beforeEach(() => {
    holder.db = db;
    holder.session = null;
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    await expect(PortfolioPage()).rejects.toMatchObject({
      digest: expect.stringContaining("/sign-in"),
    });
  });

  it("sends everyone to sign-in when there is no database", async () => {
    holder.db = undefined;
    holder.session = { userId: U1, suspended: false };
    await expect(PortfolioPage()).rejects.toMatchObject({
      digest: expect.stringContaining("/sign-in"),
    });
  });

  it("shows the balance, totals, one row per position and the trades", async () => {
    holder.session = { userId: U1, suspended: false };
    const html = await render();
    const text = visibleText(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain("Balance 9,500 pts");
    // 9.761859 YES at 52 = about 508.
    expect(text).toContain("Open positions about 508 pts");
    expect(text).toContain("Total about 10,008 pts");
    expect(html.match(/<tr class="border-t/g)).toHaveLength(2);
    expect(html).toMatch(/href="\/markets\/[a-z0-9-]+"/);
    expect(text).toContain("9.76");
    expect(text).toContain("976 pts");
    expect(text).toContain("+8 pts");
    expect(text).toContain("Buy YES");
    expect(text).toContain("paid 500 pts");
    expect(text).toContain("51 pts");
    expect(text).toMatch(/\bOpen\b|Closes soon/);
    expect(copyViolations(text)).toEqual([]);
  });

  it("is empty but useful for a member who never traded", async () => {
    holder.session = { userId: U2, suspended: false };
    const text = visibleText(await render());
    expect(text).toContain("Balance 10,000 pts");
    expect(text).toContain("You hold no contracts yet.");
    expect(text).toContain("No trades yet.");
  });

  it("shows the unavailable notice, with one <h1>, when loading fails", async () => {
    holder.session = { userId: U1, suspended: false };
    holder.db = {
      select: () => {
        throw new Error("postgres://secret@host");
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    expect(html).toContain("Your portfolio is unavailable right now");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(String(log.mock.calls[0]?.[0])).not.toContain("secret");
    log.mockRestore();
  });
});
