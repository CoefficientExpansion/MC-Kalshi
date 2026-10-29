import { MAX_CONTRACTS } from "@mc-kalshi/engine";

// The numeric(18,6) boundary (docs/specs/m3-trading.md). Drizzle returns `numeric` columns
// (q_yes, q_no, contracts) as strings; these two functions are the only places those strings and
// JavaScript numbers meet. Every value is an exact multiple of 1e-6 within the engine's
// micro-contract range (±MAX_CONTRACTS, i.e. at most 1e15 micro-contracts, all safe integers).
// No SQL arithmetic on `q` or contracts. Shared with client code: no server-only import.

/**
 * A stored or outgoing value that is not on the six-decimal grid or is out of range. Always a
 * bug or corrupt data, never user input, so callers map it to `internal_error` (it is not an
 * EngineError and has no `code`).
 */
export class NumericBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumericBoundaryError";
  }
}

const MICRO = 1e6;
/** Plain decimal as Postgres prints numeric: optional minus, digits, up to six decimals. */
const DECIMAL = /^-?\d+(\.\d{1,6})?$/;

function onGrid(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= MAX_CONTRACTS && Math.round(n * MICRO) / MICRO === n;
}

/** A numeric(18,6) string from the database as a number; throws NumericBoundaryError otherwise. */
export function parseNumeric(s: string): number {
  if (typeof s !== "string" || !DECIMAL.test(s)) {
    throw new NumericBoundaryError("numeric value is not a plain decimal with at most 6 places");
  }
  const n = Number(s);
  if (!onGrid(n)) {
    throw new NumericBoundaryError(`numeric value is outside ±${MAX_CONTRACTS}`);
  }
  return n === 0 ? 0 : n;
}

/** A contract amount as the numeric(18,6) string to store; throws NumericBoundaryError if off-grid. */
export function formatNumeric(n: number): string {
  if (typeof n !== "number" || !onGrid(n)) {
    throw new NumericBoundaryError(
      `contract amount must be finite, within ±${MAX_CONTRACTS} and a multiple of 1e-6`,
    );
  }
  return (n === 0 ? 0 : n).toFixed(6);
}
