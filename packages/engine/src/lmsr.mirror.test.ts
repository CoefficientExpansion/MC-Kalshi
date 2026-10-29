import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quoteContracts } from "./lmsr";
import type { MarketState, Side } from "./types";

/**
 * Mirror trades: buying Δ on a side whose q is the other side's q minus Δ/2 moves the state to
 * its mirror image, and the exact cost is 100·b·ln(e^{Δ/2b}) = 50·Δ points. When 50·Δ is a whole
 * number, any floating-point noise must not push the rounded cost a point up (or the sell-back
 * proceeds a point down). An independent comparison found another engine off by a whole point
 * here; this pins ours to the exact answer.
 */
function mirrorState(side: Side, otherMicros: number, deltaMicros: number, b: number): MarketState {
  const sideQ = (otherMicros - deltaMicros / 2) / 1e6;
  const otherQ = otherMicros / 1e6;
  return side === "YES" ? { qYes: sideQ, qNo: otherQ, b } : { qYes: otherQ, qNo: sideQ, b };
}

/** Buys Δ = k/50 contracts (so 50·Δ = k points exactly) and sells it straight back. */
function checkMirror(side: Side, otherMicros: number, k: number, b: number): void {
  const deltaMicros = k * 20_000;
  const delta = deltaMicros / 1e6;
  const state = mirrorState(side, otherMicros, deltaMicros, b);
  const buy = quoteContracts(state, side, delta);
  expect(buy.contracts).toBe(delta);
  expect(buy.costPoints).toBe(k);
  const sell = quoteContracts(buy.stateAfter, side, -delta);
  expect(sell.costPoints).toBe(-k);
  expect(sell.stateAfter).toEqual(state);
}

describe("mirror trades cost exactly 50·Δ points", () => {
  it("fixed cases: fresh-ish, fractional and large states", () => {
    checkMirror("YES", 10_000_000, 2, 100); // Δ = 0.04 at q = 10
    checkMirror("NO", 5_000_000, 50, 100); // Δ = 1: qNo = 4.5, qYes = 5
    checkMirror("YES", 0, 500, 100); // Δ = 10 from (−5, 0): exactly 500 points
    checkMirror("YES", 1_000_000_123_456, 1000, 250); // q ≈ 1e6 with six-decimal fractions
    checkMirror("NO", 999_999_999_999, 37, 50);
    checkMirror("YES", 123_456_789, 25_000, 500); // Δ = 500
  });

  it("property: small fractional states (≥ 500 runs)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Side>("YES", "NO"),
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), // q within ±1000, six decimals
        fc.integer({ min: 1, max: 50_000 }), // Δ up to 1000 contracts
        fc.integer({ min: 50, max: 500 }),
        (side, otherMicros, k, b) => checkMirror(side, otherMicros, k, b),
      ),
      { numRuns: 1000 },
    );
  });

  it("property: large fractional states around 1e6 contracts (≥ 500 runs)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Side>("YES", "NO"),
        fc.integer({ min: 900_000_000_000, max: 1_100_000_000_000 }), // q ≈ 1e6, six decimals
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 50, max: 500 }),
        (side, otherMicros, k, b) => checkMirror(side, otherMicros, k, b),
      ),
      { numRuns: 1000 },
    );
  });
});
