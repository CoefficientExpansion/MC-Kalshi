import { eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balances, HOUSE_ACCOUNT_ID, ledgerEntries, profiles } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import {
  checkLedgerInvariants,
  grantSignupBonus,
  LedgerError,
  postTransfer,
  type TransferEntry,
} from "./ledger";

const POOL_ID = "99999999-9999-4999-8999-999999999999";
const user = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const house = (deltaPoints: number) => ({
  accountType: "house" as const,
  accountId: HOUSE_ACCOUNT_ID,
  deltaPoints,
});
const userEntry = (n: number, deltaPoints: number) => ({
  accountType: "user" as const,
  accountId: user(n),
  deltaPoints,
});

describe("ledger", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  async function addUser(n: number) {
    await db
      .insert(profiles)
      .values({ id: user(n), email: `u${n}@my.maryvillecollege.edu`, displayName: `User ${n}` });
  }
  const balanceOf = async (n: number) =>
    (
      await db
        .select()
        .from(balances)
        .where(eq(balances.userId, user(n)))
    ).at(0)?.points;
  const ledgerCount = async () =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries))[0]?.n;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await addUser(n);
    }
  });
  afterAll(async () => {
    await close();
  });

  describe("postTransfer", () => {
    it("inserts balanced entries and updates the balance of every user touched", async () => {
      const before = (await ledgerCount()) ?? 0;
      const rows = await postTransfer(db, {
        entries: [house(-300), userEntry(1, 100), userEntry(2, 200)],
        reason: "stipend",
        refType: "stipend_run",
        refId: POOL_ID,
      });
      expect(rows).toHaveLength(3);
      expect(rows[1]).toMatchObject({
        accountType: "user",
        accountId: user(1),
        deltaPoints: 100,
        reason: "stipend",
        refType: "stipend_run",
        refId: POOL_ID,
      });
      expect(await ledgerCount()).toBe(before + 3);
      expect(await balanceOf(1)).toBe(100);
      expect(await balanceOf(2)).toBe(200);
    });

    it("adds to an existing balance and nets several entries for one user", async () => {
      await postTransfer(db, {
        entries: [
          userEntry(1, -40),
          userEntry(1, -10),
          { accountType: "market_pool", accountId: POOL_ID, deltaPoints: 50 },
        ],
        reason: "trade",
      });
      expect(await balanceOf(1)).toBe(50);
    });

    it("rejects entries that do not sum to zero and writes nothing", async () => {
      const before = await ledgerCount();
      await expect(
        postTransfer(db, { entries: [house(-100), userEntry(3, 99)], reason: "stipend" }),
      ).rejects.toThrow(LedgerError);
      expect(await ledgerCount()).toBe(before);
      expect(await balanceOf(3)).toBeUndefined();
    });

    it.each([
      ["a fractional delta", 1.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["an unsafe integer", 2 ** 53],
    ])("rejects %s and writes nothing", async (_name, bad) => {
      const before = await ledgerCount();
      await expect(
        postTransfer(db, { entries: [house(-bad), userEntry(3, bad)], reason: "stipend" }),
      ).rejects.toThrow(LedgerError);
      expect(await ledgerCount()).toBe(before);
      expect(await balanceOf(3)).toBeUndefined();
    });

    it("rejects a transfer with fewer than two entries", async () => {
      await expect(postTransfer(db, { entries: [], reason: "stipend" })).rejects.toThrow(
        LedgerError,
      );
      await expect(
        postTransfer(db, { entries: [userEntry(3, 0)], reason: "stipend" }),
      ).rejects.toThrow(LedgerError);
    });

    it("rejects a user's net change that is not a safe integer", async () => {
      const max = Number.MAX_SAFE_INTEGER;
      const before = await ledgerCount();
      await expect(
        postTransfer(db, {
          entries: [userEntry(3, max), userEntry(3, max), house(-max), house(-max)],
          reason: "stipend",
        }),
      ).rejects.toThrow(LedgerError);
      expect(await ledgerCount()).toBe(before);
    });

    it("rejects a house entry that is not on the house account", async () => {
      await expect(
        postTransfer(db, {
          entries: [{ accountType: "house", accountId: user(1), deltaPoints: -1 }, userEntry(3, 1)],
          reason: "stipend",
        }),
      ).rejects.toThrow(LedgerError);
    });

    it("writes nothing when a later step fails (unknown user), even outside a transaction", async () => {
      const before = await ledgerCount();
      await expect(
        postTransfer(db, { entries: [house(-5), userEntry(404, 5)], reason: "stipend" }),
      ).rejects.toThrow();
      expect(await ledgerCount()).toBe(before);
    });

    it("rolls back with the caller's transaction", async () => {
      const before = await ledgerCount();
      await expect(
        db.transaction(async (tx) => {
          await postTransfer(tx, { entries: [house(-7), userEntry(4, 7)], reason: "stipend" });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await ledgerCount()).toBe(before);
      expect(await balanceOf(4)).toBeUndefined();
    });
  });

  describe("grantSignupBonus", () => {
    it("credits house to user once; a second call is a no-op", async () => {
      expect(await grantSignupBonus(db, user(5), 10_000)).toBe(true);
      expect(await grantSignupBonus(db, user(5), 10_000)).toBe(false);
      expect(await balanceOf(5)).toBe(10_000);
      const rows = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.reason, "signup_bonus"))
        .orderBy(ledgerEntries.id);
      const mine = rows.filter((r) => r.accountId === user(5) || r.refId === user(5));
      expect(mine.map((r) => [r.accountType, r.deltaPoints])).toEqual([
        ["house", -10_000],
        ["user", 10_000],
      ]);
      expect(mine[0]).toMatchObject({ refType: "profile", refId: user(5) });
    });

    it("does not grant a different amount on a repeat call", async () => {
      await grantSignupBonus(db, user(6), 500);
      await grantSignupBonus(db, user(6), 9_999);
      expect(await balanceOf(6)).toBe(500);
    });

    it.each([0, -5, 1.5, Number.NaN])("rejects %s points", async (points) => {
      await expect(grantSignupBonus(db, user(6), points)).rejects.toThrow(LedgerError);
    });
  });

  describe("checkLedgerInvariants", () => {
    it("reports a zero sum and no mismatches for a consistent ledger", async () => {
      expect(await checkLedgerInvariants(db)).toEqual({ ledgerSum: 0, mismatches: [] });
    });

    it("reports a user whose cached balance drifted from the ledger", async () => {
      await db
        .update(balances)
        .set({ points: 123 })
        .where(eq(balances.userId, user(2)));
      const result = await checkLedgerInvariants(db);
      expect(result.ledgerSum).toBe(0);
      expect(result.mismatches).toEqual([{ userId: user(2), cached: 123, ledger: 200 }]);
      await db
        .update(balances)
        .set({ points: 200 })
        .where(eq(balances.userId, user(2)));
      expect((await checkLedgerInvariants(db)).mismatches).toEqual([]);
    });

    it("reports a non-zero sum and a user with ledger entries but no balance row", async () => {
      const handle = await createTestDb();
      try {
        await handle.db
          .insert(profiles)
          .values({ id: user(1), email: "x@my.maryvillecollege.edu", displayName: "X" });
        await handle.db.insert(ledgerEntries).values({
          accountType: "user",
          accountId: user(1),
          deltaPoints: 9,
          reason: "admin_adjustment",
        });
        expect(await checkLedgerInvariants(handle.db)).toEqual({
          ledgerSum: 9,
          mismatches: [{ userId: user(1), cached: 0, ledger: 9 }],
        });
      } finally {
        await handle.close();
      }
    });

    it("holds after any random sequence of transfers (property)", async () => {
      const handle = await createTestDb();
      const ids = [user(1), user(2), user(3)];
      for (const [i, id] of ids.entries()) {
        await handle.db
          .insert(profiles)
          .values({ id, email: `p${i}@my.maryvillecollege.edu`, displayName: `P${i}` });
      }
      const accounts: Pick<TransferEntry, "accountType" | "accountId">[] = [
        ...ids.map((accountId) => ({ accountType: "user" as const, accountId })),
        { accountType: "market_pool", accountId: POOL_ID },
        { accountType: "house", accountId: HOUSE_ACCOUNT_ID },
      ];
      const account = (index: number) => accounts[index] as (typeof accounts)[number];
      const expected = new Map(ids.map((id) => [id, 0]));
      const leg = fc.record({
        account: fc.integer({ min: 0, max: accounts.length - 1 }),
        delta: fc.integer({ min: -1_000_000, max: 1_000_000 }),
      });
      const transfer = fc.record({
        legs: fc.array(leg, { minLength: 1, maxLength: 5 }),
        balancer: fc.integer({ min: 0, max: accounts.length - 1 }),
        reason: fc.constantFrom("trade", "payout", "void_refund", "admin_adjustment"),
      });
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.array(transfer, { minLength: 1, maxLength: 6 }),
            async (transfers) => {
              for (const t of transfers) {
                const entries: TransferEntry[] = t.legs.map((l) => ({
                  ...account(l.account),
                  deltaPoints: l.delta,
                }));
                const total = entries.reduce((sum, e) => sum + e.deltaPoints, 0);
                entries.push({ ...account(t.balancer), deltaPoints: -total });
                await postTransfer(handle.db, { entries, reason: t.reason });
                for (const e of entries) {
                  if (e.accountType === "user") {
                    expected.set(e.accountId, (expected.get(e.accountId) ?? 0) + e.deltaPoints);
                  }
                }
              }
              const result = await checkLedgerInvariants(handle.db);
              expect(result.ledgerSum).toBe(0);
              expect(result.mismatches).toEqual([]);
            },
          ),
          { numRuns: 25 },
        );
        const cached = await handle.db.select().from(balances);
        for (const row of cached) {
          expect(row.points).toBe(expected.get(row.userId));
        }
      } finally {
        await handle.close();
      }
    });
  });
});
