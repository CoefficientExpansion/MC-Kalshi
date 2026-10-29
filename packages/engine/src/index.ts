/**
 * MC-Kalshi market engine: pure functions only (no I/O). See docs/architecture.md §5 and
 * docs/specs/m1-engine.md. Everything the app may import is re-exported here.
 */
export { CONTRACT_PAYOUT_POINTS, PRICE_MAX, PRICE_MIN } from "./constants";
export type { EngineErrorCode } from "./errors";
export { B_MAX, B_MIN, EngineError, MAX_CONTRACTS, MAX_POINTS } from "./errors";
export { costFunction, probabilityYes, quoteContracts, quotePoints, tradeCost } from "./lmsr";
export { maxPoolLoss, payout, voidRefund } from "./settlement";
export type { MarketState, Outcome, PositionLike, Quote, Side } from "./types";

import { PRICE_MAX, PRICE_MIN } from "./constants";
import { describe } from "./errors";

/** Clamp a probability into the closed interval the engine quotes in: [0.01, 0.99]. */
export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) {
    throw new RangeError(`probability must be finite, got ${describe(p)}`);
  }
  return Math.min(PRICE_MAX / 100, Math.max(PRICE_MIN / 100, p));
}
