/**
 * Quotes: the one function family that produces both the number shown in the order ticket and
 * the fill the server executes (docs/architecture.md §5). Pure, no I/O.
 *
 * Rounding always favors the pool: a buy's cost rounds UP to a whole point (and is at least 1),
 * a sell's proceeds round DOWN. Contracts are whole micro-contracts (multiples of 1e-6).
 */
import { CONTRACT_PAYOUT_POINTS } from "./constants";
import {
  assertState,
  costBetween,
  fromMicro,
  type MarketState,
  probYes,
  type Side,
  shiftState,
  toMicro,
} from "./lmsr";

/** A priced trade. `contracts` and `costPoints` are signed: positive = buy, negative = sell. */
export interface Quote {
  readonly side: Side;
  /** Signed contracts, an exact multiple of 1e-6 (+ buy, − sell). */
  readonly contracts: number;
  /** Signed integer points: positive = user pays, negative = user receives (sell proceeds). */
  readonly costPoints: number;
  /** |costPoints| / |contracts|, in points per contract (0–100 for any non-dust trade). */
  readonly avgPrice: number;
  /** P(YES) before the trade. */
  readonly probBefore: number;
  /** P(YES) after the trade, equal to `probYes(nextState)`. */
  readonly probAfter: number;
  /** floor(contracts × 100) for a buy, 0 for a sell. */
  readonly payoutIfWin: number;
  readonly nextState: MarketState;
}

function assertSide(side: Side): void {
  if (side !== "YES" && side !== "NO") {
    throw new RangeError(`side must be "YES" or "NO", got ${String(side)}`);
  }
}

function sideQ(state: MarketState, side: Side): [qSide: number, qOther: number] {
  return side === "YES" ? [state.qYes, state.qNo] : [state.qNo, state.qYes];
}

/** Contracts → whole micro-contracts, which must be at least 1. */
function positiveMicro(contracts: number): number {
  const micro = toMicro(contracts);
  if (micro < 1) {
    throw new RangeError(`contracts must be at least 1e-6, got ${contracts}`);
  }
  return micro;
}

/** Cost in whole points of moving the market from `state` to `next` by a buy: rounded up, never below 1. */
function buyCost(state: MarketState, side: Side, next: MarketState): number {
  const [qFrom, qOther] = sideQ(state, side);
  const [qTo] = sideQ(next, side);
  return Math.max(1, Math.ceil(costBetween(state.b, qFrom, qTo, qOther)));
}

function makeQuote(
  state: MarketState,
  side: Side,
  micro: number,
  costPoints: number,
  nextState: MarketState,
): Quote {
  const contracts = fromMicro(micro);
  const buying = micro > 0;
  return {
    side,
    contracts,
    costPoints,
    avgPrice: Math.abs(costPoints) / Math.abs(contracts),
    probBefore: probYes(state),
    probAfter: probYes(nextState),
    // contracts × 100 = micro / 1e4, kept in integer arithmetic.
    payoutIfWin: buying ? Math.floor(micro / (1e6 / CONTRACT_PAYOUT_POINTS)) : 0,
    nextState,
  };
}

function buyMicro(state: MarketState, side: Side, micro: number): Quote {
  const nextState = shiftState(state, side, micro);
  return makeQuote(state, side, micro, buyCost(state, side, nextState), nextState);
}

/**
 * Contracts a budget of `points` buys on `side`, from the closed form in §5 in a numerically
 * stable arrangement: Δ = b·(t + ln(1 + r·k)) with t = points/(100·b), k = 1 − e^{-t} and
 * r = e^{(qOther − qSide)/b}; the log is evaluated so neither r nor 1/r can overflow.
 */
function contractsForBudget(b: number, qSide: number, qOther: number, points: number): number {
  const t = points / (CONTRACT_PAYOUT_POINTS * b);
  const k = -Math.expm1(-t);
  const u = (qOther - qSide) / b;
  const logTerm = u <= 0 ? Math.log1p(Math.exp(u) * k) : u + Math.log(k + Math.exp(-u));
  return b * (t + logTerm);
}

/**
 * Quote spending (at most) `points` whole points on `side`. Contracts are floored to 6 dp and
 * the cost rounded up, then contracts step down by 1e-6 while the rounded cost exceeds the
 * budget, so `costPoints <= points` always holds.
 */
export function quoteBuyWithPoints(state: MarketState, side: Side, points: number): Quote {
  assertState(state);
  assertSide(side);
  if (!Number.isSafeInteger(points) || points < 1) {
    throw new RangeError(`points must be a positive whole number, got ${points}`);
  }
  const [qSide, qOther] = sideQ(state, side);
  const exact = contractsForBudget(state.b, qSide, qOther, points);
  const floored = Math.floor(exact * 1e6);
  if (!Number.isSafeInteger(floored)) {
    throw new RangeError(`budget of ${points} points is too large for this market`);
  }
  // One micro-contract always fits: it costs at most 1 point.
  let micro = Math.max(1, floored);
  let nextState = shiftState(state, side, micro);
  let cost = buyCost(state, side, nextState);
  while (cost > points && micro > 1) {
    micro -= 1;
    nextState = shiftState(state, side, micro);
    cost = buyCost(state, side, nextState);
  }
  return makeQuote(state, side, micro, cost, nextState);
}

/** Quote buying exactly `contracts` of `side`; the cost is rounded up to a whole point. */
export function quoteBuyContracts(state: MarketState, side: Side, contracts: number): Quote {
  assertState(state);
  assertSide(side);
  return buyMicro(state, side, positiveMicro(contracts));
}

/**
 * Quote selling `contracts` of `side` back to the AMM. Proceeds are rounded down and reported as
 * a negative `costPoints`. Throws `RangeError` when `contracts` exceeds the AMM's `q` on that
 * side (which would drive q below 0).
 */
export function quoteSellContracts(state: MarketState, side: Side, contracts: number): Quote {
  assertState(state);
  assertSide(side);
  const micro = positiveMicro(contracts);
  const [qSide, qOther] = sideQ(state, side);
  if (micro > toMicro(qSide)) {
    throw new RangeError(
      `cannot sell ${contracts} ${side} contracts: the market holds only ${qSide}`,
    );
  }
  const nextState = shiftState(state, side, -micro);
  const [qTo] = sideQ(nextState, side);
  const proceeds = Math.floor(-costBetween(state.b, qSide, qTo, qOther));
  // `0 - x` rather than `-x` so that zero proceeds give +0, never -0.
  return makeQuote(state, side, -micro, 0 - proceeds, nextState);
}
