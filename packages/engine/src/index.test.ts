import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CONTRACT_PAYOUT_POINTS, clampProbability, PRICE_MAX, PRICE_MIN } from "./index";

describe("engine constants", () => {
  it("match architecture §5: a contract pays 100 points and quotes live in 1..99", () => {
    expect(CONTRACT_PAYOUT_POINTS).toBe(100);
    expect(PRICE_MIN).toBe(1);
    expect(PRICE_MAX).toBe(99);
  });
});

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

  it("rejects non-finite input", () => {
    expect(() => clampProbability(Number.NaN)).toThrow(RangeError);
    expect(() => clampProbability(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => clampProbability(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
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
