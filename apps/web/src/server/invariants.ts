import "server-only";
import { eq, sql } from "drizzle-orm";
import { ledgerEntries, markets, positions, trades } from "@/db/schema";
import type { AnyDb } from "@/db/types";
import { type BalanceMismatch, checkLedgerInvariants } from "./ledger";
import { NumericBoundaryError, parseNumeric } from "./numeric";

// The scheduled integrity check for trading (docs/specs/m3-trading.md "Ledger invariant job").
// Contract amounts are compared as exact micro-contract BigInts parsed from the numeric strings;
// no SQL arithmetic on q or contracts. Issues carry a kind and ids only, never emails or names,
// because the cron route logs them verbatim.

type Side = "YES" | "NO";

export type InvariantIssue =
  | { readonly kind: "ledger_sum_nonzero" }
  | { readonly kind: "balance_mismatch"; readonly userId: string }
  /** A stored q or contract amount is off the six-decimal grid or outside the engine range. */
  | { readonly kind: "invalid_numeric"; readonly marketId: string }
  | { readonly kind: "positions_q_mismatch"; readonly marketId: string; readonly side: Side }
  | { readonly kind: "trades_q_mismatch"; readonly marketId: string; readonly side: Side }
  | {
      readonly kind: "position_trades_mismatch";
      readonly marketId: string;
      readonly userId: string;
      readonly side: Side;
    }
  | { readonly kind: "cost_basis_mismatch"; readonly marketId: string; readonly userId: string }
  | { readonly kind: "pool_trades_mismatch"; readonly marketId: string };

export interface TradingInvariants {
  readonly ok: boolean;
  readonly ledgerSum: number;
  readonly balanceMismatches: BalanceMismatch[];
  readonly issues: InvariantIssue[];
}

/** Statuses whose positions and pool must still mirror the trades (M4 settles the others). */
const LIVE_STATUSES = new Set(["open", "closed"]);

/** Exact micro-contracts; throws NumericBoundaryError for a value the engine could not hold. */
const micro = (s: string): bigint => BigInt(Math.round(parseNumeric(s) * 1e6));

interface Pair {
  yes: bigint;
  no: bigint;
}

interface UserTotals {
  /** From trades. */
  traded: Pair;
  cost: bigint;
  /** From the positions row, if any. */
  held: Pair;
  basis: bigint;
}

interface MarketTotals {
  readonly status: string;
  readonly qYes: string;
  readonly qNo: string;
  invalid: boolean;
  readonly users: Map<string, UserTotals>;
  tradeCost: bigint;
}

const zeroUser = (): UserTotals => ({
  traded: { yes: BigInt(0), no: BigInt(0) },
  cost: BigInt(0),
  held: { yes: BigInt(0), no: BigInt(0) },
  basis: BigInt(0),
});

const byId = <T>(m: Map<string, T>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Like parse, but marks the market invalid instead of throwing. */
function tryMicro(market: MarketTotals, s: string): bigint {
  try {
    return micro(s);
  } catch (error) {
    if (!(error instanceof NumericBoundaryError)) {
      throw error;
    }
    market.invalid = true;
    return BigInt(0);
  }
}

/**
 * `checkLedgerInvariants` (ledger sums to zero, balances equal the ledger) plus, per market:
 * positions vs q and pool vs trades for open/closed markets, trades vs q for every market, and
 * each user's position and cost basis vs that user's trades.
 */
export async function checkTradingInvariants(db: AnyDb): Promise<TradingInvariants> {
  const ledger = await checkLedgerInvariants(db);
  const issues: InvariantIssue[] = [];
  if (ledger.ledgerSum !== 0) {
    issues.push({ kind: "ledger_sum_nonzero" });
  }
  for (const m of ledger.mismatches) {
    issues.push({ kind: "balance_mismatch", userId: m.userId });
  }

  const marketRows = await db
    .select({ id: markets.id, status: markets.status, qYes: markets.qYes, qNo: markets.qNo })
    .from(markets);
  const byMarket = new Map<string, MarketTotals>();
  for (const r of marketRows) {
    byMarket.set(r.id, {
      status: r.status,
      qYes: r.qYes,
      qNo: r.qNo,
      invalid: false,
      users: new Map(),
      tradeCost: BigInt(0),
    });
  }
  const userOf = (market: MarketTotals, userId: string): UserTotals => {
    let u = market.users.get(userId);
    if (!u) {
      u = zeroUser();
      market.users.set(userId, u);
    }
    return u;
  };

  const tradeRows = await db
    .select({
      marketId: trades.marketId,
      userId: trades.userId,
      side: trades.side,
      contracts: trades.contracts,
      costPoints: trades.costPoints,
    })
    .from(trades);
  for (const t of tradeRows) {
    const market = byMarket.get(t.marketId);
    if (!market) continue; // unreachable: trades.market_id is a foreign key
    const u = userOf(market, t.userId);
    const amount = tryMicro(market, t.contracts);
    if (t.side === "YES") u.traded.yes += amount;
    else u.traded.no += amount;
    u.cost += BigInt(t.costPoints);
    market.tradeCost += BigInt(t.costPoints);
  }

  const positionRows = await db.select().from(positions);
  for (const p of positionRows) {
    const market = byMarket.get(p.marketId);
    if (!market) continue; // unreachable: positions.market_id is a foreign key
    const u = userOf(market, p.userId);
    u.held = { yes: tryMicro(market, p.contractsYes), no: tryMicro(market, p.contractsNo) };
    u.basis = BigInt(p.costBasisPoints);
  }

  const poolRows = await db
    .select({
      marketId: ledgerEntries.accountId,
      total: sql<string>`coalesce(sum(${ledgerEntries.deltaPoints}), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountType, "market_pool"))
    .groupBy(ledgerEntries.accountId);
  const poolSum = new Map(poolRows.map((r) => [r.marketId, BigInt(r.total)]));

  for (const [marketId, market] of byId(byMarket)) {
    const q: Pair = { yes: tryMicro(market, market.qYes), no: tryMicro(market, market.qNo) };
    const live = LIVE_STATUSES.has(market.status);
    const users = byId(market.users);

    if (market.invalid) {
      issues.push({ kind: "invalid_numeric", marketId });
    } else {
      const held: Pair = { yes: BigInt(0), no: BigInt(0) };
      const traded: Pair = { yes: BigInt(0), no: BigInt(0) };
      for (const [, u] of users) {
        held.yes += u.held.yes;
        held.no += u.held.no;
        traded.yes += u.traded.yes;
        traded.no += u.traded.no;
      }
      if (live) {
        if (held.yes !== q.yes)
          issues.push({ kind: "positions_q_mismatch", marketId, side: "YES" });
        if (held.no !== q.no) issues.push({ kind: "positions_q_mismatch", marketId, side: "NO" });
      }
      if (traded.yes !== q.yes) issues.push({ kind: "trades_q_mismatch", marketId, side: "YES" });
      if (traded.no !== q.no) issues.push({ kind: "trades_q_mismatch", marketId, side: "NO" });
    }

    for (const [userId, u] of users) {
      if (!market.invalid) {
        if (u.held.yes !== u.traded.yes) {
          issues.push({ kind: "position_trades_mismatch", marketId, userId, side: "YES" });
        }
        if (u.held.no !== u.traded.no) {
          issues.push({ kind: "position_trades_mismatch", marketId, userId, side: "NO" });
        }
      }
      if (u.basis !== u.cost) {
        issues.push({ kind: "cost_basis_mismatch", marketId, userId });
      }
    }

    if (live && (poolSum.get(marketId) ?? BigInt(0)) !== market.tradeCost) {
      issues.push({ kind: "pool_trades_mismatch", marketId });
    }
  }

  return {
    ok: issues.length === 0,
    ledgerSum: ledger.ledgerSum,
    balanceMismatches: ledger.mismatches,
    issues,
  };
}
