/**
 * User positions, fills, settlement and void (docs/architecture.md §5). Pure, no I/O.
 * Shapes map 1:1 onto the `positions` and `trades` tables (M2/M3). Points are always integers;
 * contract amounts are exact multiples of 1e-6 (integer micro-contract arithmetic).
 */
import { CONTRACT_PAYOUT_POINTS } from "./constants";
import { fromMicro, type Side, toMicro } from "./lmsr";
import type { Quote } from "./quote";

/** One user's holdings in one market. */
export interface Position {
  readonly contractsYes: number;
  readonly contractsNo: number;
  /** Net points paid in: Σ costPoints of every fill (sell proceeds subtract). */
  readonly costBasisPoints: number;
}

/** A position with nothing in it. */
export const EMPTY_POSITION: Position = { contractsYes: 0, contractsNo: 0, costBasisPoints: 0 };

/** The part of a {@link Quote} that changes a position. */
export type Fill = Pick<Quote, "side" | "contracts" | "costPoints">;

function assertSide(side: Side): void {
  if (side !== "YES" && side !== "NO") {
    throw new RangeError(`side must be "YES" or "NO", got ${String(side)}`);
  }
}

function assertPosition(position: Position): void {
  for (const contracts of [position.contractsYes, position.contractsNo]) {
    if (!Number.isFinite(contracts) || contracts < 0) {
      throw new RangeError(`position contracts must be finite and non-negative, got ${contracts}`);
    }
  }
  if (!Number.isSafeInteger(position.costBasisPoints)) {
    throw new RangeError(`costBasisPoints must be a whole number, got ${position.costBasisPoints}`);
  }
}

/**
 * New position after a fill: contracts are added (buy) or removed (sell) exactly, and the cost
 * basis moves by `costPoints` (negative for sells). Throws `RangeError` for a malformed fill or
 * when a sell would take the user below zero contracts. Does not mutate `position`.
 */
export function applyFill(position: Position, fill: Fill): Position {
  assertPosition(position);
  assertSide(fill.side);
  const delta = toMicro(fill.contracts);
  if (delta === 0) {
    throw new RangeError(`fill must move at least 1e-6 contracts, got ${fill.contracts}`);
  }
  if (!Number.isSafeInteger(fill.costPoints)) {
    throw new RangeError(`costPoints must be a whole number, got ${fill.costPoints}`);
  }
  const held = fill.side === "YES" ? position.contractsYes : position.contractsNo;
  const updatedMicro = toMicro(held) + delta;
  if (updatedMicro < 0) {
    throw new RangeError(
      `cannot sell ${-fill.contracts} ${fill.side} contracts: only ${held} held`,
    );
  }
  const updated = fromMicro(updatedMicro);
  const costBasisPoints = position.costBasisPoints + fill.costPoints;
  return fill.side === "YES"
    ? { contractsYes: updated, contractsNo: position.contractsNo, costBasisPoints }
    : { contractsYes: position.contractsYes, contractsNo: updated, costBasisPoints };
}

/**
 * Per-user payout when the market resolves to `outcome`: floor(winning contracts × 100) whole
 * points (rounds down, favoring the pool). `positions` is any iterable of `[userKey, position]`
 * pairs (a `Map` works); the result has one entry per user, in input order. Throws `RangeError`
 * on a duplicate user.
 */
export function settlePayouts<K>(
  positions: Iterable<readonly [K, Position]>,
  outcome: Side,
): Map<K, number> {
  assertSide(outcome);
  const payouts = new Map<K, number>();
  for (const [user, position] of positions) {
    assertPosition(position);
    if (payouts.has(user)) {
      throw new RangeError(`duplicate position for user ${String(user)}`);
    }
    const winning = outcome === "YES" ? position.contractsYes : position.contractsNo;
    // contracts × 100 = micro / 1e4, kept in integer arithmetic.
    payouts.set(user, Math.floor(toMicro(winning) / (1e6 / CONTRACT_PAYOUT_POINTS)));
  }
  return payouts;
}

/**
 * Per-user refund when a market is voided: exactly the net cost basis. A user who sold for more
 * than they paid has a negative basis, so their refund is a debit. Same input/output shape as
 * {@link settlePayouts}.
 */
export function voidRefunds<K>(positions: Iterable<readonly [K, Position]>): Map<K, number> {
  const refunds = new Map<K, number>();
  for (const [user, position] of positions) {
    assertPosition(position);
    if (refunds.has(user)) {
      throw new RangeError(`duplicate position for user ${String(user)}`);
    }
    // `+ 0` normalizes -0 to +0.
    refunds.set(user, position.costBasisPoints + 0);
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
  if (!Number.isFinite(expectedAvgPrice) || !Number.isFinite(fill.avgPrice)) {
    throw new RangeError("prices must be finite");
  }
  if (!Number.isFinite(maxSlippagePoints) || maxSlippagePoints < 0) {
    throw new RangeError(
      `maxSlippagePoints must be finite and non-negative, got ${maxSlippagePoints}`,
    );
  }
  if (!Number.isFinite(fill.contracts) || fill.contracts === 0) {
    throw new RangeError(`fill.contracts must be non-zero and finite, got ${fill.contracts}`);
  }
  return fill.contracts > 0
    ? fill.avgPrice <= expectedAvgPrice + maxSlippagePoints
    : fill.avgPrice >= expectedAvgPrice - maxSlippagePoints;
}
