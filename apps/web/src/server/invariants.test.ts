import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  categories,
  HOUSE_ACCOUNT_ID,
  ledgerEntries,
  markets,
  positions,
  profiles,
  trades,
} from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { checkTradingInvariants, type InvariantIssue } from "./invariants";
import { postTransfer } from "./ledger";

// placeTrade does not exist yet, so the fixture writes what a trade would: a trades row, the
// position, q on the market, and a user -> market_pool transfer through postTransfer (so the
// balances cache stays consistent). Each test then corrupts exactly one thing directly in the DB.
// trades and ledger_entries are append-only (UPDATE/DELETE raise), so those are corrupted by INSERT.

const user = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MARKET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MARKET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const handles: TestDbHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
});

let keySeq = 0;

interface Fill {
  readonly marketId: string;
  readonly userN: number;
  readonly side: "YES" | "NO";
  /** numeric(18,6) string, signed. */
  readonly contracts: string;
  readonly costPoints: number;
}

/** Writes one fill the way placeTrade will: trade, position upsert, q, pool transfer. */
async function fill(db: AnyDb, f: Fill): Promise<string> {
  const [trade] = await db
    .insert(trades)
    .values({
      marketId: f.marketId,
      userId: user(f.userN),
      side: f.side,
      contracts: f.contracts,
      costPoints: f.costPoints,
      probBefore: 0.5,
      probAfter: 0.5,
      idempotencyKey: `fixture-key-${String(++keySeq).padStart(8, "0")}`,
      requestFingerprint: "fixture",
    })
    .returning({ id: trades.id });
  const col = f.side === "YES" ? "contracts_yes" : "contracts_no";
  const qCol = f.side === "YES" ? "q_yes" : "q_no";
  // Fixture only: production code never does SQL arithmetic on contracts. Insert then update
  // (not one upsert): the non-negative CHECK is tested on the proposed row before ON CONFLICT.
  await db
    .insert(positions)
    .values({ marketId: f.marketId, userId: user(f.userN) })
    .onConflictDoNothing();
  await db.execute(
    sql.raw(`update positions set ${col} = ${col} + ${f.contracts},
      cost_basis_points = cost_basis_points + ${f.costPoints}
      where market_id = '${f.marketId}' and user_id = '${user(f.userN)}'`),
  );
  await db.execute(
    sql.raw(`update markets set ${qCol} = ${qCol} + ${f.contracts} where id = '${f.marketId}'`),
  );
  await postTransfer(db, {
    entries: [
      { accountType: "user", accountId: user(f.userN), deltaPoints: -f.costPoints },
      { accountType: "market_pool", accountId: f.marketId, deltaPoints: f.costPoints },
    ],
    reason: "trade",
    refType: "trade",
    refId: trade?.id,
  });
  return trade?.id ?? "";
}

/** Two users with 10,000 points each, two open markets, a handful of buys and a sell. */
async function consistentFixture(): Promise<AnyDb> {
  const h = await openTestDb();
  handles.push(h);
  const db = h.db;
  for (const n of [1, 2]) {
    await db
      .insert(profiles)
      .values({ id: user(n), email: `u${n}@my.maryvillecollege.edu`, displayName: `User ${n}` });
    await postTransfer(db, {
      entries: [
        { accountType: "house", accountId: HOUSE_ACCOUNT_ID, deltaPoints: -10_000 },
        { accountType: "user", accountId: user(n), deltaPoints: 10_000 },
      ],
      reason: "signup_bonus",
      refType: "profile",
      refId: user(n),
    });
  }
  const [cat] = await db
    .insert(categories)
    .values({ slug: "campus", name: "Campus" })
    .returning({ id: categories.id });
  const closeAt = new Date(Date.now() + 86_400_000);
  for (const [id, slug] of [
    [MARKET_A, "market-a"],
    [MARKET_B, "market-b"],
  ] as const) {
    await db.insert(markets).values({
      id,
      slug,
      title: slug,
      rules: "rules",
      categoryId: cat?.id ?? "",
      status: "open",
      closeAt,
    });
  }
  await fill(db, {
    marketId: MARKET_A,
    userN: 1,
    side: "YES",
    contracts: "9.761859",
    costPoints: 500,
  });
  await fill(db, {
    marketId: MARKET_A,
    userN: 2,
    side: "NO",
    contracts: "3.000001",
    costPoints: 160,
  });
  await fill(db, { marketId: MARKET_A, userN: 1, side: "YES", contracts: "-1.5", costPoints: -80 });
  await fill(db, { marketId: MARKET_B, userN: 2, side: "YES", contracts: "0.01", costPoints: 1 });
  return db;
}

const kinds = (issues: readonly InvariantIssue[]) => issues.map((i) => i.kind);

describe("checkTradingInvariants", () => {
  it("returns ok for a consistent fixture", async () => {
    const db = await consistentFixture();
    const result = await checkTradingInvariants(db);
    expect(result).toEqual({ ok: true, ledgerSum: 0, balanceMismatches: [], issues: [] });
  });

  it("returns ok for an empty database", async () => {
    const h = await openTestDb();
    handles.push(h);
    expect(await checkTradingInvariants(h.db)).toEqual({
      ok: true,
      ledgerSum: 0,
      balanceMismatches: [],
      issues: [],
    });
  });

  it("detects q that no longer matches positions or trades (UPDATE markets SET q_yes)", async () => {
    const db = await consistentFixture();
    await db.update(markets).set({ qYes: "8.261860" }).where(eq(markets.id, MARKET_A));
    const { ok, issues } = await checkTradingInvariants(db);
    expect(ok).toBe(false);
    expect(issues).toEqual([
      { kind: "positions_q_mismatch", marketId: MARKET_A, side: "YES" },
      { kind: "trades_q_mismatch", marketId: MARKET_A, side: "YES" },
    ]);
  });

  it("detects a one-micro-contract drift in q (exact comparison)", async () => {
    const db = await consistentFixture();
    await db.update(markets).set({ qNo: "3.000002" }).where(eq(markets.id, MARKET_A));
    const { issues } = await checkTradingInvariants(db);
    expect(issues).toEqual([
      { kind: "positions_q_mismatch", marketId: MARKET_A, side: "NO" },
      { kind: "trades_q_mismatch", marketId: MARKET_A, side: "NO" },
    ]);
  });

  it("detects an extra positions row with no trades behind it", async () => {
    const db = await consistentFixture();
    await db
      .insert(positions)
      .values({ marketId: MARKET_B, userId: user(1), contractsNo: "2", costBasisPoints: 0 });
    const { ok, issues } = await checkTradingInvariants(db);
    expect(ok).toBe(false);
    expect(issues).toEqual([
      { kind: "positions_q_mismatch", marketId: MARKET_B, side: "NO" },
      { kind: "position_trades_mismatch", marketId: MARKET_B, userId: user(1), side: "NO" },
    ]);
  });

  it("detects an altered position (contracts moved between users, q still matches)", async () => {
    const db = await consistentFixture();
    await db.execute(
      sql`update positions set contracts_no = 0 where market_id = ${MARKET_A} and user_id = ${user(2)}`,
    );
    await db
      .insert(positions)
      .values({ marketId: MARKET_A, userId: user(1), contractsNo: "3.000001" })
      .onConflictDoUpdate({
        target: [positions.marketId, positions.userId],
        set: { contractsNo: "3.000001" },
      });
    const { issues } = await checkTradingInvariants(db);
    expect(issues).toEqual([
      { kind: "position_trades_mismatch", marketId: MARKET_A, userId: user(1), side: "NO" },
      { kind: "position_trades_mismatch", marketId: MARKET_A, userId: user(2), side: "NO" },
    ]);
  });

  it("detects a cost basis that differs from the sum of cost points", async () => {
    const db = await consistentFixture();
    await db.execute(
      sql`update positions set cost_basis_points = 421 where market_id = ${MARKET_A} and user_id = ${user(1)}`,
    );
    const { issues } = await checkTradingInvariants(db);
    expect(issues).toEqual([{ kind: "cost_basis_mismatch", marketId: MARKET_A, userId: user(1) }]);
  });

  it("detects a trade inserted without its position, q or pool movement", async () => {
    const db = await consistentFixture();
    const [t] = await db
      .insert(trades)
      .values({
        marketId: MARKET_B,
        userId: user(1),
        side: "YES",
        contracts: "1",
        costPoints: 50,
        probBefore: 0.5,
        probAfter: 0.5,
        idempotencyKey: "corrupt-trade-0001",
        requestFingerprint: "fixture",
      })
      .returning({ id: trades.id });
    expect(t).toBeDefined();
    const { issues } = await checkTradingInvariants(db);
    expect(issues).toEqual([
      { kind: "trades_q_mismatch", marketId: MARKET_B, side: "YES" },
      { kind: "position_trades_mismatch", marketId: MARKET_B, userId: user(1), side: "YES" },
      { kind: "cost_basis_mismatch", marketId: MARKET_B, userId: user(1) },
      { kind: "pool_trades_mismatch", marketId: MARKET_B },
    ]);
  });

  it("detects a ledger entry that unbalances a pool (and the ledger sum)", async () => {
    const db = await consistentFixture();
    await db
      .insert(ledgerEntries)
      .values({ accountType: "market_pool", accountId: MARKET_A, deltaPoints: 7, reason: "trade" });
    const result = await checkTradingInvariants(db);
    expect(result.ok).toBe(false);
    expect(result.ledgerSum).toBe(7);
    expect(result.issues).toEqual([
      { kind: "ledger_sum_nonzero" },
      { kind: "pool_trades_mismatch", marketId: MARKET_A },
    ]);
  });

  it("detects a pool imbalance even when the ledger still sums to zero", async () => {
    const db = await consistentFixture();
    await postTransfer(db, {
      entries: [
        { accountType: "market_pool", accountId: MARKET_A, deltaPoints: -30 },
        { accountType: "market_pool", accountId: MARKET_B, deltaPoints: 30 },
      ],
      reason: "admin_adjustment",
    });
    const result = await checkTradingInvariants(db);
    expect(result.ledgerSum).toBe(0);
    expect(result.issues).toEqual([
      { kind: "pool_trades_mismatch", marketId: MARKET_A },
      { kind: "pool_trades_mismatch", marketId: MARKET_B },
    ]);
  });

  it("detects a user ledger entry that the balances cache does not reflect", async () => {
    const db = await consistentFixture();
    await db.insert(ledgerEntries).values([
      { accountType: "user", accountId: user(2), deltaPoints: 25, reason: "admin_adjustment" },
      {
        accountType: "house",
        accountId: HOUSE_ACCOUNT_ID,
        deltaPoints: -25,
        reason: "admin_adjustment",
      },
    ]);
    const result = await checkTradingInvariants(db);
    expect(result.ok).toBe(false);
    expect(result.ledgerSum).toBe(0);
    expect(result.balanceMismatches).toEqual([{ userId: user(2), cached: 9_839, ledger: 9_864 }]);
    expect(result.issues).toEqual([{ kind: "balance_mismatch", userId: user(2) }]);
  });

  it("reports a stored value outside the engine range instead of throwing", async () => {
    const db = await consistentFixture();
    await db.update(markets).set({ qYes: "2000000000.000000" }).where(eq(markets.id, MARKET_B));
    const { ok, issues } = await checkTradingInvariants(db);
    expect(ok).toBe(false);
    expect(issues).toEqual([{ kind: "invalid_numeric", marketId: MARKET_B }]);
  });

  it("skips positions-vs-q and pool checks for resolved and voided markets, not trades-vs-q", async () => {
    const db = await consistentFixture();
    await db
      .update(markets)
      .set({ status: "resolved", outcome: "YES" })
      .where(eq(markets.id, MARKET_A));
    await db.update(markets).set({ status: "voided" }).where(eq(markets.id, MARKET_B));
    // What M4 settlement might do: pay out of the pools (the pool sums no longer match trades).
    await postTransfer(db, {
      entries: [
        { accountType: "market_pool", accountId: MARKET_A, deltaPoints: -580 },
        { accountType: "market_pool", accountId: MARKET_B, deltaPoints: -1 },
        { accountType: "house", accountId: HOUSE_ACCOUNT_ID, deltaPoints: 581 },
      ],
      reason: "payout",
    });
    expect((await checkTradingInvariants(db)).issues).toEqual([]);

    // Trades are immutable, so trades vs q still applies to a resolved market.
    await db.update(markets).set({ qYes: "1" }).where(eq(markets.id, MARKET_A));
    expect(kinds((await checkTradingInvariants(db)).issues)).toEqual(["trades_q_mismatch"]);
  });

  it("never puts an email or display name in an issue", async () => {
    const db = await consistentFixture();
    await db.update(markets).set({ qYes: "1" }).where(eq(markets.id, MARKET_A));
    await db
      .insert(positions)
      .values({ marketId: MARKET_B, userId: user(1), contractsNo: "2", costBasisPoints: 3 });
    const { issues } = await checkTradingInvariants(db);
    expect(issues.length).toBeGreaterThan(0);
    const text = JSON.stringify(issues);
    expect(text).not.toMatch(/@|maryvillecollege|User \d/);
  });
});
