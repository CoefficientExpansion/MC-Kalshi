import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PRICE_MAX, PRICE_MIN } from "./constants";
import { clampProbability, displayPrice } from "./display";
import { EngineError } from "./errors";

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

describe("clampProbability", () => {
  it("leaves in-range values untouched", () => {
    expect(clampProbability(0.5)).toBe(0.5);
    expect(clampProbability(0.01)).toBe(0.01);
    expect(clampProbability(0.99)).toBe(0.99);
  });

  it("clamps out-of-range values to the quoting interval", () => {
    expect(clampProbability(0)).toBe(0.01);
    expect(clampProbability(1)).toBe(0.99);
    expect(clampProbability(-3)).toBe(0.01);
    expect(clampProbability(42)).toBe(0.99);
  });

  it("rejects non-finite input with an EngineError (INVALID_STATE)", () => {
    expect(codeOf(() => clampProbability(Number.NaN))).toBe("INVALID_STATE");
    expect(codeOf(() => clampProbability(Number.POSITIVE_INFINITY))).toBe("INVALID_STATE");
    expect(codeOf(() => clampProbability(Number.NEGATIVE_INFINITY))).toBe("INVALID_STATE");
  });

  it("rejects a null-prototype object or a symbol with an EngineError, not a TypeError", () => {
    expect(codeOf(() => clampProbability(Object.create(null) as never))).toBe("INVALID_STATE");
    expect(codeOf(() => clampProbability(Symbol("p") as never))).toBe("INVALID_STATE");
  });

  it("property: in-range input is returned unchanged", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 0.99, noNaN: true }), (p) => {
        expect(clampProbability(p)).toBe(p);
      }),
      { numRuns: 500 },
    );
  });

  it("property: result is always within [PRICE_MIN/100, PRICE_MAX/100] and idempotent", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (p) => {
        const c = clampProbability(p);
        expect(c).toBeGreaterThanOrEqual(PRICE_MIN / 100);
        expect(c).toBeLessThanOrEqual(PRICE_MAX / 100);
        expect(clampProbability(c)).toBe(c);
      }),
      { numRuns: 500 },
    );
  });
});

describe("displayPrice", () => {
  it("is the clamped probability as a whole percent", () => {
    expect(displayPrice(0.5)).toBe(50);
    expect(displayPrice(0.004)).toBe(1);
    expect(displayPrice(0.999)).toBe(99);
    expect(displayPrice(0)).toBe(1);
    expect(displayPrice(1)).toBe(99);
  });

  it("rounds a half up: 0.505 × 100 evaluates to exactly 50.5 in doubles and Math.round gives 51", () => {
    // 0.505 is stored as 0.50500000000000000444…; the product rounds to the double 50.5, and
    // Math.round rounds halves toward +∞.
    expect(0.505 * 100).toBe(50.5);
    expect(displayPrice(0.505)).toBe(51);
  });

  it("rejects non-finite input with an EngineError (INVALID_STATE)", () => {
    expect(codeOf(() => displayPrice(Number.NaN))).toBe("INVALID_STATE");
    expect(codeOf(() => displayPrice(Number.POSITIVE_INFINITY))).toBe("INVALID_STATE");
  });

  it("property: always an integer in PRICE_MIN..PRICE_MAX", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (p) => {
        const price = displayPrice(p);
        expect(Number.isInteger(price)).toBe(true);
        expect(price).toBeGreaterThanOrEqual(PRICE_MIN);
        expect(price).toBeLessThanOrEqual(PRICE_MAX);
      }),
      { numRuns: 500 },
    );
  });
});
