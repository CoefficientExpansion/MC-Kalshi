/**
 * LMSR core math (docs/architecture.md §5). Pure functions, no I/O.
 *
 * Units: `q` and contract amounts are in contracts, kept to 6 decimal places (1 micro-contract =
 * 1e-6). Costs are in points. Internally the engine does contract arithmetic on integer
 * micro-contracts so that every contract number it returns is an exact multiple of 1e-6.
 */
import { CONTRACT_PAYOUT_POINTS, clampProbability } from "./constants";

/** The two outcomes of a binary market. */
export type Side = "YES" | "NO";

/** Market state: liquidity `b` (contracts) and contracts the AMM has sold on each side. */
export interface MarketState {
  readonly b: number;
  readonly qYes: number;
  readonly qNo: number;
}

/** Micro-contracts per contract: contracts are kept to 6 dp. */
export const MICRO_PER_CONTRACT = 1_000_000;
/** Moderators may set `b` between these bounds (inclusive) for a new market. */
export const LIQUIDITY_MIN = 50;
export const LIQUIDITY_MAX = 500;
/** Default liquidity for a new market. */
export const DEFAULT_LIQUIDITY = 100;

/**
 * Probabilities are clamped to [2^-53, 1 − 2^-53] so that they stay strictly inside (0, 1) as
 * doubles however lopsided the market is, and p_yes + p_no is exactly 1 at the extremes.
 */
const PROB_FLOOR = 2 ** -53;

function assertSide(side: Side): void {
  if (side !== "YES" && side !== "NO") {
    throw new RangeError(`side must be "YES" or "NO", got ${String(side)}`);
  }
}

/** Throws `RangeError` unless `b` is positive and finite and both q are finite. */
export function assertState(state: MarketState): void {
  if (!Number.isFinite(state.b) || state.b <= 0) {
    throw new RangeError(`b must be a positive finite number, got ${state.b}`);
  }
  if (!Number.isFinite(state.qYes) || !Number.isFinite(state.qNo)) {
    throw new RangeError(`q must be finite, got qYes=${state.qYes}, qNo=${state.qNo}`);
  }
}

/** Convert contracts to integer micro-contracts (rounds to the nearest micro-contract). */
export function toMicro(contracts: number): number {
  if (!Number.isFinite(contracts)) {
    throw new RangeError(`contracts must be finite, got ${contracts}`);
  }
  const micro = Math.round(contracts * MICRO_PER_CONTRACT);
  if (!Number.isSafeInteger(micro)) {
    throw new RangeError(`contract amount ${contracts} is too large`);
  }
  return micro;
}

/** Convert integer micro-contracts to contracts; the result is an exact multiple of 1e-6. */
export function fromMicro(micro: number): number {
  if (!Number.isSafeInteger(micro)) {
    throw new RangeError(`micro-contracts must be a safe integer, got ${micro}`);
  }
  return micro / MICRO_PER_CONTRACT;
}

/** Returns `b` if it is a valid liquidity parameter for a new market (50–500), else throws. */
export function validateLiquidity(b: number): number {
  if (!Number.isFinite(b) || b < LIQUIDITY_MIN || b > LIQUIDITY_MAX) {
    throw new RangeError(`b must be between ${LIQUIDITY_MIN} and ${LIQUIDITY_MAX}, got ${b}`);
  }
  return b;
}

/** A fresh market with nothing sold (p = 0.5). `b` defaults to 100 and is validated. */
export function initialState(b: number = DEFAULT_LIQUIDITY): MarketState {
  return { b: validateLiquidity(b), qYes: 0, qNo: 0 };
}

/** ln(1 + e^{-|d|/b}): the log-sum-exp remainder after factoring out the larger exponent. */
function lseRemainder(d: number, b: number): number {
  return Math.log1p(Math.exp(-Math.abs(d) / b));
}

/**
 * Cost function C(q) = 100·b·ln(e^{qYes/b} + e^{qNo/b}), in points, via log-sum-exp
 * (`max + log1p(exp(-|Δ|/b))`), so it never overflows for finite q.
 */
export function costFunction(state: MarketState): number {
  assertState(state);
  const { b, qYes, qNo } = state;
  return CONTRACT_PAYOUT_POINTS * (Math.max(qYes, qNo) + b * lseRemainder(qYes - qNo, b));
}

/**
 * Cost in points of moving one side's q from `qFrom` to `qTo` while the other side stays at
 * `qOther`: C(after) − C(before), negative for a decrease. Computed from the difference of the
 * log-sum-exp terms rather than of two huge C values, so it stays accurate at large q.
 * Internal building block for {@link rawCost} and the quotes.
 */
export function costBetween(b: number, qFrom: number, qTo: number, qOther: number): number {
  const shift = Math.max(qTo, qOther) - Math.max(qFrom, qOther);
  const remainder = lseRemainder(qTo - qOther, b) - lseRemainder(qFrom - qOther, b);
  return CONTRACT_PAYOUT_POINTS * (shift + b * remainder);
}

/**
 * Unrounded cost in points of buying `contracts` of `side` (negative `contracts` is a sell and
 * gives a negative cost, i.e. proceeds). Exactly 0 for 0 contracts.
 */
export function rawCost(state: MarketState, side: Side, contracts: number): number {
  assertState(state);
  assertSide(side);
  if (!Number.isFinite(contracts)) {
    throw new RangeError(`contracts must be finite, got ${contracts}`);
  }
  const [qSide, qOther] = side === "YES" ? [state.qYes, state.qNo] : [state.qNo, state.qYes];
  return costBetween(state.b, qSide, qSide + contracts, qOther);
}

/** Instantaneous P(YES) = e^{qYes/b} / (e^{qYes/b} + e^{qNo/b}), strictly inside (0, 1). */
export function probYes(state: MarketState): number {
  assertState(state);
  const x = (state.qYes - state.qNo) / state.b;
  // Logistic of x, evaluated on the side that cannot overflow.
  const p = x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
  return Math.min(1 - PROB_FLOOR, Math.max(PROB_FLOOR, p));
}

/** Instantaneous P(NO) = 1 − P(YES), computed symmetrically so it is strictly inside (0, 1). */
export function probNo(state: MarketState): number {
  return probYes({ b: state.b, qYes: state.qNo, qNo: state.qYes });
}

/** Display price: an integer 1–99 equal to `round(p·100)`, clamped. */
export function displayPrice(p: number): number {
  return Math.round(clampProbability(p) * 100);
}

/** Worst-case loss for the pool in points: 100·b·ln 2 (about 6,931 at b = 100). */
export function maxPoolLoss(b: number): number {
  if (!Number.isFinite(b) || b <= 0) {
    throw new RangeError(`b must be a positive finite number, got ${b}`);
  }
  return CONTRACT_PAYOUT_POINTS * b * Math.LN2;
}

/**
 * New state after the AMM sells (positive) or buys back (negative) `deltaMicro` micro-contracts
 * of `side`. Exact: q stays a multiple of 1e-6. Does not mutate `state`.
 */
export function shiftState(state: MarketState, side: Side, deltaMicro: number): MarketState {
  assertState(state);
  assertSide(side);
  if (!Number.isSafeInteger(deltaMicro)) {
    throw new RangeError(`deltaMicro must be a safe integer, got ${deltaMicro}`);
  }
  const current = side === "YES" ? state.qYes : state.qNo;
  const next = fromMicro(toMicro(current) + deltaMicro);
  return side === "YES" ? { ...state, qYes: next } : { ...state, qNo: next };
}
