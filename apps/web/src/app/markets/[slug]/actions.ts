"use server";

import { getDb } from "@/db";
import { getSessionMember } from "@/server/auth";
import type { TradeResult } from "@/server/trade-types";
import { placeTrade } from "@/server/trading";

// The order ticket's server action (docs/specs/m3-trading.md, key decision 1). The user comes
// from the verified session, never from the input; placeTrade validates the input. Next's
// built-in Origin check covers CSRF for server actions. A suspended member's session still
// reaches placeTrade, which answers account_suspended (not unauthenticated).

export async function placeTradeAction(input: unknown): Promise<TradeResult> {
  const session = await getSessionMember();
  if (!session) {
    return { ok: false, code: "unauthenticated", message: "sign in to trade" };
  }
  const db = getDb();
  if (!db) {
    return { ok: false, code: "internal_error", message: "trading is not available right now" };
  }
  return placeTrade(db, session.userId, input);
}
