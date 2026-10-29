import { describe, expect, it } from "vitest";
import { quoteContracts, quotePoints, tradeCost } from "./lmsr";

// Sides whose probability has underflowed to exactly 0 (gap ≫ 745·b) must still price finitely.
const saturated = { qYes: 1e6, qNo: -1e6, b: 50 };

describe("underflowed sides", () => {
  it("prices a huge buy of the worthless side at about nothing, never -Infinity", () => {
    const cost = tradeCost(saturated, "NO", 40000);
    expect(Number.isFinite(cost)).toBe(true);
    expect(Math.abs(cost)).toBeLessThan(1e-6);
    expect(quoteContracts(saturated, "NO", 40000).costPoints).toBe(1);
  });

  it("prices a huge sell of the certain side at 100 points per contract", () => {
    const cost = tradeCost(saturated, "YES", -40000);
    expect(cost).toBeCloseTo(-4_000_000, 3);
    expect(quoteContracts(saturated, "YES", -40000).costPoints).toBe(-4_000_000);
  });

  it("inverts a budget on the worthless side and a huge budget on a fresh market", () => {
    const cheap = quotePoints({ qYes: 0, qNo: 36000, b: 50 }, "YES", 10);
    expect(cheap.contracts).toBeGreaterThan(0);
    expect(cheap.costPoints).toBeLessThanOrEqual(10);
    const huge = quotePoints({ qYes: 0, qNo: 0, b: 50 }, "YES", 4_000_000);
    expect(Number.isFinite(huge.contracts)).toBe(true);
    expect(huge.costPoints).toBeLessThanOrEqual(4_000_000);
    expect(huge.costPoints).toBeGreaterThan(3_999_000);
  });
});
