import { displayPrice, probabilityYes } from "@mc-kalshi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categories, markets, profiles } from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import { grantSignupBonus } from "./ledger";
import { loadMarketState } from "./market-state";
import { placeTrade } from "./trading";

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const closeAt = new Date("2030-01-01T12:00:00.000Z");

let h: TestDbHandle;
const ids: Record<string, string> = {};

beforeAll(async () => {
  h = await openTestDb();
  const [category] = await h.db
    .insert(categories)
    .values({ slug: "c", name: "C" })
    .returning({ id: categories.id });
  for (const id of [U1, U2]) {
    await h.db
      .insert(profiles)
      .values({ id, email: `${id.slice(-1)}@my.maryvillecollege.edu`, displayName: "U" });
  }
  await grantSignupBonus(h.db, U1, 10_000);
  for (const status of ["open", "proposed", "rejected", "closed"] as const) {
    const [m] = await h.db
      .insert(markets)
      .values({
        slug: status,
        title: status,
        rules: "R",
        categoryId: category?.id ?? "",
        status,
        b: 120,
        closeAt,
      })
      .returning({ id: markets.id });
    ids[status] = m?.id ?? "";
  }
  const traded = await placeTrade(
    h.db,
    U1,
    {
      marketId: ids.open,
      side: "YES",
      mode: "buy_points",
      amount: 500,
      expectedAvgPrice: 51,
      idempotencyKey: "market-state-key-1",
    },
    { tradingPaused: false },
  );
  if (!traded.ok) throw new Error(traded.code);
});
afterAll(() => h.close());

describe("loadMarketState", () => {
  it("returns the public state for a signed-out visitor", async () => {
    const state = await loadMarketState(h.db, ids.open as string, null);
    expect(state).not.toBeNull();
    if (!state) return;
    const p = probabilityYes({ b: 120, qYes: state.qYes, qNo: 0 });
    expect(state).toEqual({
      status: "open",
      closeAt: closeAt.toISOString(),
      b: 120,
      qYes: state.qYes,
      qNo: 0,
      probabilityYes: p,
      displayPrice: displayPrice(p),
    });
    expect(state.qYes).toBeGreaterThan(0);
    expect("balance" in state).toBe(false);
  });

  it("adds the member's balance and position when signed in", async () => {
    const state = await loadMarketState(h.db, ids.open as string, U1);
    expect(state).toMatchObject({
      balance: 9_500,
      position: { contractsYes: state?.qYes, contractsNo: 0, costBasisPoints: 500 },
    });
  });

  it("gives a member with no balance row or position zero and an empty position", async () => {
    expect(await loadMarketState(h.db, ids.open as string, U2)).toMatchObject({
      balance: 0,
      position: { contractsYes: 0, contractsNo: 0, costBasisPoints: 0 },
    });
  });

  it("serves closed markets", async () => {
    expect(await loadMarketState(h.db, ids.closed as string, null)).toMatchObject({
      status: "closed",
    });
  });

  it.each(["proposed", "rejected"])("hides %s markets", async (status) => {
    expect(await loadMarketState(h.db, ids[status] as string, U1)).toBeNull();
  });

  it.each(["11111111-1111-4111-8111-111111111111", "not-a-uuid", ""])(
    "returns null for the unknown id %j",
    async (id) => {
      expect(await loadMarketState(h.db, id, null)).toBeNull();
    },
  );
});
