/**
 * MC-Kalshi market engine: pure functions only (no I/O). See docs/architecture.md §5 and
 * docs/specs/m1-engine.md. Everything the app may import is re-exported here.
 */
export { CONTRACT_PAYOUT_POINTS, PRICE_MAX, PRICE_MIN } from "./constants";
export { clampProbability, displayPrice } from "./display";
export type { EngineErrorCode } from "./errors";
export { B_MAX, B_MIN, EngineError, MAX_CONTRACTS, MAX_POINTS } from "./errors";
export { costFunction, probabilityYes, quoteContracts, quotePoints, tradeCost } from "./lmsr";
export type { Fill, Position } from "./positions";
export {
  applyFill,
  EMPTY_POSITION,
  settlePayouts,
  voidRefunds,
  withinSlippage,
} from "./positions";
export { maxPoolLoss, payout, voidRefund } from "./settlement";
export type { MarketState, Outcome, PositionLike, Quote, Side } from "./types";
