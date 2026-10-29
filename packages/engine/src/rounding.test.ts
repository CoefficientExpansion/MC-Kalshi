import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ceilPoints, floorContracts, floorPoints, roundContracts } from "./rounding";

describe("ceilPoints (what a buyer pays)", () => {
  it("rounds any fraction of a point up to the next whole point", () => {
    expect(ceilPoints(0.000001)).toBe(1);
    expect(ceilPoints(499.000001)).toBe(500);
    expect(ceilPoints(500)).toBe(500);
  });

  it("ignores floating-point noise within one part in 10¹²", () => {
    expect(ceilPoints(500.0000000001)).toBe(500);
    expect(ceilPoints(500.000001)).toBe(501);
  });

  it("never returns negative zero", () => {
    expect(Object.is(ceilPoints(-0), 0)).toBe(true);
    expect(Object.is(ceilPoints(-0.0000000001), 0)).toBe(true);
  });
});

describe("floorPoints (what a seller receives)", () => {
  it("drops any fraction of a point", () => {
    expect(floorPoints(0.999999)).toBe(0);
    expect(floorPoints(500.999999)).toBe(500);
    expect(floorPoints(500)).toBe(500);
  });

  it("ignores floating-point noise within one part in 10¹²", () => {
    expect(floorPoints(499.9999999999)).toBe(500);
    expect(floorPoints(499.999999)).toBe(499);
  });
});

describe("rounding tolerance at large magnitudes", () => {
  it("is capped so a real fraction of a point is never swallowed", () => {
    expect(ceilPoints(1e12 + 0.4)).toBe(1e12 + 1);
    expect(floorPoints(1e12 + 0.6)).toBe(1e12);
  });
});

describe("contract rounding", () => {
  it("roundContracts keeps six decimals, half away from zero", () => {
    expect(roundContracts(1.23456789)).toBe(1.234568);
    expect(roundContracts(1.2345645)).toBe(1.234565);
    expect(roundContracts(-1.23456789)).toBe(-1.234568);
    expect(Object.is(roundContracts(-0), 0)).toBe(true);
  });

  it("floorContracts truncates toward zero to six decimals", () => {
    expect(floorContracts(9.7622009)).toBe(9.7622);
    expect(floorContracts(0.0000019)).toBe(0.000001);
    expect(Object.is(floorContracts(0.0000001), 0)).toBe(true);
  });

  it("property: rounded contracts are idempotent and within half a micro-contract", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x) => {
        const r = roundContracts(x);
        expect(roundContracts(r)).toBe(r);
        expect(Math.abs(r - x)).toBeLessThanOrEqual(0.0000005 + 1e-9);
      }),
      { numRuns: 500 },
    );
  });
});
