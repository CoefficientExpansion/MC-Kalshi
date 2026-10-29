import { PRICE_MAX, PRICE_MIN } from "./constants";
import { describe, EngineError } from "./errors";

/** Clamp a probability into the closed interval the engine quotes in: [0.01, 0.99]. */
export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) {
    throw new EngineError("INVALID_STATE", `probability must be finite, got ${describe(p)}`);
  }
  return Math.min(PRICE_MAX / 100, Math.max(PRICE_MIN / 100, p));
}

/**
 * The price shown to users: the clamped probability as a whole percent, an integer in
 * PRICE_MIN..PRICE_MAX. probabilityYes can return exactly 0 or 1 at extreme states; this never
 * shows 0 or 100.
 */
export function displayPrice(p: number): number {
  return Math.round(clampProbability(p) * 100);
}
