import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLedgerInvariants, grantSignupBonus, postTransfer } from "@/server/ledger";
import * as schema from "./schema";
import { balances, ledgerEntries, profiles } from "./schema";
import { openTestDb, type TestDbHandle } from "./test-db";

// Concurrency on a real server (PGlite has one connection, so it cannot race). Skipped unless
// TEST_DATABASE_URL is set, as in the CI `postgres` job; openTestDb creates and drops a
// throwaway database for this file.

const user = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("real Postgres: concurrent ledger writes", () => {
  let h: TestDbHandle;
  const clients: postgres.Sql[] = [];
  /** A Drizzle client on its own connection pool to the test database. */
  const connect = (max: number) => {
    const client = postgres(h.url as string, { max, onnotice: () => {} });
    clients.push(client);
    return drizzle(client, { schema });
  };

  beforeAll(async () => {
    h = await openTestDb();
    await h.db.insert(profiles).values(
      Array.from({ length: 30 }, (_, i) => ({
        id: user(i),
        email: `c${i}@my.maryvillecollege.edu`,
        displayName: `C${i}`,
      })),
    );
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end({ timeout: 5 })));
    await h?.close();
  });

  const userBonusRows = async (id: string) =>
    (await h.db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, id))).filter(
      (r) => r.reason === "signup_bonus",
    );

  it("concurrent grantSignupBonus calls for one user on two connections credit exactly once", async () => {
    const a = connect(1);
    const b = connect(1);
    for (let i = 0; i < 10; i += 1) {
      const results = await Promise.all([
        grantSignupBonus(a, user(i), 100),
        grantSignupBonus(b, user(i), 100),
      ]);
      expect(results.sort()).toEqual([false, true]);
      expect(await userBonusRows(user(i))).toHaveLength(1);
    }
    expect(await checkLedgerInvariants(h.db)).toEqual({ ledgerSum: 0, mismatches: [] });
  });

  it("two grants queued behind a held balances lock still credit exactly once", async () => {
    const id = user(10);
    await h.db.insert(balances).values({ userId: id, points: 0 });
    const holder = postgres(h.url as string, { max: 1, onnotice: () => {} });
    clients.push(holder);
    let release!: () => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    let locked!: () => void;
    const lockedSignal = new Promise<void>((r) => {
      locked = r;
    });
    const holding = holder.begin(async (tx) => {
      await tx`select user_id from balances where user_id = ${id} for update`;
      locked();
      await released;
    });
    await lockedSignal;
    const grants = Promise.all([
      grantSignupBonus(connect(1), id, 250),
      grantSignupBonus(connect(1), id, 250),
    ]);
    await new Promise((r) => setTimeout(r, 300)); // both are now waiting on the lock
    release();
    await holding;
    expect((await grants).sort()).toEqual([false, true]);
    expect(await userBonusRows(id)).toHaveLength(1);
    const [row] = await h.db.select().from(balances).where(eq(balances.userId, id));
    expect(row?.points).toBe(250);
    expect(await checkLedgerInvariants(h.db)).toEqual({ ledgerSum: 0, mismatches: [] });
  });

  it("parallel postTransfers between two users in opposite order neither deadlock nor break the ledger", async () => {
    const [A, B] = [user(20), user(21)];
    await grantSignupBonus(h.db, A, 10_000);
    await grantSignupBonus(h.db, B, 10_000);
    const pool = connect(10);
    const N = 40;
    const expected = { [A]: 10_000, [B]: 10_000 };
    const transfers = Array.from({ length: N }, (_, i) => {
      const amount = i + 1;
      // Alternate direction and the order the entries are listed in.
      const [from, to] = i % 2 === 0 ? [A, B] : [B, A];
      expected[from] = (expected[from] ?? 0) - amount;
      expected[to] = (expected[to] ?? 0) + amount;
      return postTransfer(pool, {
        entries: [
          { accountType: "user", accountId: from, deltaPoints: -amount },
          { accountType: "user", accountId: to, deltaPoints: amount },
        ],
        reason: "admin_adjustment",
      });
    });
    const settled = await Promise.allSettled(transfers);
    expect(settled.filter((s) => s.status === "rejected")).toEqual([]);

    expect(await checkLedgerInvariants(h.db)).toEqual({ ledgerSum: 0, mismatches: [] });
    const [sum] = await h.rows<{ s: number }>(
      sql`select coalesce(sum(delta_points), 0)::int as s from ledger_entries`,
    );
    expect(sum?.s).toBe(0);
    for (const id of [A, B]) {
      const [row] = await h.db.select().from(balances).where(eq(balances.userId, id));
      expect(row?.points, id).toBe(expected[id]);
    }
  });
});
