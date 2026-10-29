import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  balances,
  categories,
  HOUSE_ACCOUNT_ID,
  ledgerEntries,
  markets,
  profiles,
  trades,
} from "./schema";
import { MIGRATIONS_FOLDER, openTestDb, pgError, type TestDbHandle } from "./test-db";

// Every test opens its own database (PGlite locally, a throwaway real database in the CI
// `postgres` job), so no test depends on another having run first.

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"));
const userId = "22222222-2222-4222-8222-222222222222";

const handles: TestDbHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
});

async function fresh(): Promise<TestDbHandle> {
  const h = await openTestDb();
  handles.push(h);
  return h;
}

async function addCategory(h: TestDbHandle): Promise<string> {
  const [category] = await h.db
    .insert(categories)
    .values({ slug: "academics", name: "Academics" })
    .returning({ id: categories.id });
  return category?.id ?? "";
}

/** A database holding one user, one market, two ledger rows and one trade. */
async function seeded(): Promise<{ h: TestDbHandle; marketId: string }> {
  const h = await fresh();
  await h.db
    .insert(profiles)
    .values({ id: userId, email: "b@my.maryvillecollege.edu", displayName: "B" });
  const [market] = await h.db
    .insert(markets)
    .values({
      slug: "m",
      title: "M",
      rules: "R",
      categoryId: await addCategory(h),
      closeAt: new Date("2030-01-01T00:00:00Z"),
    })
    .returning({ id: markets.id });
  await h.db.insert(ledgerEntries).values([
    { accountType: "house", accountId: HOUSE_ACCOUNT_ID, deltaPoints: -5, reason: "signup_bonus" },
    { accountType: "user", accountId: userId, deltaPoints: 5, reason: "stipend" },
  ]);
  await h.db.insert(trades).values({
    marketId: market?.id ?? "",
    userId,
    side: "YES",
    contracts: "1",
    costPoints: 50,
    probBefore: 0.5,
    probAfter: 0.51,
    idempotencyKey: "k",
  });
  return { h, marketId: market?.id ?? "" };
}

describe("migrations", () => {
  it("applies every migration listed in the journal", async () => {
    const h = await fresh();
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(await h.rows(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).toEqual([
      { n: journal.entries.length },
    ]);
  });
});

describe("custom migration: RLS and append-only", () => {
  it("enables Row Level Security on every table; the only policies are for mc_app", async () => {
    const h = await fresh();
    const tables = await h.rows<{ relname: string; relrowsecurity: boolean }>(
      sql`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(tables).toHaveLength(11);
    for (const row of tables) {
      expect(row.relrowsecurity, row.relname).toBe(true);
    }
    const roles = await h.rows<{ roles: string }>(
      sql`select distinct array_to_string(roles, ',') as roles from pg_policies where schemaname = 'public'`,
    );
    expect(roles).toEqual([{ roles: "mc_app" }]);
  });

  it.each([
    ["UPDATE", "ledger_entries", sql`update ledger_entries set delta_points = 0`],
    ["DELETE", "ledger_entries", sql`delete from ledger_entries`],
    ["TRUNCATE", "ledger_entries", sql`truncate ledger_entries`],
    ["UPDATE", "trades", sql`update trades set cost_points = 0`],
    ["DELETE", "trades", sql`delete from trades`],
    ["TRUNCATE", "trades", sql`truncate trades`],
  ])(
    "raises on %s of %s, even for the owner role, and changes nothing",
    async (op, table, statement) => {
      const { h } = await seeded();
      const error = await pgError(h.db.execute(statement));
      expect(error.code).toBe("23001");
      expect(error.message).toContain(`${op} on ${table} is not allowed`);
      expect(
        await h.rows(
          sql`select sum(delta_points)::int as s, count(*)::int as n from ledger_entries`,
        ),
      ).toEqual([{ s: 0, n: 2 }]);
      expect(
        await h.rows(sql`select count(*)::int as n, sum(cost_points)::int as c from trades`),
      ).toEqual([{ n: 1, c: 50 }]);
    },
  );

  it("still allows INSERT into both tables", async () => {
    const { h } = await seeded();
    await h.db.insert(ledgerEntries).values([
      { accountType: "house", accountId: HOUSE_ACCOUNT_ID, deltaPoints: -1, reason: "stipend" },
      { accountType: "user", accountId: userId, deltaPoints: 1, reason: "stipend" },
    ]);
    expect(await h.rows(sql`select count(*)::int as n from ledger_entries`)).toEqual([{ n: 4 }]);
  });
});

describe("hardening and trading migrations: indexes, CHECKs, columns", () => {
  // One database for this block: each test reads the catalog or writes rows no other test reads.
  let h: TestDbHandle;
  let categoryId = "";
  beforeAll(async () => {
    h = await openTestDb();
    categoryId = await addCategory(h);
  });
  afterAll(async () => {
    await h.close();
  });

  it.each([
    ["trades", "market_id"],
    ["trades", "user_id, created_at"],
    ["positions", "user_id"],
    ["ledger_entries", "ref_type, ref_id"],
  ])("indexes %s (%s)", async (table, columns) => {
    const defs = await h.rows<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = ${table}`,
    );
    expect(defs.map((d) => d.indexdef).join("\n")).toContain(`USING btree (${columns})`);
  });

  type MarketCase = [
    string,
    "open" | "closed" | "resolved" | "finalized" | "voided",
    "YES" | "NO" | null,
  ];
  it.each<MarketCase>([
    ["rejects", "resolved", null],
    ["rejects", "finalized", null],
    ["rejects", "open", "YES"],
    ["rejects", "closed", "NO"],
    ["rejects", "voided", "YES"],
    ["accepts", "resolved", "YES"],
    ["accepts", "finalized", "YES"],
    ["accepts", "voided", null],
    ["accepts", "open", null],
  ])("%s a %s market with outcome %s", async (verdict, status, outcome) => {
    const insert = h.db.insert(markets).values({
      slug: `${status}-${outcome}`,
      title: "X",
      rules: "R",
      categoryId,
      closeAt: new Date("2030-01-01T00:00:00Z"),
      status,
      outcome,
    });
    if (verdict === "accepts") {
      await insert;
    } else {
      const error = await pgError(insert);
      expect(error.code).toBe("23514");
      expect(error.message).toContain("markets_outcome_matches_status");
    }
  });

  it("rejects a negative cached balance (balances CHECK)", async () => {
    await h.db.insert(profiles).values({ id: userId, email: "n@x.edu", displayName: "N" });
    await h.db.insert(balances).values({ userId, points: 0 });
    const error = await pgError(
      h.db.execute(sql`update balances set points = -1 where user_id = ${userId}`),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toContain("balances_points_nonnegative");
  });

  it("adds a nullable text trades.request_fingerprint", async () => {
    expect(
      await h.rows(
        sql`select data_type, is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'trades' and column_name = 'request_fingerprint'`,
      ),
    ).toEqual([{ data_type: "text", is_nullable: "YES" }]);
  });
});
