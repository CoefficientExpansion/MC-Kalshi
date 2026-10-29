/**
 * User positions, fills, settlement and void (docs/architecture.md §5). Pure, no I/O.
 * Shapes map 1:1 onto the `positions` and `trades` tables (M2/M3). Points are always integers;
 * contract amounts are exact multiples of 1e-6 (integer micro-contract arithmetic).
 */
import {
  assertOutcome,
  assertSide,
  describe,
  EngineError,
  MAX_CONTRACTS,
  MAX_POINTS,
  readFields,
  readPosition,
} from "./errors";
import { noNegativeZero, roundContracts } from "./rounding";
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

/**
 * Non-zero, finite, within ±MAX_CONTRACTS and exactly on the six-decimal grid (no silent
 * rounding: 5e-7 or 1.0000004 is rejected, not booked); returns whole micro-contracts.
 */
function fillMicros(contracts: unknown): number {
  if (
    typeof contracts !== "number" ||
    !Number.isFinite(contracts) ||
    Math.abs(contracts) > MAX_CONTRACTS ||
    roundContracts(contracts) !== contracts ||
    contracts === 0
  ) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `fill contracts must be non-zero, finite, within ±${MAX_CONTRACTS} and on the six-decimal grid, got ${describe(contracts)}`,
    );
  }
  return Math.round(contracts * MICRO);
}

/**
 * New position after a fill: contracts are added (buy) or removed (sell) exactly, and the cost
 * basis moves by `costPoints` (negative for sells). Throws EngineError for a malformed position
 * or fill, or when a sell would take the user below zero contracts. Does not mutate `position`.
 */
export function applyFill(position: Position, fill: Fill): Position {
  // Snapshots: neither `position` nor `fill` is read again below.
  const held = readPosition(position);
  const { side, contracts, costPoints } = readObject(
    fill,
    ["side", "contracts", "costPoints"],
    "fill",
  );
  assertSide(side);
  const delta = fillMicros(contracts);
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
  const onSide = side === "YES" ? held.contractsYes : held.contractsNo;
  const updatedMicros = Math.round(onSide * MICRO) + delta;
  if (updatedMicros < 0) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `cannot sell ${describe(-(contracts as number))} ${side} contracts: only ${onSide} held`,
    );
  }
  if (updatedMicros > MAX_MICROS) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `holdings on ${side} would exceed ${MAX_CONTRACTS} contracts`,
    );
  }
  const costBasisPoints = noNegativeZero(held.costBasisPoints + cost);
  if (Math.abs(costBasisPoints) > MAX_POINTS) {
    throw new EngineError("INVALID_POINTS", `cost basis would exceed ±${MAX_POINTS} points`);
  }
  const updated = noNegativeZero(updatedMicros / MICRO);
  return side === "YES"
    ? { contractsYes: updated, contractsNo: noNegativeZero(held.contractsNo), costBasisPoints }
    : {
        contractsYes: noNegativeZero(held.contractsYes),
        contractsNo: updated,
        costBasisPoints,
      };
}

const NOT_PAIRS = "positions must be an iterable of [user, position] pairs";

/**
 * Drains `positions` into an array of `[user, position]` pairs. `Symbol.iterator` is read and
 * called exactly once and the iterator is driven by hand. Anything caller code throws (the
 * iterator getter, the iterator factory, `next()`, or a getter on its result or on a pair) becomes
 * a fresh EngineError (INVALID_STATE) without the thrown value being inspected, so a forged or
 * hostile throwable cannot escape and an EngineError raised inside a caller's generator does not
 * keep its own code. A non-iterable input or an element that is not a two-element array is also
 * INVALID_STATE. Position contents are not checked here: payout()/voidRefund() check them.
 */
function readPairs<K>(positions: unknown): Array<readonly [K, unknown]> {
  if (typeof positions !== "object" || positions === null) {
    throw new EngineError("INVALID_STATE", `${NOT_PAIRS}, got ${describe(positions)}`);
  }
  let factory: unknown;
  try {
    factory = (positions as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  } catch {
    throw new EngineError("INVALID_STATE", "positions could not be iterated");
  }
  if (typeof factory !== "function") {
    throw new EngineError("INVALID_STATE", NOT_PAIRS);
  }
  let iterator: unknown;
  try {
    iterator = factory.call(positions);
  } catch {
    throw new EngineError("INVALID_STATE", "positions could not be iterated");
  }
  const pairs: Array<readonly [K, unknown]> = [];
  for (;;) {
    let done: unknown;
    let entry: unknown;
    try {
      const result = (iterator as Iterator<unknown>).next();
      done = result.done;
      entry = done ? undefined : result.value;
    } catch {
      throw new EngineError("INVALID_STATE", "positions could not be iterated");
    }
    if (done) return pairs;
    pairs.push(readPair<K>(entry));
  }
}

/** One element of `positions`: exactly a two-element array, else INVALID_STATE. */
function readPair<K>(entry: unknown): readonly [K, unknown] {
  let isPair: boolean;
  let user: unknown;
  let position: unknown;
  try {
    isPair = Array.isArray(entry) && entry.length === 2;
    user = isPair ? (entry as unknown[])[0] : undefined;
    position = isPair ? (entry as unknown[])[1] : undefined;
  } catch {
    throw new EngineError("INVALID_STATE", "a positions element could not be read");
  }
  if (!isPair) {
    throw new EngineError("INVALID_STATE", `${NOT_PAIRS}, got an element ${describe(entry)}`);
  }
  return [user as K, position];
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
 * order. Users are compared by Map key identity, so key by user id strings, never by objects.
 *
 * Errors (always EngineError): a malformed iterable, any failure while iterating it, an element
 * that is not a `[user, position]` pair, or a duplicate user → INVALID_STATE; a well-formed pair
 * whose position is invalid → the code {@link payout} gives for it (INVALID_CONTRACTS or
 * INVALID_POINTS).
 */
export function settlePayouts<K>(
  positions: Iterable<readonly [K, Position]>,
  outcome: Outcome,
): Map<K, number> {
  assertOutcome(outcome);
  const payouts = new Map<K, number>();
  for (const [user, position] of readPairs<K>(positions)) {
    assertNewUser(payouts, user);
    payouts.set(user, payout(position as Position, outcome));
  }
  return payouts;
}

/**
 * Per-user refund when a market is voided, each computed by {@link voidRefund}: exactly the net
 * cost basis. A user who sold for more than they paid has a negative basis, so their refund is
 * a debit. Same input/output shape as {@link settlePayouts}.
 *
 * Errors (always EngineError): a malformed iterable, any failure while iterating it, an element
 * that is not a `[user, position]` pair, or a duplicate user → INVALID_STATE; a well-formed pair
 * whose position is invalid → the code {@link voidRefund} gives for it (INVALID_CONTRACTS or
 * INVALID_POINTS).
 */
export function voidRefunds<K>(positions: Iterable<readonly [K, Position]>): Map<K, number> {
  const refunds = new Map<K, number>();
  for (const [user, position] of readPairs<K>(positions)) {
    assertNewUser(refunds, user);
    refunds.set(user, voidRefund(position as Position));
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
