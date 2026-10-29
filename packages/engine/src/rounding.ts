/**
 * The only place the engine rounds. Every rule favors the pool (architecture §5):
 * a buyer's cost rounds up, a seller's proceeds round down, contracts keep six decimals.
 * Point values carry a tolerance of one part in 10¹² (at least 10⁻¹², at most 10⁻⁶ points) so
 * floating-point noise (e.g. 500.0000000001 for an exact 500) cannot move a whole-point
 * boundary; that is the only way a rounding rule can favor the user, and by at most 10⁻⁶ points.
 */
const MICRO = 1e6;
const RELATIVE_TOLERANCE = 1e-12;
const MAX_TOLERANCE = 1e-6;

/** Maps −0 to +0; every other value passes through. */
export function noNegativeZero(x: number): number {
  return x === 0 ? 0 : x;
}

function tolerance(x: number): number {
  return Math.min(MAX_TOLERANCE, Math.max(RELATIVE_TOLERANCE, RELATIVE_TOLERANCE * Math.abs(x)));
}

/** Whole points a buyer pays for a fractional cost. */
export function ceilPoints(x: number): number {
  return noNegativeZero(Math.ceil(x - tolerance(x)));
}

/** Whole points a seller receives for fractional proceeds. */
export function floorPoints(x: number): number {
  return noNegativeZero(Math.floor(x + tolerance(x)));
}

/** Contracts to six decimals, half away from zero. */
export function roundContracts(x: number): number {
  return noNegativeZero((Math.sign(x) * Math.round(Math.abs(x) * MICRO)) / MICRO);
}

/** Contracts truncated toward zero to six decimals (used when a budget must not be exceeded). */
export function floorContracts(x: number): number {
  return noNegativeZero((Math.sign(x) * Math.floor(Math.abs(x) * MICRO)) / MICRO);
}
