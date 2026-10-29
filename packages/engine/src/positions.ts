/**
 * User positions, fills, settlement and void (docs/architecture.md §5). Pure, no I/O.
 * Shapes map 1:1 onto the `positions` and `trades` tables (M2/M3). Points are always integers;
 * contract amounts are exact multiples of 1e-6 (integer micro-contract arithmetic).
 */
import {
  assertOutcome,
  assertPosition,
  assertSide,
  describe,
  EngineError,
  MAX_CONTRACTS,
  MAX_POINTS,
  readFields,
} from "./errors";
import { noNegativeZero } from "./rounding";
import { payout, voidRefund } from "./settlement";
import type { Outcome, PositionLike, Quote } from "./types";

/** One user's holdings in one market; the same shape settlement takes. */
export type Position = PositionLike;

/** A position with nothing in it. */
export const EMPTY_POSITION: Position = { contractsYes: 0, contractsNo: 0, costBasisPoints: 0 };

/** The part of a {@link Quote} that changes a position. */
export type Fill = Pick<Quote, "side" | "contracts" | "costPoints">;

const MICRO = 1e6;
/** 1e15: holdings and fills stay within ±MAX_CONTRACTS, so every micro count is a safe integer. */
const MAX_MICROS = MAX_CONTRACTS * MICRO;

function readObject<K extends string>(value: unknown, keys: readonly K[], what: string) {
  if (typeof value !== "object" || value === null) {
    throw new EngineError("INVALID_STATE", `${what} must be an object, got ${describe(value)}`);
  }
  return readFields(value, keys, what);
}

/** Finite, within ±MAX_CONTRACTS; returns the amount in whole micro-contracts. */
function fillMicros(contracts: unknown): number {
  if (!Number.isFinite(contracts) || Math.abs(contracts as number) > MAX_CONTRACTS) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `fill contracts must be finite and within ±${MAX_CONTRACTS}, got ${describe(contracts)}`,
    );
  }
  return noNegativeZero(Math.round((contracts as number) * MICRO));
}

/**
 * New position after a fill: contracts are added (buy) or removed (sell) exactly, and the cost
 * basis moves by `costPoints` (negative for sells). Throws EngineError for a malformed position
 * or fill, or when a sell would take the user below zero contracts. Does not mutate `position`.
 */
export function applyFill(position: Position, fill: Fill): Position {
  assertPosition(position);
  const { side, contracts, costPoints } = readObject(
    fill,
    ["side", "contracts", "costPoints"],
    "fill",
  );
  assertSide(side);
  const delta = fillMicros(contracts);
  if (delta === 0) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `fill must move at least 1e-6 contracts, got ${describe(contracts)}`,
    );
  }
  if (!Number.isSafeInteger(costPoints)) {
    throw new EngineError(
      "INVALID_POINTS",
      `costPoints must be a whole number, got ${describe(costPoints)}`,
    );
  }
  const cost = costPoints as number;
  // A fill not built by a quote must still not hand out free contracts: buys cost at least 1
  // point, sells never charge the user.
  if (delta > 0 ? cost < 1 : cost > 0) {
    throw new EngineError(
      "INVALID_POINTS",
      `costPoints ${cost} has the wrong sign for ${delta > 0 ? "a buy" : "a sell"}`,
    );
  }
  const held = side === "YES" ? position.contractsYes : position.contractsNo;
  const updatedMicros = Math.round(held * MICRO) + delta;
  if (updatedMicros < 0) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `cannot sell ${describe(-(contracts as number))} ${side} contracts: only ${held} held`,
    );
  }
  if (updatedMicros > MAX_MICROS) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `holdings on ${side} would exceed ${MAX_CONTRACTS} contracts`,
    );
  }
  const costBasisPoints = noNegativeZero(position.costBasisPoints + cost);
  if (Math.abs(costBasisPoints) > MAX_POINTS) {
    throw new EngineError("INVALID_POINTS", `cost basis would exceed ±${MAX_POINTS} points`);
  }
  const updated = noNegativeZero(updatedMicros / MICRO);
  return side === "YES"
    ? { contractsYes: updated, contractsNo: noNegativeZero(position.contractsNo), costBasisPoints }
    : {
        contractsYes: noNegativeZero(position.contractsYes),
        contractsNo: updated,
        costBasisPoints,
      };
}

function assertNewUser<K>(seen: Map<K, number>, user: K): void {
  if (seen.has(user)) {
    throw new EngineError("INVALID_STATE", `duplicate position for user ${describe(user)}`);
  }
}

/**
 * Per-user payout when the market resolves to `outcome`, each computed by {@link payout}
 * (floor of winning contracts × 100, favoring the pool). `positions` is any iterable of
 * `[userKey, position]` pairs (a `Map` works); the result has one entry per user, in input
 * order. Throws EngineError (INVALID_STATE) on a duplicate user.
 */
export function settlePayouts<K>(
  positions: Iterable<readonly [K, Position]>,
  outcome: Outcome,
): Map<K, number> {
  assertOutcome(outcome);
  const payouts = new Map<K, number>();
  for (const [user, position] of positions) {
    assertNewUser(payouts, user);
    payouts.set(user, payout(position, outcome));
  }
  return payouts;
}

/**
 * Per-user refund when a market is voided, each computed by {@link voidRefund}: exactly the net
 * cost basis. A user who sold for more than they paid has a negative basis, so their refund is
 * a debit. Same input/output shape as {@link settlePayouts}.
 */
export function voidRefunds<K>(positions: Iterable<readonly [K, Position]>): Map<K, number> {
  const refunds = new Map<K, number>();
  for (const [user, position] of positions) {
    assertNewUser(refunds, user);
    refunds.set(user, voidRefund(position));
  }
  return refunds;
}

/**
 * Whether a fill is still acceptable against the average price the user saw. Buys are rejected
 * when `fill.avgPrice > expected + tolerance`, sells when `fill.avgPrice < expected − tolerance`
 * (both in points per contract). The sign of `fill.contracts` tells buys from sells.
 */
export function withinSlippage(
  expectedAvgPrice: number,
  fill: Pick<Quote, "contracts" | "avgPrice">,
  maxSlippagePoints = 2,
): boolean {
  const { contracts, avgPrice } = readObject(fill, ["contracts", "avgPrice"], "fill");
  if (!Number.isFinite(expectedAvgPrice) || !Number.isFinite(avgPrice)) {
    throw new EngineError(
      "INVALID_POINTS",
      `prices must be finite, got ${describe(expectedAvgPrice)} and ${describe(avgPrice)}`,
    );
  }
  if (!Number.isFinite(maxSlippagePoints) || maxSlippagePoints < 0) {
    throw new EngineError(
      "INVALID_POINTS",
      `maxSlippagePoints must be finite and non-negative, got ${describe(maxSlippagePoints)}`,
    );
  }
  if (!Number.isFinite(contracts) || contracts === 0) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `fill.contracts must be non-zero and finite, got ${describe(contracts)}`,
    );
  }
  const price = avgPrice as number;
  return (contracts as number) > 0
    ? price <= expectedAvgPrice + maxSlippagePoints
    : price >= expectedAvgPrice - maxSlippagePoints;
}
