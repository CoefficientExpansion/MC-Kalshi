import { CONTRACT_PAYOUT_POINTS, PRICE_MAX, PRICE_MIN } from "./constants";
import {
  assertContracts,
  assertFiniteContracts,
  assertPoints,
  assertSide,
  assertState,
  describe,
  EngineError,
  MAX_CONTRACTS,
} from "./errors";
import { ceilPoints, floorPoints, noNegativeZero, roundContracts } from "./rounding";
import { payoutPoints } from "./settlement";
import type { MarketState, Quote, Side } from "./types";

/**
 * Logarithmic market scoring rule, two outcomes (ADR-0002, architecture §5):
 *   C(qY, qN) = 100 · b · ln(e^{qY/b} + e^{qN/b})
 *   p_yes     = e^{qY/b} / (e^{qY/b} + e^{qN/b})
 * Probabilities are computed through log-sum-exp (subtract max(q)/b first) so no exponent
 * overflows. Trade costs and budget inversion work in the log domain, where ln p_yes and ln p_no
 * stay finite for every finite q even when the probabilities themselves underflow to 0.
 */
interface Scaled {
  readonly m: number;
  readonly ey: number;
  readonly en: number;
}

function scaled(state: MarketState): Scaled {
  const m = Math.max(state.qYes, state.qNo) / state.b;
  return {
    m,
    ey: Math.exp(state.qYes / state.b - m),
    en: Math.exp(state.qNo / state.b - m),
  };
}

interface LogProbs {
  readonly logPYes: number;
  readonly logPNo: number;
}

/**
 * ln p_yes = −softplus((qN − qY)/b) and ln p_no = −softplus((qY − qN)/b): only the gap enters, so
 * large but equal |q| never cancel. Exported for tests; not part of the package's public surface.
 */
export function logProbabilities(state: MarketState): LogProbs {
  const gap = (state.qYes - state.qNo) / state.b;
  return { logPYes: -softplus(-gap), logPNo: -softplus(gap) };
}

/** ln(e^a + e^b) without overflow. */
function logAddExp(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi + Math.log1p(Math.exp(lo - hi));
}

/** ln(1 + e^t) without overflow. */
function softplus(t: number): number {
  return t > 36 ? t + Math.log1p(Math.exp(-t)) : Math.log1p(Math.exp(t));
}

/**
 * Instantaneous probability of YES. In double precision it reaches exactly 1 once
 * (qY − qN) / b exceeds about 36.7 (ln 2⁵³) and exactly 0 below about −745.
 */
export function probabilityYes(state: MarketState): number {
  assertState(state);
  const { ey, en } = scaled(state);
  return ey / (ey + en);
}

/** Cost function C(q) in points, unrounded. */
export function costFunction(state: MarketState): number {
  assertState(state);
  const { m, ey, en } = scaled(state);
  return CONTRACT_PAYOUT_POINTS * state.b * (m + Math.log(ey + en));
}

/**
 * (C(q + Δ·e_side) − C(q)) / (100·b) = ln(p_other + p_side · e^{d}) with d = Δ / b.
 * Two branches keep full precision: log1p/expm1 for |d| ≤ 1 (the argument stays above −0.64, so
 * nothing cancels), and beyond that ln(p_other + p_side·e^d) as a log-sum-exp of two finite
 * logs, which adds two positive terms (no cancellation) and cannot overflow.
 */
function tradeValue(lp: LogProbs, side: Side, d: number): number {
  const logPSide = side === "YES" ? lp.logPYes : lp.logPNo;
  const logPOther = side === "YES" ? lp.logPNo : lp.logPYes;
  if (d >= -1 && d <= 1) {
    return Math.log1p(Math.exp(logPSide) * Math.expm1(d));
  }
  return logAddExp(logPOther, logPSide + d);
}

/** Exact cost of moving `delta` contracts on `side`, in points, unrounded. */
export function tradeCost(state: MarketState, side: Side, delta: number): number {
  assertSide(side);
  assertState(state);
  assertFiniteContracts(delta);
  const value = tradeValue(logProbabilities(state), side, delta / state.b);
  return noNegativeZero(CONTRACT_PAYOUT_POINTS * state.b * value);
}

function applyContracts(state: MarketState, side: Side, delta: number): MarketState {
  // Keep q on the six-decimal grid; fifty 0.1-contract buys would otherwise drift to 4.999999999999998.
  return side === "YES"
    ? { qYes: roundContracts(state.qYes + delta), qNo: noNegativeZero(state.qNo), b: state.b }
    : { qYes: noNegativeZero(state.qYes), qNo: roundContracts(state.qNo + delta), b: state.b };
}

function clampPrice(price: number): number {
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, price));
}

/**
 * Quote (and, server-side, fill) a trade of `contracts` on `side`: positive buys, negative sells.
 * Cost rounds up for buys and is never below one point; proceeds round down for sells;
 * contracts keep six decimals.
 */
export function quoteContracts(state: MarketState, side: Side, contracts: number): Quote {
  assertSide(side);
  assertState(state);
  assertContracts(contracts);
  const delta = roundContracts(contracts);
  if (delta === 0) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `contracts round to zero at six decimals: ${describe(contracts)}`,
    );
  }
  const stateAfter = applyContracts(state, side, delta);
  if (Math.abs(side === "YES" ? stateAfter.qYes : stateAfter.qNo) > MAX_CONTRACTS) {
    throw new EngineError(
      "INVALID_CONTRACTS",
      `trade would move q on ${side} beyond ±${MAX_CONTRACTS} contracts`,
    );
  }
  const value = tradeValue(logProbabilities(state), side, delta / state.b);
  const rawCost = CONTRACT_PAYOUT_POINTS * state.b * value;
  let costPoints: number;
  if (delta > 0) {
    costPoints = Math.max(1, ceilPoints(rawCost));
  } else {
    const proceeds = floorPoints(-rawCost);
    costPoints = proceeds === 0 ? 0 : -proceeds;
  }
  // From the exact cost, so the one-point minimum charge does not distort the displayed price.
  const avgPrice = clampPrice(Math.round(Math.abs(rawCost) / Math.abs(delta)));
  return {
    side,
    contracts: delta,
    costPoints,
    avgPrice,
    probBefore: probabilityYes(state),
    probAfter: probabilityYes(stateAfter),
    payoutIfWin: delta > 0 ? payoutPoints(delta) : 0,
    stateAfter,
  };
}

/**
 * Buy with a points budget: the largest six-decimal amount of contracts whose rounded cost does
 * not exceed `points`. The closed form from architecture §5 in the log domain:
 *   Δ / b = ln(1 + expm1(c / (100·b)) / p_side) = softplus( ln expm1(c/(100·b)) − ln p_side )
 * which stays finite for any budget and any representable state. When the floored amount would
 * trade more than MAX_CONTRACTS, or push the side's q beyond it, the fill is capped there and
 * accepted only if it still spends the whole budget (invariant 5); otherwise it is rejected.
 */
export function quotePoints(state: MarketState, side: Side, points: number): Quote {
  assertSide(side);
  assertState(state);
  assertPoints(points);
  const lp = logProbabilities(state);
  const logPSide = side === "YES" ? lp.logPYes : lp.logPNo;
  const x = points / (CONTRACT_PAYOUT_POINTS * state.b);
  const logExpm1 = x > 700 ? x : Math.log(Math.expm1(x));
  const exact = state.b * softplus(logExpm1 - logPSide);
  const quote = fitContractsToBudget(state, side, exact, points);
  if (Math.floor(exact * MICRO) > roomMicros(state, side) && quote.costPoints < points) {
    throw new EngineError(
      "INVALID_POINTS",
      `${points} points would buy more than this market can absorb (q on ${side} stays within ${MAX_CONTRACTS} contracts)`,
    );
  }
  return quote;
}

const MICRO = 1e6;
const MAX_MICROS = MAX_CONTRACTS * MICRO;
const MAX_BISECTION_STEPS = 64;
const MAX_FORWARD_PROBES = 4;

/** Micro-contracts one buy on `side` may add: |Δ| ≤ MAX_CONTRACTS and q after ≤ MAX_CONTRACTS. */
function roomMicros(state: MarketState, side: Side): number {
  const qMicros = Math.round((side === "YES" ? state.qYes : state.qNo) * MICRO);
  return Math.min(MAX_MICROS, MAX_MICROS - qMicros);
}

/**
 * The largest six-decimal amount, at most `exactDelta` floored (plus a few forward probes), whose
 * rounded cost fits `points`. Works on integer micro-contracts so the search is exact: if the
 * floored amount overshoots by noise, bisect down (at most 64 quotes); if it fits, probe forward
 * up to four micro-contracts so grid-exact answers that float a hair low are not left one short.
 * Never exceeds the room left under MAX_CONTRACTS. Exported for tests; not public surface.
 */
export function fitContractsToBudget(
  state: MarketState,
  side: Side,
  exactDelta: number,
  points: number,
): Quote {
  const room = roomMicros(state, side);
  if (room <= 0) {
    throw new EngineError("INVALID_POINTS", "this market cannot absorb that budget");
  }
  const quoteAt = (micros: number): Quote | undefined => {
    const quote = quoteContracts(state, side, micros / MICRO);
    return quote.costPoints <= points ? quote : undefined;
  };
  const top = Math.min(room, Math.floor(exactDelta * MICRO));
  if (top <= 0) {
    throw new EngineError("INVALID_POINTS", `${points} points buy less than one micro-contract`);
  }
  let best = quoteAt(top);
  let bestMicros = top;
  if (best) {
    for (let probe = 0; probe < MAX_FORWARD_PROBES && bestMicros < room; probe++) {
      const next = quoteAt(bestMicros + 1);
      if (!next) {
        break;
      }
      best = next;
      bestMicros += 1;
    }
    return best;
  }
  // Invariant: lo fits (0 trivially), hi does not.
  let lo = 0;
  let hi = top;
  for (let step = 0; step < MAX_BISECTION_STEPS && hi - lo > 1; step++) {
    const mid = Math.floor((lo + hi) / 2);
    const quote = quoteAt(mid);
    if (quote) {
      lo = mid;
      best = quote;
    } else {
      hi = mid;
    }
  }
  if (!best) {
    throw new EngineError("INVALID_POINTS", `${points} points buy less than one micro-contract`);
  }
  return best;
}
