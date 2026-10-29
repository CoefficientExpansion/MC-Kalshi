import type { Position, Side } from "@mc-kalshi/engine";
import type { Market } from "@/db/schema";
import {
  DEFAULT_MAX_SLIPPAGE,
  MAX_INPUT_CONTRACTS,
  MAX_INPUT_POINTS,
  MAX_SLIPPAGE,
  MIN_BUY_POINTS,
} from "./trade-limits";

// The trading contract (docs/specs/m3-trading.md, "placeTrade" and task 0): what the order ticket
// sends, what placeTrade returns, and the market state the page polls. Shared with client code:
// no server-only import and no Node built-ins here (the request fingerprint lives in
// `trade-fingerprint.ts`).

export const TRADE_MODES = ["buy_points", "buy_contracts", "sell_contracts"] as const;
export type TradeMode = (typeof TRADE_MODES)[number];

/** What the client sends. `amount` is whole points for `buy_points`, else contracts. */
export interface TradeInput {
  readonly marketId: string;
  readonly side: Side;
  readonly mode: TradeMode;
  readonly amount: number;
  /** Points per contract (0–100): the average price the ticket displayed. */
  readonly expectedAvgPrice: number;
  /** Points per contract, 0–10; default 2. */
  readonly maxSlippage?: number;
  /**
   * The total cost the ticket displayed, whole points >= 1. Required for `buy_contracts` (the
   * fill may cost at most ceil(maxSlippage × contracts) more); ignored and dropped otherwise.
   */
  readonly expectedCostPoints?: number;
  /** 16–64 chars of [A-Za-z0-9_-]; the client sends `crypto.randomUUID()`. */
  readonly idempotencyKey: string;
}

/**
 * A validated input: `marketId` lowercased, `maxSlippage` defaulted, unknown fields dropped
 * (`expectedCostPoints` is present only for `buy_contracts`).
 */
export type ParsedTradeInput = TradeInput & { readonly maxSlippage: number };

export type ParseTradeInputResult =
  | { readonly ok: true; readonly input: ParsedTradeInput }
  | { readonly ok: false; readonly code: "invalid_input" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const MICRO = 1e6;

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

const isSide = (x: unknown): x is Side => x === "YES" || x === "NO";

const isMode = (x: unknown): x is TradeMode =>
  typeof x === "string" && (TRADE_MODES as readonly string[]).includes(x);

function isValidAmount(mode: TradeMode, amount: unknown): amount is number {
  if (!isFiniteNumber(amount)) return false;
  if (mode === "buy_points") {
    return Number.isInteger(amount) && amount >= MIN_BUY_POINTS && amount <= MAX_INPUT_POINTS;
  }
  // Contracts: positive, at most six decimals, and no more than the sanity cap. The minimum trade
  // size (0.01) is a size rule (`trade_too_small`), checked after quoting, not here.
  return (
    amount > 0 && amount <= MAX_INPUT_CONTRACTS && Math.round(amount * MICRO) / MICRO === amount
  );
}

const INVALID: ParseTradeInputResult = { ok: false, code: "invalid_input" };

/**
 * Validates untrusted input (a server action argument) into a {@link ParsedTradeInput}. Pure;
 * never throws, even for a hostile object whose getters throw.
 */
export function parseTradeInput(raw: unknown): ParseTradeInputResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return INVALID;
  let fields: Record<string, unknown>;
  try {
    const r = raw as Record<string, unknown>;
    fields = {
      marketId: r.marketId,
      side: r.side,
      mode: r.mode,
      amount: r.amount,
      expectedAvgPrice: r.expectedAvgPrice,
      maxSlippage: r.maxSlippage,
      idempotencyKey: r.idempotencyKey,
      expectedCostPoints: r.expectedCostPoints,
    };
  } catch {
    return INVALID;
  }
  const { marketId, side, mode, amount, expectedAvgPrice, idempotencyKey, expectedCostPoints } =
    fields;
  const maxSlippage = fields.maxSlippage === undefined ? DEFAULT_MAX_SLIPPAGE : fields.maxSlippage;
  if (
    typeof marketId !== "string" ||
    !UUID.test(marketId) ||
    !isSide(side) ||
    !isMode(mode) ||
    !isValidAmount(mode, amount) ||
    !isFiniteNumber(expectedAvgPrice) ||
    expectedAvgPrice < 0 ||
    expectedAvgPrice > 100 ||
    !isFiniteNumber(maxSlippage) ||
    maxSlippage < 0 ||
    maxSlippage > MAX_SLIPPAGE ||
    typeof idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY.test(idempotencyKey)
  ) {
    return INVALID;
  }
  const input: ParsedTradeInput = {
    marketId: marketId.toLowerCase(),
    side,
    mode,
    amount,
    expectedAvgPrice,
    maxSlippage,
    idempotencyKey,
  };
  if (mode !== "buy_contracts") return { ok: true, input };
  if (
    !isFiniteNumber(expectedCostPoints) ||
    !Number.isInteger(expectedCostPoints) ||
    expectedCostPoints < 1 ||
    expectedCostPoints > MAX_INPUT_POINTS
  ) {
    return INVALID;
  }
  return { ok: true, input: { ...input, expectedCostPoints } };
}

/** Every expected failure code (spec "Error taxonomy"). The UI maps each to fixed copy. */
export const TRADE_ERROR_CODES = [
  "trading_paused",
  "unauthenticated",
  "account_suspended",
  "invalid_input",
  "market_not_found",
  "market_not_open",
  "market_closed",
  "slippage_exceeded",
  "trade_too_small",
  "trade_too_large",
  "insufficient_balance",
  "insufficient_position",
  "rate_limited",
  "idempotency_key_reused",
  "internal_error",
] as const;
export type TradeErrorCode = (typeof TRADE_ERROR_CODES)[number];

/** The fresh quote offered after `slippage_exceeded`. */
export interface Requote {
  readonly avgPrice: number;
  readonly contracts: number;
  readonly costPoints: number;
  readonly probAfter: number;
  readonly payoutIfWin: number;
}

/** The trade as returned to the client (`createdAt` is an ISO 8601 string). */
export interface TradeView {
  readonly id: string;
  readonly side: Side;
  /** Signed: positive for a buy, negative for a sell. */
  readonly contracts: number;
  /** Signed whole points: positive paid, negative received. */
  readonly costPoints: number;
  readonly avgPrice: number;
  readonly probBefore: number;
  readonly probAfter: number;
  readonly createdAt: string;
}

export interface MarketQuoteState {
  readonly qYes: number;
  readonly qNo: number;
  readonly probabilityYes: number;
  readonly displayPrice: number;
}

export interface TradeSuccess {
  readonly ok: true;
  /** True when this is the original result of an earlier call with the same key and input. */
  readonly replayed: boolean;
  readonly trade: TradeView;
  readonly position: Position;
  readonly balance: number;
  readonly market: MarketQuoteState;
}

type Failure<C extends TradeErrorCode, Extra = unknown> = {
  readonly ok: false;
  readonly code: C;
  /** For logs and tests; the UI never shows it. */
  readonly message: string;
} & Extra;

/** Codes whose failure carries extra fields. */
type CodesWithExtras =
  | "slippage_exceeded"
  | "trade_too_large"
  | "insufficient_balance"
  | "insufficient_position"
  | "rate_limited";

export type TradeFailure =
  | Failure<"slippage_exceeded", { readonly requote: Requote }>
  | Failure<"trade_too_large", { readonly maxPoints: number }>
  | Failure<"insufficient_balance", { readonly balance: number; readonly needed: number }>
  | Failure<"insufficient_position", { readonly held: number }>
  | Failure<"rate_limited", { readonly retryAfterSec: number }>
  | Failure<Exclude<TradeErrorCode, CodesWithExtras>>;

export type TradeResult = TradeSuccess | TradeFailure;

/**
 * `GET /api/markets/[id]/state` (polled every 3 s). `balance` and `position` are present only for
 * a signed-in member. `closeAt` is an ISO 8601 string.
 */
export interface MarketStateDto {
  readonly status: Market["status"];
  readonly closeAt: string;
  readonly b: number;
  readonly qYes: number;
  readonly qNo: number;
  readonly probabilityYes: number;
  /** Whole-percent YES price, 1–99 (engine `displayPrice`). */
  readonly displayPrice: number;
  readonly balance?: number;
  readonly position?: Position;
}
