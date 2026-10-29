import { CONTRACT_PAYOUT_POINTS } from "./constants";
import { assertLiquidity, assertOutcome, assertPosition } from "./errors";
import { noNegativeZero } from "./rounding";
import type { Outcome, PositionLike } from "./types";

const MICRO = 1e6;
const MICROS_PER_POINT = MICRO / CONTRACT_PAYOUT_POINTS;

/**
 * Worst case the pool can lose on one market: 100·b·ln 2, rounded up (architecture §5). Plain
 * ceil, no tolerance: the bound is irrational, so any fraction above a whole point is real.
 */
export function maxPoolLoss(b: number): number {
  assertLiquidity(b);
  return Math.ceil(CONTRACT_PAYOUT_POINTS * b * Math.LN2);
}

/**
 * Whole points `contracts` pay if they win, rounded down. Computed in micro-contract integers so
 * large six-decimal amounts (537000000.05 × 100) do not misround. Exported for lmsr.ts.
 */
export function payoutPoints(contracts: number): number {
  return noNegativeZero(Math.floor(Math.round(contracts * MICRO) / MICROS_PER_POINT));
}

/** Whole points a position receives when the market resolves to `outcome`; rounds down. */
export function payout(position: PositionLike, outcome: Outcome): number {
  assertOutcome(outcome);
  assertPosition(position);
  return payoutPoints(outcome === "YES" ? position.contractsYes : position.contractsNo);
}

/** Points returned on a void: exactly the user's net cost basis, which may be negative. */
export function voidRefund(position: PositionLike): number {
  assertPosition(position);
  const basis = position.costBasisPoints;
  return basis === 0 ? 0 : basis;
}
