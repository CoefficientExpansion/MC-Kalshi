import "server-only";
import {
  applyFill,
  displayPrice,
  EMPTY_POSITION,
  type MarketState,
  type Position,
  PRICE_MAX,
  PRICE_MIN,
  probabilityYes,
  type Quote,
  withinSlippage,
} from "@mc-kalshi/engine";
import { and, eq, sql } from "drizzle-orm";
import { balances, markets, positions, priceSnapshots, profiles, trades } from "@/db/schema";
import type { AnyDb } from "@/db/types";
import { postTransfer } from "./ledger";
import { PUBLIC_MARKET_STATUSES } from "./markets";
import { formatNumeric, parseNumeric } from "./numeric";
import { quoteTrade, withinCostSlippage } from "./quote";
import { checkTradeRateLimit, type RateLimited } from "./rate-limit";
import { requestFingerprint } from "./trade-fingerprint";
import { checkSizeRules } from "./trade-limits";
import {
  type MarketQuoteState,
  type ParsedTradeInput,
  parseTradeInput,
  type Requote,
  type TradeFailure,
  type TradeResult,
  type TradeSuccess,
  type TradeView,
} from "./trade-types";

// placeTrade (docs/specs/m3-trading.md, "placeTrade", steps 0–12): one transaction per trade,
// market row locked first, then the user's balances row. All market math is the engine's,
// reached through server/quote.ts. Expected failures are values; only bugs throw, and those are
// logged with ids only and returned as `internal_error`.

export interface PlaceTradeOptions {
  /** Overrides `TRADING_PAUSED === "true"` (tests). */
  readonly tradingPaused?: boolean;
  /**
   * The rate-limit seam, called inside the transaction once the balances row is locked (step
   * 5c); defaults to {@link checkTradeRateLimit}.
   */
  readonly rateLimit?: (db: AnyDb, userId: string) => Promise<RateLimited | null>;
}

type TradeRow = typeof trades.$inferSelect;

const MICRO = 1e6;
const micros = (n: number) => Math.round(n * MICRO);

/** Rolls the transaction back and says why: a failure to return, or a key to resolve as a replay. */
class Abort extends Error {
  constructor(readonly outcome: TradeFailure | "replay") {
    super("trade aborted");
  }
}

function fail<C extends TradeFailure["code"]>(
  code: C,
  message: string,
  extra: Omit<Extract<TradeFailure, { code: C }>, "ok" | "code" | "message"> = {} as never,
): TradeFailure {
  return { ok: false, code, message, ...extra } as TradeFailure;
}

const abort = (failure: TradeFailure): never => {
  throw new Abort(failure);
};

// Not "nothing was traded": a COMMIT that fails on the wire may still have applied.
const INTERNAL = fail("internal_error", "the trade could not be confirmed");

/**
 * Buy or sell contracts for `userId` (already authenticated by the caller). `rawInput` is
 * untrusted and validated here. Never throws for expected failures; any rejection writes nothing.
 */
export async function placeTrade(
  db: AnyDb,
  userId: string,
  rawInput: unknown,
  opts: PlaceTradeOptions = {},
): Promise<TradeResult> {
  // Step 0, before any transaction.
  const paused = opts.tradingPaused ?? process.env.TRADING_PAUSED === "true";
  if (paused) return fail("trading_paused", "trading is paused");
  // Never throws, even for a revoked Proxy: any throw while reading the input is invalid_input.
  const parsed = parseTradeInput(rawInput);
  if (!parsed.ok) return fail("invalid_input", "the trade request is not valid");
  const input = parsed.input;
  const rateLimit = opts.rateLimit ?? checkTradeRateLimit;

  try {
    const fingerprint = requestFingerprint(input);
    const prior = await findTrade(db, userId, input.idempotencyKey);
    if (prior) return await replay(db, prior, fingerprint);

    try {
      return await db.transaction((tx) => fillTrade(tx, userId, input, fingerprint, rateLimit));
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      if (e.outcome !== "replay") return e.outcome;
      // Another call with this key committed first (steps 3 and 8): answer as its replay.
      const original = await findTrade(db, userId, input.idempotencyKey);
      if (!original) throw new Error("idempotency key conflict without an original trade");
      return await replay(db, original, fingerprint);
    }
  } catch (e) {
    logInternalError(userId, input.marketId, e);
    return INTERNAL;
  }
}

const suspended = () => fail("account_suspended", "this account may not trade");

/** Steps 1–12 inside one transaction. Throws {@link Abort} to roll back with a result. */
async function fillTrade(
  tx: AnyDb,
  userId: string,
  input: ParsedTradeInput,
  fingerprint: string,
  rateLimit: NonNullable<PlaceTradeOptions["rateLimit"]>,
): Promise<TradeSuccess> {
  // 1. The member (an early answer; re-checked under the locks in step 5a).
  const [profile] = await tx
    .select({ suspendedAt: profiles.suspendedAt })
    .from(profiles)
    .where(eq(profiles.id, userId));
  if (!profile) abort(fail("unauthenticated", "no member for this session"));
  if (profile?.suspendedAt) abort(suspended());

  // 2. Lock the market.
  const [market] = await tx
    .select({ b: markets.b, qYes: markets.qYes, qNo: markets.qNo, status: markets.status })
    .from(markets)
    .where(eq(markets.id, input.marketId))
    .for("update");
  if (!market) return abort(fail("market_not_found", "no such market"));

  // 3. A concurrent retry may have committed while we waited for the lock.
  if (await findTrade(tx, userId, input.idempotencyKey)) throw new Abort("replay");

  // 4. Public and open. Moderator-only statuses answer as missing, like the state route.
  if (!PUBLIC_MARKET_STATUSES.includes(market.status)) {
    abort(fail("market_not_found", "no such market"));
  }
  if (market.status !== "open") abort(fail("market_not_open", "this market is not open"));

  // 5. Lock the balance (creating the row for a member who has none).
  await tx.insert(balances).values({ userId, points: 0 }).onConflictDoNothing();
  const [balanceRow] = await tx
    .select({ points: balances.points })
    .from(balances)
    .where(eq(balances.userId, userId))
    .for("update");
  const balance = balanceRow?.points ?? 0;

  // 5a. Both locks held: re-read the member FOR SHARE, so a suspension that committed while we
  // waited stops the trade and one that starts now waits for our commit.
  const [current] = await tx
    .select({ suspendedAt: profiles.suspendedAt })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .for("share");
  if (!current) abort(fail("unauthenticated", "no member for this session"));
  if (current?.suspendedAt) abort(suspended());

  // 5b. The trade's time: the clock after the locks (now() is the transaction's start, which may
  // be long before a queued trade got its locks). close_at, created_at and the snapshot use it.
  const [clock] = await tx
    .select({ at: sql<string>`clock_timestamp()::text` })
    .from(markets)
    .where(eq(markets.id, input.marketId));
  if (!clock) throw new Error("locked market row vanished");
  const at = sql`${clock.at}::timestamptz`;
  const [closed] = await tx
    .select({ past: sql<boolean>`${markets.closeAt} <= ${at}` })
    .from(markets)
    .where(eq(markets.id, input.marketId));
  if (closed?.past) abort(fail("market_closed", "this market has closed"));

  // 5c. The rate limit, under the balances lock: one user's trades serialize here, so each
  // count sees every trade that committed before it.
  const limited = await rateLimit(tx, userId);
  if (limited) {
    abort(
      fail("rate_limited", "too many trades in the last minute", {
        retryAfterSec: limited.retryAfterSec,
      }),
    );
  }

  // 5d. The position.
  const position = await readPosition(tx, input.marketId, userId);

  // 6. Quote from the locked state.
  const state: MarketState = {
    b: market.b,
    qYes: parseNumeric(market.qYes),
    qNo: parseNumeric(market.qNo),
  };
  const quoted = quoteTrade(state, input.side, input.mode, input.amount);
  if (!quoted.ok) return abort(fail("invalid_input", "the engine refused this trade"));
  const quote = quoted.quote;
  const held = input.side === "YES" ? position.contractsYes : position.contractsNo;

  // 7a. Size rules first: on dust the minimum charge makes the price comparison meaningless.
  const size = checkSizeRules({ mode: input.mode, quote, b: market.b, heldOnSide: held });
  if (size?.code === "trade_too_small") abort(fail("trade_too_small", "this trade is too small"));
  if (size?.code === "trade_too_large") {
    abort(fail("trade_too_large", "this trade is too large", { maxPoints: size.maxPoints }));
  }

  // 7b. Slippage: average price, and for contract buys the total cost as well.
  const priceOk = withinSlippage(input.expectedAvgPrice, quote, input.maxSlippage);
  const costOk =
    input.mode !== "buy_contracts" ||
    withinCostSlippage(
      input.expectedCostPoints ?? 0,
      quote.costPoints,
      input.maxSlippage,
      quote.contracts,
    );
  if (!priceOk || !costOk) {
    abort(fail("slippage_exceeded", "the price moved", { requote: toRequote(quote) }));
  }

  // 7c. Affordability, or holdings for a sell.
  if (input.mode === "sell_contracts") {
    if (micros(held) < micros(input.amount)) {
      abort(fail("insufficient_position", "not enough contracts held", { held }));
    }
  } else if (balance < quote.costPoints) {
    abort(fail("insufficient_balance", "not enough points", { balance, needed: quote.costPoints }));
  }

  // 8. The trade row; losing the unique key to another transaction means this is a replay.
  const [row] = await tx
    .insert(trades)
    .values({
      marketId: input.marketId,
      userId,
      side: quote.side,
      contracts: formatNumeric(quote.contracts),
      costPoints: quote.costPoints,
      probBefore: quote.probBefore,
      probAfter: quote.probAfter,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      createdAt: at,
    })
    .onConflictDoNothing({ target: [trades.userId, trades.idempotencyKey] })
    .returning();
  if (!row) throw new Abort("replay");

  // 9. The position, from a fresh engine quote (never from client input).
  const after = applyFill(position, quote);
  const stored = {
    contractsYes: formatNumeric(after.contractsYes),
    contractsNo: formatNumeric(after.contractsNo),
    costBasisPoints: after.costBasisPoints,
  };
  await tx
    .insert(positions)
    .values({ marketId: input.marketId, userId, ...stored })
    .onConflictDoUpdate({ target: [positions.marketId, positions.userId], set: stored });

  // 10. The AMM state, as absolute values.
  await tx
    .update(markets)
    .set({
      qYes: formatNumeric(quote.stateAfter.qYes),
      qNo: formatNumeric(quote.stateAfter.qNo),
    })
    .where(eq(markets.id, input.marketId));

  // 11. The ledger. A sell's costPoints is negative, so the same entries flip direction; a dust
  // close-out whose proceeds floor to 0 moves no points.
  if (quote.costPoints !== 0) {
    await postTransfer(tx, {
      entries: [
        { accountType: "user", accountId: userId, deltaPoints: -quote.costPoints },
        { accountType: "market_pool", accountId: input.marketId, deltaPoints: quote.costPoints },
      ],
      reason: "trade",
      refType: "trade",
      refId: row.id,
    });
  }

  // 12. The chart point, at the trade's time (5b).
  await tx
    .insert(priceSnapshots)
    .values({ marketId: input.marketId, at, probabilityYes: quote.probAfter });

  return {
    ok: true,
    replayed: false,
    trade: { ...viewOf(row), avgPrice: quote.avgPrice },
    position: after,
    balance: balance - quote.costPoints,
    market: marketView(quote.stateAfter),
  };
}

async function findTrade(db: AnyDb, userId: string, key: string): Promise<TradeRow | undefined> {
  const [row] = await db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.idempotencyKey, key)));
  return row;
}

/**
 * The answer for a key that already has a trade: the original trade with the member's current
 * position, balance and market state, if the request is the same; never re-validated.
 */
async function replay(db: AnyDb, original: TradeRow, fingerprint: string): Promise<TradeResult> {
  if (original.requestFingerprint !== fingerprint) {
    return fail("idempotency_key_reused", "this key was already used for a different trade");
  }
  const [market] = await db
    .select({ b: markets.b, qYes: markets.qYes, qNo: markets.qNo })
    .from(markets)
    .where(eq(markets.id, original.marketId));
  if (!market) throw new Error("replayed trade has no market");
  const [balanceRow] = await db
    .select({ points: balances.points })
    .from(balances)
    .where(eq(balances.userId, original.userId));
  return {
    ok: true,
    replayed: true,
    trade: viewOf(original),
    position: await readPosition(db, original.marketId, original.userId),
    balance: balanceRow?.points ?? 0,
    market: marketView({
      b: market.b,
      qYes: parseNumeric(market.qYes),
      qNo: parseNumeric(market.qNo),
    }),
  };
}

async function readPosition(db: AnyDb, marketId: string, userId: string): Promise<Position> {
  const [row] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.marketId, marketId), eq(positions.userId, userId)));
  if (!row) return EMPTY_POSITION;
  return {
    contractsYes: parseNumeric(row.contractsYes),
    contractsNo: parseNumeric(row.contractsNo),
    costBasisPoints: row.costBasisPoints,
  };
}

/**
 * A stored trade for the client. Rows do not store the engine's average price, so this one is
 * the realized average (|cost| / |contracts|, whole points, clamped to 1–99); a fresh fill
 * overrides it with the quote's.
 */
function viewOf(row: TradeRow): TradeView {
  const contracts = parseNumeric(row.contracts);
  const realized = Math.round(Math.abs(row.costPoints) / Math.abs(contracts));
  return {
    id: row.id,
    side: row.side,
    contracts,
    costPoints: row.costPoints,
    avgPrice: Math.min(PRICE_MAX, Math.max(PRICE_MIN, realized)),
    probBefore: row.probBefore,
    probAfter: row.probAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

function marketView(state: MarketState): MarketQuoteState {
  const p = probabilityYes(state);
  return { qYes: state.qYes, qNo: state.qNo, probabilityYes: p, displayPrice: displayPrice(p) };
}

function toRequote(quote: Quote): Requote {
  return {
    avgPrice: quote.avgPrice,
    contracts: quote.contracts,
    costPoints: quote.costPoints,
    probAfter: quote.probAfter,
    payoutIfWin: quote.payoutIfWin,
  };
}

/** One JSON line with ids and the error's class and SQLSTATE only: no message, URL or values. */
function logInternalError(userId: string, marketId: string, e: unknown): void {
  const err = e as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const pgCode = err?.cause?.code ?? err?.code;
  console.error(
    JSON.stringify({
      event: "place_trade_internal_error",
      userId,
      marketId,
      error: e instanceof Error ? e.name : "unknown",
      ...(typeof pgCode === "string" && /^[0-9A-Z]{5}$/.test(pgCode) ? { pgCode } : {}),
    }),
  );
}
