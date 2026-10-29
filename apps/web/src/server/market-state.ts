import "server-only";
import { displayPrice, EMPTY_POSITION, probabilityYes } from "@mc-kalshi/engine";
import { and, eq } from "drizzle-orm";
import { balances, markets, positions } from "@/db/schema";
import type { AnyDb } from "@/db/types";
import { PUBLIC_MARKET_STATUSES } from "./markets";
import { parseNumeric } from "./numeric";
import type { MarketStateDto } from "./trade-types";

// The state the market page polls every 3 s (GET /api/markets/[id]/state; spec "Order ticket").

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The market's live AMM state, plus the member's balance and position when `userId` is given.
 * Null for an id that is not a UUID, an unknown market, or one the public may not see
 * (`proposed`, `rejected`).
 */
export async function loadMarketState(
  db: AnyDb,
  marketId: string,
  userId: string | null,
): Promise<MarketStateDto | null> {
  if (!UUID.test(marketId)) return null;
  const [market] = await db
    .select({
      status: markets.status,
      closeAt: markets.closeAt,
      b: markets.b,
      qYes: markets.qYes,
      qNo: markets.qNo,
    })
    .from(markets)
    .where(eq(markets.id, marketId));
  if (!market || !PUBLIC_MARKET_STATUSES.includes(market.status)) return null;

  const state = { b: market.b, qYes: parseNumeric(market.qYes), qNo: parseNumeric(market.qNo) };
  const p = probabilityYes(state);
  const dto: MarketStateDto = {
    status: market.status,
    closeAt: market.closeAt.toISOString(),
    ...state,
    probabilityYes: p,
    displayPrice: displayPrice(p),
  };
  if (!userId) return dto;

  const [balance] = await db
    .select({ points: balances.points })
    .from(balances)
    .where(eq(balances.userId, userId));
  const [held] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.marketId, marketId), eq(positions.userId, userId)));
  return {
    ...dto,
    balance: balance?.points ?? 0,
    position: held
      ? {
          contractsYes: parseNumeric(held.contractsYes),
          contractsNo: parseNumeric(held.contractsNo),
          costBasisPoints: held.costBasisPoints,
        }
      : EMPTY_POSITION,
  };
}
