import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLedgerInvariants, grantSignupBonus, postTransfer } from "@/server/ledger";
import { categories, HOUSE_ACCOUNT_ID, markets, profiles, trades } from "./schema";
import { attemptAs, ensureRole, openTestDb, type TestDbHandle } from "./test-db";
import type { AnyDb } from "./types";

// Who may do what in the database (docs/adr/0006-app-database-role.md). Runs on PGlite locally
// and on a throwaway real database in the CI `postgres` job. Every statement run as a restricted
// role sits in a transaction that is always rolled back (`attemptAs`), so the tests sharing a
// database cannot affect one another. Roles are cluster-wide on a real server, so the Supabase
// roles are created only if missing and never dropped.

const PUBLIC_TABLES = [
  "audit_log",
  "balances",
  "categories",
  "disputes",
  "ledger_entries",
  "markets",
  "positions",
  "price_snapshots",
  "profiles",
  "settings",
  "trades",
] as const;
/** Tables no server code reads yet (src/server/*.ts), so mc_app has no grant on them. */
const UNREAD_TABLES: readonly string[] = ["audit_log", "disputes", "settings"];

const userA = "33333333-3333-4333-8333-333333333333";
const userB = "33333333-3333-4333-8333-444444444444";

/** One member with a signup bonus, one without, one market and one trade. */
async function seed(db: AnyDb): Promise<string> {
  await db.insert(profiles).values([
    { id: userA, email: "a@my.maryvillecollege.edu", displayName: "A" },
    { id: userB, email: "b@my.maryvillecollege.edu", displayName: "B" },
  ]);
  const [category] = await db
    .insert(categories)
    .values({ slug: "c", name: "C" })
    .returning({ id: categories.id });
  const [market] = await db
    .insert(markets)
    .values({
      slug: "m",
      title: "M",
      rules: "R",
      categoryId: category?.id ?? "",
      closeAt: new Date("2030-01-01T00:00:00Z"),
    })
    .returning({ id: markets.id });
  const marketId = market?.id ?? "";
  await grantSignupBonus(db, userA, 1000);
  await db.insert(trades).values({
    marketId,
    userId: userA,
    side: "YES",
    contracts: "1",
    costPoints: 50,
    probBefore: 0.5,
    probAfter: 0.51,
    idempotencyKey: "k",
    requestFingerprint: "f",
  });
  return marketId;
}

describe("mc_app, the app's runtime role", () => {
  let h: TestDbHandle;
  let marketId = "";

  beforeAll(async () => {
    h = await openTestDb();
    marketId = await seed(h.db);
  });
  afterAll(async () => {
    await h.close();
  });

  it("exists, cannot log in, and is neither superuser nor BYPASSRLS", async () => {
    expect(
      await h.rows(
        sql`select rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'mc_app'`,
      ),
    ).toEqual([
      {
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);
  });

  it.each(PUBLIC_TABLES.filter((t) => !UNREAD_TABLES.includes(t)))("may read %s", async (table) => {
    expect(await attemptAs(h.db, "mc_app", sql.raw(`select * from ${table}`))).toBeUndefined();
  });

  it("sees the rows (RLS lets mc_app through)", async () => {
    let count = -1;
    expect(
      await attemptAs(h.db, "mc_app", async (tx) => {
        count = (await tx.select().from(trades)).length;
      }),
    ).toBeUndefined();
    expect(count).toBe(1);
  });

  it.each(UNREAD_TABLES)("may not read %s", async (table) => {
    expect(await attemptAs(h.db, "mc_app", sql.raw(`select * from ${table}`))).toBe("42501");
  });

  it("may insert a trade and a ledger row", async () => {
    expect(
      await attemptAs(
        h.db,
        "mc_app",
        sql`insert into trades (market_id, user_id, side, contracts, cost_points, prob_before, prob_after, idempotency_key, request_fingerprint)
            values (${marketId}, ${userA}, 'NO', 2, 30, 0.5, 0.4, 'k2', 'f')`,
      ),
    ).toBeUndefined();
    expect(
      await attemptAs(
        h.db,
        "mc_app",
        sql`insert into ledger_entries (account_type, account_id, delta_points, reason)
            values ('house', ${HOUSE_ACCOUNT_ID}, 0, 'stipend')`,
      ),
    ).toBeUndefined();
  });

  it("can do a trade's writes: ledger code, market lock and update, snapshot, position upsert", async () => {
    expect(
      await attemptAs(h.db, "mc_app", async (tx) => {
        await grantSignupBonus(tx, userB, 500);
        await postTransfer(tx, {
          entries: [
            { accountType: "user", accountId: userA, deltaPoints: -100 },
            { accountType: "market_pool", accountId: marketId, deltaPoints: 100 },
          ],
          reason: "trade",
        });
        await tx.execute(sql`select id from markets where id = ${marketId} for update`);
        await tx.execute(sql`update markets set q_yes = 1 where id = ${marketId}`);
        await tx.execute(
          sql`insert into price_snapshots (market_id, prob_yes) values (${marketId}, 0.6)`,
        );
        await tx.execute(
          sql`insert into positions (market_id, user_id, contracts_yes) values (${marketId}, ${userA}, 1)
              on conflict (market_id, user_id) do update set contracts_yes = positions.contracts_yes + 1`,
        );
        await tx.execute(
          sql`insert into profiles (id, email, display_name)
              values ('33333333-3333-4333-8333-555555555555', 'c@maryvillecollege.edu', 'C')`,
        );
        expect(await checkLedgerInvariants(tx)).toEqual({ ledgerSum: 0, mismatches: [] });
      }),
    ).toBeUndefined();
  });

  it.each([
    ["UPDATE", "ledger_entries", "update ledger_entries set delta_points = 0"],
    ["DELETE", "ledger_entries", "delete from ledger_entries"],
    ["TRUNCATE", "ledger_entries", "truncate ledger_entries"],
    ["UPDATE", "trades", "update trades set cost_points = 0"],
    ["DELETE", "trades", "delete from trades"],
    ["TRUNCATE", "trades", "truncate trades"],
    ["DISABLE TRIGGER", "ledger_entries", "alter table ledger_entries disable trigger all"],
    ["DISABLE TRIGGER", "trades", "alter table trades disable trigger trades_append_only"],
    ["DISABLE ROW LEVEL SECURITY", "profiles", "alter table profiles disable row level security"],
    ["DELETE", "balances", "delete from balances"],
    ["DELETE", "profiles", "delete from profiles"],
    ["TRUNCATE", "markets", "truncate markets cascade"],
    ["UPDATE", "categories", "update categories set name = 'x'"],
    ["UPDATE", "price_snapshots", "update price_snapshots set prob_yes = 0"],
    ["DROP", "price_snapshots", "drop table price_snapshots"],
    ["CREATE", "a table", "create table public.mc_app_probe (id int)"],
  ])("is refused %s on %s", async (_op, _target, statement) => {
    expect(await attemptAs(h.db, "mc_app", sql.raw(statement))).toBe("42501");
  });
});

describe("anon and authenticated (Supabase's Data API roles)", () => {
  let h: TestDbHandle;

  beforeAll(async () => {
    // Mimic Supabase before any migration runs: the roles exist, and they hold default grants
    // on everything the migrating role creates in `public`.
    h = await openTestDb({
      beforeMigrate: async (db) => {
        await ensureRole(db, "anon");
        await ensureRole(db, "authenticated");
        await db.execute(sql`grant usage on schema public to anon, authenticated`);
        for (const kind of ["tables", "sequences", "functions"]) {
          await db.execute(
            sql.raw(
              `alter default privileges in schema public grant all on ${kind} to anon, authenticated`,
            ),
          );
        }
      },
    });
    await seed(h.db);
    // Created after the migrations: must not inherit the default grants either.
    await h.db.execute(sql`create table public.later_table (id int generated always as identity)`);
  });
  afterAll(async () => {
    await h.close();
  });

  it.each(["anon", "authenticated"])("%s holds no privilege on any public table", async (role) => {
    expect(
      await h.rows(
        sql`select table_name, privilege_type from information_schema.role_table_grants
            where table_schema = 'public' and grantee = ${role}`,
      ),
    ).toEqual([]);
  });

  it.each(["anon", "authenticated"])(
    "%s holds no privilege on any public sequence",
    async (role) => {
      expect(
        await h.rows(
          sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S'
              and (has_sequence_privilege(${role}, c.oid, 'USAGE')
                   or has_sequence_privilege(${role}, c.oid, 'SELECT')
                   or has_sequence_privilege(${role}, c.oid, 'UPDATE'))`,
        ),
      ).toEqual([]);
    },
  );

  it.each(["anon", "authenticated"])("%s cannot execute the sign-up hook", async (role) => {
    expect(
      await h.rows(
        sql`select has_function_privilege(${role}, 'public.hook_before_user_created(jsonb)', 'EXECUTE') as ok`,
      ),
    ).toEqual([{ ok: false }]);
  });

  const cases = ["anon", "authenticated"].flatMap((role) =>
    [...PUBLIC_TABLES, "later_table"].flatMap((table) => [
      [role, "SELECT", table, `select * from ${table}`],
      [role, "INSERT", table, `insert into ${table} default values`],
      [role, "DELETE", table, `delete from ${table}`],
    ]),
  );
  it.each(cases)("%s is refused %s on %s", async (role, _op, _table, statement) => {
    expect(await attemptAs(h.db, role as string, sql.raw(statement as string))).toBe("42501");
  });
});
