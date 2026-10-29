import "server-only";
import { displayPrice, PRICE_MAX, PRICE_MIN, probabilityYes } from "@mc-kalshi/engine";
import { desc, eq } from "drizzle-orm";
import { balances, type Market, markets, positions, trades } from "@/db/schema";
import type { AnyDb } from "@/db/types";
import { holdsAny, positionValue } from "@/lib/position-value";
import { parseNumeric } from "./numeric";

// The member's holdings and recent trades (docs/specs/m3-trading.md, "Positions and portfolio").
// Read-only. Definitions, per the spec: NO price = 100 − displayPrice(YES); value now =
// round(contracts × price) per side, summed ("about": it ignores price impact); pays if win =
// the engine's payout (floor(contracts × 100)); change = value now − cost basis. Cost basis is
// per market, so there is no per-side average cost. Resolved-market P&L arrives with M4.

export const PORTFOLIO_TRADE_LIMIT = 20;

/** Statuses whose positions still count toward the header's value (not yet settled). */
const UNSETTLED: readonly Market["status"][] = ["open", "closed"];

export interface PortfolioPosition {
  readonly marketId: string;
  readonly slug: string;
  readonly title: string;
  readonly status: Market["status"];
  readonly outcome: Market["outcome"];
  readonly closeAt: Date;
  readonly contractsYes: number;
  readonly contractsNo: number;
  /** Net points paid in for this market (signed). */
  readonly costBasisPoints: number;
  /** Whole-percent YES price, 1–99. */
  readonly yesPrice: number;
  readonly noPrice: number;
  readonly valueNow: number;
  readonly paysIfYes: number;
  readonly paysIfNo: number;
  readonly change: number;
}

export interface PortfolioTrade {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly side: "YES" | "NO";
  /** Signed: positive for a buy, negative for a sell. */
  readonly contracts: number;
  /** Signed whole points: positive paid, negative received. */
  readonly costPoints: number;
  /** Realized points per contract, whole, 1–99. */
  readonly avgPrice: number;
  readonly createdAt: Date;
}

export interface Portfolio {
  readonly balance: number;
  /** Value now of the positions in open and closed markets. */
  readonly positionsValue: number;
  /** balance + positionsValue. */
  readonly total: number;
  readonly positions: readonly PortfolioPosition[];
  /** The last {@link PORTFOLIO_TRADE_LIMIT} trades, newest first. */
  readonly trades: readonly PortfolioTrade[];
}

function positionRow(
  market: Pick<Market, "id" | "slug" | "title" | "status" | "outcome" | "closeAt" | "b">,
  q: { qYes: number; qNo: number },
  held: { contractsYes: number; contractsNo: number; costBasisPoints: number },
): PortfolioPosition {
  const yesPrice = displayPrice(probabilityYes({ b: market.b, ...q }));
  return {
    marketId: market.id,
    slug: market.slug,
    title: market.title,
    status: market.status,
    outcome: market.outcome,
    closeAt: market.closeAt,
    ...held,
    yesPrice,
    ...positionValue(held, yesPrice),
  };
}

/** Open and closed markets first, then settled ones; each group by close time, then slug. */
function byListOrder(a: PortfolioPosition, b: PortfolioPosition): number {
  const group = (r: PortfolioPosition) => (UNSETTLED.includes(r.status) ? 0 : 1);
  return (
    group(a) - group(b) ||
    a.closeAt.getTime() - b.closeAt.getTime() ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  );
}

export async function getPortfolio(db: AnyDb, userId: string): Promise<Portfolio> {
  const [balanceRow] = await db
    .select({ points: balances.points })
    .from(balances)
    .where(eq(balances.userId, userId));
  const balance = balanceRow?.points ?? 0;

  const held = await db
    .select({ position: positions, market: markets })
    .from(positions)
    .innerJoin(markets, eq(positions.marketId, markets.id))
    .where(eq(positions.userId, userId));
  const rows = held
    .map(({ position, market }) =>
      positionRow(
        market,
        { qYes: parseNumeric(market.qYes), qNo: parseNumeric(market.qNo) },
        {
          contractsYes: parseNumeric(position.contractsYes),
          contractsNo: parseNumeric(position.contractsNo),
          costBasisPoints: position.costBasisPoints,
        },
      ),
    )
    .filter(holdsAny)
    .sort(byListOrder);

  const recent = await db
    .select({ trade: trades, slug: markets.slug, title: markets.title })
    .from(trades)
    .innerJoin(markets, eq(trades.marketId, markets.id))
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt), desc(trades.id))
    .limit(PORTFOLIO_TRADE_LIMIT);

  const positionsValue = rows
    .filter((r) => UNSETTLED.includes(r.status))
    .reduce((sum, r) => sum + r.valueNow, 0);
  return {
    balance,
    positionsValue,
    total: balance + positionsValue,
    positions: rows,
    trades: recent.map(({ trade, slug, title }) => {
      const contracts = parseNumeric(trade.contracts);
      const realized = Math.round(Math.abs(trade.costPoints) / Math.abs(contracts));
      return {
        id: trade.id,
        slug,
        title,
        side: trade.side,
        contracts,
        costPoints: trade.costPoints,
        avgPrice: Math.min(PRICE_MAX, Math.max(PRICE_MIN, realized)),
        createdAt: trade.createdAt,
      };
    }),
  };
}
