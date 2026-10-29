/**
 * MC-Kalshi market engine: pure functions only (no I/O). See docs/architecture.md §5.
 * A contract pays CONTRACT_PAYOUT_POINTS on the winning side; quotes live in PRICE_MIN..PRICE_MAX.
 */
export const CONTRACT_PAYOUT_POINTS = 100;
export const PRICE_MIN = 1;
export const PRICE_MAX = 99;

/** Clamp a probability into the closed interval the engine quotes in: [0.01, 0.99]. */
export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) {
    throw new RangeError(`probability must be finite, got ${p}`);
  }
  return Math.min(PRICE_MAX / 100, Math.max(PRICE_MIN / 100, p));
}
