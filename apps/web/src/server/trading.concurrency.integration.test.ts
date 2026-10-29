import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { balances, categories, markets, profiles, trades } from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { checkTradingInvariants } from "./invariants";
import { grantSignupBonus } from "./ledger";
import type { TradeResult, TradeSuccess } from "./trade-types";
import { type PlaceTradeOptions, placeTrade } from "./trading";

// placeTrade under real concurrency (docs/specs/m3-trading.md, "Concurrency (real Postgres)").
// PGlite has one connection, so these run only when TEST_DATABASE_URL is set (the CI `postgres`
// job). The file gets its own throwaway database from openTestDb; every placeTrade call runs on
// its own postgres.js client. Races are forced, not hoped for: an outside transaction holds a row
// lock and the test polls pg_stat_activity until the expected backends are waiting on it, then
// releases. Every wait is bounded, and each connection has a lock_timeout, so a deadlock or a
// lost wake-up fails fast instead of hanging CI.

const HAS_PG = Boolean(process.env.TEST_DATABASE_URL);
if (!HAS_PG) {
  console.info(
    "trading.concurrency.integration.test.ts skipped: set TEST_DATABASE_URL to a Postgres server",
  );
}

const DAY = 86_400_000;
const WAIT_MS = 10_000;
const TEST_MS = 30_000;
const NO_LIMIT: PlaceTradeOptions = { tradingPaused: false, rateLimit: async () => null };

const user = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;
const key = (label: string) => `conc-${label}`.padEnd(16, "0");

/** Rejects after `ms` so a hung race fails the test with a reason. */
async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls `check` every 20 ms until it is true; throws after `ms`. */
async function until(check: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function ok(result: TradeResult): TradeSuccess {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

describe.skipIf(!HAS_PG)("real Postgres: concurrent placeTrade", () => {
  let h: TestDbHandle;
  let categoryId = "";
  const clients: postgres.Sql[] = [];
  let appSeq = 0;

  /** A new postgres.js client (pool of `max`) tagged with a unique application_name. */
  const client = (max = 1) => {
    appSeq += 1;
    const app = `mck_conc_${appSeq}`;
    const sqlClient = postgres(h.url as string, {
      max,
      onnotice: () => {},
      connection: { application_name: app, lock_timeout: 15_000 },
    });
    clients.push(sqlClient);
    return { app, sql: sqlClient, db: drizzle(sqlClient, { schema }) as AnyDb };
  };

  /** Backends of `app` in this database that are waiting on a lock. */
  const lockWaiters = async (app: string) => {
    const [row] = await h.rows<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database() and application_name = ${app}
            and wait_event_type = 'Lock'`,
    );
    return row?.n ?? 0;
  };

  /**
   * Holds `select … for update` on one row in an outside transaction until `release()`.
   * `release` is idempotent; `done` settles when the holder's transaction has ended.
   */
  const holdLock = async (table: "markets" | "balances", id: string) => {
    const holder = client(1);
    let release!: () => void;
    const released = new Promise<void>((r) => {
      release = r;
    });
    let locked!: () => void;
    const lockedSignal = new Promise<void>((r) => {
      locked = r;
    });
    const done = holder.sql.begin(async (tx) => {
      if (table === "markets") await tx`select id from markets where id = ${id} for update`;
      else await tx`select user_id from balances where user_id = ${id} for update`;
      locked();
      await released;
    });
    await within(Promise.race([lockedSignal, done]), WAIT_MS, `lock on ${table}`);
    return { release, done };
  };

  /** Runs `work` while the row is locked; the lock is always released, even on failure. */
  const whileLocked = async <T>(
    table: "markets" | "balances",
    id: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    const lock = await holdLock(table, id);
    try {
      return await work();
    } finally {
      lock.release();
      await within(lock.done, WAIT_MS, "lock holder to commit");
    }
  };

  const addUser = async (n: number, bonus = 10_000) => {
    await h.db.insert(profiles).values({
      id: user(n),
      email: `conc${n}@my.maryvillecollege.edu`,
      displayName: `Conc ${n}`,
    });
    if (bonus > 0) await grantSignupBonus(h.db, user(n), bonus);
    return user(n);
  };

  const addMarket = async (b = 500) => {
    const [row] = await h.db
      .insert(markets)
      .values({
        slug: `conc-${Math.random().toString(36).slice(2)}`,
        title: "Will it rain on the quad?",
        rules: "Resolves YES if it rains.",
        categoryId,
        b,
        status: "open",
        closeAt: new Date(Date.now() + DAY),
        openedAt: new Date(),
      })
      .returning({ id: markets.id });
    if (!row) throw new Error("no market");
    return row.id;
  };

  const buy = (marketId: string, idempotencyKey: string, patch: Record<string, unknown> = {}) => ({
    marketId,
    side: "YES",
    mode: "buy_points",
    amount: 50,
    expectedAvgPrice: 50,
    maxSlippage: 10,
    idempotencyKey,
    ...patch,
  });

  const tradesOf = (userId: string) => h.db.select().from(trades).where(eq(trades.userId, userId));

  const expectInvariants = async () => {
    const inv = await checkTradingInvariants(h.db);
    expect(inv.issues).toEqual([]);
    expect(inv.balanceMismatches).toEqual([]);
    expect(inv.ledgerSum).toBe(0);
    expect(inv.ok).toBe(true);
  };

  beforeAll(async () => {
    h = await openTestDb();
    expect(h.backend).toBe("postgres");
    const [category] = await h.db
      .insert(categories)
      .values({ slug: "campus", name: "Campus" })
      .returning({ id: categories.id });
    if (!category) throw new Error("no category");
    categoryId = category.id;
  }, TEST_MS);

  afterAll(async () => {
    await Promise.allSettled(clients.map((c) => c.end({ timeout: 5 })));
    await h?.close();
  }, TEST_MS);

  it(
    "two parallel trades on one market both succeed and chain prob_before to prob_after",
    async () => {
      const [u1, u2] = [await addUser(1), await addUser(2)];
      const marketId = await addMarket();
      const [a, b] = [client(), client()];
      const results = await within(
        Promise.all([
          placeTrade(a.db, u1, buy(marketId, key("two-a")), NO_LIMIT),
          placeTrade(b.db, u2, buy(marketId, key("two-b")), NO_LIMIT),
        ]),
        WAIT_MS,
        "two parallel trades",
      );
      const [x, y] = results.map(ok);
      if (!x || !y) throw new Error("missing result");
      expect(x.replayed || y.replayed).toBe(false);
      // Whichever ran first started from the opening price; the other started where it ended.
      const [first, second] = x.trade.probBefore === 0.5 ? [x, y] : [y, x];
      expect(first.trade.probBefore).toBe(0.5);
      expect(second.trade.probBefore).toBe(first.trade.probAfter);
      const rows = await h.db.select().from(trades).where(eq(trades.marketId, marketId));
      expect(rows).toHaveLength(2);
      await expectInvariants();
    },
    TEST_MS,
  );

  it(
    "lock witness: placeTrade waits on a held market row lock, then completes",
    async () => {
      const u = await addUser(3);
      const marketId = await addMarket();
      const c = client();
      const result = await whileLocked("markets", marketId, async () => {
        let settled = false;
        const pending = placeTrade(c.db, u, buy(marketId, key("witness")), NO_LIMIT).finally(() => {
          settled = true;
        });
        await until(async () => (await lockWaiters(c.app)) === 1, WAIT_MS, "a Lock wait");
        expect(settled).toBe(false);
        return { pending }; // wrapped: returning the bare promise would await it under the lock
      });
      const done = ok(await within(result.pending, WAIT_MS, "placeTrade after release"));
      expect(done.replayed).toBe(false);
      expect(await tradesOf(u)).toHaveLength(1);
      await expectInvariants();
    },
    TEST_MS,
  );

  it(
    "one user, two markets, balance for one: exactly one succeeds, never negative",
    async () => {
      const u = await addUser(4, 150);
      const [m1, m2] = [await addMarket(), await addMarket()];
      const [a, b] = [client(), client()];
      // Hold the user's balance row so both trades lock their markets and queue on it.
      const pending = await whileLocked("balances", u, async () => {
        const both = Promise.all([
          placeTrade(a.db, u, buy(m1, key("bal-1"), { amount: 100 }), NO_LIMIT),
          placeTrade(b.db, u, buy(m2, key("bal-2"), { amount: 100 }), NO_LIMIT),
        ]);
        await until(
          async () => (await lockWaiters(a.app)) + (await lockWaiters(b.app)) === 2,
          WAIT_MS,
          "both trades to wait on the balance",
        );
        return { both };
      });
      const results = await within(pending.both, WAIT_MS, "both trades after release");
      const wins = results.filter((r) => r.ok);
      const losses = results.filter((r) => !r.ok);
      expect(wins).toHaveLength(1);
      expect(losses.map((r) => (r.ok ? "ok" : r.code))).toEqual(["insufficient_balance"]);
      const [row] = await h.db.select().from(balances).where(eq(balances.userId, u));
      expect(row?.points).toBeGreaterThanOrEqual(0);
      expect(row?.points).toBe(150 - (wins[0] as TradeSuccess).trade.costPoints);
      expect(await tradesOf(u)).toHaveLength(1);
      await expectInvariants();
    },
    TEST_MS,
  );

  it(
    "the same key sent 5 times in parallel books one trade and every call returns it",
    async () => {
      const u = await addUser(5);
      const marketId = await addMarket();
      const input = buy(marketId, key("five"));
      const results = await within(
        Promise.all(Array.from({ length: 5 }, () => placeTrade(client().db, u, input, NO_LIMIT))),
        WAIT_MS,
        "five calls with one key",
      );
      const all = results.map(ok);
      const rows = await tradesOf(u);
      expect(rows).toHaveLength(1);
      expect(new Set(all.map((r) => r.trade.id))).toEqual(new Set([rows[0]?.id]));
      expect(all.filter((r) => !r.replayed)).toHaveLength(1);
      expect(all.filter((r) => r.replayed)).toHaveLength(4);
      await expectInvariants();
    },
    TEST_MS,
  );

  it.each([
    { label: "same input", patch: {}, expected: "replayed" },
    { label: "different input", patch: { amount: 60 }, expected: "idempotency_key_reused" },
  ] as const)(
    "one key, one market, both queued on its lock past the pre-check (step 3): $label",
    async ({ label, patch, expected }) => {
      const u = await addUser(label === "same input" ? 6 : 7);
      const marketId = await addMarket();
      const [a, b] = [client(), client()];
      const k = key(`step3-${label.replace(" ", "-")}`);
      const pending = await whileLocked("markets", marketId, async () => {
        const both = Promise.all([
          placeTrade(a.db, u, buy(marketId, k), NO_LIMIT),
          placeTrade(b.db, u, buy(marketId, k, patch), NO_LIMIT),
        ]);
        await until(
          async () => (await lockWaiters(a.app)) + (await lockWaiters(b.app)) === 2,
          WAIT_MS,
          "both calls to wait on the market lock",
        );
        return { both };
      });
      const results = await within(pending.both, WAIT_MS, "both calls after release");
      const rows = await tradesOf(u);
      expect(rows).toHaveLength(1);
      const fresh = results.filter((r) => r.ok && !r.replayed);
      expect(fresh).toHaveLength(1);
      const other = results.find((r) => r !== fresh[0]);
      if (expected === "replayed") {
        const replay = ok(other as TradeResult);
        expect(replay.replayed).toBe(true);
        expect(replay.trade.id).toBe(rows[0]?.id);
      } else {
        expect(other?.ok ? "ok" : other?.code).toBe("idempotency_key_reused");
      }
      await expectInvariants();
    },
    TEST_MS,
  );

  it(
    "one key for two markets at once, both past their market locks: the loser hits the unique key (step 8)",
    async () => {
      const u = await addUser(8);
      const [m1, m2] = [await addMarket(), await addMarket()];
      const [a, b] = [client(), client()];
      const k = key("step8");
      // Hold the balance row: each call then holds its own market lock and queues on the balance,
      // so the loser reaches the trades insert while the winner's row is already committed.
      const pending = await whileLocked("balances", u, async () => {
        const both = Promise.all([
          placeTrade(a.db, u, buy(m1, k), NO_LIMIT),
          placeTrade(b.db, u, buy(m2, k), NO_LIMIT),
        ]);
        await until(
          async () => (await lockWaiters(a.app)) + (await lockWaiters(b.app)) === 2,
          WAIT_MS,
          "both calls to wait on the balance",
        );
        return { both };
      });
      const results = await within(pending.both, WAIT_MS, "both calls after release");
      const rows = await tradesOf(u);
      expect(rows).toHaveLength(1);
      const winner = results.filter((r) => r.ok);
      expect(winner).toHaveLength(1);
      expect((winner[0] as TradeSuccess).replayed).toBe(false);
      expect((winner[0] as TradeSuccess).trade.id).toBe(rows[0]?.id);
      // The fingerprint includes the market, so the same key on another market never matches:
      // the loser is told the key was reused, and its market is untouched.
      const loser = results.find((r) => !r.ok);
      expect(loser?.ok ? "ok" : loser?.code).toBe("idempotency_key_reused");
      const loserMarket = rows[0]?.marketId === m1 ? m2 : m1;
      const [untouched] = await h.db
        .select({ qYes: markets.qYes, qNo: markets.qNo })
        .from(markets)
        .where(eq(markets.id, loserMarket));
      expect(Number(untouched?.qYes)).toBe(0);
      expect(Number(untouched?.qNo)).toBe(0);
      await expectInvariants();
    },
    TEST_MS,
  );

  it(
    "20 mixed trades from 5 users on 2 markets in parallel settle without deadlock",
    async () => {
      const users: string[] = [];
      for (let n = 10; n < 15; n += 1) users.push(await addUser(n));
      const ms = [await addMarket(), await addMarket()];
      // Every user first holds some YES on both markets, so the mix can include sells.
      for (const [i, u] of users.entries()) {
        for (const [j, m] of ms.entries()) {
          ok(await placeTrade(h.db, u, buy(m, key(`seed-${i}-${j}`), { amount: 10 }), NO_LIMIT));
        }
      }
      const pool = client(10);
      const kinds = [
        { side: "YES", mode: "buy_points", amount: 10, expectedAvgPrice: 55 },
        { side: "NO", mode: "buy_points", amount: 10, expectedAvgPrice: 45 },
        { side: "YES", mode: "sell_contracts", amount: 2, expectedAvgPrice: 55 },
        { side: "NO", mode: "buy_points", amount: 10, expectedAvgPrice: 45 },
      ];
      const calls = Array.from({ length: 20 }, (_, k) => {
        const u = users[k % 5] as string;
        const m = ms[Math.floor(k / 5) % 2] as string;
        return placeTrade(pool.db, u, buy(m, key(`mix-${k}`), kinds[k % 4]), NO_LIMIT);
      });
      const results = await within(Promise.all(calls), 20_000, "20 mixed trades");
      expect(results.filter((r) => !r.ok)).toEqual([]);
      for (const u of users) {
        const [row] = await h.db.select().from(balances).where(eq(balances.userId, u));
        expect(row?.points).toBeGreaterThanOrEqual(0);
      }
      const rows = await h.db
        .select({ id: trades.id })
        .from(trades)
        .where(sql`${trades.idempotencyKey} like 'conc-mix-%'`);
      expect(rows).toHaveLength(20);
      await expectInvariants();
      const [sum] = await h.rows<{ s: number }>(
        sql`select coalesce(sum(delta_points), 0)::int as s from ledger_entries`,
      );
      expect(sum?.s).toBe(0);
    },
    TEST_MS,
  );
});
